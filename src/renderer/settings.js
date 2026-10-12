// Workspace Settings, Light Dashboard, Output Meters and Log windows.
import { app, change, applySettings } from './app.js';
import { h, clear, modal, toast } from './lib/dom.js';
import { uid } from './lib/util.js';
import { FIXTURE_TYPES } from './lib/lightcmd.js';

let settingsTab = 'general';

function f(label, control, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}

function bind(obj, key, { type = 'text', min, max, step, apply = true, parse } = {}) {
  const el = h('input', { type, value: obj[key] ?? '', min, max, step });
  if (type === 'checkbox') el.checked = !!obj[key];
  el.addEventListener('change', () => {
    const v = type === 'checkbox' ? el.checked : type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    change(() => { obj[key] = parse ? parse(v) : v; });
    if (apply) applySettings();
  });
  return el;
}

function bindSelect(obj, key, options, { apply = true } = {}) {
  const el = h('select', {}, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(obj[key]) }, o.label)));
  el.addEventListener('change', () => { change(() => { obj[key] = el.value; }); if (apply) applySettings(); });
  return el;
}

function check(obj, key, label, opts) {
  return h('label', { class: 'check' }, bind(obj, key, { type: 'checkbox', ...opts }), h('span', {}, label));
}

const row = (...c) => h('div', { class: 'field-row' }, c);

// ------------------------------------------------------------------ tabs

function generalTab(s) {
  return h('div', {},
    row(f('Panic fade time (s)', bind(s.general, 'panicTime', { type: 'number', min: 0, step: 0.1, apply: false })),
      f('Double-GO protection (s)', bind(s.general, 'minGoInterval', { type: 'number', min: 0, step: 0.05 }), 'Ignores GO presses closer together than this'),
      f('Autosave backup every (min, 0 = off)', bind(s.general, 'autosaveMinutes', { type: 'number', min: 0, step: 1, apply: false }))),
    check(s.general, 'backups', 'Keep timestamped backups in "NomadCue Backups" next to the workspace on every save', { apply: false }),
    check(s.general, 'showMode', 'Show mode (locks editing; ↑/↓ move the playhead)', { apply: false }),
    h('p', { class: 'muted' }, 'NomadCue is free and open source. Every feature — unlimited outputs, stages, DMX, cue lists, carts, effects, OSC/MIDI, remote — is unlocked.'));
}

function audioTab(s) {
  const devSel = h('select', {}, h('option', { value: 'default' }, 'System default'));
  app.audio.listDevices().then((d) => {
    for (const dev of d.outputs) if (dev.id !== 'default') devSel.appendChild(h('option', { value: dev.id, selected: dev.id === s.audio.deviceId }, dev.label));
  });
  devSel.addEventListener('change', () => { change(() => { s.audio.deviceId = devSel.value; }); applySettings(); });
  const n = app.audio.outCount;
  const outs = h('div', { class: 'out-table' },
    h('div', { class: 'out-row head' }, h('span', {}, '#'), h('span', {}, 'Name'), h('span', {}, 'Level (dB)'), h('span', {}, 'Mute')),
    Array.from({ length: n }, (_, i) => {
      const name = h('input', { value: s.audio.outputNames[i] || '', placeholder: `Output ${i + 1}` });
      name.addEventListener('change', () => change(() => { s.audio.outputNames[i] = name.value; }));
      const lvl = h('input', { type: 'number', step: 0.5, min: -60, max: 12, value: s.audio.outputLevels[i] ?? 0 });
      const mute = h('input', { type: 'checkbox', checked: !!s.audio.outputMutes[i] });
      const upd = () => { change(() => { s.audio.outputLevels[i] = Number(lvl.value); s.audio.outputMutes[i] = mute.checked; }); app.audio.setOutputLevel(i, Number(lvl.value), mute.checked); };
      lvl.addEventListener('change', upd); mute.addEventListener('change', upd);
      return h('div', { class: 'out-row' }, h('span', {}, String(i + 1)), name, lvl, mute);
    }));
  return h('div', {},
    row(f('Output device', devSel), f('Output channels', bind(s.audio, 'outputs', { type: 'number', min: 1, max: 512, step: 1 }),
      `This device reports ${app.audioInfo?.max ?? '?'} channels. No license limit.`)),
    h('h3', {}, 'Outputs'), outs);
}

