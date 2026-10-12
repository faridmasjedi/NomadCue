// Workspace & cue data model. Pure (no DOM) so it can be unit-tested in Node.
import { uid, deepClone } from './util.js';

export const CONTINUE_MODES = [
  { value: 'none', label: 'Do not continue' },
  { value: 'auto-continue', label: 'Auto-continue (after post-wait)' },
  { value: 'auto-follow', label: 'Auto-follow (when cue ends)' },
];

export const CUE_COLORS = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'grey'];

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

export const FADE_CURVES = [
  { value: 'scurve', label: 'S-curve' }, { value: 'linear', label: 'Linear' },
  { value: 'equalPower', label: 'Equal power' }, { value: 'exponential', label: 'Exponential' },
  { value: 'logarithmic', label: 'Logarithmic' },
];

export const GROUP_MODES = [
  { value: 'first', label: 'Start first child; children follow their continue modes' },
  { value: 'all', label: 'Start all children simultaneously' },
  { value: 'random', label: 'Start a random child' },
];

export const MSC_COMMANDS = ['go', 'stop', 'resume', 'timed_go', 'load', 'set', 'fire', 'all_off', 'restore', 'reset', 'go_off'];
export const MSC_CODES = { go: 1, stop: 2, resume: 3, timed_go: 4, load: 5, set: 6, fire: 7, all_off: 8, restore: 9, reset: 0x0a, go_off: 0x0b };

const AUDIO_FX = {
  hpOn: false, hpFreq: 80, lpOn: false, lpFreq: 12000,
  eqOn: false, lowGain: 0, midFreq: 1000, midGain: 0, midQ: 1, highGain: 0,
  compOn: false, threshold: -24, ratio: 4, attack: 0.003, release: 0.25,
  delayOn: false, delayTime: 0.35, delayFeedback: 30, delayMix: 25,
  reverbOn: false, reverbSize: 2.5, reverbMix: 25,
};

const GEOMETRY = { stage: '', layer: 10, opacity: 100, x: 0, y: 0, scale: 100, rotation: 0, fit: 'contain', blend: 'normal',
  cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0,
  blur: 0, brightness: 100, contrast: 100, saturate: 100, hue: 0, grayscale: 0, invert: 0, sepia: 0, fadeIn: 0 };

// type: { label, glyph, defaults, hasDuration, targets: 'file'|'cue'|null }
export const CUE_TYPES = {
  audio: { label: 'Audio', glyph: '♪', targets: 'file', defaults: { file: '', startTime: 0, endTime: 0, loops: 1, rate: 1, level: 0, outLevels: {}, matrix: null, fadeIn: 0, fadeOut: 0, ...AUDIO_FX } },
  mic: { label: 'Mic', glyph: '◉', defaults: { inputDeviceId: '', inputChannels: 1, level: 0, outLevels: {}, matrix: null, ...AUDIO_FX } },
  video: { label: 'Video', glyph: '▶', targets: 'file', defaults: { file: '', startTime: 0, endTime: 0, loops: 1, rate: 1, volume: 0, imageDuration: 0, ...GEOMETRY } },
  camera: { label: 'Camera', glyph: '◎', defaults: { deviceId: '', mirror: false, ...GEOMETRY } },
  text: { label: 'Text', glyph: 'T', hasDuration: true, defaults: { text: 'Text', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 72, fontWeight: '700', textColor: '#ffffff', bgColor: 'transparent', align: 'center', duration: 0, ...GEOMETRY } },
  light: { label: 'Light', glyph: '☀', hasDuration: true, defaults: { commands: '', duration: 3, curve: 'linear' } },
  fade: { label: 'Fade', glyph: '◢', targets: 'cue', hasDuration: true, defaults: {
    target: '', duration: 5, curve: 'scurve', stopTargetWhenDone: false,
    fadeLevel: true, level: -60, fadeOutLevels: false, outLevels: {}, fadeRate: false, rate: 1,
    fadeOpacity: false, opacity: 0, fadeGeometry: false, x: 0, y: 0, scale: 100, rotation: 0, fadeVolume: false, volume: -60,
  } },
  network: { label: 'Network', glyph: '⇄', defaults: { protocol: 'osc', host: '127.0.0.1', port: 53000, message: '/go' } },
  midi: { label: 'MIDI', glyph: '♫', defaults: { outputId: '', msgType: 'noteOn', channel: 1, number: 60, value: 100, mscDeviceId: 127, mscFormat: 1, mscCommand: 'go', mscCue: '1', mscList: '', sysex: 'F0 7E 7F 06 01 F7' } },
  midifile: { label: 'MIDI File', glyph: '♬', targets: 'file', defaults: { file: '', outputId: '', rate: 1 } },
  timecode: { label: 'Timecode', glyph: '⏱', hasDuration: true, defaults: { outputId: '', fps: 30, startTC: '01:00:00:00', duration: 60 } },
  group: { label: 'Group', glyph: '▦', defaults: { mode: 'first', children: [], collapsed: false } },
  start: { label: 'Start', glyph: '▷', targets: 'cue', defaults: { target: '' } },
  stop: { label: 'Stop', glyph: '■', targets: 'cue', defaults: { target: '', fadeTime: 0 } },
  pause: { label: 'Pause', glyph: '❙❙', targets: 'cue', defaults: { target: '' } },
  load: { label: 'Load', glyph: '⤓', targets: 'cue', defaults: { target: '', loadTime: 0 } },
  reset: { label: 'Reset', glyph: '↺', targets: 'cue', defaults: { target: '' } },
  devamp: { label: 'Devamp', glyph: '↬', targets: 'cue', defaults: { target: '', startNext: false } },
  goto: { label: 'GoTo', glyph: '↪', targets: 'cue', defaults: { target: '' } },
  target: { label: 'Target', glyph: '⌖', targets: 'cue', defaults: { target: '', newTarget: '' } },
  arm: { label: 'Arm', glyph: '✓', targets: 'cue', defaults: { target: '' } },
  disarm: { label: 'Disarm', glyph: '✕', targets: 'cue', defaults: { target: '' } },
  wait: { label: 'Wait', glyph: '⌛', hasDuration: true, defaults: { duration: 5 } },
  memo: { label: 'Memo', glyph: '✎', defaults: {} },
  script: { label: 'Script', glyph: '{}', defaults: { code: "// nq.go(), nq.start('3'), nq.osc('127.0.0.1', 53000, '/go'), nq.log('hi')\n" } },
};

