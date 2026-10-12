// Inspector: edits the selected cue(s). Multi-selection edits shared fields on every selected cue.
import { app, render, snapshot, markDirty, selectedCues, checkMedia, fireCue, change } from './app.js';
import {
  CUE_TYPES, CUE_COLORS, BLEND_MODES, FADE_CURVES, GROUP_MODES, MSC_COMMANDS, walk, cueSummary, findCue,
} from './lib/model.js';
import { h, clear } from './lib/dom.js';
import { formatTime, parseTime } from './lib/util.js';
import { defaultMatrix, waveformPeaks } from './audio.js';

let currentTab = 'basics';
let lastKey = '';

// ------------------------------------------------------------------ field widgets

function setField(cues, key, value) {
  snapshot();
  for (const c of cues) c[key] = value;
  markDirty();
  render();
}

function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}

function shared(cues, key) {
  const v = cues[0][key];
  return cues.every((c) => JSON.stringify(c[key]) === JSON.stringify(v)) ? v : undefined;
}

function textInput(cues, key, opts = {}) {
  const v = shared(cues, key);
  const el = h(opts.multiline ? 'textarea' : 'input', {
    value: v ?? '', placeholder: v === undefined ? '(multiple)' : opts.placeholder || '', rows: opts.rows || 3,
    class: opts.mono ? 'mono' : '', spellcheck: !opts.mono,
  });
  el.addEventListener('change', () => setField(cues, key, el.value));
  if (opts.multiline) el.addEventListener('keydown', (e) => e.stopPropagation());
  return el;
}

function numInput(cues, key, { min, max, step = 'any', suffix } = {}) {
  const v = shared(cues, key);
  const el = h('input', { type: 'number', value: v ?? '', placeholder: v === undefined ? '—' : '', min, max, step });
  el.addEventListener('change', () => { if (el.value !== '') setField(cues, key, Number(el.value)); });
  return suffix ? h('div', { class: 'with-suffix' }, el, h('span', {}, suffix)) : el;
}

function timeInput(cues, key) {
  const v = shared(cues, key);
  const el = h('input', { value: v === undefined ? '' : formatTime(v || 0), placeholder: v === undefined ? '(multiple)' : '00:00.00', class: 'time' });
  el.addEventListener('change', () => setField(cues, key, parseTime(el.value)));
  return el;
}

function checkbox(cues, key, label) {
  const v = shared(cues, key);
  const el = h('input', { type: 'checkbox', checked: !!v });
  el.indeterminate = v === undefined;
  el.addEventListener('change', () => setField(cues, key, el.checked));
  return h('label', { class: 'check' }, el, h('span', {}, label));
}

function selectInput(cues, key, options) {
  const v = shared(cues, key);
  const el = h('select', {}, v === undefined ? h('option', { value: '' }, '(multiple)') : null,
    options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)).map((o) => h('option', { value: o.value, selected: String(o.value) === String(v) }, o.label)));
  el.addEventListener('change', () => {
    const opt = options.map((o) => (typeof o === 'string' ? { value: o } : o)).find((o) => String(o.value) === el.value);
    setField(cues, key, opt ? opt.value : el.value);
  });
  return el;
}

function slider(cues, key, { min, max, step = 1, suffix = '' }) {
  const v = shared(cues, key) ?? min;
  const out = h('span', { class: 'slider-val' }, `${v}${suffix}`);
  const el = h('input', { type: 'range', min, max, step, value: v });
  el.addEventListener('input', () => { out.textContent = `${el.value}${suffix}`; });
  el.addEventListener('change', () => setField(cues, key, Number(el.value)));
  return h('div', { class: 'slider' }, el, out);
}

function cueTargetSelect(cues, key, { filter } = {}) {
  const v = shared(cues, key);
  const opts = [];
  for (const list of app.ws.lists) {
    for (const { cue, depth } of walk(list.cues)) {
      if (cues.some((c) => c.id === cue.id)) continue;
      if (filter && !filter(cue)) continue;
      opts.push(h('option', { value: cue.id, selected: cue.id === v }, `${'  '.repeat(depth)}${cue.number ? cue.number + ' · ' : ''}${cueSummary(cue, app.ws)}  [${list.name}]`));
    }
  }
  const el = h('select', {}, h('option', { value: '' }, v === undefined ? '(multiple)' : '— none —'), opts);
  el.addEventListener('change', () => setField(cues, key, el.value));
  return el;
}

function fileInput(cues, key, kind) {
  const v = shared(cues, key);
  const broken = v && app.broken.has(v);
  return h('div', { class: 'file-row' + (broken ? ' broken' : '') },
    h('input', { value: v ?? '', readOnly: true, placeholder: v === undefined ? '(multiple)' : 'No file', title: v || '' }),
    h('button', {
      onClick: async () => {
        const [p] = await window.nq.chooseMedia(kind, false);
        if (p) { setField(cues, key, p); app.audio.forget(p); checkMedia(); }
      },
    }, 'Choose…'),
    broken ? h('span', { class: 'warn' }, '⚠ missing') : null);
}

