// Cue type handlers: what each cue does when its action starts.
import { findCue, findCueByNumber, siblingsOf, CUE_TYPES } from './lib/model.js';

// A simple pausable timed action (Wait, Fade, …).
function timedAction(run, seconds, onEnd) {
  const start = performance.now();
  let pausedMs = 0;
  let pausedAt = 0;
  let timer = null;
  const schedule = (ms) => { timer = setTimeout(() => { onEnd?.(); run.done(); }, ms); };
  schedule(seconds * 1000);
  return {
    duration: seconds,
    elapsed: () => ((pausedAt || performance.now()) - start - pausedMs) / 1000,
    pause() { if (pausedAt) return; pausedAt = performance.now(); clearTimeout(timer); },
    resume() {
      if (!pausedAt) return;
      pausedMs += performance.now() - pausedAt; pausedAt = 0;
      schedule(Math.max(0, seconds * 1000 - (performance.now() - start - pausedMs)));
    },
    stop() { clearTimeout(timer); run.done(); },
  };
}

// Wraps an async-created action so the engine gets an action object immediately.
function deferredAction(run, promise, log) {
  let inner = null;
  let stopped = false;
  promise.then((a) => { inner = a; if (stopped) a?.stop(0); else if (!a) run.done(); })
    .catch((e) => { log(e.message); run.done(); });
  return {
    get duration() { return inner?.duration ?? null; },
    elapsed: () => inner?.elapsed?.() ?? 0,
    pause: () => inner?.pause?.(),
    resume: () => inner?.resume?.(),
    stop: (f) => { stopped = true; if (inner) inner.stop(f); else run.done(); },
  };
}

export function makeHandlers({ audio, video, lights, midi, getWs, log, onMutate, scriptApi }) {
  const target = (cue) => (cue.target ? findCue(getWs(), cue.target)?.cue : null);

  return {
    audio: (cue, run) => audio.playCue(cue, run),
    mic: (cue, run) => audio.micCue(cue, run),
    video: (cue, run) => video.play(cue, run),
    camera: (cue, run) => video.play(cue, run),
    text: (cue, run) => video.play(cue, run),
    light: (cue, run) => lights.playCue(cue, run),

    fade: (cue, run, engine) => {
      const t = target(cue);
      if (!t) { log(`Fade cue ${cue.number || ''} has no target`); return undefined; }
      const params = {};
      if (cue.fadeLevel) params.level = Number(cue.level);
      if (cue.fadeOutLevels) params.outLevels = cue.outLevels;
      if (cue.fadeRate) params.rate = Number(cue.rate);
      if (cue.fadeOpacity) params.opacity = Number(cue.opacity);
      if (cue.fadeGeometry) Object.assign(params, { x: Number(cue.x), y: Number(cue.y), scale: Number(cue.scale), rotation: Number(cue.rotation) });
      if (cue.fadeVolume) params.volume = Number(cue.volume);
      const dur = Math.max(0, Number(cue.duration) || 0);
      engine.forEachActionUnder(t.id, (action) => action.fade?.(params, dur, cue.curve));
      const end = () => { if (cue.stopTargetWhenDone) engine.stopCue(t.id, 0); };
      if (dur <= 0) { end(); return undefined; }
      return timedAction(run, dur, end);
    },

    network: (cue) => {
      const lines = String(cue.message || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const text of lines) {
        if (cue.protocol === 'udp') window.nq.sendUdp({ host: cue.host, port: Number(cue.port), text });
        else window.nq.sendOscString({ host: cue.host, port: Number(cue.port), text });
      }
    },

    midi: (cue) => { midi.sendCue(cue); },
    midifile: (cue, run) => deferredAction(run, midi.playFile(cue, run), log),
    timecode: (cue, run) => midi.playTimecode(cue, run),

    start: (cue, run, engine) => { const t = target(cue); if (t) engine.trigger(t); },
    stop: (cue, run, engine) => { const t = target(cue); if (t) engine.stopCue(t.id, Number(cue.fadeTime) || 0); },
    pause: (cue, run, engine) => { const t = target(cue); if (t) engine.pauseCue(t.id); },
    load: (cue) => {
      const t = target(cue);
      if (t && t.type === 'audio' && t.file) audio.load(t.file).catch((e) => log(e.message));
    },
    reset: (cue, run, engine) => {
      const t = target(cue);
      if (!t) return;
      engine.stopCue(t.id, 0);
      if (t._originalTarget !== undefined) {
        if (CUE_TYPES[t.type].targets === 'file') t.file = t._originalTarget; else t.target = t._originalTarget;
        delete t._originalTarget;
        onMutate();
      }
    },
    devamp: (cue, run, engine) => {
      const t = target(cue);
      if (!t) return;
      let remaining = 0;
      engine.forEachActionUnder(t.id, (a) => { const r = a.devamp?.(); if (typeof r === 'number') remaining = Math.max(remaining, r); });
      if (cue.startNext) {
        const sibs = siblingsOf(getWs(), t.id) || [];
        const next = sibs[sibs.findIndex((c) => c.id === t.id) + 1];
        if (next) setTimeout(() => engine.trigger(next), remaining * 1000);
      }
    },
    goto: (cue, run, engine) => { const t = target(cue); if (t) engine.setPlayhead(t.id); },
    target: (cue) => {
      const t = target(cue);
      if (!t || !cue.newTarget) return;
      const isFile = CUE_TYPES[t.type].targets === 'file';
      if (t._originalTarget === undefined) t._originalTarget = isFile ? t.file : t.target;
      if (isFile) t.file = cue.newTarget; else t.target = cue.newTarget;
      onMutate();
    },
    arm: (cue) => { const t = target(cue); if (t) { t.armed = true; onMutate(); } },
    disarm: (cue) => { const t = target(cue); if (t) { t.armed = false; onMutate(); } },
    wait: (cue, run) => (Number(cue.duration) > 0 ? timedAction(run, Number(cue.duration)) : undefined),
    memo: () => undefined,
    group: () => undefined,

    script: (cue, run, engine) => {
      const api = scriptApi(engine, cue);
      try {
        const fn = new Function('nq', 'cue', `"use strict"; return (async () => {\n${cue.code}\n})();`);
        const p = fn(api, cue);
        let done = false;
        p.then(() => { done = true; run.done(); }).catch((e) => { log(`Script cue ${cue.number || ''}: ${e.message}`); run.done(); });
        return { stop: () => { if (!done) run.done(); }, pause() {}, resume() {} };
      } catch (e) {
        log(`Script cue ${cue.number || ''}: ${e.message}`);
        return undefined;
      }
    },
  };
}

