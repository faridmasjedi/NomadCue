// Lighting engine: unlimited patch, Art-Net / sACN output, timed crossfades, live dashboard overrides.
import { parseLightCommands, resolveLightCommands, FIXTURE_TYPES } from './lib/lightcmd.js';
import { ease } from './lib/util.js';

export class LightEngine {
  constructor({ getSettings, log }) {
    this.getSettings = getSettings;
    this.log = log;
    this.values = {}; // "instId.param" -> percent (current output)
    this.fades = new Map(); // key -> { from, to, start, dur, curve, owner }
    this.listeners = new Set();
    this.timer = null;
    this.lastSent = 0;
  }

  get settings() { return this.getSettings().lighting; }

  patch() {
    return (this.settings.patch || []).map((p) => ({ ...p, params: FIXTURE_TYPES[p.type]?.params || ['intensity'] }));
  }

  start() {
    this.stop();
    window.nq.configureDmx({ protocol: this.settings.protocol, host: this.settings.host, universeOffset: this.settings.universeOffset, enabled: this.settings.enabled });
    const hz = Math.max(1, Math.min(44, Number(this.settings.rate) || 40));
    this.timer = setInterval(() => this.tick(), 1000 / hz);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // Starts a crossfade to `targets` ({ key: percent }). Returns a promise-like handle.
  fadeTo(targets, seconds, curve = 'linear', owner = null) {
    const now = performance.now();
    for (const [key, to] of Object.entries(targets)) {
      const from = this.currentValue(key);
      if (seconds <= 0) { this.values[key] = to; this.fades.delete(key); continue; }
      this.fades.set(key, { from, to, start: now, dur: seconds * 1000, curve, owner });
    }
    this.dirty = true;
  }

  currentValue(key) {
    const f = this.fades.get(key);
    if (f) return f.from + (f.to - f.from) * ease(f.curve, Math.min(1, (performance.now() - f.start) / f.dur));
    return this.values[key] ?? 0;
  }

  stopOwner(owner) {
    for (const [key, f] of this.fades) if (f.owner === owner) { this.values[key] = this.currentValue(key); this.fades.delete(key); }
  }

  pauseOwner(owner) {
    const now = performance.now();
    for (const f of this.fades.values()) if (f.owner === owner && !f.pausedAt) f.pausedAt = now;
  }

  resumeOwner(owner) {
    const now = performance.now();
    for (const f of this.fades.values()) if (f.owner === owner && f.pausedAt) { f.start += now - f.pausedAt; f.pausedAt = null; }
  }

  setLive(key, percent) {
    this.fades.delete(key);
    this.values[key] = percent;
    this.dirty = true;
  }

  blackout(seconds = 0) {
    const t = {};
    for (const key of Object.keys(this.values)) t[key] = 0;
    for (const key of this.fades.keys()) t[key] = 0;
    this.fadeTo(t, seconds);
  }

  tick() {
    const now = performance.now();
    for (const [key, f] of this.fades) {
      if (f.pausedAt) continue;
      const t = Math.min(1, (now - f.start) / f.dur);
      this.values[key] = f.from + (f.to - f.from) * ease(f.curve, t);
      if (t >= 1) this.fades.delete(key);
      this.dirty = true;
    }
    // Always refresh at least once a second (Art-Net/sACN receivers time out otherwise)
    if (!this.dirty && now - this.lastSent < 1000) return;
    this.dirty = false;
    this.lastSent = now;
    window.nq.sendDmx(this.frames());
    for (const fn of this.listeners) fn();
  }

  frames() {
    const frames = {};
    for (const inst of this.patch()) {
      const u = Number(inst.universe) || 1;
      const frame = frames[u] || (frames[u] = new Array(512).fill(0));
      inst.params.forEach((param, i) => {
        const ch = (Number(inst.address) || 1) - 1 + i;
        if (ch >= 0 && ch < 512) frame[ch] = Math.round(((this.values[`${inst.id}.${param}`] ?? 0) / 100) * 255);
      });
    }
    for (const u of this.settings.universes || []) if (!frames[u]) frames[u] = new Array(512).fill(0);
    return frames;
  }

  resolve(text) {
    const { commands, errors } = parseLightCommands(text);
    return { targets: resolveLightCommands(commands, this.patch(), this.settings.groups || []), errors };
  }

  // Generates command text representing the current live state (for "record to cue").
  snapshotCommands() {
    const lines = [];
    for (const inst of this.patch()) {
      for (const p of inst.params) {
        const v = this.values[`${inst.id}.${p}`];
        if (v > 0.05) lines.push(`${inst.name || inst.number}${inst.params.length > 1 || p !== 'intensity' ? '.' + p : ''} = ${Math.round(v * 10) / 10}`);
      }
    }
    return lines.join('\n');
  }

  playCue(cue, run) {
    const { targets, errors } = this.resolve(cue.commands);
    errors.forEach((e) => this.log(`Light cue ${cue.number || ''}: ${e}`));
    const dur = Math.max(0, Number(cue.duration) || 0);
    const owner = run.id;
    this.fadeTo(targets, dur, cue.curve || 'linear', owner);
    const started = performance.now();
    let pausedMs = 0;
    let pausedAt = 0;
    let timer = null;
    const self = this;
    const schedule = (ms) => { timer = setTimeout(() => run.done(), ms); };
    if (dur > 0) schedule(dur * 1000); else return undefined;
    return {
      duration: dur,
      elapsed: () => ((pausedAt || performance.now()) - started - pausedMs) / 1000,
      stop() { clearTimeout(timer); self.stopOwner(owner); run.done(); },
      pause() { pausedAt = performance.now(); clearTimeout(timer); self.pauseOwner(owner); },
      resume() {
        pausedMs += performance.now() - pausedAt; pausedAt = 0; self.resumeOwner(owner);
        schedule(Math.max(0, dur * 1000 - (performance.now() - started - pausedMs)));
      },
    };
  }
}