function stagesTab(s) {
  const box = h('div', {});
  const draw = async () => {
    const displays = await window.nq.listDisplays();
    clear(box);
    s.stages.forEach((st) => {
      const corners = st.corners || [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
      const cornerInputs = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'].map((lbl, i) => h('div', { class: 'corner' }, h('span', {}, lbl),
        ['x', 'y'].map((axis) => {
          const inp = h('input', { type: 'number', step: 0.005, value: corners[i][axis] });
          inp.addEventListener('change', () => { change(() => { st.corners = corners.map((c, j) => (j === i ? { ...c, [axis]: Number(inp.value) } : c)); }); window.nq.openStage(st); });
          return inp;
        })));
      box.appendChild(h('fieldset', { class: 'section' }, h('legend', {}, st.name),
        row(f('Name', bind(st, 'name', { apply: false })),
          f('Display', bindSelect(st, 'displayId', [{ value: '', label: 'Last display' }, ...displays.map((d) => ({ value: d.id, label: `${d.label} ${d.bounds.width}×${d.bounds.height}${d.primary ? ' (primary)' : ''}` }))], { apply: false })),
          f('Window W', bind(st, 'width', { type: 'number', min: 160, apply: false })), f('Window H', bind(st, 'height', { type: 'number', min: 90, apply: false }))),
        row(check(st, 'fullscreen', 'Fullscreen on display', { apply: false }), f('Background', bind(st, 'background', { apply: false })),
          f('Edge blend left (px)', bind(st, 'blendLeft', { type: 'number', min: 0, apply: false })), f('Edge blend right (px)', bind(st, 'blendRight', { type: 'number', min: 0, apply: false }))),
        check(st, 'warp', 'Corner-pin warp / keystone (normalised 0–1 coordinates)', { apply: false }),
        st.warp ? h('div', { class: 'corners' }, cornerInputs) : null,
        h('div', { class: 'btn-row' },
          h('button', { onClick: () => app.video.openStage(st) }, 'Open / update'),
          h('button', { onClick: () => { app.video.openStage(st); setTimeout(() => window.nq.stageCmd({ stageId: st.id, cmd: 'identify', on: true }), 300); setTimeout(() => window.nq.stageCmd({ stageId: st.id, cmd: 'identify', on: false }), 3300); } }, 'Identify'),
          h('button', { onClick: () => app.video.closeStage(st.id) }, 'Close'),
          s.stages.length > 1 ? h('button', { class: 'danger', onClick: () => { change(() => { s.stages = s.stages.filter((x) => x !== st); }); app.video.closeStage(st.id); draw(); } }, 'Remove') : null)));
    });
    box.appendChild(h('button', { class: 'primary', onClick: () => { change(() => { s.stages.push({ id: 'stage' + uid().slice(0, 5), name: `Stage ${s.stages.length + 1}`, displayId: '', fullscreen: false, width: 1280, height: 720, warp: false, corners: null, blendLeft: 0, blendRight: 0, background: '#000000' }); }); draw(); } }, '+ Add stage (unlimited)'));
  };
  draw();
  return box;
}

