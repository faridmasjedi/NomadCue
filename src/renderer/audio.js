// Audio engine (Web Audio). Every feature on: up to the device's channel count (128+), per-cue crosspoint matrix,
// per-cue & per-output levels, EQ/filters/compressor/delay/reverb, sample-accurate loops & slices, rate fades, meters.
import { dbToGain, ease, mediaUrl } from './lib/util.js';

const CURVE_POINTS = 128;

function curveArray(from, to, curve) {
  const arr = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) arr[i] = from + (to - from) * ease(curve, i / (CURVE_POINTS - 1));
  return arr;
}

// Smoothly ramp an AudioParam from its current value to `to`.
export function rampParam(ctx, param, to, seconds, curve = 'scurve') {
  const now = ctx.currentTime;
  const from = param.value;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now); else param.cancelScheduledValues(now);
  if (!seconds || seconds <= 0) { param.setValueAtTime(to, now); return; }
  param.setValueAtTime(from, now);
  param.setValueCurveAtTime(curveArray(from, to, curve), now + 0.001, seconds);
}

function makeImpulse(ctx, seconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * Math.max(0.1, seconds)));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

export class AudioEngine {
  constructor(log = console.log) {
    this.log = log;
    this.ctx = null;
    this.outCount = 2;
    this.outputs = []; // per-output GainNode (master faders)
    this.analysers = [];
    this.buffers = new Map(); // path -> Promise<AudioBuffer>
    this.impulses = new Map();
  }