function stageSelect(cues) {
  return selectInput(cues, 'stage', app.ws.settings.stages.map((s) => ({ value: s.id, label: s.name })));
}

function deviceSelect(cues, key, kind) {
  const el = h('select', {}, h('option', { value: '' }, 'Default'));
  const v = shared(cues, key);
  app.audio.listDevices().then((d) => {
    for (const dev of d[kind]) el.appendChild(h('option', { value: dev.id, selected: dev.id === v }, dev.label));
  });
  el.addEventListener('change', () => setField(cues, key, el.value));
  return el;
}

function midiOutSelect(cues, key) {
  const v = shared(cues, key);
  return h('select', { onChange: (e) => setField(cues, key, e.target.value) },
    h('option', { value: '' }, 'Workspace default'),
    app.midi.outputs().map((o) => h('option', { value: o.id, selected: o.id === v }, o.name)));
}

function row(...children) { return h('div', { class: 'field-row' }, children); }
function section(title, ...children) { return h('fieldset', { class: 'section' }, h('legend', {}, title), children); }

// ------------------------------------------------------------------ custom editors

function levelsEditor(cue, { fadeMode = false } = {}) {
  const n = app.audio.outCount;
  const names = app.ws.settings.audio.outputNames || [];
  const cells = [];
  for (let o = 0; o < n; o++) {
    const v = cue.outLevels?.[o];
    const input = h('input', { type: 'number', step: 0.5, min: -60, max: 12, value: v ?? (fadeMode ? '' : 0), placeholder: fadeMode ? '—' : '0' });
    input.addEventListener('change', () => change(() => {
      cue.outLevels = { ...(cue.outLevels || {}) };
      if (input.value === '') delete cue.outLevels[o]; else cue.outLevels[o] = Number(input.value);
    }));
    cells.push(h('div', { class: 'lvl-cell' }, h('div', { class: 'lvl-name' }, names[o] || String(o + 1)), input));
  }
  return h('div', { class: 'levels-grid' }, cells);
}

function matrixEditor(cue, inCh) {
  const outCh = app.audio.outCount;
  const matrix = cue.matrix || defaultMatrix(inCh, outCh);
  const names = app.ws.settings.audio.outputNames || [];
  const table = h('table', { class: 'matrix' },
    h('tr', {}, h('th', {}, 'in \\ out'), Array.from({ length: outCh }, (_, o) => h('th', {}, names[o] || String(o + 1)))),
    Array.from({ length: inCh }, (_, i) => h('tr', {}, h('th', {}, String(i + 1)), Array.from({ length: outCh }, (_, o) => {
      const v = matrix[i]?.[o];
      const input = h('input', { type: 'number', step: 0.5, min: -60, max: 12, value: v ?? '', placeholder: '-∞', class: v !== null && v !== undefined ? 'on' : '' });
      input.addEventListener('change', () => change(() => {
        const m = (cue.matrix || defaultMatrix(inCh, outCh)).map((r) => [...r]);
        while (m.length < inCh) m.push(new Array(outCh).fill(null));
        m[i] = m[i] || new Array(outCh).fill(null);
        m[i][o] = input.value === '' ? null : Number(input.value);
        cue.matrix = m;
      }));
      input.addEventListener('dblclick', () => { input.value = input.value === '' ? '0' : ''; input.dispatchEvent(new Event('change')); });
      return h('td', {}, input);
    }))));
  return h('div', {},
    h('div', { class: 'matrix-wrap' }, table),
    h('div', { class: 'btn-row' },
      h('small', { class: 'hint' }, 'Crosspoints in dB; empty = off. Double-click toggles 0 dB / off.'),
      h('button', { class: 'small', onClick: () => change(() => { cue.matrix = null; }) }, 'Reset to default')));
}

function waveformEditor(cue) {
  const canvas = h('canvas', { class: 'waveform', width: 900, height: 110 });
  const info = h('small', { class: 'hint' }, 'Loading waveform…');
  const wrap = h('div', { class: 'wave-wrap' }, canvas, info);
  if (!cue.file || app.broken.has(cue.file)) { info.textContent = 'No media'; return wrap; }
  app.audio.load(cue.file).then((buf) => {
    const g = canvas.getContext('2d');
    const W = canvas.width; const H = canvas.height;
    const peaks = waveformPeaks(buf, W);
    const draw = () => {
      g.clearRect(0, 0, W, H);
      const s = (Number(cue.startTime) || 0) / buf.duration * W;
      const e = (Number(cue.endTime) > 0 ? cue.endTime : buf.duration) / buf.duration * W;
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(0, 0, s, H); g.fillRect(e, 0, W - e, H);
      g.fillStyle = getComputedStyle(document.body).getPropertyValue('--wave') || '#6cb4ff';
      for (let x = 0; x < W; x++) {
        const min = peaks[x * 2]; const max = peaks[x * 2 + 1];
        g.fillRect(x, (1 - max) * H / 2, 1, Math.max(1, (max - min) * H / 2));
      }
      g.fillStyle = '#3ddc84'; g.fillRect(s - 1, 0, 2, H);
      g.fillStyle = '#ff5d5d'; g.fillRect(e - 1, 0, 2, H);
    };
    draw();
    info.textContent = `${buf.numberOfChannels} ch · ${buf.sampleRate} Hz · ${formatTime(buf.duration)} — click: set start · ⌥/shift-click: set end`;
    canvas.addEventListener('mousedown', (ev) => {
      const r = canvas.getBoundingClientRect();
      const t = Math.max(0, Math.min(buf.duration, ((ev.clientX - r.left) / r.width) * buf.duration));
      change(() => { if (ev.altKey || ev.shiftKey) cue.endTime = Math.round(t * 1000) / 1000; else cue.startTime = Math.round(t * 1000) / 1000; });
    });
  }).catch((e) => { info.textContent = e.message; });
  return wrap;
}