// API exposed to Script cues as `nq`.
export function makeScriptApi({ getWs, log, midi, lights, onMutate }) {
  return (engine) => {
    const byNum = (n) => findCueByNumber(getWs(), n);
    return {
      go: () => engine.go(),
      start: (n) => { const c = byNum(n); if (c) engine.trigger(c); return !!c; },
      stop: (n, fade = 0) => { const c = byNum(n); if (c) engine.stopCue(c.id, fade); },
      pause: (n) => { const c = byNum(n); if (c) engine.pauseCue(c.id); },
      resume: (n) => { const c = byNum(n); if (c) engine.resumeCue(c.id); },
      panic: () => engine.panic(1),
      stopAll: () => engine.hardStop(),
      playhead: (n) => { const c = byNum(n); if (c) engine.setPlayhead(c.id); },
      cue: (n) => byNum(n),
      set: (n, prop, value) => { const c = byNum(n); if (c) { c[prop] = value; onMutate(); } },
      isRunning: (n) => { const c = byNum(n); return c ? engine.isRunning(c.id) : false; },
      osc: (host, port, message) => window.nq.sendOscString({ host, port: Number(port), text: message }),
      udp: (host, port, text) => window.nq.sendUdp({ host, port: Number(port), text }),
      midi: (bytes, outputId) => midi.send(bytes, outputId),
      light: (commands, seconds = 0) => { const { targets } = lights.resolve(commands); lights.fadeTo(targets, seconds); },
      wait: (seconds) => new Promise((r) => setTimeout(r, seconds * 1000)),
      log: (...a) => log('[script] ' + a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')),
      workspace: () => getWs(),
    };
  };
}
