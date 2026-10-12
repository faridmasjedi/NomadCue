import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/renderer/lib/engine.js';
import { createWorkspace, createCue } from '../src/renderer/lib/model.js';

// Deterministic fake clock
function fakeClock() {
  let now = 0; let seq = 0; const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
  };
}

function setup(cues) {
  const ws = createWorkspace();
  ws.lists[0].cues = cues;
  const clock = fakeClock();
  const log = [];
  // "timed" handler: an action that lasts cue.duration seconds
  const timed = (cue, run, engine) => {
    log.push('start:' + cue.number);
    if (!cue.duration) return;
    let h = engine.clock.setTimeout(() => { log.push('end:' + cue.number); run.done(); }, cue.duration * 1000);
    return { stop() { engine.clock.clearTimeout(h); log.push('stop:' + cue.number); }, pause() {}, resume() {} };
  };
  const engine = new Engine({ getWorkspace: () => ws, clock, handlers: { memo: timed, wait: timed } });
  engine.setActiveList(ws.lists[0].id);
  return { ws, engine, clock, log };
}

test('GO starts playhead cue and advances', () => {
  const a = createCue('memo', { number: '1' }); const b = createCue('memo', { number: '2' });
  const { engine, log } = setup([a, b]);
  assert.equal(engine.playheadId, a.id);
  engine.go();
  assert.deepEqual(log, ['start:1']);
  assert.equal(engine.playheadId, b.id);
});

test('pre-wait delays the action', () => {
  const a = createCue('memo', { number: '1', preWait: 2 });
  const { engine, clock, log } = setup([a]);
  engine.go();
  clock.advance(1999); assert.deepEqual(log, []);
  clock.advance(1); assert.deepEqual(log, ['start:1']);
});

test('auto-continue fires next after post-wait and playhead skips the sequence', () => {
  const a = createCue('memo', { number: '1', continueMode: 'auto-continue', postWait: 1 });
  const b = createCue('memo', { number: '2' }); const c = createCue('memo', { number: '3' });
  const { engine, clock, log } = setup([a, b, c]);
  engine.go();
  assert.equal(engine.playheadId, c.id);
  clock.advance(1000);
  assert.deepEqual(log, ['start:1', 'start:2']);
});

test('auto-follow fires next when cue ends', () => {
  const a = createCue('wait', { number: '1', duration: 3, continueMode: 'auto-follow' });
  const b = createCue('memo', { number: '2' });
  const { engine, clock, log } = setup([a, b]);
  engine.go();
  clock.advance(2999); assert.deepEqual(log, ['start:1']);
  clock.advance(1); assert.deepEqual(log, ['start:1', 'end:1', 'start:2']);
  assert.equal(engine.runs.size, 0);
});

test('group "all" fires every child; group "first" chains children', () => {
  const g1 = createCue('group', { number: '1', mode: 'all', children: [createCue('memo', { number: '1.1' }), createCue('memo', { number: '1.2', continueMode: 'auto-continue' }), createCue('memo', { number: '1.3' })] });
  const { engine, log } = setup([g1]);
  engine.go();
  assert.deepEqual(log, ['start:1.1', 'start:1.2', 'start:1.3']);

  const g2 = createCue('group', { number: '2', mode: 'first', children: [createCue('memo', { number: '2.1', continueMode: 'auto-continue' }), createCue('memo', { number: '2.2' }), createCue('memo', { number: '2.3' })] });
  const s = setup([g2]);
  s.engine.go();
  assert.deepEqual(s.log, ['start:2.1', 'start:2.2']);
});

test('group finishes when children finish, then auto-follows', () => {
  const g = createCue('group', { number: '1', mode: 'all', continueMode: 'auto-follow', children: [createCue('wait', { number: '1.1', duration: 1 }), createCue('wait', { number: '1.2', duration: 2 })] });
  const n = createCue('memo', { number: '2' });
  const { engine, clock, log } = setup([g, n]);
  engine.go();
  clock.advance(1500); assert.ok(!log.includes('start:2'));
  clock.advance(600); assert.ok(log.includes('start:2'));
  assert.equal(engine.runs.size, 0);
});

test('disarmed cue does not run its action but still continues', () => {
  const a = createCue('memo', { number: '1', armed: false, continueMode: 'auto-continue' });
  const b = createCue('memo', { number: '2' });
  const { engine, log } = setup([a, b]);
  engine.go();
  assert.deepEqual(log, ['start:2']);
});

test('stop all cancels pending waits and stops actions', () => {
  const a = createCue('wait', { number: '1', duration: 10, continueMode: 'auto-continue', postWait: 5 });
  const b = createCue('memo', { number: '2' });
  const { engine, clock, log } = setup([a, b]);
  engine.go();
  engine.hardStop();
  clock.advance(20000);
  assert.deepEqual(log, ['start:1', 'stop:1']);
  assert.equal(engine.runs.size, 0);
});

test('pause freezes pre-wait', () => {
  const a = createCue('memo', { number: '1', preWait: 2 });
  const { engine, clock, log } = setup([a]);
  engine.go(); clock.advance(1000); engine.pauseAll(); clock.advance(5000);
  assert.deepEqual(log, []);
  engine.resumeAll(); clock.advance(1000);
  assert.deepEqual(log, ['start:1']);
});

test('retrigger ignore vs restart', () => {
  const a = createCue('wait', { number: '1', duration: 10 });
  const { engine, log } = setup([a]);
  engine.trigger(a); engine.trigger(a);
  assert.deepEqual(log, ['start:1']);
  a.retrigger = 'restart'; engine.trigger(a);
  assert.deepEqual(log, ['start:1', 'stop:1', 'start:1']);
});