  async init(settings) {
    if (this.ctx) try { await this.ctx.close(); } catch (_) {}
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (settings.deviceId && settings.deviceId !== 'default' && this.ctx.setSinkId) {
      try { await this.ctx.setSinkId(settings.deviceId); } catch (e) { this.log('Audio device unavailable, using default: ' + e.message); }
    }
    const dest = this.ctx.destination;
    const max = dest.maxChannelCount || 2;
    this.outCount = Math.max(1, Math.min(Number(settings.outputs) || 2, max));
    if (Number(settings.outputs) > max) this.log(`Device supports ${max} output channels; using ${this.outCount}.`);
    dest.channelCount = this.outCount;
    dest.channelCountMode = 'explicit';
    dest.channelInterpretation = 'discrete';
    this.merger = this.ctx.createChannelMerger(this.outCount);
    this.merger.connect(dest);
    this.outputs = [];
    this.analysers = [];
    for (let i = 0; i < this.outCount; i++) {
      const g = this.ctx.createGain();
      g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'discrete';
      const muted = settings.outputMutes?.[i];
      g.gain.value = muted ? 0 : dbToGain(settings.outputLevels?.[i] ?? 0);
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      g.connect(a);
      g.connect(this.merger, 0, i);
      this.outputs.push(g);
      this.analysers.push(a);
    }
    this.settings = settings;
    return { outputs: this.outCount, max, sampleRate: this.ctx.sampleRate };
  }

  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }

  setOutputLevel(i, db, muted) {
    if (this.outputs[i]) rampParam(this.ctx, this.outputs[i].gain, muted ? 0 : dbToGain(db), 0.05, 'linear');
  }

  async listDevices() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return {
        outputs: devs.filter((d) => d.kind === 'audiooutput').map((d) => ({ id: d.deviceId, label: d.label || d.deviceId })),
        inputs: devs.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label || d.deviceId })),
        cameras: devs.filter((d) => d.kind === 'videoinput').map((d) => ({ id: d.deviceId, label: d.label || d.deviceId })),
      };
    } catch (_) { return { outputs: [], inputs: [], cameras: [] }; }
  }

  load(path) {
    if (!path) return Promise.reject(new Error('No file'));
    if (!this.buffers.has(path)) {
      const p = fetch(mediaUrl(path))
        .then((r) => { if (!r.ok) throw new Error(`Cannot read ${path}`); return r.arrayBuffer(); })
        .then((ab) => this.ctx.decodeAudioData(ab));
      p.catch(() => { if (this.buffers.get(path) === p) this.buffers.delete(path); });
      this.buffers.set(path, p);
    }
    return this.buffers.get(path);
  }

  forget(path) { this.buffers.delete(path); }

  levels() {
    const out = [];
    const data = new Float32Array(512);
    for (const a of this.analysers) {
      a.getFloatTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      out.push(peak);
    }
    return out;
  }

  impulse(size) {
    const key = Math.round(size * 10);
    if (!this.impulses.has(key)) this.impulses.set(key, makeImpulse(this.ctx, size));
    return this.impulses.get(key);
  }

  // Builds the effect chain; returns { input, output, nodes }.
  buildFx(cue) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    let last = input;
    const chain = (node) => { last.connect(node); last = node; return node; };
    const nodes = {};
    if (cue.hpOn) { nodes.hp = chain(Object.assign(ctx.createBiquadFilter(), { type: 'highpass' })); nodes.hp.frequency.value = cue.hpFreq; }
    if (cue.eqOn) {
      nodes.low = chain(Object.assign(ctx.createBiquadFilter(), { type: 'lowshelf' })); nodes.low.frequency.value = 200; nodes.low.gain.value = cue.lowGain;
      nodes.mid = chain(Object.assign(ctx.createBiquadFilter(), { type: 'peaking' })); nodes.mid.frequency.value = cue.midFreq; nodes.mid.gain.value = cue.midGain; nodes.mid.Q.value = cue.midQ || 1;
      nodes.high = chain(Object.assign(ctx.createBiquadFilter(), { type: 'highshelf' })); nodes.high.frequency.value = 4000; nodes.high.gain.value = cue.highGain;
    }
    if (cue.lpOn) { nodes.lp = chain(Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' })); nodes.lp.frequency.value = cue.lpFreq; }
    if (cue.compOn) {
      const c = chain(ctx.createDynamicsCompressor());
      c.threshold.value = cue.threshold; c.ratio.value = cue.ratio; c.attack.value = cue.attack; c.release.value = cue.release;
      nodes.comp = c;
    }
    const wetDry = (makeWet, mixPct) => {
      const dry = ctx.createGain(); const wet = ctx.createGain(); const sum = ctx.createGain();
      dry.gain.value = 1 - mixPct / 100; wet.gain.value = mixPct / 100;
      last.connect(dry); dry.connect(sum);
      const wetIn = makeWet();
      last.connect(wetIn.input); wetIn.output.connect(wet); wet.connect(sum);
      last = sum;
    };
    if (cue.delayOn) {
      wetDry(() => {
        const d = ctx.createDelay(5); d.delayTime.value = cue.delayTime;
        const fb = ctx.createGain(); fb.gain.value = Math.min(0.95, cue.delayFeedback / 100);
        d.connect(fb); fb.connect(d);
        return { input: d, output: d };
      }, cue.delayMix);
    }
    if (cue.reverbOn) {
      wetDry(() => { const cv = ctx.createConvolver(); cv.buffer = this.impulse(cue.reverbSize); return { input: cv, output: cv }; }, cue.reverbMix);
    }
    return { input, output: last, nodes };
  }

  // Routes a multichannel source through cue level -> crosspoint matrix -> per-cue output levels -> device outputs.
  buildRouting(cue, inChannels) {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = dbToGain(cue.level);
    master.channelCount = inChannels; master.channelCountMode = 'explicit'; master.channelInterpretation = 'discrete';
    const splitter = ctx.createChannelSplitter(inChannels);
    master.connect(splitter);
    const outGains = [];
    for (let o = 0; o < this.outCount; o++) {
      const g = ctx.createGain();
      g.channelCount = 1; g.channelCountMode = 'explicit';
      g.gain.value = dbToGain(cue.outLevels?.[o] ?? 0);
      g.connect(this.outputs[o]);
      outGains.push(g);
    }
    const matrix = cue.matrix || defaultMatrix(inChannels, this.outCount);
    const crosspoints = [];
    for (let i = 0; i < inChannels; i++) {
      for (let o = 0; o < this.outCount; o++) {
        const db = matrix[i]?.[o];
        if (db === null || db === undefined || db === '' || db <= -60) continue;
        const x = ctx.createGain();
        x.gain.value = dbToGain(db);
        splitter.connect(x, i);
        x.connect(outGains[o]);
        crosspoints.push(x);
      }
    }
    return { master, outGains, crosspoints, nodes: [master, splitter, ...outGains, ...crosspoints] };
  }

  playCue(cue, run) { return new AudioPlayback(this, cue, run); }
  micCue(cue, run) { return new MicPlayback(this, cue, run); }
}

export function defaultMatrix(inCh, outCh) {
  const m = [];
  for (let i = 0; i < inCh; i++) {
    m.push(new Array(outCh).fill(null));
    if (inCh === 1) { m[0][0] = 0; if (outCh > 1) m[0][1] = 0; } else if (i < outCh) m[i][i] = 0;
  }
  return m;
}

