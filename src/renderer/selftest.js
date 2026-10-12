// End-to-end self test run by `npm run smoke` (NQ_SMOKE=1). Exercises the real engine, audio graph,
// lighting, OSC loopback, scripts and undo inside the running app.
import {
  app, loadWorkspace, applySettings, change, undo, log, addCue, moveIntoGroup, moveOutOfGroup, moveUpDown, setWait,
  crossfadeToNext, addFadeOut, copySelected, paste, select,
} from './app.js';
import { createWorkspace, createCue } from './lib/model.js';
import { uid } from './lib/util.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls until fn() is true (or the timeout passes); avoids flaky fixed sleeps on slow machines / CI.
async function waitFor(fn, ms = 3000) {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (fn()) return true; await sleep(20); }
  return fn();
}

export async function runSelfTest() {
  const passed = [];
  const failed = [];
  const check = (name, cond, detail = '') => (cond ? passed : failed).push(cond ? name : `${name} ${detail}`);
  await window.__nqReady; // don't race app start-up (it reloads the workspace when done)

  const ws = createWorkspace();
  ws.settings.osc.port = 53999;
  ws.settings.osc.textPort = 0;
  ws.settings.general.minGoInterval = 0;
  ws.settings.lighting.enabled = false; // don't spray DMX on the network during tests
  ws.settings.lighting.patch = [
    { id: 'L1', number: 1, name: 'front', type: 'dimmer', universe: 1, address: 1 },
    { id: 'L2', number: 2, name: 'wash', type: 'rgb', universe: 1, address: 2 },
  ];
  const c1 = createCue('memo', { number: '1' });
  const c2 = createCue('wait', { number: '2', duration: 0.2, continueMode: 'auto-follow' });
  const c3 = createCue('memo', { number: '3' });
  const c4 = createCue('network', { number: '4', host: '127.0.0.1', port: 53999, message: '/playhead/1' });
  const c5 = createCue('light', { number: '5', commands: 'front = full\nwash.color = #ff0000', duration: 0.1 });
  const c6 = createCue('group', { number: '6', mode: 'all', children: [createCue('memo', { number: '6.1' }), createCue('memo', { number: '6.2' })] });
  const c7 = createCue('script', { number: '7', code: "nq.log('script ok ' + nq.cue('1').number)" });
  const c8 = createCue('audio', { number: '8', file: '/__selftest__.wav' });
  const c9 = createCue('audio', { number: '9', file: '/__selftest_long__.wav', loops: 0 });
  const c10 = createCue('fade', { number: '10', target: c9.id, duration: 0.2, level: -60, fadeLevel: true, stopTargetWhenDone: true });
  ws.lists[0].cues = [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10];
  loadWorkspace(ws, null);
  await applySettings();
  await sleep(200);

  try {
    // 1. GO & playhead
    app.engine.go();
    check('GO advances playhead', app.engine.playheadId === c2.id);

    // 2. auto-follow sequence & playhead skipping
    app.engine.go();
    check('playhead skips auto-follow sequence', app.engine.playheadId === c4.id);
    await sleep(350);
    check('auto-follow sequence completed', app.engine.runs.size === 0, `runs=${app.engine.runs.size}`);

    // 3. Network cue -> our own OSC server (loopback) -> playhead/1
    app.engine.go();
    await sleep(400);
    check('OSC loopback moved playhead', app.engine.playheadId === c1.id, `playhead=${app.engine.playheadCue()?.number}`);

    // 4. lighting
    app.engine.trigger(c5);
    await sleep(300);
    check('light cue reaches levels', Math.round(app.lights.values['L1.intensity']) === 100 && Math.round(app.lights.values['L2.red']) === 100 && Math.round(app.lights.values['L2.green'] || 0) === 0,
      JSON.stringify(app.lights.values));
    const frame = app.lights.frames()[1];
    check('DMX frame built', frame[0] === 255 && frame[1] === 255 && frame[2] === 0, `frame=${frame.slice(0, 4)}`);

    // 5. group
    app.engine.trigger(c6);
    await sleep(50);
    check('group (all) completes', app.engine.runs.size === 0);

    // 6. script
    const before = app.logLines.length;
    app.engine.trigger(c7);
    await sleep(100);
    check('script cue ran', app.logLines.slice(before).some((l) => l.includes('script ok 1')));

    // 7. audio playback through the real Web Audio graph (synthetic buffers)
    const ctx = app.audio.ctx;
    await app.audio.resume();
    const mk = (secs) => { const b = ctx.createBuffer(2, Math.floor(ctx.sampleRate * secs), ctx.sampleRate); b.getChannelData(0).fill(0.1); return b; };
    app.audio.buffers.set('/__selftest__.wav', Promise.resolve(mk(0.3)));
    app.audio.buffers.set('/__selftest_long__.wav', Promise.resolve(mk(1)));
    check('audio context running', ctx.state === 'running', ctx.state);
    app.engine.trigger(c8);
    const run8 = app.engine.runsFor(c8.id)[0];
    await waitFor(() => run8?.duration() != null, 1000);
    check('audio cue running', !!run8 && Math.abs((run8.duration() || 0) - 0.3) < 0.01, `dur=${run8?.duration()} log=${app.logLines.slice(-2).join(' / ')}`);
    check('audio cue ended naturally', await waitFor(() => !app.engine.isRunning(c8.id), 3000));

    // 8. looping audio + fade cue with stop-target
    app.engine.trigger(c9);
    await sleep(100);
    check('looping audio running', app.engine.isRunning(c9.id), `runs=${[...app.engine.runs.values()].map((r) => r.cue.number)} log=${app.logLines.slice(-3).join(' / ')}`);
    app.engine.trigger(c10);
    check('fade cue stopped its target', await waitFor(() => !app.engine.isRunning(c9.id), 3000));

    // 9. pause / resume
    app.engine.trigger(c8);
    app.engine.pauseAll(); // pause immediately, even before the audio has loaded
    await sleep(400);
    check('paused audio stays alive', app.engine.isRunning(c8.id));
    app.engine.resumeAll();
    check('resumed audio finishes', await waitFor(() => !app.engine.isRunning(c8.id), 3000));

    // 10. real media files through media:// (dev checkout only)
    const fixtures = decodeURIComponent(new URL('../../test/fixtures/', location.href).pathname);
    const [hasWav, hasPng] = await window.nq.filesExist([fixtures + 'tone.wav', fixtures + 'slide.png']);
    if (hasWav) {
      const real = createCue('audio', { number: '11', file: fixtures + 'tone.wav' });
      ws.lists[0].cues.push(real);
      app.engine.trigger(real);
      await sleep(300);
      const r = app.engine.runsFor(real.id)[0];
      check('real WAV decoded via media://', !!r && Math.abs((r.duration() || 0) - 0.5) < 0.01, `dur=${r?.duration()}`);
      await sleep(500);
      check('real WAV finished', !app.engine.isRunning(real.id));
    }
    if (hasPng) {
      const img = createCue('video', { number: '12', file: fixtures + 'slide.png', imageDuration: 0.4, stage: 'stage1' });
      ws.lists[0].cues.push(img);
      app.engine.trigger(img);
      await sleep(150);
      check('image cue running on stage', app.engine.isRunning(img.id));
      await sleep(1500);
      check('stage reported image end (IPC round trip)', !app.engine.isRunning(img.id));
      const txt = createCue('text', { number: '13', text: 'Hello', duration: 0.3, stage: 'stage1' });
      ws.lists[0].cues.push(txt);
      app.engine.trigger(txt);
      await sleep(600);
      check('text cue timed out', !app.engine.isRunning(txt.id));
    }

    // 11. editing operations used by the right-click menu
    const list = ws.lists[0];
    const g = createCue('group', { number: 'G', mode: 'all' });
    list.cues.push(g);
    const inside = addCue('memo', { name: 'inside' }, { inside: g.id });
    check('add cue inside group', g.children.includes(inside));
    const loose = addCue('memo', { name: 'loose' }, { after: g.id });
    moveIntoGroup([loose.id], g.id);
    check('move into group', g.children.includes(loose) && !list.cues.includes(loose));
    moveOutOfGroup([loose.id]);
    check('move out of group lands after the group', list.cues[list.cues.indexOf(g) + 1] === loose);
    moveUpDown([loose.id], -1);
    check('move up', list.cues[list.cues.indexOf(g) - 1] === loose);
    setWait([loose.id], 'postWait', 2);
    check('setting post-wait enables auto-continue', loose.postWait === 2 && loose.continueMode === 'auto-continue');
    select(loose.id);
    copySelected();
    const before2 = list.cues.length;
    paste({ after: loose.id });
    check('copy / paste cue', list.cues.length === before2 + 1 && list.cues[list.cues.indexOf(loose) + 1].name === 'loose');

    // 12. crossfade helper: one GO fades A out while B fades in
    const a = createCue('audio', { number: 'XA', file: '/__selftest_long__.wav', loops: 0 });
    const b = createCue('audio', { number: 'XB', file: '/__selftest_long__.wav', loops: 0 });
    list.cues.push(a, b);
    const xf = crossfadeToNext(a.id, 0.3);
    check('crossfade cue inserted between', list.cues.indexOf(xf) === list.cues.indexOf(a) + 1 && list.cues.indexOf(b) === list.cues.indexOf(xf) + 1
      && xf.continueMode === 'auto-continue' && b.fadeIn === 0.3 && xf.target === a.id && xf.stopTargetWhenDone);
    app.engine.trigger(a);
    await sleep(150);
    app.engine.setPlayhead(xf.id);
    app.engine.go();
    await sleep(100);
    check('crossfade starts the next cue', app.engine.isRunning(b.id) && app.engine.isRunning(a.id));
    await sleep(600);
    check('crossfade stops the previous cue', !app.engine.isRunning(a.id) && app.engine.isRunning(b.id));
    app.engine.hardStop();
    const fo = addFadeOut(b.id, 1);
    check('add fade-out after', fo.target === b.id && list.cues.indexOf(fo) === list.cues.indexOf(b) + 1);

    // 13. the right-click menu really opens on a cue row
    select(loose.id);
    await sleep(50);
    const rowEl = document.querySelector(`.row[data-id="${loose.id}"]`);
    rowEl?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }));
    await sleep(50);
    const labels = [...document.querySelectorAll('.cm .cm-label')].map((x) => x.textContent);
    check('context menu opens with actions', ['Add cue after', 'Move into group', 'Delete cue'].every((l) => labels.includes(l)) && labels.some((l) => l.startsWith('Then:')), labels.join('|'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(20);
    check('context menu closes on Esc', !document.querySelector('.cm'));

    // 14. the user's scenario: Group[ Text (until stopped, auto-follow) , Light ] + Space key handling
    app.engine.hardStop();
    const txt2 = createCue('text', { number: 'T', text: 'Salam', duration: 0, continueMode: 'auto-follow', stage: 'stage1' });
    const lt = createCue('light', { number: 'L', commands: 'front = 40', duration: 0 });
    const grp = createCue('group', { number: 'GRP', mode: 'step', children: [txt2, lt] });
    list.cues.push(grp);
    select(grp.id);
    await sleep(50);
    check('warning shown for follow that never fires', !!document.querySelector(`.row[data-id="${txt2.id}"] .c-cont.stuck`));
    select(lt.id);
    check('clicking a cue inside a group moves the playhead to it', app.engine.playheadId === lt.id);
    select(grp.id);
    const space = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    const sel = document.createElement('select');
    sel.appendChild(document.createElement('option'));
    document.body.appendChild(sel);
    sel.focus();
    space();
    await sleep(50);
    check('Space works while a dropdown has focus (step group fires first child)', app.engine.isRunning(txt2.id) && app.engine.playheadId === lt.id, `focus=${document.activeElement?.tagName} ph=${app.engine.playheadCue()?.number}`);
    sel.remove();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    document.body.appendChild(cb);
    cb.focus();
    app.engine.lastGo = -Infinity;
    space();
    cb.remove();
    await sleep(50);
    check('next Space steps to the next cue in the group', Math.round(app.lights.values['L1.intensity']) === 40);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    const ph = app.engine.playheadId;
    app.engine.lastGo = -Infinity;
    space();
    check('Space while typing in a text field does not GO', app.engine.playheadId === ph);
    ta.remove();
    app.engine.hardStop();

    // 15. undo
    const n = ws.lists[0].cues.length;
    change(() => { ws.lists[0].cues.push(createCue('memo', { number: uid() })); });
    check('change adds cue', app.ws.lists[0].cues.length === n + 1);
    undo();
    check('undo restores', app.ws.lists[0].cues.length === n);
  } catch (e) {
    failed.push('exception: ' + e.stack);
  }

  app.engine.hardStop();
  loadWorkspace(createWorkspace(), null);
  log(`Self-test: ${passed.length} passed, ${failed.length} failed`);
  return { passed, failed };
}