function fxEditor(cues) {
  return h('div', { class: 'fx-grid' },
    section('Filters', checkbox(cues, 'hpOn', 'High-pass'), field('HP freq', numInput(cues, 'hpFreq', { min: 10, max: 20000, suffix: 'Hz' })),
      checkbox(cues, 'lpOn', 'Low-pass'), field('LP freq', numInput(cues, 'lpFreq', { min: 10, max: 20000, suffix: 'Hz' }))),
    section('3-band EQ', checkbox(cues, 'eqOn', 'Enable EQ'), field('Low (200 Hz)', numInput(cues, 'lowGain', { min: -24, max: 24, step: 0.5, suffix: 'dB' })),
      field('Mid freq', numInput(cues, 'midFreq', { min: 50, max: 16000, suffix: 'Hz' })), field('Mid gain', numInput(cues, 'midGain', { min: -24, max: 24, step: 0.5, suffix: 'dB' })),
      field('Mid Q', numInput(cues, 'midQ', { min: 0.1, max: 20, step: 0.1 })), field('High (4 kHz)', numInput(cues, 'highGain', { min: -24, max: 24, step: 0.5, suffix: 'dB' }))),
    section('Compressor', checkbox(cues, 'compOn', 'Enable compressor'), field('Threshold', numInput(cues, 'threshold', { min: -100, max: 0, suffix: 'dB' })),
      field('Ratio', numInput(cues, 'ratio', { min: 1, max: 20, step: 0.5, suffix: ':1' })), field('Attack', numInput(cues, 'attack', { min: 0, max: 1, step: 0.001, suffix: 's' })),
      field('Release', numInput(cues, 'release', { min: 0, max: 1, step: 0.01, suffix: 's' }))),
    section('Delay', checkbox(cues, 'delayOn', 'Enable delay'), field('Time', numInput(cues, 'delayTime', { min: 0, max: 5, step: 0.01, suffix: 's' })),
      field('Feedback', numInput(cues, 'delayFeedback', { min: 0, max: 95, suffix: '%' })), field('Mix', numInput(cues, 'delayMix', { min: 0, max: 100, suffix: '%' }))),
    section('Reverb', checkbox(cues, 'reverbOn', 'Enable reverb'), field('Size', numInput(cues, 'reverbSize', { min: 0.1, max: 10, step: 0.1, suffix: 's' })),
      field('Mix', numInput(cues, 'reverbMix', { min: 0, max: 100, suffix: '%' }))));
}

function geometryEditor(cues) {
  return h('div', {},
    row(field('Stage', stageSelect(cues)), field('Layer', numInput(cues, 'layer', { min: 0, max: 1000, step: 1 })),
      field('Blend mode', selectInput(cues, 'blend', BLEND_MODES)), field('Fit', selectInput(cues, 'fit', ['contain', 'cover', 'fill', 'none', 'scale-down']))),
    row(field('Opacity', slider(cues, 'opacity', { min: 0, max: 100, suffix: '%' })), field('Fade in', numInput(cues, 'fadeIn', { min: 0, step: 0.1, suffix: 's' }))),
    row(field('X', numInput(cues, 'x', { suffix: 'px' })), field('Y', numInput(cues, 'y', { suffix: 'px' })),
      field('Scale', numInput(cues, 'scale', { min: 0, suffix: '%' })), field('Rotation', numInput(cues, 'rotation', { suffix: '°' }))),
    section('Crop / mask (%)', row(field('Top', numInput(cues, 'cropTop', { min: 0, max: 100 })), field('Right', numInput(cues, 'cropRight', { min: 0, max: 100 })),
      field('Bottom', numInput(cues, 'cropBottom', { min: 0, max: 100 })), field('Left', numInput(cues, 'cropLeft', { min: 0, max: 100 })))));
}