function lightingTab(s) {
  const L = s.lighting;
  const table = h('div', {});
  const draw = () => {
    clear(table);
    table.appendChild(h('div', { class: 'patch-row head' }, ['#', 'Name', 'Type', 'Universe', 'Address', 'Channels', ''].map((x) => h('span', {}, x))));
    L.patch.forEach((p) => {
      const inp = (key, type = 'text') => {
        const el = h('input', { type, value: p[key] });
        el.addEventListener('change', () => change(() => { p[key] = type === 'number' ? Number(el.value) : el.value; }));
        return el;
      };
      const type = h('select', {}, Object.entries(FIXTURE_TYPES).map(([k, v]) => h('option', { value: k, selected: k === p.type }, v.label)));
      type.addEventListener('change', () => { change(() => { p.type = type.value; }); draw(); });
      const params = FIXTURE_TYPES[p.type]?.params || [];
      table.appendChild(h('div', { class: 'patch-row' }, inp('number', 'number'), inp('name'), type, inp('universe', 'number'), inp('address', 'number'),
        h('span', { class: 'muted' }, `${p.address}–${p.address + params.length - 1}`),
        h('button', { class: 'icon-btn small', onClick: () => { change(() => { L.patch = L.patch.filter((x) => x !== p); }); draw(); } }, '✕')));
    });
    const addBtn = h('button', {
      class: 'primary',
      onClick: () => {
        const last = L.patch[L.patch.length - 1];
        const type = last?.type || 'dimmer';
        const nextAddr = last ? last.address + (FIXTURE_TYPES[last.type]?.params.length || 1) : 1;
        change(() => {
          L.patch.push({ id: uid(), number: (last?.number || 0) + 1, name: `light${(last?.number || 0) + 1}`, type, universe: last?.universe || 1, address: nextAddr > 512 ? 1 : nextAddr });
        });
        draw();
      },
    }, '+ Add instrument');
    const bulk = h('button', {
      onClick: () => {
        change(() => {
          let n = (L.patch[L.patch.length - 1]?.number || 0);
          let addr = 1;
          if (L.patch.length) { const last = L.patch[L.patch.length - 1]; addr = last.address + (FIXTURE_TYPES[last.type]?.params.length || 1); }
          for (let i = 0; i < 12; i++) { n++; L.patch.push({ id: uid(), number: n, name: `dimmer${n}`, type: 'dimmer', universe: 1, address: addr++ }); }
        });
        draw();
      },
    }, '+ 12 dimmers');
    table.appendChild(h('div', { class: 'btn-row' }, addBtn, bulk));

    // groups
    table.appendChild(h('h3', {}, 'Groups'));
    (L.groups || []).forEach((g) => {
      const name = h('input', { value: g.name });
      name.addEventListener('change', () => change(() => { g.name = name.value; }));
      const members = h('input', { value: g.members.map((id) => L.patch.find((p) => p.id === id)?.number).filter(Boolean).join(' '), placeholder: 'instrument numbers, e.g. 1 2 3' });
      members.addEventListener('change', () => change(() => {
        const nums = members.value.split(/[\s,]+/).filter(Boolean);
        g.members = L.patch.filter((p) => nums.includes(String(p.number))).map((p) => p.id);
      }));
      table.appendChild(h('div', { class: 'field-row' }, f('Group name', name), f('Members', members), h('button', { class: 'icon-btn small', onClick: () => { change(() => { L.groups = L.groups.filter((x) => x !== g); }); draw(); } }, '✕')));
    });
    table.appendChild(h('button', { onClick: () => { change(() => { L.groups = L.groups || []; L.groups.push({ name: `group${L.groups.length + 1}`, members: [] }); }); draw(); } }, '+ Add group'));
  };
  draw();
  return h('div', {},
    row(f('Protocol', bindSelect(L, 'protocol', [{ value: 'artnet', label: 'Art-Net' }, { value: 'sacn', label: 'sACN (E1.31)' }])),
      f('Destination IP', bind(L, 'host'), 'Art-Net: broadcast 255.255.255.255 or node IP. sACN: blank/broadcast = multicast'),
      f('Universe offset', bind(L, 'universeOffset', { type: 'number', step: 1 })), f('Refresh (Hz)', bind(L, 'rate', { type: 'number', min: 1, max: 44 }))),
    check(L, 'enabled', 'Output DMX'),
    h('h3', {}, 'Patch (unlimited addresses & universes)'),
    table);
}