// Demo workspace used for screenshots (NQ_SHOT) and as an example.
export function buildDemo() {
  const ws = createWorkspace();
  ws.settings.lighting.enabled = false;
  ws.settings.lighting.patch = [
    { id: 'p1', number: 1, name: 'front', type: 'dimmer', universe: 1, address: 1 },
    { id: 'p2', number: 2, name: 'back', type: 'dimmer', universe: 1, address: 2 },
    { id: 'p3', number: 3, name: 'wash', type: 'rgbw', universe: 1, address: 10 },
  ];
  const preshow = createCue('audio', { number: '1', name: 'Preshow music', file: '/Show/Audio/preshow.wav', loops: 0, color: 'blue', notes: 'Wait for house to open' });
  const cues = [
    preshow,
    createCue('fade', { number: '2', name: 'Fade out preshow', target: preshow.id, duration: 8, level: -60, stopTargetWhenDone: true, continueMode: 'auto-continue', postWait: 2 }),
    createCue('light', { number: '3', name: 'House to half', commands: 'front = 50\nback = 30', duration: 5 }),
    createCue('group', { number: '4', name: 'Act 1 opening', mode: 'all', color: 'green', children: [
      createCue('video', { number: '4.1', name: 'Projection: storm', file: '/Show/Video/storm.mp4', stage: 'stage1' }),
      createCue('audio', { number: '4.2', name: 'Thunder', file: '/Show/Audio/thunder.wav', level: -3 }),
      createCue('light', { number: '4.3', name: 'Lightning wash', commands: 'wash.color = #8899ff', duration: 0.2 }),
    ] }),
    createCue('network', { number: '5', name: 'Trigger console cue 12', message: '/eos/cue/1/12/fire', host: '192.168.1.20', port: 8000 }),
    createCue('midi', { number: '6', name: 'MSC GO to sound desk', msgType: 'msc', mscCommand: 'go', mscCue: '6' }),
    createCue('text', { number: '7', name: 'Surtitle: Scene 2', text: 'Scene 2 — The Harbour', duration: 6, color: 'purple' }),
    createCue('wait', { number: '8', duration: 3, continueMode: 'auto-follow' }),
    createCue('stop', { number: '9', name: 'Stop thunder', target: '', fadeTime: 2 }),
    createCue('memo', { name: 'Interval — 15 minutes', color: 'yellow', flagged: true }),
  ];
  ws.lists[0].cues = cues;
  ws.lists[0].name = 'Main Cue List';
  ws.lists.push({ id: 'cart1', name: 'SFX Cart', kind: 'cart', cues: [
    createCue('audio', { number: 'S1', name: 'Doorbell', file: '/Show/Audio/doorbell.wav', hotkey: 'd', color: 'orange' }),
    createCue('audio', { number: 'S2', name: 'Phone ring', file: '/Show/Audio/phone.wav', hotkey: 'f', color: 'red' }),
    createCue('audio', { number: 'S3', name: 'Applause', file: '/Show/Audio/applause.wav', color: 'green' }),
  ] });
  return ws;
}

export async function showDemo(mode) {
  await window.__nqReady;
  const ws = buildDemo();
  if (mode === 'scenario') {
    const t = createCue('text', { number: '2', text: 'Salam', duration: 0, continueMode: 'auto-follow' });
    ws.lists[0].cues = [createCue('group', { number: '1', name: 'Group', mode: 'step', children: [t, createCue('light', { number: '3', commands: 'front = 50' })] })];
    loadWorkspace(ws, null);
    await sleep(300);
    select(t.id);
    return true;
  }
  loadWorkspace(ws, null);
  await sleep(300);
  select(ws.lists[0].cues[1].id);
  if (mode === 'menu') {
    await sleep(100);
    const row = document.querySelectorAll('#cuelist .rows .row')[1];
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 420, clientY: r.top + 12 }));
    await sleep(100);
    // open the "Then:" submenu too
    const then = [...document.querySelectorAll('.cm-item')].find((x) => x.textContent.includes('Then:'));
    then?.click();
  }
  return true;
}