function videoFxEditor(cues) {
  return h('div', { class: 'fx-grid' },
    field('Blur', slider(cues, 'blur', { min: 0, max: 50, suffix: 'px' })),
    field('Brightness', slider(cues, 'brightness', { min: 0, max: 300, suffix: '%' })),
    field('Contrast', slider(cues, 'contrast', { min: 0, max: 300, suffix: '%' })),
    field('Saturation', slider(cues, 'saturate', { min: 0, max: 300, suffix: '%' })),
    field('Hue rotate', slider(cues, 'hue', { min: -180, max: 180, suffix: '°' })),
    field('Grayscale', slider(cues, 'grayscale', { min: 0, max: 100, suffix: '%' })),
    field('Invert', slider(cues, 'invert', { min: 0, max: 100, suffix: '%' })),
    field('Sepia', slider(cues, 'sepia', { min: 0, max: 100, suffix: '%' })));
}

function lightEditor(cue) {
  const ta = h('textarea', { class: 'mono', rows: 8, value: cue.commands, spellcheck: false, placeholder: 'front = 75\n1 thru 4 = full\nwash.color = #ff8800\nall = out' });
  const preview = h('div', { class: 'light-preview' });
  const update = () => {
    const { targets, errors } = app.lights.resolve(ta.value);
    clear(preview);
    errors.forEach((e) => preview.appendChild(h('div', { class: 'warn' }, e)));
    const n = Object.keys(targets).length;
    preview.appendChild(h('div', { class: 'muted' }, n ? `${n} parameters → ` + Object.entries(targets).slice(0, 12).map(([k, v]) => {
      const [id, p] = k.split('.');
      const inst = app.ws.settings.lighting.patch.find((x) => x.id === id);
      return `${inst?.name || id}.${p}=${Math.round(v)}%`;
    }).join(', ') + (n > 12 ? '…' : '') : (app.ws.settings.lighting.patch.length ? 'No parameters matched' : 'No instruments patched — add some in Settings → Lighting')));
  };
  ta.addEventListener('input', update);
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  ta.addEventListener('change', () => change(() => { cue.commands = ta.value; }));
  update();
  return h('div', {},
    field('Commands', ta),
    preview,
    h('div', { class: 'btn-row' },
      h('button', { onClick: () => change(() => { cue.commands = app.lights.snapshotCommands(); }) }, 'Record current dashboard look'),
      h('button', { onClick: () => { const { targets } = app.lights.resolve(ta.value); app.lights.fadeTo(targets, 0); } }, 'Preview (snap)'),
      h('small', { class: 'hint' }, 'Syntax: name/number/group = value · ranges "1 thru 6" · lists "1 + 3" · ".param" · "#rrggbb" · full/out')));
}

function triggersEditor(cues) {
  const cue = cues[0];
  const t = cue.midiTrigger || { type: '', channel: 0, number: 60 };
  const learnBtn = h('button', {
    onClick: () => {
      learnBtn.textContent = 'Waiting for MIDI…';
      app.midiLearn = ({ data, ch, status }) => {
        app.midiLearn = null;
        const type = status === 0x90 ? 'note' : status === 0xb0 ? 'cc' : status === 0xc0 ? 'program' : null;
        if (type) change(() => { cue.midiTrigger = { type, channel: ch, number: data[1] }; });
        else render();
      };
    },
  }, 'MIDI Learn');
  const setT = (k, v) => change(() => { cue.midiTrigger = { ...t, [k]: v }; });
  return h('div', {},
    row(field('Hotkey', textInput(cues, 'hotkey', { placeholder: 'single key, e.g. a' }), 'Fires this cue from the keyboard'),
      field('When re-triggered while running', selectInput(cues, 'retrigger', [
        { value: 'ignore', label: 'Ignore' }, { value: 'restart', label: 'Restart' }, { value: 'stop', label: 'Stop' }, { value: 'pause', label: 'Pause / resume' }]))),
    cues.length === 1 ? section('MIDI trigger',
      row(field('Type', h('select', { onChange: (e) => setT('type', e.target.value) }, ['', 'note', 'cc', 'program'].map((x) => h('option', { value: x, selected: x === t.type }, x || 'Off')))),
        field('Channel (0 = any)', h('input', { type: 'number', min: 0, max: 16, value: t.channel, onChange: (e) => setT('channel', Number(e.target.value)) })),
        field('Number', h('input', { type: 'number', min: 0, max: 127, value: t.number, onChange: (e) => setT('number', Number(e.target.value)) })),
        learnBtn)) : null,
    h('small', { class: 'hint' }, 'OSC: /cue/{number}/start · /cue/{number}/stop · /go · /panic … on UDP port ' + app.ws.settings.osc.port));
}

// ------------------------------------------------------------------ tabs per type

