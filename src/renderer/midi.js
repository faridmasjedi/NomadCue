// MIDI service (Web MIDI): output for MIDI / MSC / SysEx / MIDI File / MTC timecode cues, input for triggers.
import { buildMidiMessage, parseMscMessage } from './lib/model.js';
import { parseMidiFile } from './lib/smf.js';

export class MidiService {
  constructor({ getSettings, log }) {
    this.getSettings = getSettings;
    this.log = log;
    this.access = null;
    this.inputHandlers = new Set();
  }

  async init() {
    if (!navigator.requestMIDIAccess) { this.log('Web MIDI unavailable'); return; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => this.bindInputs();
      this.bindInputs();
    } catch (e) { this.log('MIDI access denied: ' + e.message); }
  }

  bindInputs() {
    if (!this.access) return;
    const want = this.getSettings().midi.inputId;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = !want || want === input.id ? (e) => this.onMessage([...e.data], input) : null;
    }
  }

  onInput(fn) { this.inputHandlers.add(fn); return () => this.inputHandlers.delete(fn); }

  onMessage(data, input) {
    const msc = data[0] === 0xf0 ? parseMscMessage(data) : null;
    for (const fn of this.inputHandlers) fn({ data, msc, input: input.name });
  }

  outputs() { return this.access ? [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name })) : []; }
  inputs() { return this.access ? [...this.access.inputs.values()].map((o) => ({ id: o.id, name: o.name })) : []; }

  output(id) {
    if (!this.access) return null;
    const wanted = id || this.getSettings().midi.outputId;
    const outs = [...this.access.outputs.values()];
    return outs.find((o) => o.id === wanted) || outs[0] || null;
  }

  send(bytes, outputId, timestamp) {
    const out = this.output(outputId);
    if (!out) { this.log('No MIDI output available'); return false; }
    try { out.send(bytes, timestamp); return true; } catch (e) { this.log('MIDI send failed: ' + e.message); return false; }
  }

  sendCue(cue) { return this.send(buildMidiMessage(cue), cue.outputId); }

  // Schedules events ahead using Web MIDI timestamps for tight timing.
  async playFile(cue, run) {
    const bytes = await window.nq.readBinary(cue.file);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { events, duration } = parseMidiFile(ab);
    const rate = Number(cue.rate) || 1;
    const out = this.output(cue.outputId);
    if (!out) throw new Error('No MIDI output available');
    return new ScheduledStream(run, duration / rate, (from, to) => {
      const t0 = performance.now();
      return { t0, events: events.filter((e) => e.time / rate >= from && e.time / rate < to).map((e) => ({ at: e.time / rate, data: e.data })) };
    }, out, () => { for (let ch = 0; ch < 16; ch++) out.send([0xb0 | ch, 123, 0]); });
  }

  // MIDI Time Code generator (quarter-frame messages + full-frame on start).
  playTimecode(cue, run) {
    const out = this.output(cue.outputId);
    if (!out) throw new Error('No MIDI output available');
    const fps = Number(cue.fps) || 30;
    const rateCode = { 24: 0, 25: 1, 29.97: 2, 30: 3 }[fps] ?? 3;
    const [hh, mm, ss, ff] = String(cue.startTC || '00:00:00:00').split(/[:;.]/).map((n) => parseInt(n, 10) || 0);
    const startFrames = ((hh * 60 + mm) * 60 + ss) * Math.round(fps) + ff;
    const tcAt = (frame) => {
      const f = Math.round(fps);
      return { h: Math.floor(frame / (f * 3600)) % 24, m: Math.floor(frame / (f * 60)) % 60, s: Math.floor(frame / f) % 60, f: frame % f };
    };
    const full = (tc) => [0xf0, 0x7f, 0x7f, 0x01, 0x01, (rateCode << 5) | tc.h, tc.m, tc.s, tc.f, 0xf7];
    out.send(full(tcAt(startFrames)));
    const qfInterval = 1 / (fps * 4);
    const duration = Number(cue.duration) || 0;
    return new ScheduledStream(run, duration > 0 ? duration : Infinity, (from, to) => {
      const evts = [];
      let i = Math.ceil(from / qfInterval);
      for (; i * qfInterval < to; i++) {
        const piece = i % 8;
        const frame = startFrames + 2 * Math.floor(i / 8); // one 8-piece QF sequence spans 2 frames
        const tc = tcAt(frame);
        const values = [tc.f & 0xf, tc.f >> 4, tc.s & 0xf, tc.s >> 4, tc.m & 0xf, tc.m >> 4, tc.h & 0xf, ((tc.h >> 4) & 1) | (rateCode << 1)];
        evts.push({ at: i * qfInterval, data: [0xf1, (piece << 4) | values[piece]] });
      }
      return { events: evts };
    }, out);
  }
}

// Generic look-ahead scheduler used by MIDI File and Timecode cues.
class ScheduledStream {
  constructor(run, duration, window, out, onStop) {
    this.run = run;
    this.duration = duration;
    this.window = window;
    this.out = out;
    this.onStop = onStop;
    this.lookahead = 0.2;
    this.pos = 0; // seconds of stream already scheduled
    this.startPerf = performance.now();
    this.pausedMs = 0;
    this.interval = setInterval(() => this.pump(), 50);
    this.pump();
  }

  elapsed() { return ((this.pausedAt || performance.now()) - this.startPerf - this.pausedMs) / 1000; }

  pump() {
    if (this.pausedAt) return;
    const now = this.elapsed();
    const until = Math.min(this.duration, now + this.lookahead);
    if (until > this.pos) {
      const { events } = this.window(this.pos, until);
      const base = this.startPerf + this.pausedMs;
      for (const e of events) try { this.out.send(e.data, base + e.at * 1000); } catch (_) {}
      this.pos = until;
    }
    if (now >= this.duration) this.finish();
  }

  pause() { this.pausedAt = performance.now(); }
  resume() {
    if (!this.pausedAt) return;
    this.pausedMs += performance.now() - this.pausedAt;
    this.pausedAt = 0;
  }
  stop() { if (this.out.clear) try { this.out.clear(); } catch (_) {} this.onStop?.(); this.finish(); }
  finish() {
    if (this.done) return;
    this.done = true;
    clearInterval(this.interval);
    this.run.done();
  }
}
