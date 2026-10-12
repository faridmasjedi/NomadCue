// Cue playback engine: playhead, GO, pre-wait / post-wait, continue modes, groups, pause, stop, panic.
// Pure logic. Media/lighting/network behaviour is injected as `handlers[type](cue, run, engine)`.
//
// A handler either returns nothing (instant cue: it is done as soon as it starts) or an action object:
//   { stop(fadeSeconds), pause(), resume(), fade?(params, duration, curve), devamp?(), elapsed?(), duration? }
// and calls run.done() when the action has naturally finished.
import { findCue, findCueByNumber, cueAfterSequence, siblingsOf, walk } from './model.js';

export class PTimer {
  constructor(seconds, fn, clock) {
    this.fn = fn;
    this.clock = clock;
    this.remaining = Math.max(0, seconds) * 1000;
    this.handle = null;
    this.startedAt = 0;
    this.fired = false;
    this.resume();
  }
  resume() {
    if (this.fired || this.handle) return;
    if (this.remaining <= 0) { this.fired = true; this.fn(); return; } // zero waits fire synchronously (lowest GO latency)
    this.startedAt = this.clock.now();
    this.handle = this.clock.setTimeout(() => { this.handle = null; this.fired = true; this.fn(); }, this.remaining);
  }
  pause() {
    if (!this.handle) return;
    this.clock.clearTimeout(this.handle);
    this.handle = null;
    this.remaining = Math.max(0, this.remaining - (this.clock.now() - this.startedAt));
  }
  cancel() {
    if (this.handle) this.clock.clearTimeout(this.handle);
    this.handle = null;
    this.fired = true;
  }
  get pending() { return !this.fired; }
}

const defaultClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

let runSeq = 0;

export class Run {
  constructor(engine, cue, parentRun) {
    this.id = 'r' + ++runSeq;
    this.engine = engine;
    this.cue = cue;
    this.parentRun = parentRun || null;
    this.children = new Set();
    this.state = 'prewait'; // prewait | running | done
    this.paused = false;
    this.action = null;
    this.actionDone = false;
    this.preTimer = null;
    this.postTimer = null;
    this.startedAt = 0;
    this.pausedTotal = 0;
    this.pausedAt = 0;
    this.finished = false;
  }

  // Called by handlers when the cue's action has completed on its own.
  done() {
    if (this.actionDone) return;
    this.actionDone = true;
    if (this.cue.continueMode === 'auto-follow' && !this.cancelled) this.engine._continueAfter(this);
    this._maybeFinish();
  }

  _maybeFinish() {
    if (this.finished) return;
    if (this.isGroup && !this.actionDone && this.state === 'running' && this.children.size === 0) {
      this.done(); // a group's action ends when its last child finishes
      return;
    }
    if (this.state !== 'running' || !this.actionDone) return;
    if (this.postPending) return;
    if (this.children.size) return;
    this.finished = true;
    this.state = 'done';
    this.engine._removeRun(this);
  }

  elapsed() {
    if (this.state === 'prewait') return 0;
    if (this.action && this.action.elapsed) return this.action.elapsed();
    const now = this.paused ? this.pausedAt : this.engine.clock.now();
    return Math.max(0, (now - this.startedAt - this.pausedTotal) / 1000);
  }

  preWaitRemaining() {
    if (this.state !== 'prewait' || !this.preTimer) return 0;
    const t = this.preTimer;
    return (t.handle ? t.remaining - (this.engine.clock.now() - t.startedAt) : t.remaining) / 1000;
  }

  duration() {
    if (this.action && this.action.duration !== undefined && this.action.duration !== null) {
      return typeof this.action.duration === 'function' ? this.action.duration() : this.action.duration;
    }
    return this.cue.duration || null;
  }
}

export class Engine {
  constructor({ getWorkspace, handlers = {}, clock = defaultClock, log = () => {} }) {
    this.getWorkspace = getWorkspace;
    this.handlers = handlers;
    this.clock = clock;
    this.log = log;
    this.runs = new Map(); // run.id -> Run
    this.activeListId = null;
    this.playheadId = null;
    this.listeners = new Set();
    this.lastGo = -Infinity;
    this.minGoInterval = 0;
  }