function tabsFor(cues) {
  const type = cues.every((c) => c.type === cues[0].type) ? cues[0].type : null;
  const tabs = [{ id: 'basics', label: 'Basics', render: () => basicsTab(cues) }, { id: 'triggers', label: 'Triggers', render: () => triggersEditor(cues) }];
  const one = cues.length === 1 ? cues[0] : null;
  switch (type) {
    case 'audio':
      tabs.push({ id: 'time', label: 'Time & Loops', render: () => h('div', {},
        one ? waveformEditor(one) : null,
        row(field('File', fileInput(cues, 'file', 'audio')), h('button', { class: 'audition', onClick: () => one && fireCue(one.id) }, '▶ Audition')),
        row(field('Start time', timeInput(cues, 'startTime')), field('End time (0 = end)', timeInput(cues, 'endTime')),
          field('Plays (0 = loop forever)', numInput(cues, 'loops', { min: 0, step: 1 })), field('Rate', numInput(cues, 'rate', { min: 0.03, max: 33, step: 0.01 }))),
        row(field('Fade in', numInput(cues, 'fadeIn', { min: 0, step: 0.1, suffix: 's' })), field('Fade out at end', numInput(cues, 'fadeOut', { min: 0, step: 0.1, suffix: 's' })))) });
      tabs.push({ id: 'levels', label: 'Levels', render: () => audioLevelsTab(cues, one, () => audioChannels(one)) });
      tabs.push({ id: 'fx', label: 'Audio Effects', render: () => fxEditor(cues) });
      break;
    case 'mic':
      tabs.push({ id: 'input', label: 'Input', render: () => row(field('Input device', deviceSelect(cues, 'inputDeviceId', 'inputs')), field('Input channels', numInput(cues, 'inputChannels', { min: 1, max: 64, step: 1 }))) });
      tabs.push({ id: 'levels', label: 'Levels', render: () => audioLevelsTab(cues, one, () => Promise.resolve(Number(one?.inputChannels) || 1)) });
      tabs.push({ id: 'fx', label: 'Audio Effects', render: () => fxEditor(cues) });
      break;
    case 'video':
      tabs.push({ id: 'media', label: 'Media', render: () => h('div', {},
        field('File (video or image)', fileInput(cues, 'file', 'video')),
        row(field('Start time', timeInput(cues, 'startTime')), field('End time (0 = end)', timeInput(cues, 'endTime')),
          field('Plays (0 = loop forever)', numInput(cues, 'loops', { min: 0, step: 1 })), field('Rate', numInput(cues, 'rate', { min: 0.0625, max: 16, step: 0.01 }))),
        row(field('Volume', numInput(cues, 'volume', { min: -60, max: 0, step: 0.5, suffix: 'dB' })), field('Image hold time (0 = until stopped)', numInput(cues, 'imageDuration', { min: 0, step: 0.1, suffix: 's' })))) });
      tabs.push({ id: 'geometry', label: 'Geometry', render: () => geometryEditor(cues) });
      tabs.push({ id: 'vfx', label: 'Video Effects', render: () => videoFxEditor(cues) });
      break;
    case 'camera':
      tabs.push({ id: 'camera', label: 'Camera', render: () => row(field('Camera', deviceSelect(cues, 'deviceId', 'cameras')), checkbox(cues, 'mirror', 'Mirror')) });
      tabs.push({ id: 'geometry', label: 'Geometry', render: () => geometryEditor(cues) });
      tabs.push({ id: 'vfx', label: 'Video Effects', render: () => videoFxEditor(cues) });
      break;
    case 'text':
      tabs.push({ id: 'text', label: 'Text', render: () => h('div', {},
        field('Text', textInput(cues, 'text', { multiline: true, rows: 4 })),
        row(field('Font', textInput(cues, 'fontFamily')), field('Size', numInput(cues, 'fontSize', { min: 4, suffix: 'px' })),
          field('Weight', selectInput(cues, 'fontWeight', ['300', '400', '500', '600', '700', '800', '900'])), field('Align', selectInput(cues, 'align', ['left', 'center', 'right']))),
        row(field('Color', textInput(cues, 'textColor')), field('Background', textInput(cues, 'bgColor')),
          field('Duration (0 = until stopped)', numInput(cues, 'duration', { min: 0, step: 0.1, suffix: 's' })))) });
      tabs.push({ id: 'geometry', label: 'Geometry', render: () => geometryEditor(cues) });
      tabs.push({ id: 'vfx', label: 'Video Effects', render: () => videoFxEditor(cues) });
      break;
    case 'light':
      tabs.push({ id: 'light', label: 'Levels', render: () => h('div', {},
        one ? lightEditor(one) : h('p', { class: 'muted' }, 'Select a single light cue to edit commands.'),
        row(field('Fade time', numInput(cues, 'duration', { min: 0, step: 0.1, suffix: 's' })), field('Curve', selectInput(cues, 'curve', FADE_CURVES)))) });
      break;
    case 'fade':
      tabs.push({ id: 'fade', label: 'Fade', render: () => fadeTab(cues, one) });
      break;
    case 'network':
      tabs.push({ id: 'network', label: 'Network', render: () => h('div', {},
        row(field('Protocol', selectInput(cues, 'protocol', [{ value: 'osc', label: 'OSC (UDP)' }, { value: 'udp', label: 'Plain UDP text' }])),
          field('Host', textInput(cues, 'host')), field('Port', numInput(cues, 'port', { min: 1, max: 65535, step: 1 }))),
        field('Message(s) — one per line', textInput(cues, 'message', { multiline: true, rows: 4, mono: true }), 'OSC: /address arg1 2 3.5 "quoted string"')) });
      break;
    case 'midi':
      tabs.push({ id: 'midi', label: 'MIDI', render: () => midiTab(cues, one) });
      break;
    case 'midifile':
      tabs.push({ id: 'midifile', label: 'MIDI File', render: () => row(field('File', fileInput(cues, 'file', 'midi')), field('Output', midiOutSelect(cues, 'outputId')), field('Rate', numInput(cues, 'rate', { min: 0.1, max: 10, step: 0.05 }))) });
      break;
    case 'timecode':
      tabs.push({ id: 'timecode', label: 'Timecode', render: () => row(field('MIDI output', midiOutSelect(cues, 'outputId')), field('Frame rate', selectInput(cues, 'fps', [24, 25, 29.97, 30].map((v) => ({ value: v, label: String(v) })))),
        field('Start timecode', textInput(cues, 'startTC', { placeholder: 'HH:MM:SS:FF' })), field('Duration (0 = until stopped)', numInput(cues, 'duration', { min: 0, step: 1, suffix: 's' }))) });
      break;
    case 'group':
      tabs.push({ id: 'group', label: 'Group', render: () => field('Mode', selectInput(cues, 'mode', GROUP_MODES)) });
      break;
    case 'script':
      tabs.push({ id: 'script', label: 'Script', render: () => h('div', {},
        field('JavaScript', textInput(cues, 'code', { multiline: true, rows: 12, mono: true })),
        h('small', { class: 'hint' }, 'API: nq.go() · nq.start(n) · nq.stop(n, fade) · nq.pause(n) · nq.panic() · nq.playhead(n) · nq.cue(n) · nq.set(n, prop, value) · nq.osc(host, port, "/addr 1") · nq.udp(host, port, text) · nq.midi([0x90,60,100]) · nq.light("front = 50", 2) · await nq.wait(s) · nq.log(…)')) });
      break;
    default:
      break;
  }
  if (type && CUE_TYPES[type].targets === 'cue' && type !== 'fade') {
    tabs.push({ id: 'target', label: 'Target', render: () => h('div', {},
      field('Target cue', cueTargetSelect(cues, 'target')),
      type === 'stop' ? field('Fade out time', numInput(cues, 'fadeTime', { min: 0, step: 0.1, suffix: 's' })) : null,
      type === 'devamp' ? checkbox(cues, 'startNext', 'Start the next cue when the current loop ends') : null,
      type === 'target' ? targetTargetEditor(cues, one) : null) });
  }
  return tabs;
}