class BasePlayback {
  constructor(engine, cue, run) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.cue = cue;
    this.run = run;
    this.stopped = false;
  }

  applyFade(params, seconds, curve) {
    const ctx = this.ctx;
    if (!this.routing) return;
    if (params.level !== undefined) rampParam(ctx, this.routing.master.gain, dbToGain(params.level), seconds, curve);
    if (params.outLevels) {
      for (const [o, db] of Object.entries(params.outLevels)) {
        const g = this.routing.outGains[Number(o)];
        if (g && db !== null && db !== '' && db !== undefined) rampParam(ctx, g.gain, dbToGain(db), seconds, curve);
      }
    }
  }

  fadeOutAndStop(seconds) {
    if (this.routing && seconds > 0) {
      rampParam(this.ctx, this.routing.master.gain, 0, seconds, 'scurve');
      this.fadeStopTimer = setTimeout(() => this.teardown(), seconds * 1000);
    } else {
      this.teardown();
    }
  }

  disconnect(nodes) {
    for (const n of nodes) try { n.disconnect(); } catch (_) {}
  }
}

export class AudioPlayback extends BasePlayback {
  constructor(engine, cue, run) {
    super(engine, cue, run);
    this.buffer = null;
    this.source = null;
    this.offset = Number(cue.startTime) || 0; // position in file where the next start begins
    this.rate = Number(cue.rate) || 1;
    this.loopsLeft = Number(cue.loops) === 0 ? Infinity : Math.max(1, Number(cue.loops) || 1);
    this.devamped = false;
    this.ready = engine.load(cue.file).then((buf) => {
      if (this.stopped) return;
      this.buffer = buf;
      this.sliceEnd = Number(cue.endTime) > 0 ? Math.min(Number(cue.endTime), buf.duration) : buf.duration;
      this.sliceStart = Math.min(Number(cue.startTime) || 0, this.sliceEnd);
      this.sliceLen = Math.max(0.001, this.sliceEnd - this.sliceStart);
      this.fx = engine.buildFx(cue);
      this.routing = engine.buildRouting(cue, buf.numberOfChannels);
      this.fx.output.connect(this.routing.master);
      if (cue.fadeIn > 0) {
        const target = this.routing.master.gain.value;
        this.routing.master.gain.value = 0;
        rampParam(this.ctx, this.routing.master.gain, target, cue.fadeIn, 'scurve');
      }
      if (!this.paused) this.startSource(this.offset); // paused while loading: wait for resume()
    }).catch((e) => {
      engine.log(`Audio cue ${cue.number || ''}: ${e.message}`);
      run.done();
    });
  }

  get duration() {
    if (!this.buffer) return null;
    if (this.loopsLeft === Infinity && !this.devamped) return Infinity;
    return (this.sliceLen * (Number(this.cue.loops) || 1)) / this.rate;
  }

