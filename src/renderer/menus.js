// Right-click menus for cues, the cue list background and cart tiles.
import {
  app, addCue, addFiles, deleteSelected, duplicateSelected, groupSelected, renumberSelected, selectedCues, select, fireCue,
  setContinueMode, setWait, setCueProp, moveIntoGroup, moveOutOfGroup, moveUpDown, moveCuesToList, addFadeOut, crossfadeToNext,
  copySelected, cutSelected, paste, viewList, render,
} from './app.js';
import { CUE_TYPES, CUE_COLORS, CONTINUE_MODES, GROUP_MODES, walk, findCue, cueSummary, isDescendant, siblingsOf, neverEnds, neverEndsReason } from './lib/model.js';
import { showMenu } from './lib/contextmenu.js';
import { promptDialog } from './lib/dom.js';
import { parseTime, formatTime } from './lib/util.js';

const TYPE_GROUPS = [
  ['Media', ['audio', 'mic', 'video', 'camera', 'text']],
  ['Lighting & control', ['light', 'fade', 'network', 'midi', 'midifile', 'timecode', 'script']],
  ['Show flow', ['group', 'wait', 'memo', 'start', 'stop', 'pause', 'goto', 'devamp', 'load', 'reset', 'target', 'arm', 'disarm']],
];

const FADEABLE = ['audio', 'mic', 'video', 'camera', 'text'];
const WAIT_PRESETS = [0, 0.5, 1, 2, 3, 5, 10];

// Creates a cue the way the toolbar does: media types ask for files first.
export async function createCueInteractive(type, placement = {}) {
  if (type === 'audio' || type === 'video' || type === 'midifile') {
    const files = await window.nq.chooseMedia(type === 'midifile' ? 'midi' : type, true);
    if (files.length) { addFiles(files, placement); return; }
  }
  addCue(type, {}, placement);
}

export function addCueMenu(placement) { return typeMenu(placement); }

function typeMenu(placement) {
  const items = [];
  TYPE_GROUPS.forEach(([title, types], i) => {
    if (i) items.push('separator');
    items.push({ heading: title });
    for (const t of types) items.push({ label: CUE_TYPES[t].label, icon: CUE_TYPES[t].glyph, onClick: () => createCueInteractive(t, placement) });
  });
  return items;
}

async function askSeconds(title, current) {
  const r = await promptDialog(title, [{ key: 'v', label: 'Seconds (or mm:ss.ss)', value: current ? formatTime(current) : '0' }]);
  return r ? parseTime(r.v) : null;
}

function waitMenu(ids, key, current) {
  return [
    ...WAIT_PRESETS.map((s) => ({ label: s ? `${s} s` : 'None', checked: Number(current) === s, onClick: () => setWait(ids, key, s) })),
    'separator',
    { label: 'Custom…', onClick: async () => { const v = await askSeconds(key === 'preWait' ? 'Pre-wait' : 'Post-wait', current); if (v !== null) setWait(ids, key, v); } },
  ];
}

const CONTINUE_HELP = {
  none: 'Stop here — the next cue waits for GO',
  'auto-continue': 'Auto-continue: the next cue starts after the post-wait, counted from when this cue starts (0 = together)',
  'auto-follow': 'Auto-follow: the next cue starts when this cue finishes',
};

export function transitionMenu(ids, cue) {
  const pw = cue.postWait || 0;
  const stuck = neverEnds(cue);
  return [
    ...CONTINUE_MODES.map((m) => ({
      label: m.short + (m.value === 'auto-follow' && stuck ? '  ⚠ never ends' : ''),
      title: m.value === 'auto-follow' && stuck ? `Won't fire: ${neverEndsReason(cue)}` : CONTINUE_HELP[m.value],
      checked: cue.continueMode === m.value, onClick: () => setContinueMode(ids, m.value),
    })),
    'separator',
    { label: `Post-wait: ${pw ? formatTime(pw) : 'none'}`, submenu: waitMenu(ids, 'postWait', pw) },
  ];
}