function targetTargetEditor(cues, one) {
  const t = one?.target && findCue(app.ws, one.target)?.cue;
  if (!t) return h('p', { class: 'muted' }, 'Choose the cue whose target should change.');
  if (CUE_TYPES[t.type].targets === 'file') {
    return field('New file for target cue', fileInput(cues, 'newTarget', t.type === 'midifile' ? 'midi' : t.type));
  }
  if (CUE_TYPES[t.type].targets === 'cue') return field('New target for target cue', cueTargetSelect(cues, 'newTarget'));
  return h('p', { class: 'muted' }, 'That cue type has no target.');
}

function audioChannels(cue) {
  if (!cue?.file || app.broken.has(cue.file)) return Promise.resolve(2);
  return app.audio.load(cue.file).then((b) => b.numberOfChannels).catch(() => 2);
}

function audioLevelsTab(cues, one, getChannels) {
  const matrixBox = h('div', {}, h('small', { class: 'hint' }, 'Loading…'));
  if (one) getChannels().then((ch) => matrixBox.replaceChildren(matrixEditor(one, ch)));
  else matrixBox.replaceChildren(h('small', { class: 'hint' }, 'Select a single cue to edit its matrix.'));
  return h('div', {},
    row(field('Cue level (master)', numInput(cues, 'level', { min: -60, max: 12, step: 0.5, suffix: 'dB' }))),
    one ? section('Output levels (dB)', levelsEditor(one)) : null,
    section('Crosspoint matrix', matrixBox));
}