  startSource(fromPos) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    const looping = this.loopsLeft > 1 && !this.devamped;
    src.loop = looping;
    src.loopStart = this.sliceStart;
    src.loopEnd = this.sliceEnd;
    src.connect(this.fx.input);
    this.source = src;
    this.startCtxTime = ctx.currentTime;
    this.startPos = fromPos;
    // Number of passes already completed before fromPos (for resume after pause)
    if (looping && this.loopsLeft !== Infinity) {
      const remaining = (this.sliceEnd - fromPos) + this.sliceLen * (this.loopsLeft - 1);
      src.start(0, fromPos, remaining);
    } else if (looping) {
      src.start(0, fromPos);
    } else {
      src.start(0, fromPos, Math.max(0, this.sliceEnd - fromPos));
    }
    src.onended = () => {
      if (src !== this.source || this.paused || this.stopped) return;
      this.finish();
    };
    if (this.cue.fadeOut > 0 && !looping) {
      const playLen = (this.sliceEnd - fromPos) / this.rate;
      const startFade = Math.max(0, playLen - this.cue.fadeOut);
      clearTimeout(this.autoFadeTimer);
      this.autoFadeTimer = setTimeout(() => rampParam(ctx, this.routing.master.gain, 0, Math.min(this.cue.fadeOut, playLen), 'scurve'), startFade * 1000);
    }
  }

  position() {
    if (!this.buffer) return this.offset;
    if (this.paused) return this.offset;
    const played = (this.ctx.currentTime - this.startCtxTime) * this.rate;
    let pos = this.startPos + played;
    if (this.source && this.source.loop && pos > this.sliceEnd) pos = this.sliceStart + ((pos - this.sliceStart) % this.sliceLen);
    return pos;
  }

  elapsed() {
    if (!this.buffer || !this.source) return 0;
    if (this.paused) return this.pausedElapsed || 0;
    return (this.ctx.currentTime - this.startCtxTime) + (this.elapsedBefore || 0);
  }

  pause() {
    if (this.paused) return;
    if (!this.source) { this.paused = true; this.pausedElapsed = 0; return; } // still loading
    this.pausedElapsed = this.elapsed();
    this.offset = this.position();
    this.paused = true;
    clearTimeout(this.autoFadeTimer);
    try { this.source.stop(); } catch (_) {}
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.elapsedBefore = this.pausedElapsed;
    if (this.buffer && !this.stopped) this.startSource(this.offset); // otherwise the loader starts it
  }

  devamp() {
    // Exit the loop at the end of the current pass.
    if (!this.source || !this.source.loop) return;
    this.devamped = true;
    const pos = this.position();
    const remaining = (this.sliceEnd - pos) / this.rate;
    this.source.loop = false;
    try { this.source.stop(this.ctx.currentTime + Math.max(0, remaining)); } catch (_) {}
    return remaining;
  }

  fade(params, seconds, curve) {
    this.applyFade(params, seconds, curve);
    if (params.rate !== undefined && this.source) {
      // keep elapsed/position bookkeeping consistent across rate changes
      this.offset = this.position();
      this.elapsedBefore = this.elapsed();
      this.startPos = this.offset;
      this.startCtxTime = this.ctx.currentTime;
      rampParam(this.ctx, this.source.playbackRate, params.rate, seconds, curve);
      this.rate = params.rate;
    }
  }

  stop(fade = 0) {
    this.stopped = true;
    clearTimeout(this.autoFadeTimer);
    if (!this.source) { this.finish(); return; }
    if (fade > 0) {
      this.fadeOutAndStop(fade);
    } else {
      this.teardown();
    }
  }

  teardown() {
    clearTimeout(this.fadeStopTimer);
    try { this.source?.stop(); } catch (_) {}
    this.disconnect([this.source, this.fx?.input, this.fx?.output, ...(this.routing?.nodes || [])].filter(Boolean));
    this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.autoFadeTimer);
    if (!this.stopped) this.disconnect([this.source, ...(this.routing?.nodes || [])].filter(Boolean));
    this.run.done();
  }
}

export class MicPlayback extends BasePlayback {
  constructor(engine, cue, run) {
    super(engine, cue, run);
    const constraints = {
      audio: {
        deviceId: cue.inputDeviceId ? { exact: cue.inputDeviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: { ideal: Number(cue.inputChannels) || 1 },
      },
    };
    this.startedAt = engine.ctx.currentTime;
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (this.stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      this.source = this.ctx.createMediaStreamSource(stream);
      const ch = Math.max(1, Number(cue.inputChannels) || 1);
      this.fx = engine.buildFx(cue);
      this.routing = engine.buildRouting(cue, ch);
      this.source.connect(this.fx.input);
      this.fx.output.connect(this.routing.master);
    }).catch((e) => { engine.log('Mic cue: ' + e.message); run.done(); });
  }

  get duration() { return Infinity; }
  elapsed() { return this.ctx.currentTime - this.startedAt; }
  pause() { if (this.routing) this.routing.master.gain.value = 0; }
  resume() { if (this.routing) this.routing.master.gain.value = dbToGain(this.cue.level); }
  fade(params, seconds, curve) { this.applyFade(params, seconds, curve); }
  stop(fade = 0) { this.stopped = true; if (fade > 0 && this.routing) this.fadeOutAndStop(fade); else this.teardown(); }
  teardown() {
    clearTimeout(this.fadeStopTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.disconnect([this.source, this.fx?.input, this.fx?.output, ...(this.routing?.nodes || [])].filter(Boolean));
    if (!this.finished) { this.finished = true; this.run.done(); }
  }
}

// Downsampled peak data for drawing waveforms.
export function waveformPeaks(buffer, width) {
  const peaks = new Float32Array(width * 2);
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const step = Math.max(1, Math.floor(len / width));
  for (let x = 0; x < width; x++) {
    let min = 1; let max = -1;
    const start = x * step;
    for (let c = 0; c < ch; c++) {
      const d = buffer.getChannelData(c);
      for (let i = start; i < start + step && i < len; i += 8) { const v = d[i]; if (v < min) min = v; if (v > max) max = v; }
    }
    peaks[x * 2] = min; peaks[x * 2 + 1] = max;
  }
  return peaks;
}