export const TOOLBAR_ORDER = ['group', 'audio', 'mic', 'video', 'camera', 'text', 'light', 'fade', 'network', 'midi', 'midifile', 'timecode',
  'start', 'stop', 'pause', 'load', 'reset', 'devamp', 'goto', 'target', 'arm', 'disarm', 'wait', 'memo', 'script'];

export function createCue(type, overrides = {}) {
  const def = CUE_TYPES[type];
  if (!def) throw new Error('Unknown cue type ' + type);
  return {
    id: uid(), type, number: '', name: '', notes: '', color: 'none', flagged: false, armed: true,
    preWait: 0, postWait: 0, continueMode: 'none', retrigger: 'ignore',
    hotkey: '', midiTrigger: null,
    ...deepClone(def.defaults),
    ...overrides,
  };
}

export function createList(name = 'Main Cue List', kind = 'list') {
  return { id: uid(), name, kind, cues: [] };
}

export function defaultSettings() {
  return {
    audio: { deviceId: 'default', outputs: 2, outputNames: [], outputLevels: [], outputMutes: [] },
    stages: [{ id: 'stage1', name: 'Main Stage', displayId: '', fullscreen: false, width: 1280, height: 720, warp: false,
      corners: null, blendLeft: 0, blendRight: 0, background: '#000000' }],
    lighting: { protocol: 'artnet', host: '255.255.255.255', universeOffset: 0, enabled: true, patch: [], groups: [], rate: 40 },
    osc: { enabled: true, port: 53000, textPort: 53535, replyPort: 53001, passcode: '' },
    midi: { inputId: '', outputId: '', goNote: null, stopNote: null, mscDeviceId: 127, mscReceive: true },
    remote: { enabled: false, port: 53100, passcode: '' },
    general: { panicTime: 1, autosaveMinutes: 2, backups: true, minGoInterval: 0.2, showMode: false },
  };
}

export function createWorkspace() {
  return { app: 'NomadQlab', version: 1, settings: defaultSettings(), lists: [createList()] };
}

// Merge loaded data with defaults so older/foreign files keep working.
export function normalizeWorkspace(ws) {
  const base = createWorkspace();
  const out = { ...base, ...ws };
  const d = defaultSettings();
  out.settings = { ...d, ...(ws.settings || {}) };
  for (const k of Object.keys(d)) out.settings[k] = Array.isArray(d[k]) ? (ws.settings?.[k] ?? d[k]) : { ...d[k], ...(ws.settings?.[k] || {}) };
  if (!out.lists || !out.lists.length) out.lists = [createList()];
  const fix = (cue) => {
    const def = CUE_TYPES[cue.type] || CUE_TYPES.memo;
    const filled = { ...createCue(CUE_TYPES[cue.type] ? cue.type : 'memo'), ...deepClone(def.defaults), ...cue };
    if (filled.type === 'group') filled.children = (cue.children || []).map(fix);
    return filled;
  };
  out.lists = out.lists.map((l) => ({ ...createList(l.name, l.kind), ...l, cues: (l.cues || []).map(fix) }));
  return out;
}

// ---- tree helpers

export function* walk(cues, parent = null, depth = 0) {
  for (const cue of cues) {
    yield { cue, parent, depth };
    if (cue.type === 'group') yield* walk(cue.children, cue, depth + 1);
  }
}

export function findCue(ws, id) {
  for (const list of ws.lists) for (const { cue, parent } of walk(list.cues)) if (cue.id === id) return { cue, parent, list };
  return null;
}