function networkTab(s) {
  return h('div', {},
    check(s.osc, 'enabled', 'Accept OSC & UDP control'),
    row(f('OSC port (UDP)', bind(s.osc, 'port', { type: 'number', min: 1, max: 65535 })),
      f('Plain-text UDP port', bind(s.osc, 'textPort', { type: 'number', min: 0, max: 65535 })),
      f('Reply port', bind(s.osc, 'replyPort', { type: 'number', min: 1, max: 65535, apply: false })),
      f('Passcode (optional)', bind(s.osc, 'passcode', { apply: false }), 'Clients send /connect <passcode> first')),
    h('h3', {}, 'Supported OSC commands'),
    h('pre', { class: 'mono small' }, [
      '/go                    /go/{number}             /stop   /hardStop   /panic   /panicInTime {s}',
      '/pause   /resume       /reset                   /playhead/next   /playhead/previous   /playhead/{number}',
      '/select/{number}       /select/next|previous    /cue/{number}/start|stop|pause|resume|togglePause|load|arm|disarm',
      '/cue/{number}/name [value]   /cue/{number}/notes [value]   /cue/selected/start   /cue/playhead/start',
      '/cueLists   /runningCues   /version   /connect {passcode}       (optional prefix: /workspace/{name})',
    ].join('\n')));
}

function midiTab(s) {
  const outs = app.midi.outputs();
  const ins = app.midi.inputs();
  return h('div', {},
    row(f('Default MIDI output', bindSelect(s.midi, 'outputId', [{ value: '', label: 'First available' }, ...outs.map((o) => ({ value: o.id, label: o.name }))])),
      f('MIDI input', bindSelect(s.midi, 'inputId', [{ value: '', label: 'All inputs' }, ...ins.map((o) => ({ value: o.id, label: o.name }))]))),
    row(f('GO on note number', bind(s.midi, 'goNote', { type: 'number', min: 0, max: 127, apply: false })),
      f('Panic on note number', bind(s.midi, 'stopNote', { type: 'number', min: 0, max: 127, apply: false }))),
    row(check(s.midi, 'mscReceive', 'Respond to MIDI Show Control', { apply: false }), f('MSC device ID', bind(s.midi, 'mscDeviceId', { type: 'number', min: 0, max: 126, apply: false }))),
    h('p', { class: 'muted' }, outs.length || ins.length ? `${outs.length} outputs · ${ins.length} inputs detected.` : 'No MIDI devices detected. On macOS you can enable the IAC Driver in Audio MIDI Setup for virtual ports.'));
}

function remoteTab(s) {
  const urls = h('div', { class: 'urls' }, (app.remoteUrls || []).map((u) => h('div', {}, h('code', {}, u))));
  return h('div', {},
    check(s.remote, 'enabled', 'Enable web remote (any phone, tablet or laptop browser on your network)'),
    row(f('Port', bind(s.remote, 'port', { type: 'number', min: 1024, max: 65535 })), f('Passcode (optional)', bind(s.remote, 'passcode'))),
    s.remote.enabled ? h('div', {}, h('p', {}, 'Open one of these on your device:'), urls) : null,
    h('p', { class: 'muted' }, 'Free replacement for a paid remote app: GO, panic, playhead control, fire any cue, live running-cue view.'));
}

const TABS = [
  ['general', 'General', generalTab], ['audio', 'Audio', audioTab], ['video', 'Video Stages', stagesTab], ['lighting', 'Lighting', lightingTab],
  ['network', 'OSC / Network', networkTab], ['midi', 'MIDI', midiTab], ['remote', 'Remote', remoteTab],
];

export function openSettings(tab) {
  if (tab) settingsTab = tab;
  const body = h('div', { class: 'settings' });
  const draw = () => {
    clear(body);
    body.append(
      h('div', { class: 'settings-nav' }, TABS.map(([id, label]) => h('button', { class: 'tab' + (settingsTab === id ? ' on' : ''), onClick: () => { settingsTab = id; draw(); } }, label))),
      h('div', { class: 'settings-body' }, TABS.find((t) => t[0] === settingsTab)[2](app.ws.settings)));
  };
  draw();
  const unsub = () => app.renderers.delete(redraw);
  const redraw = () => { if (!body.contains(document.activeElement)) draw(); };
  app.renderers.add(redraw);
  modal('Workspace Settings', body, { wide: true, onClose: unsub });
}

// ------------------------------------------------------------------ light dashboard