function groupsIn(list, exclude) {
  const out = [];
  for (const { cue, depth } of walk(list.cues)) {
    if (cue.type !== 'group') continue;
    if (exclude.some((c) => c.id === cue.id || isDescendant(c, cue.id))) continue;
    out.push({ cue, depth });
  }
  return out;
}

export function cueMenu(cue) {
  if (!app.selection.has(cue.id)) select(cue.id);
  const cues = selectedCues();
  const ids = cues.map((c) => c.id);
  const one = cues.length === 1;
  const f = findCue(app.ws, cue.id);
  const list = f.list;
  const isCart = list.kind === 'cart';
  const running = app.engine.isRunning(cue.id);
  const anyInGroup = ids.some((id) => findCue(app.ws, id)?.parent);
  const groups = isCart ? [] : groupsIn(list, cues);
  const sibs = siblingsOf(app.ws, cue.id) || [];
  const next = sibs[sibs.indexOf(cue) + 1];
  const canFade = one && FADEABLE.includes(cue.type);
  const canXfade = canFade && next && FADEABLE.includes(next.type);
  const label = one ? `${cue.number ? cue.number + ' · ' : ''}${cueSummary(cue, app.ws)}` : `${cues.length} cues selected`;

  return [
    { heading: label.length > 46 ? label.slice(0, 45) + '…' : label },
    { label: running ? 'Stop' : 'Play now', icon: running ? '■' : '▶', shortcut: running ? 'S' : 'V', onClick: () => cues.forEach((c) => (running ? app.engine.stopCue(c.id, 0) : fireCue(c.id))) },
    !isCart && one && !f.parent ? { label: 'Set playhead here', icon: '▸', onClick: () => app.engine.setPlayhead(cue.id) } : null,
    'separator',
    { label: 'Add cue after', icon: '+', submenu: typeMenu({ after: cue.id }) },
    one && cue.type === 'group' ? { label: 'Add cue inside this group', icon: '⤵', submenu: typeMenu({ inside: cue.id }) } : null,
    one && cue.type === 'group' ? { label: 'Group mode', icon: '▦', submenu: GROUP_MODES.map((m) => ({ label: m.label, checked: cue.mode === m.value, onClick: () => setCueProp(ids, 'mode', m.value) })) } : null,
    app.clipboard ? { label: 'Paste after', shortcut: '⌘V', onClick: () => paste({ after: cue.id }) } : null,
    app.clipboard && one && cue.type === 'group' ? { label: 'Paste inside group', onClick: () => paste({ inside: cue.id }) } : null,
    'separator',
    !isCart ? { label: `Then: ${CONTINUE_MODES.find((m) => m.value === cue.continueMode)?.short}`, icon: '↓', submenu: transitionMenu(ids, cue) } : null,
    { label: `Pre-wait: ${cue.preWait ? formatTime(cue.preWait) : 'none'}`, icon: '⏱', submenu: waitMenu(ids, 'preWait', cue.preWait) },
    canFade ? {
      label: 'Fades', icon: '◢', submenu: [
        { label: 'Add fade-out after (3 s)', onClick: () => addFadeOut(cue.id, 3) },
        { label: 'Add fade-out after…', onClick: async () => { const v = await askSeconds('Fade-out time', 3); if (v !== null) addFadeOut(cue.id, v); } },
        'separator',
        { label: canXfade ? `Crossfade into next cue (3 s)` : 'Crossfade into next cue', disabled: !canXfade, title: canXfade ? '' : 'The next cue must be an audio, video, camera, text or mic cue', onClick: () => crossfadeToNext(cue.id, 3) },
        { label: 'Crossfade into next cue…', disabled: !canXfade, onClick: async () => { const v = await askSeconds('Crossfade time', 3); if (v !== null) crossfadeToNext(cue.id, v); } },
        'separator',
        { label: `Fade in: ${cue.fadeIn ? formatTime(cue.fadeIn) : 'none'}`, submenu: [0, 0.5, 1, 2, 3, 5].map((s) => ({ label: s ? `${s} s` : 'None', checked: Number(cue.fadeIn || 0) === s, onClick: () => setCueProp(ids, 'fadeIn', s) })) },
      ],
    } : null,
    'separator',
    { label: 'Move up', icon: '↑', shortcut: '⌥↑', onClick: () => moveUpDown(ids, -1) },
    { label: 'Move down', icon: '↓', shortcut: '⌥↓', onClick: () => moveUpDown(ids, 1) },
    !isCart ? {
      label: 'Move into group', icon: '▦', submenu: [
        ...groups.map(({ cue: g, depth }) => ({ label: `${'  '.repeat(depth)}${g.number ? g.number + ' · ' : ''}${g.name || 'Group'}`, onClick: () => moveIntoGroup(ids, g.id) })),
        groups.length ? 'separator' : null,
        { label: 'New group from selection', shortcut: '⌘G', onClick: () => groupSelected() },
      ],
    } : null,
    anyInGroup ? { label: 'Move out of group', icon: '⤴', onClick: () => moveOutOfGroup(ids) } : null,
    app.ws.lists.length > 1 ? { label: 'Move to list', icon: '☰', submenu: app.ws.lists.filter((l) => l.id !== list.id).map((l) => ({ label: l.name, onClick: () => moveCuesToList(ids, l.id) })) } : null,
    'separator',
    { swatches: CUE_COLORS.map((c) => ({ color: c, on: cue.color === c, label: c === 'none' ? 'No colour' : c, onClick: () => setCueProp(ids, 'color', c) })) },
    { label: 'Armed', checked: cue.armed !== false, title: 'Disarmed cues are skipped (their continue still happens)', onClick: () => setCueProp(ids, 'armed', !(cue.armed !== false)) },
    { label: 'Flagged', checked: !!cue.flagged, onClick: () => setCueProp(ids, 'flagged', !cue.flagged) },
    'separator',
    one ? { label: 'Rename…', shortcut: '↩', onClick: async () => { const r = await promptDialog('Rename cue', [{ key: 'name', label: 'Name', value: cue.name }, { key: 'number', label: 'Number', value: cue.number }]); if (r) { setCueProp(ids, 'name', r.name); setCueProp(ids, 'number', r.number); } } } : null,
    !one ? { label: 'Renumber…', onClick: () => renumberSelected() } : null,
    { label: 'Duplicate', shortcut: '⌘D', onClick: () => duplicateSelected() },
    { label: 'Copy', shortcut: '⌘C', onClick: () => copySelected() },
    { label: 'Cut', shortcut: '⌘X', onClick: () => cutSelected() },
    'separator',
    { label: one ? 'Delete cue' : `Delete ${cues.length} cues`, shortcut: '⌫', danger: true, onClick: () => deleteSelected() },
  ];
}