export function findCueByNumber(ws, number) {
  const n = String(number);
  for (const list of ws.lists) for (const { cue } of walk(list.cues)) if (cue.number !== '' && String(cue.number) === n) return cue;
  return null;
}

export function siblingsOf(ws, id) {
  const f = findCue(ws, id);
  if (!f) return null;
  return f.parent ? f.parent.children : f.list.cues;
}

export function allCues(ws) {
  const out = [];
  for (const list of ws.lists) for (const { cue } of walk(list.cues)) out.push(cue);
  return out;
}

export function removeCue(ws, id) {
  const sibs = siblingsOf(ws, id);
  if (!sibs) return null;
  const i = sibs.findIndex((c) => c.id === id);
  return i >= 0 ? sibs.splice(i, 1)[0] : null;
}

export function isDescendant(cue, maybeChildId) {
  if (cue.type !== 'group') return false;
  for (const { cue: c } of walk(cue.children)) if (c.id === maybeChildId) return true;
  return false;
}

// Copy with fresh ids (and remap internal target references inside the copy).
export function cloneCue(cue) {
  const copy = deepClone(cue);
  const map = {};
  for (const { cue: c } of walk([copy])) { const nid = uid(); map[c.id] = nid; c.id = nid; }
  for (const { cue: c } of walk([copy])) if (c.target && map[c.target]) c.target = map[c.target];
  return copy;
}

export function mediaFiles(ws) {
  const files = new Set();
  for (const c of allCues(ws)) if (c.file) files.add(c.file);
  return [...files];
}

// The cue a GO at `cue` lands on afterwards: skips over cues reached through auto-continue/auto-follow chains.
export function cueAfterSequence(siblings, cueId) {
  let i = siblings.findIndex((c) => c.id === cueId);
  if (i < 0) return null;
  while (i < siblings.length && siblings[i].continueMode !== 'none') i++;
  return siblings[i + 1] || null;
}

export function cueSummary(cue, ws) {
  const def = CUE_TYPES[cue.type];
  if (cue.name) return cue.name;
  const basename = (p) => String(p || '').split(/[\\/]/).pop();
  if (def.targets === 'file') return cue.file ? basename(cue.file) : `${def.label} (no file)`;
  if (def.targets === 'cue') {
    const t = cue.target && findCue(ws, cue.target);
    return `${def.label}${t ? ': ' + (t.cue.number ? t.cue.number + ' · ' : '') + cueSummary(t.cue, ws) : ''}`;
  }
  if (cue.type === 'network') return `${cue.protocol.toUpperCase()} ${cue.host}:${cue.port} ${cue.message}`;
  if (cue.type === 'text') return `Text: ${String(cue.text).split('\n')[0].slice(0, 40)}`;
  if (cue.type === 'light') return cue.commands ? `Light: ${cue.commands.split('\n')[0]}` : 'Light';
  if (cue.type === 'midi') return `MIDI ${cue.msgType === 'msc' ? 'MSC ' + cue.mscCommand + ' ' + cue.mscCue : cue.msgType}`;
  return def.label;
}

export function buildMscMessage(c) {
  const bytes = [0xf0, 0x7f, Number(c.mscDeviceId) & 0x7f, 0x02, Number(c.mscFormat) & 0x7f, MSC_CODES[c.mscCommand] ?? 1];
  const ascii = (s) => [...String(s)].map((ch) => ch.charCodeAt(0) & 0x7f);
  if (c.mscCue !== '' && c.mscCue !== undefined) {
    bytes.push(...ascii(c.mscCue));
    if (c.mscList) bytes.push(0, ...ascii(c.mscList));
  }
  bytes.push(0xf7);
  return bytes;
}

export function parseMscMessage(data) {
  if (data[0] !== 0xf0 || data[1] !== 0x7f || data[3] !== 0x02) return null;
  const code = data[5];
  const command = Object.keys(MSC_CODES).find((k) => MSC_CODES[k] === code);
  const rest = data.slice(6, data.length - 1);
  const zero = rest.indexOf(0);
  const cue = String.fromCharCode(...(zero >= 0 ? rest.slice(0, zero) : rest));
  return { deviceId: data[2], format: data[4], command, cue };
}

export function buildMidiMessage(c) {
  const ch = (Math.max(1, Math.min(16, Number(c.channel) || 1)) - 1) & 0x0f;
  const n = Number(c.number) & 0x7f;
  const v = Number(c.value) & 0x7f;
  switch (c.msgType) {
    case 'noteOn': return [0x90 | ch, n, v];
    case 'noteOff': return [0x80 | ch, n, v];
    case 'cc': return [0xb0 | ch, n, v];
    case 'program': return [0xc0 | ch, n];
    case 'pitchbend': { const b = Math.max(0, Math.min(16383, Number(c.value) || 8192)); return [0xe0 | ch, b & 0x7f, b >> 7]; }
    case 'msc': return buildMscMessage(c);
    case 'sysex': return String(c.sysex).trim().split(/[\s,]+/).filter(Boolean).map((h) => parseInt(h, 16) & 0xff);
    default: return [];
  }
}