function fadeTab(cues, one) {
  const t = one?.target && findCue(app.ws, one.target)?.cue;
  const isVisual = t && ['video', 'camera', 'text'].includes(t.type);
  return h('div', {},
    row(field('Target cue', cueTargetSelect(cues, 'target', { filter: (c) => ['audio', 'mic', 'video', 'camera', 'text', 'group'].includes(c.type) })),
      field('Duration', numInput(cues, 'duration', { min: 0, step: 0.1, suffix: 's' })), field('Curve', selectInput(cues, 'curve', FADE_CURVES))),
    checkbox(cues, 'stopTargetWhenDone', 'Stop target when done'),
    !isVisual ? section('Audio',
      row(checkbox(cues, 'fadeLevel', 'Fade master level'), field('to', numInput(cues, 'level', { min: -60, max: 12, step: 0.5, suffix: 'dB' }))),
      row(checkbox(cues, 'fadeRate', 'Fade playback rate'), field('to', numInput(cues, 'rate', { min: 0.03, max: 33, step: 0.01 }))),
      checkbox(cues, 'fadeOutLevels', 'Fade output levels (empty = unchanged)'),
      one && one.fadeOutLevels ? levelsEditor(one, { fadeMode: true }) : null) : null,
    t && t.type !== 'audio' && t.type !== 'mic' ? section('Video',
      row(checkbox(cues, 'fadeOpacity', 'Fade opacity'), field('to', numInput(cues, 'opacity', { min: 0, max: 100, suffix: '%' }))),
      row(checkbox(cues, 'fadeGeometry', 'Fade geometry'), field('X', numInput(cues, 'x')), field('Y', numInput(cues, 'y')),
        field('Scale %', numInput(cues, 'scale', { min: 0 })), field('Rotation', numInput(cues, 'rotation'))),
      row(checkbox(cues, 'fadeVolume', 'Fade video volume'), field('to', numInput(cues, 'volume', { min: -60, max: 0, step: 0.5, suffix: 'dB' })))) : null);
}

function midiTab(cues, one) {
  const type = shared(cues, 'msgType');
  return h('div', {},
    row(field('Output', midiOutSelect(cues, 'outputId')),
      field('Message', selectInput(cues, 'msgType', [
        { value: 'noteOn', label: 'Note On' }, { value: 'noteOff', label: 'Note Off' }, { value: 'cc', label: 'Control Change' },
        { value: 'program', label: 'Program Change' }, { value: 'pitchbend', label: 'Pitch Bend' }, { value: 'msc', label: 'MIDI Show Control' }, { value: 'sysex', label: 'SysEx (hex)' }]))),
    ['noteOn', 'noteOff', 'cc', 'program', 'pitchbend'].includes(type) ? row(field('Channel', numInput(cues, 'channel', { min: 1, max: 16, step: 1 })),
      type !== 'pitchbend' ? field(type === 'cc' ? 'Controller' : type === 'program' ? 'Program' : 'Note', numInput(cues, 'number', { min: 0, max: 127, step: 1 })) : null,
      type !== 'program' ? field(type === 'pitchbend' ? 'Value (0-16383)' : 'Value / velocity', numInput(cues, 'value', { min: 0, max: type === 'pitchbend' ? 16383 : 127, step: 1 })) : null) : null,
    type === 'msc' ? row(field('Device ID (127 = all)', numInput(cues, 'mscDeviceId', { min: 0, max: 127, step: 1 })),
      field('Command format', selectInput(cues, 'mscFormat', [{ value: 1, label: 'Lighting (1)' }, { value: 0x10, label: 'Sound (0x10)' }, { value: 0x30, label: 'Machinery (0x30)' }, { value: 0x40, label: 'Video (0x40)' }, { value: 0x7f, label: 'All types (0x7F)' }])),
      field('Command', selectInput(cues, 'mscCommand', MSC_COMMANDS)), field('Cue number', textInput(cues, 'mscCue')), field('Cue list', textInput(cues, 'mscList'))) : null,
    type === 'sysex' ? field('Bytes (hex)', textInput(cues, 'sysex', { mono: true })) : null,
    one ? h('button', { onClick: () => app.midi.sendCue(one) }, 'Send now') : null);
}

const TRANSITIONS = [
  { value: 'none', icon: '■', title: 'Wait for GO', desc: 'Stop here. The next cue waits until you press GO.' },
  { value: 'auto-continue', icon: '↓', title: 'Auto-continue', desc: 'Start the next cue after the post-wait, counted from when this cue starts.' },
  { value: 'auto-follow', icon: '⇣', title: 'Auto-follow', desc: 'Start the next cue as soon as this cue finishes.' },
];

function nextCueOf(cue) {
  const f = findCue(app.ws, cue.id);
  if (!f) return null;
  const sibs = f.parent ? f.parent.children : f.list.cues;
  return sibs[sibs.indexOf(cue) + 1] || null;
}

// Plain-English description of what this cue does over time.
function timelineSentence(cue) {
  const name = (c) => `“${c.number ? c.number + ' · ' : ''}${cueSummary(c, app.ws)}”`;
  const parts = [];
  parts.push(cue.preWait > 0 ? `After GO, wait ${formatTime(cue.preWait)}, then start ${name(cue)}.` : `GO starts ${name(cue)} immediately.`);
  const next = nextCueOf(cue);
  if (cue.continueMode === 'auto-continue') {
    parts.push(next ? `${cue.postWait > 0 ? formatTime(cue.postWait) + ' after it starts' : 'At the same moment'}, ${name(next)} starts automatically.` : 'There is no next cue to continue to.');
  } else if (cue.continueMode === 'auto-follow') {
    parts.push(next ? `When it finishes, ${name(next)} starts automatically.` : 'There is no next cue to follow.');
  } else {
    parts.push(next ? `Then the playhead waits on ${name(next)} for the next GO.` : 'This is the last cue in the sequence.');
  }
  return parts.join(' ');
}