export function openLightDashboard() {
  const body = h('div', { class: 'dashboard' });
  const sliders = new Map();
  const draw = () => {
    clear(body);
    sliders.clear();
    const patch = app.lights.patch();
    const cmd = h('input', { class: 'mono', placeholder: 'Command line: front = 50 · 1 thru 6 = full · all = out   (Enter to run)' });
    cmd.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const { targets, errors } = app.lights.resolve(cmd.value);
        if (errors.length) toast(errors[0]); else { for (const [k, v] of Object.entries(targets)) app.lights.setLive(k, v); cmd.value = ''; }
      }
    });
    body.appendChild(h('div', { class: 'btn-row' }, cmd,
      h('button', { onClick: () => app.lights.blackout(0) }, 'Blackout'),
      h('button', { onClick: () => app.lights.blackout(3) }, 'Fade out 3s'),
      h('button', { onClick: () => { navigator.clipboard?.writeText(app.lights.snapshotCommands()); toast('Copied look as commands'); } }, 'Copy look')));
    if (!patch.length) { body.appendChild(h('p', { class: 'muted' }, 'No instruments patched. Add some in Settings → Lighting.')); return; }
    const grid = h('div', { class: 'faders' });
    for (const inst of patch) {
      const col = h('div', { class: 'fader-col' }, h('div', { class: 'fader-title' }, `${inst.number} ${inst.name}`));
      for (const p of inst.params) {
        const key = `${inst.id}.${p}`;
        const val = h('span', { class: 'fader-val' }, String(Math.round(app.lights.values[key] || 0)));
        const s = h('input', { type: 'range', min: 0, max: 100, step: 1, value: app.lights.values[key] || 0, class: `vfader p-${p}`, orient: 'vertical' });
        s.addEventListener('input', () => { app.lights.setLive(key, Number(s.value)); val.textContent = s.value; });
        sliders.set(key, [s, val]);
        col.appendChild(h('div', { class: 'fader' }, s, val, h('small', {}, p.slice(0, 3))));
      }
      grid.appendChild(col);
    }
    body.appendChild(grid);
  };
  draw();
  const unsub = app.lights.onChange(() => {
    for (const [key, [s, val]] of sliders) {
      if (document.activeElement === s) continue;
      const v = Math.round(app.lights.values[key] || 0);
      s.value = v; val.textContent = String(v);
    }
  });
  modal('Light Dashboard', body, { wide: true, onClose: unsub });
}

// ------------------------------------------------------------------ meters & log

export function openMeters() {
  const canvas = h('canvas', { class: 'meters', width: 900, height: 220 });
  let raf;
  const drawM = () => {
    const g = canvas.getContext('2d');
    const levels = app.audio.levels();
    const n = Math.max(1, levels.length);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const bw = Math.min(60, (canvas.width - 20) / n - 4);
    levels.forEach((v, i) => {
      const db = v > 0 ? 20 * Math.log10(v) : -60;
      const frac = Math.max(0, Math.min(1, (db + 60) / 60));
      const x = 10 + i * (bw + 4);
      g.fillStyle = '#2a2d35'; g.fillRect(x, 10, bw, 180);
      g.fillStyle = db > -1 ? '#ff4d4d' : db > -12 ? '#f5c542' : '#3ddc84';
      g.fillRect(x, 10 + 180 * (1 - frac), bw, 180 * frac);
      g.fillStyle = '#aaa'; g.font = '11px system-ui';
      g.fillText(app.ws.settings.audio.outputNames[i] || String(i + 1), x, 205);
    });
    raf = requestAnimationFrame(drawM);
  };
  drawM();
  modal('Audio Output Meters', canvas, { wide: true, onClose: () => cancelAnimationFrame(raf) });
}

export function openLog() {
  const pre = h('pre', { class: 'log mono' }, app.logLines.join('\n') || 'Log is empty.');
  const prev = app.onLog;
  app.onLog = (line) => { prev?.(line); pre.textContent += '\n' + line; pre.scrollTop = pre.scrollHeight; };
  modal('Log', pre, { wide: true, onClose: () => { app.onLog = prev; } });
  setTimeout(() => { pre.scrollTop = pre.scrollHeight; }, 0);
}