export function listMenu() {
  const list = viewList();
  const last = list.cues[list.cues.length - 1];
  const placement = last ? { after: last.id } : {};
  return [
    { label: 'Add cue', icon: '+', submenu: typeMenu(placement) },
    { label: 'Add media files…', icon: '♪', onClick: async () => { const files = await window.nq.chooseMedia('audio', true); if (files.length) addFiles(files, placement); } },
    app.clipboard ? { label: 'Paste', shortcut: '⌘V', onClick: () => paste(placement) } : null,
    'separator',
    { label: 'Select all', shortcut: '⌘A', onClick: () => { app.selection = new Set([...walk(list.cues)].map((x) => x.cue.id)); render(); } },
  ];
}

export function openCueMenu(e, cue) {
  e.preventDefault();
  e.stopPropagation();
  showMenu(e.clientX, e.clientY, cueMenu(cue));
}

export function openListMenu(e) {
  e.preventDefault();
  showMenu(e.clientX, e.clientY, listMenu());
}

export function openTransitionMenu(e, cue) {
  e.preventDefault();
  e.stopPropagation();
  // Measure before selecting: selecting re-renders the list and detaches the clicked cell.
  const r = e.currentTarget.getBoundingClientRect();
  if (!app.selection.has(cue.id)) select(cue.id);
  showMenu(r.left, r.bottom, transitionMenu(selectedCues().map((c) => c.id), cue));
}