function timelineBar(cue) {
  const pre = Number(cue.preWait) || 0;
  const post = cue.continueMode === 'auto-continue' ? Number(cue.postWait) || 0 : 0;
  const total = Math.max(1, pre + Math.max(post, 2));
  const seg = (cls, w, label) => h('div', { class: `tl-seg ${cls}`, style: { flex: String(Math.max(w, 0.0001)) } }, label);
  return h('div', { class: 'timeline' },
    h('div', { class: 'tl-go' }, 'GO'),
    pre > 0 ? seg('tl-pre', pre / total, `pre-wait ${formatTime(pre)}`) : null,
    seg('tl-action', Math.max(post, 2) / total, 'this cue ' + (cue.continueMode === 'auto-continue' ? `· next in ${formatTime(post)}` : '')),
    h('div', { class: `tl-next m-${cue.continueMode}` }, cue.continueMode === 'none' ? '■ wait for GO' : cue.continueMode === 'auto-follow' ? '⇣ next when done' : '↓ next'));
}

function basicsTab(cues) {
  const one = cues.length === 1 ? cues[0] : null;
  const mode = shared(cues, 'continueMode');
  return h('div', { class: 'basics' },
    row(field('Number', textInput(cues, 'number')), h('div', { class: 'grow' }, field('Name', textInput(cues, 'name', { placeholder: one ? cueSummary({ ...one, name: '' }, app.ws) : '' })))),
    section('Timing & transition to the next cue',
      h('div', { class: 'transition-picker' }, TRANSITIONS.map((t) => h('button', {
        class: 'transition-opt' + (mode === t.value ? ' on' : ''), title: t.desc,
        onClick: () => setField(cues, 'continueMode', t.value),
      }, h('span', { class: 't-icon' }, t.icon), h('span', { class: 't-title' }, t.title), h('span', { class: 't-desc' }, t.desc)))),
      row(field('Pre-wait (delay before this cue starts)', timeInput(cues, 'preWait')),
        field('Post-wait (delay before the next cue, auto-continue)', (() => {
          const el = timeInput(cues, 'postWait');
          el.addEventListener('change', () => {
            if (parseTime(el.value) > 0 && cues.some((c) => c.continueMode === 'none')) setField(cues.filter((c) => c.continueMode === 'none'), 'continueMode', 'auto-continue');
          });
          return el;
        })())),
      one ? timelineBar(one) : null,
      one ? h('p', { class: 'sentence' }, timelineSentence(one)) : null),
    row(field('Color', h('div', { class: 'colors' }, CUE_COLORS.map((c) => h('button', {
      class: `swatch c-${c}${shared(cues, 'color') === c ? ' on' : ''}`, title: c, onClick: () => setField(cues, 'color', c),
    })))), checkbox(cues, 'armed', 'Armed'), checkbox(cues, 'flagged', 'Flagged')),
    field('Notes', textInput(cues, 'notes', { multiline: true, rows: 3 })));
}

// ------------------------------------------------------------------ main render

export function renderInspector(root) {
  const cues = selectedCues();
  const key = cues.map((c) => c.id).join(',');
  // Don't rebuild while the user is typing in the inspector (would steal focus)
  if (key === lastKey && root.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  lastKey = key;
  const scroll = root.querySelector('.insp-body')?.scrollTop || 0;
  clear(root);
  if (!cues.length) {
    root.appendChild(h('div', { class: 'insp-empty' }, h('div', {}, 'No cue selected'),
      h('small', {}, 'Space = GO · Esc = Panic (twice = hard stop) · ↑↓ select · ⌘1–9 new cue · ⌘G group · ⌘D duplicate · P pause · S stop selected · V audition')));
    return;
  }
  const tabs = tabsFor(cues);
  if (!tabs.find((t) => t.id === currentTab)) currentTab = tabs[Math.min(2, tabs.length - 1)].id;
  const head = h('div', { class: 'insp-head' },
    h('div', { class: 'insp-title' }, cues.length > 1 ? `${cues.length} cues selected` : `${CUE_TYPES[cues[0].type].label} cue ${cues[0].number || ''}`),
    h('div', { class: 'tabs' }, tabs.map((t) => h('button', { class: 'tab' + (t.id === currentTab ? ' on' : ''), onClick: () => { currentTab = t.id; lastKey = ''; renderInspector(root); } }, t.label))));
  const body = h('div', { class: 'insp-body' }, tabs.find((t) => t.id === currentTab).render());
  root.append(head, body);
  body.scrollTop = scroll;
}