  get ws() { return this.getWorkspace(); }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) try { fn(); } catch (e) { console.error(e); } }

  activeList() {
    const ws = this.ws;
    return ws.lists.find((l) => l.id === this.activeListId) || ws.lists[0];
  }

  setActiveList(id) {
    this.activeListId = id;
    const list = this.activeList();
    if (!this.playheadId || !findCue(this.ws, this.playheadId) || findCue(this.ws, this.playheadId).list !== list) {
      this.playheadId = list && list.kind !== 'cart' && list.cues[0] ? list.cues[0].id : null;
    }
    this.emit();
  }

  setPlayhead(id) {
    this.playheadId = id || null;
    this.emit();
  }

  playheadCue() {
    return this.playheadId ? findCue(this.ws, this.playheadId)?.cue || null : null;
  }

  // Cues the playhead steps through: top-level cues plus the children of "step" groups.
  playheadStops(list = this.activeList()) {
    const out = [];
    const visit = (cues) => {
      for (const c of cues) {
        out.push(c);
        if (c.type === 'group' && c.mode === 'step') visit(c.children);
      }
    };
    if (list) visit(list.cues);
    return out;
  }

  movePlayhead(delta) {
    const stops = this.playheadStops();
    if (!stops.length) return;
    let i = stops.findIndex((c) => c.id === this.playheadId);
    if (i < 0) i = delta > 0 ? -1 : stops.length;
    this.setPlayhead(stops[Math.max(0, Math.min(stops.length - 1, i + delta))].id);
  }

  // Where the playhead lands after GO on `cue`: the first cue after its auto-continue/auto-follow
  // sequence, climbing out of groups once a group's children are used up.
  nextAfterGo(cue) {
    let id = cue.id;
    for (;;) {
      const f = findCue(this.ws, id);
      if (!f) return null;
      const after = cueAfterSequence(f.parent ? f.parent.children : f.list.cues, id);
      if (after) return after;
      if (!f.parent) return null;
      id = f.parent.id;
    }
  }

  runsFor(cueId) {
    return [...this.runs.values()].filter((r) => r.cue.id === cueId);
  }

  isRunning(cueId) {
    return this.runsFor(cueId).length > 0;
  }

  // ------------------------------------------------------------- transport

  go() {
    const now = this.clock.now();
    if (now - this.lastGo < this.minGoInterval * 1000) return false; // double-GO protection
    this.lastGo = now;
    let cue = this.playheadCue();
    if (!cue) return false;
    // "step" groups: GO enters the group and fires its first child; later GOs step through the rest.
    while (cue.type === 'group' && cue.mode === 'step' && cue.children.length) cue = cue.children[0];
    this.playheadId = this.nextAfterGo(cue)?.id ?? null;
    this.trigger(cue);
    this.emit();
    return true;
  }

  goToNumber(number) {
    const cue = findCueByNumber(this.ws, number);
    if (cue) this.trigger(cue);
    return !!cue;
  }

  trigger(cue, parentRun = null, noChain = false) {
    if (!cue) return null;
    const existing = this.runsFor(cue.id);
    if (existing.length) {
      if (cue.retrigger === 'restart') existing.forEach((r) => this._stopRun(r, 0));
      else if (cue.retrigger === 'stop') { existing.forEach((r) => this._stopRun(r, 0)); this.emit(); return null; }
      else if (cue.retrigger === 'pause') { existing.forEach((r) => (r.paused ? this._resumeRun(r) : this._pauseRun(r))); this.emit(); return null; }
      else return null; // ignore
    }
    const run = new Run(this, cue, parentRun);
    run.noChain = noChain;
    if (parentRun) parentRun.children.add(run);
    this.runs.set(run.id, run);
    run.preTimer = new PTimer(Number(cue.preWait) || 0, () => this._begin(run), this.clock);
    this.emit();
    return run;
  }

  _begin(run) {
    const { cue } = run;
    run.state = 'running';
    run.startedAt = this.clock.now();
    const autoContinue = cue.continueMode === 'auto-continue';
    run.postPending = autoContinue; // keeps the run alive until the continuation has fired
    if (cue.armed === false) {
      run.done();
    } else if (cue.type === 'group') {
      this._beginGroup(run);
    } else {
      const handler = this.handlers[cue.type];
      try {
        const action = handler ? handler(cue, run, this) : undefined;
        if (action && typeof action === 'object') run.action = action;
        else run.done();
      } catch (e) {
        this.log(`Cue ${cue.number || cue.id} (${cue.type}) failed: ${e.message}`);
        run.done();
      }
    }
    if (autoContinue) {
      run.postTimer = new PTimer(Number(cue.postWait) || 0, () => {
        run.postPending = false;
        this._continueAfter(run);
        run._maybeFinish();
      }, this.clock);
    }
    this.emit();
  }

  _beginGroup(run) {
    const kids = run.cue.children || [];
    if (!kids.length) { run.done(); return; }
    run.isGroup = true;
    if (run.cue.mode === 'all') kids.forEach((k) => this._triggerChild(k, run, false));
    else if (run.cue.mode === 'random') this._triggerChild(kids[Math.floor(Math.random() * kids.length)], run, false);
    else this._triggerChild(kids[0], run, true);
    run._maybeFinish();
  }

  _triggerChild(cue, parentRun, chain) {
    return this.trigger(cue, parentRun, !chain);
  }

  _continueAfter(run) {
    if (run.cancelled || run.noChain) return;
    const sibs = run.parentRun ? run.parentRun.cue.children : siblingsOf(this.ws, run.cue.id);
    if (!sibs) return;
    const i = sibs.findIndex((c) => c.id === run.cue.id);
    const next = sibs[i + 1];
    if (next) this.trigger(next, run.parentRun);
  }

  _removeRun(run) {
    this.runs.delete(run.id);
    const parent = run.parentRun;
    if (parent) {
      parent.children.delete(run);
      parent._maybeFinish();
    }
    this.emit();
  }

  _descendantRuns(run) {
    const out = [];
    for (const c of run.children) out.push(c, ...this._descendantRuns(c));
    return out;
  }

  _stopRun(run, fade = 0) {
    if (run.finished) return;
    run.cancelled = true;
    run.preTimer?.cancel();
    run.postTimer?.cancel();
    run.postPending = false;
    for (const child of [...run.children]) this._stopRun(child, fade);
    if (run.action && !run.actionDone) {
      try { run.action.stop(fade); } catch (e) { this.log(e.message); }
    }
    if (fade > 0 && run.action && !run.actionDone) {
      // action will call done() when its fade-out completes; force-finish as a safety net
      this.clock.setTimeout(() => { run.actionDone = true; run.state = 'running'; run._maybeFinish(); }, fade * 1000 + 250);
    } else {
      run.actionDone = true;
      run.state = 'running';
      run._maybeFinish();
    }
  }

  _pauseRun(run) {
    if (run.paused || run.finished) return;
    run.paused = true;
    run.pausedAt = this.clock.now();
    run.preTimer?.pause();
    run.postTimer?.pause();
    try { run.action?.pause?.(); } catch (_) {}
    for (const c of run.children) this._pauseRun(c);
  }

  _resumeRun(run) {
    if (!run.paused) return;
    run.paused = false;
    run.pausedTotal += this.clock.now() - run.pausedAt;
    run.preTimer?.resume();
    run.postTimer?.resume();
    try { run.action?.resume?.(); } catch (_) {}
    for (const c of run.children) this._resumeRun(c);
  }

  topRuns(cueId) {
    return this.runsFor(cueId);
  }

  stopCue(cueId, fade = 0) {
    this.runsFor(cueId).forEach((r) => this._stopRun(r, fade));
    this.emit();
  }

  pauseCue(cueId) { this.runsFor(cueId).forEach((r) => this._pauseRun(r)); this.emit(); }
  resumeCue(cueId) { this.runsFor(cueId).forEach((r) => this._resumeRun(r)); this.emit(); }
  togglePauseCue(cueId) {
    const runs = this.runsFor(cueId);
    if (runs.some((r) => !r.paused)) runs.forEach((r) => this._pauseRun(r)); else runs.forEach((r) => this._resumeRun(r));
    this.emit();
  }

  stopAll(fade = 0) {
    for (const r of [...this.runs.values()]) if (!r.parentRun) this._stopRun(r, fade);
    for (const r of [...this.runs.values()]) this._stopRun(r, fade);
    this.emit();
  }

  panic(fade = 1) { this.stopAll(fade); }
  hardStop() { this.stopAll(0); }
  pauseAll() { for (const r of this.runs.values()) this._pauseRun(r); this.emit(); }
  resumeAll() { for (const r of this.runs.values()) this._resumeRun(r); this.emit(); }

  reset() {
    this.hardStop();
    const list = this.activeList();
    this.playheadId = list && list.kind !== 'cart' && list.cues[0] ? list.cues[0].id : null;
    this.emit();
  }

  // Applies fn(action, run) to every running action under the cue (incl. a group's descendants).
  forEachActionUnder(cueId, fn) {
    const found = findCue(this.ws, cueId);
    if (!found) return 0;
    const ids = new Set([...walk([found.cue])].map((x) => x.cue.id));
    let n = 0;
    for (const r of this.runs.values()) {
      if (ids.has(r.cue.id) && r.action && !r.actionDone) { fn(r.action, r); n++; }
    }
    return n;
  }
}
