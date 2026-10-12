// NomadCue renderer entry: app state, engine wiring, persistence, undo, keyboard, OSC/MIDI/remote control.
import { Engine } from './lib/engine.js';
import {
  createWorkspace, normalizeWorkspace, createCue, createList, findCue, findCueByNumber, siblingsOf, removeCue, walk,
  allCues, cloneCue, mediaFiles, CUE_TYPES, isDescendant,
} from './lib/model.js';
import { deepClone, nextCueNumber, dirname, basename } from './lib/util.js';
import { AudioEngine } from './audio.js';
import { VideoController } from './video.js';
import { LightEngine } from './lighting.js';
import { MidiService } from './midi.js';
import { makeHandlers, makeScriptApi } from './cues.js';
import { confirmDialog, promptDialog, toast } from './lib/dom.js';

export const app = {
  ws: createWorkspace(),
  path: null,
  dirty: false,
  selection: new Set(),
  lastSelected: null,
  viewListId: null,
  broken: new Set(),
  logLines: [],
  undoStack: [],
  redoStack: [],
  renderers: new Set(), // full re-render callbacks
  oscConnected: new Set(),
};

// ------------------------------------------------------------------ logging

export function log(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  app.logLines.push(line);
  if (app.logLines.length > 1000) app.logLines.shift();
  console.log('[nq]', msg);
  app.onLog?.(line);
}

// ------------------------------------------------------------------ services

const getWs = () => app.ws;
const getSettings = () => app.ws.settings;
app.audio = new AudioEngine(log);
app.video = new VideoController({ getSettings, log });
app.lights = new LightEngine({ getSettings, log });
app.midi = new MidiService({ getSettings, log });

const onMutate = () => { markDirty(); render(); };
app.engine = new Engine({
  getWorkspace: getWs,
  log,
  handlers: makeHandlers({
    audio: app.audio, video: app.video, lights: app.lights, midi: app.midi, getWs, log, onMutate,
    scriptApi: makeScriptApi({ getWs, log, midi: app.midi, lights: app.lights, onMutate }),
  }),
});

// ------------------------------------------------------------------ render & state

export function render() { for (const fn of app.renderers) fn(); }

export function markDirty() {
  if (!app.dirty) { app.dirty = true; updateTitle(); }
}

function updateTitle() {
  const name = app.path ? basename(app.path).replace(/\.nomadcue$/, '') : 'Untitled';
  window.nq.setTitle(`${app.dirty ? '• ' : ''}${name} — NomadCue`);
  app.onTitle?.(name);
}

export function viewList() {
  return app.ws.lists.find((l) => l.id === app.viewListId) || app.ws.lists[0];
}

// Snapshot BEFORE a change; call commit() after mutating.
export function snapshot() {
  app.undoStack.push(JSON.stringify({ lists: app.ws.lists, settings: app.ws.settings }));
  if (app.undoStack.length > 200) app.undoStack.shift();
  app.redoStack.length = 0;
}

export function commit() { markDirty(); render(); }

export function change(fn) { snapshot(); fn(); commit(); }

function restore(json) {
  const s = JSON.parse(json);
  app.ws.lists = s.lists;
  const audioChanged = JSON.stringify(s.settings.audio) !== JSON.stringify(app.ws.settings.audio);
  app.ws.settings = s.settings;
  if (audioChanged) applySettings();
  for (const id of [...app.selection]) if (!findCue(app.ws, id)) app.selection.delete(id);
  markDirty();
  render();
}

export function undo() {
  if (!app.undoStack.length) return;
  app.redoStack.push(JSON.stringify({ lists: app.ws.lists, settings: app.ws.settings }));
  restore(app.undoStack.pop());
}

export function redo() {
  if (!app.redoStack.length) return;
  app.undoStack.push(JSON.stringify({ lists: app.ws.lists, settings: app.ws.settings }));
  restore(app.redoStack.pop());
}

// ------------------------------------------------------------------ selection

export function selectedCues() {
  return [...app.selection].map((id) => findCue(app.ws, id)?.cue).filter(Boolean);
}

export function select(id, { add = false, range = false } = {}) {
  if (range && app.lastSelected) {
    const flat = [...walk(viewList().cues)].map((x) => x.cue.id);
    const a = flat.indexOf(app.lastSelected);
    const b = flat.indexOf(id);
    if (a >= 0 && b >= 0) {
      if (!add) app.selection.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) app.selection.add(flat[i]);
    }
  } else if (add) {
    if (app.selection.has(id)) app.selection.delete(id); else app.selection.add(id);
    app.lastSelected = id;
  } else {
    app.selection.clear();
    if (id) app.selection.add(id);
    app.lastSelected = id;
  }
  // Playhead follows selection of top-level cues in the active list.
  const f = id && findCue(app.ws, id);
  if (f && !f.parent && f.list.id === app.engine.activeList()?.id && f.list.kind !== 'cart' && !app.ws.settings.general.showMode) {
    app.engine.setPlayhead(id);
  }
  render();
}

export function moveSelection(delta) {
  const flat = [...walk(viewList().cues)].filter(({ cue, parent }) => !parent || !parent.collapsed).map((x) => x.cue.id);
  if (!flat.length) return;
  const cur = flat.indexOf(app.lastSelected);
  const next = flat[Math.max(0, Math.min(flat.length - 1, cur < 0 ? 0 : cur + delta))];
  select(next);
  document.querySelector(`.row[data-id="${next}"]`)?.scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ cue editing

// placement: { inside: groupId } adds as the group's last child, { after: cueId } inserts after that cue,
// otherwise the new cue goes after the current selection (or at the end of the list).
export function addCue(type, overrides = {}, placement = {}) {
  const list = viewList();
  const anchorId = placement.inside || placement.after || app.lastSelected;
  const sel = anchorId && findCue(app.ws, anchorId);
  const cue = createCue(type, overrides);
  const numbers = allCues(app.ws).map((c) => c.number);
  if (cue.number === '' && type !== 'memo') cue.number = nextCueNumber(numbers, sel?.cue.number);
  // Target-type cues default to targeting the anchor cue
  if (CUE_TYPES[type].targets === 'cue' && sel && !cue.target && !placement.inside) cue.target = sel.cue.id;
  if (type === 'fade' && sel && ['video', 'camera', 'text'].includes(sel.cue.type)) { cue.fadeLevel = false; cue.fadeOpacity = true; }
  if (type === 'fade' && sel?.cue.type === 'fade') { cue.target = sel.cue.target; }
  if (['video', 'camera', 'text'].includes(type) && !cue.stage) cue.stage = app.ws.settings.stages[0]?.id || '';
  snapshot();
  if (placement.inside && sel?.cue.type === 'group') {
    sel.cue.children.push(cue);
    sel.cue.collapsed = false;
  } else if (sel && (sel.list === list || placement.after)) {
    const sibs = sel.parent ? sel.parent.children : sel.list.cues;
    sibs.splice(sibs.indexOf(sel.cue) + 1, 0, cue);
  } else {
    list.cues.push(cue);
  }
  if (list.id === app.engine.activeList()?.id && !app.engine.playheadId) app.engine.setPlayhead(cue.id);
  select(cue.id);
  commit();
  checkMedia();
  return cue;
}

// ------------------------------------------------------------------ transitions & quick edits

export function setContinueMode(ids, mode) {
  change(() => { for (const id of ids) { const c = findCue(app.ws, id)?.cue; if (c) c.continueMode = mode; } });
}

export function setWait(ids, key, seconds) {
  change(() => {
    for (const id of ids) {
      const c = findCue(app.ws, id)?.cue;
      if (!c) continue;
      c[key] = Math.max(0, Number(seconds) || 0);
      // A post-wait only matters when the cue auto-continues, so switch it on for the user.
      if (key === 'postWait' && c[key] > 0 && c.continueMode === 'none') c.continueMode = 'auto-continue';
    }
  });
}

export function setCueProp(ids, key, value) {
  change(() => { for (const id of ids) { const c = findCue(app.ws, id)?.cue; if (c) c[key] = typeof value === 'function' ? value(c[key]) : value; } });
}

export function moveIntoGroup(ids, groupId) { moveCues(ids, groupId, 'into'); }

export function moveOutOfGroup(ids) {
  const items = ids.map((id) => findCue(app.ws, id)).filter((f) => f && f.parent);
  if (!items.length) return;
  snapshot();
  // Process in reverse so the order is preserved when inserting after the parent group.
  for (const f of items.reverse()) {
    const group = findCue(app.ws, f.parent.id);
    removeCue(app.ws, f.cue.id);
    const sibs = group.parent ? group.parent.children : group.list.cues;
    sibs.splice(sibs.indexOf(group.cue) + 1, 0, f.cue);
  }
  commit();
}

export function moveUpDown(ids, delta) {
  const items = ids.map((id) => findCue(app.ws, id)).filter(Boolean);
  if (!items.length) return;
  snapshot();
  const ordered = delta < 0 ? items : items.reverse();
  for (const f of ordered) {
    const sibs = f.parent ? f.parent.children : f.list.cues;
    const i = sibs.indexOf(f.cue);
    const j = i + delta;
    if (j < 0 || j >= sibs.length || ids.includes(sibs[j].id)) continue;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  }
  commit();
}

function nextSibling(id) {
  const sibs = siblingsOf(app.ws, id) || [];
  return sibs[sibs.findIndex((c) => c.id === id) + 1] || null;
}

const VISUAL = ['video', 'camera', 'text'];

function makeFadeOut(target, seconds, name) {
  const visual = VISUAL.includes(target.type);
  return createCue('fade', {
    name, target: target.id, duration: seconds, stopTargetWhenDone: true,
    fadeLevel: !visual, level: -60, fadeOpacity: visual, opacity: 0, fadeVolume: target.type === 'video', volume: -60,
  });
}

// Inserts a fade-out cue right after `cueId` that fades it to silence/black and stops it.
export function addFadeOut(cueId, seconds = 3) {
  const f = findCue(app.ws, cueId);
  if (!f) return null;
  const label = f.cue.name || cueSummaryFor(f.cue);
  const fade = makeFadeOut(f.cue, seconds, `Fade out ${label}`);
  fade.number = nextCueNumber(allCues(app.ws).map((c) => c.number), f.cue.number);
  snapshot();
  const sibs = f.parent ? f.parent.children : f.list.cues;
  sibs.splice(sibs.indexOf(f.cue) + 1, 0, fade);
  app.selection = new Set([fade.id]);
  app.lastSelected = fade.id;
  commit();
  return fade;
}

// Crossfade: one GO fades this cue out while the next cue fades in.
// Inserts "Crossfade" fade cue (auto-continue, 0 post-wait) before the next cue and gives the next cue a fade-in.
export function crossfadeToNext(cueId, seconds = 3) {
  const f = findCue(app.ws, cueId);
  const next = f && nextSibling(cueId);
  if (!f || !next) return null;
  const fade = makeFadeOut(f.cue, seconds, `Crossfade ${f.cue.name || cueSummaryFor(f.cue)} → ${next.name || cueSummaryFor(next)}`);
  fade.continueMode = 'auto-continue';
  fade.postWait = 0;
  fade.number = nextCueNumber(allCues(app.ws).map((c) => c.number), f.cue.number);
  snapshot();
  if ('fadeIn' in next) next.fadeIn = seconds;
  if (f.cue.continueMode !== 'none') f.cue.continueMode = 'none';
  const sibs = f.parent ? f.parent.children : f.list.cues;
  sibs.splice(sibs.indexOf(next), 0, fade);
  app.selection = new Set([fade.id]);
  app.lastSelected = fade.id;
  commit();
  return fade;
}

function cueSummaryFor(cue) {
  return cue.file ? basename(cue.file) : CUE_TYPES[cue.type].label;
}

// ------------------------------------------------------------------ clipboard (cues)

export function copySelected() {
  const cues = selectedCues();
  if (!cues.length) return false;
  app.clipboard = JSON.stringify(cues);
  return true;
}

export function cutSelected() {
  if (copySelected()) deleteSelected();
}

export function paste(placement = {}) {
  if (!app.clipboard) return;
  const cues = JSON.parse(app.clipboard).map(cloneCue);
  const numbers = allCues(app.ws).map((c) => c.number);
  for (const c of cues) {
    if (c.number && numbers.includes(c.number)) { c.number = nextCueNumber(numbers, c.number); }
    numbers.push(c.number);
  }
  const anchor = placement.inside || placement.after || app.lastSelected;
  const sel = anchor && findCue(app.ws, anchor);
  snapshot();
  if (placement.inside && sel?.cue.type === 'group') sel.cue.children.push(...cues);
  else if (sel) { const sibs = sel.parent ? sel.parent.children : sel.list.cues; sibs.splice(sibs.indexOf(sel.cue) + 1, 0, ...cues); }
  else viewList().cues.push(...cues);
  app.selection = new Set(cues.map((c) => c.id));
  app.lastSelected = cues[cues.length - 1].id;
  commit();
  checkMedia();
}

export function deleteSelected() {
  const ids = [...app.selection];
  if (!ids.length) return;
  snapshot();
  for (const id of ids) {
    app.engine.stopCue(id, 0);
    if (app.engine.playheadId === id) {
      const sibs = siblingsOf(app.ws, id) || [];
      const i = sibs.findIndex((c) => c.id === id);
      app.engine.setPlayhead((sibs[i + 1] || sibs[i - 1])?.id || null);
    }
    removeCue(app.ws, id);
  }
  app.selection.clear();
  commit();
}

export function duplicateSelected() {
  const cues = selectedCues();
  if (!cues.length) return;
  snapshot();
  const numbers = allCues(app.ws).map((c) => c.number);
  let last = null;
  for (const c of cues) {
    const sibs = siblingsOf(app.ws, c.id);
    const copy = cloneCue(c);
    if (copy.number) { copy.number = nextCueNumber(numbers, c.number); numbers.push(copy.number); }
    sibs.splice(sibs.indexOf(c) + 1, 0, copy);
    last = copy;
  }
  app.selection.clear();
  if (last) { app.selection.add(last.id); app.lastSelected = last.id; }
  commit();
}

export function groupSelected() {
  const cues = selectedCues();
  if (!cues.length) return;
  const first = findCue(app.ws, cues[0].id);
  const sibs = first.parent ? first.parent.children : first.list.cues;
  const same = cues.filter((c) => sibs.includes(c));
  snapshot();
  const group = createCue('group', { number: nextCueNumber(allCues(app.ws).map((c) => c.number), cues[0].number), name: 'Group' });
  const idx = Math.min(...same.map((c) => sibs.indexOf(c)));
  for (const c of same) sibs.splice(sibs.indexOf(c), 1);
  group.children = same;
  sibs.splice(idx, 0, group);
  if (same.some((c) => c.id === app.engine.playheadId)) app.engine.setPlayhead(group.id);
  app.selection = new Set([group.id]);
  app.lastSelected = group.id;
  commit();
}

export async function renumberSelected() {
  const cues = selectedCues();
  if (!cues.length) return;
  const r = await promptDialog('Renumber selected cues', [
    { key: 'start', label: 'Start at', value: cues[0].number || '1' },
    { key: 'step', label: 'Increment by', value: '1' },
  ]);
  if (!r) return;
  const step = parseFloat(r.step) || 1;
  snapshot();
  let n = parseFloat(r.start) || 1;
  const others = new Set(allCues(app.ws).filter((c) => !app.selection.has(c.id)).map((c) => String(c.number)));
  for (const c of cues) {
    while (others.has(String(n))) n += step;
    c.number = String(Math.round(n * 1000) / 1000);
    n += step;
  }
  commit();
}

// Moves cues (by id) to before/after/into a target cue.
export function moveCues(ids, targetId, where) {
  const target = findCue(app.ws, targetId);
  if (!target) return;
  const moving = ids.map((id) => findCue(app.ws, id)?.cue).filter((c) => c && c.id !== targetId && !isDescendant(c, targetId));
  if (!moving.length) return;
  snapshot();
  for (const c of moving) removeCue(app.ws, c.id);
  if (where === 'into' && target.cue.type === 'group') {
    target.cue.children.push(...moving);
    target.cue.collapsed = false;
  } else {
    const sibs = target.parent ? target.parent.children : target.list.cues;
    const i = sibs.indexOf(target.cue);
    sibs.splice(where === 'after' ? i + 1 : i, 0, ...moving);
  }
  commit();
}

export function moveCuesToList(ids, listId) {
  const list = app.ws.lists.find((l) => l.id === listId);
  if (!list) return;
  snapshot();
  for (const id of ids) {
    const c = removeCue(app.ws, id);
    if (c) list.cues.push(c);
  }
  commit();
}

export function addFiles(paths, placement = {}) {
  const audioExt = /\.(wav|aiff?|mp3|flac|ogg|m4a|aac|opus)$/i;
  const videoExt = /\.(mp4|m4v|mov|webm|mkv|png|jpe?g|gif|webp|svg)$/i;
  const midiExt = /\.midi?$/i;
  let where = { ...placement };
  const add = (type, file) => {
    const c = addCue(type, { file }, where);
    if (!where.inside) where = { after: c.id }; // keep the files in order
  };
  for (const p of paths) {
    if (audioExt.test(p)) add('audio', p);
    else if (videoExt.test(p)) add('video', p);
    else if (midiExt.test(p)) add('midifile', p);
    else if (/\.nomadcue$/i.test(p)) { openFromData(p, null); return; }
    else toast(`Unsupported file: ${basename(p)}`);
  }
}

export async function checkMedia() {
  const files = mediaFiles(app.ws);
  const exists = files.length ? await window.nq.filesExist(files) : [];
  app.broken = new Set(files.filter((_, i) => !exists[i]));
  render();
}

export function isBroken(cue) {
  const def = CUE_TYPES[cue.type];
  if (def.targets === 'file') return !cue.file || app.broken.has(cue.file);
  if (def.targets === 'cue') return !cue.target || !findCue(app.ws, cue.target);
  return false;
}

// ------------------------------------------------------------------ lists

export function addList(kind = 'list') {
  change(() => {
    const l = createList(kind === 'cart' ? `Cart ${app.ws.lists.filter((x) => x.kind === 'cart').length + 1}` : `Cue List ${app.ws.lists.length + 1}`, kind);
    app.ws.lists.push(l);
    app.viewListId = l.id;
  });
}

export async function deleteList(id) {
  if (app.ws.lists.length <= 1) { toast('A workspace needs at least one list'); return; }
  const l = app.ws.lists.find((x) => x.id === id);
  if (l.cues.length && !(await confirmDialog(`Delete "${l.name}" and its ${l.cues.length} cues?`, { ok: 'Delete', danger: true }))) return;
  change(() => {
    app.ws.lists = app.ws.lists.filter((x) => x.id !== id);
    if (app.viewListId === id) app.viewListId = app.ws.lists[0].id;
    if (app.engine.activeListId === id) app.engine.setActiveList(app.ws.lists.find((x) => x.kind !== 'cart')?.id || app.ws.lists[0].id);
  });
}

export function showList(id) {
  app.viewListId = id;
  const l = viewList();
  if (l.kind !== 'cart') app.engine.setActiveList(id);
  render();
}

// ------------------------------------------------------------------ persistence

function serialize() {
  const ws = deepClone(app.ws);
  if (app.path) {
    const dir = dirname(app.path);
    const sep = app.path.includes('\\') && !app.path.includes('/') ? '\\' : '/';
    for (const list of ws.lists) for (const { cue } of walk(list.cues)) {
      if (cue.file && cue.file.startsWith(dir + sep)) cue.file = '.' + sep + cue.file.slice(dir.length + 1);
      delete cue._originalTarget;
    }
  }
  return JSON.stringify(ws, null, 2);
}

function resolvePaths(ws, wsPath) {
  const dir = dirname(wsPath);
  for (const list of ws.lists) for (const { cue } of walk(list.cues)) {
    if (cue.file && /^\.[\\/]/.test(cue.file)) cue.file = dir + cue.file.slice(1);
  }
}

export async function save(saveAs = false) {
  const target = await window.nq.saveWorkspace({ path: app.path, data: serialize(), saveAs, backups: app.ws.settings.general.backups });
  if (!target) return false;
  app.path = target;
  app.dirty = false;
  updateTitle();
  toast('Saved');
  return true;
}

async function confirmDiscard() {
  if (!app.dirty) return true;
  return confirmDialog('You have unsaved changes. Discard them?', { ok: 'Discard', danger: true });
}

export async function newWorkspace() {
  if (!(await confirmDiscard())) return;
  loadWorkspace(createWorkspace(), null);
}

export async function openWorkspace() {
  if (!(await confirmDiscard())) return;
  window.nq.openWorkspace();
}

function openFromData(path, data) {
  if (data === null) return; // dropped files are opened via menu flow
  try {
    const ws = normalizeWorkspace(JSON.parse(data));
    resolvePaths(ws, path);
    loadWorkspace(ws, path);
  } catch (e) {
    toast('Could not open: ' + e.message, 5000);
  }
}

export function loadWorkspace(ws, path) {
  app.engine.hardStop();
  app.video.clearAll();
  app.ws = ws;
  app.path = path;
  app.dirty = false;
  app.selection.clear();
  app.lastSelected = null;
  app.undoStack = [];
  app.redoStack = [];
  const first = ws.lists.find((l) => l.kind !== 'cart') || ws.lists[0];
  app.viewListId = first.id;
  app.engine.activeListId = null;
  app.engine.playheadId = null;
  app.engine.setActiveList(first.id);
  updateTitle();
  applySettings();
  checkMedia();
  render();
}

export async function bundleWorkspace() {
  const files = mediaFiles(app.ws).filter((f) => !app.broken.has(f));
  const r = await window.nq.bundleWorkspace({ files });
  if (!r) return;
  snapshot();
  for (const c of allCues(app.ws)) if (c.file && r.mapping[c.file]) c.file = r.mapping[c.file];
  app.path = r.folder + '/' + (app.path ? basename(app.path) : 'Workspace.nomadcue');
  commit();
  await save();
  toast(`Bundled ${Object.keys(r.mapping).length} media files`);
}

// ------------------------------------------------------------------ settings application

export async function applySettings() {
  const s = app.ws.settings;
  try {
    const info = await app.audio.init(s.audio);
    app.audioInfo = info;
  } catch (e) { log('Audio init failed: ' + e.message); }
  app.engine.minGoInterval = Number(s.general.minGoInterval) || 0;
  window.nq.configureOsc({ port: s.osc.enabled ? Number(s.osc.port) : 0, textPort: s.osc.enabled ? Number(s.osc.textPort) : 0 });
  app.lights.start();
  app.midi.bindInputs();
  try {
    app.remoteUrls = await window.nq.configureRemote({ enabled: s.remote.enabled, port: Number(s.remote.port), passcode: s.remote.passcode });
  } catch (e) { log('Remote: ' + e.message); }
  for (const id of await window.nq.openStages()) {
    const st = s.stages.find((x) => x.id === id);
    if (st) window.nq.openStage(st); else window.nq.closeStage(id);
  }
  render();
}

// ------------------------------------------------------------------ transport

export function go() {
  app.audio.resume();
  return app.engine.go();
}

export function panic() {
  if (app.panicking) { app.engine.hardStop(); app.video.clearAll(); app.panicking = false; return; }
  app.panicking = true;
  const t = Number(app.ws.settings.general.panicTime) || 1;
  app.engine.panic(t);
  setTimeout(() => { app.panicking = false; }, t * 1000 + 100);
}

export function hardStop() { app.engine.hardStop(); app.video.clearAll(); }

export function fireCue(id) {
  const f = findCue(app.ws, id);
  if (!f) return;
  app.audio.resume();
  if (app.engine.isRunning(id) && f.list.kind === 'cart') app.engine.stopCue(id, 0);
  else app.engine.trigger(f.cue);
}

// ------------------------------------------------------------------ OSC control

function oscReply(from, address, data, status = 'ok') {
  const json = JSON.stringify({ address, status, data });
  window.nq.sendOsc({ host: from.address, port: Number(app.ws.settings.osc.replyPort) || 53001, address: '/reply' + address, args: [{ type: 's', value: json }] });
}

function cueJson(cue) {
  const out = { uniqueID: cue.id, number: cue.number, name: cue.name, type: cue.type, colorName: cue.color, flagged: cue.flagged, armed: cue.armed };
  if (cue.type === 'group') out.cues = cue.children.map(cueJson);
  return out;
}

export function handleOsc({ address, args, from }) {
  const s = app.ws.settings.osc;
  let addr = address.replace(/^\/workspace\/[^/]+/, '');
  const key = from.address;
  if (addr === '/connect') {
    const ok = !s.passcode || String(args[0]) === String(s.passcode);
    if (ok) app.oscConnected.add(key);
    oscReply(from, address, ok ? 'ok' : 'badpass', ok ? 'ok' : 'denied');
    return;
  }
  if (s.passcode && !app.oscConnected.has(key)) { oscReply(from, address, null, 'denied'); return; }
  const e = app.engine;
  const parts = addr.split('/').filter(Boolean);
  const [head, ...rest] = parts;
  switch (head) {
    case 'go': if (rest[0] || args[0] !== undefined) e.goToNumber(rest[0] ?? args[0]); else go(); break;
    case 'stop': e.stopAll(0); break;
    case 'hardStop': hardStop(); break;
    case 'panic': panic(); break;
    case 'panicInTime': e.panic(Number(args[0]) || 1); break;
    case 'pause': e.pauseAll(); break;
    case 'resume': e.resumeAll(); break;
    case 'reset': e.reset(); break;
    case 'version': oscReply(from, address, 'NomadCue 0.1'); break;
    case 'playhead':
      if (rest[0] === 'next') e.movePlayhead(1);
      else if (rest[0] === 'previous') e.movePlayhead(-1);
      else if (rest[0] === 'none') e.setPlayhead(null);
      else if (rest[0]) { const c = findCueByNumber(app.ws, rest[0]); if (c) e.setPlayhead(c.id); }
      else oscReply(from, address, e.playheadCue()?.number ?? null);
      break;
    case 'playheadID': if (rest[0]) e.setPlayhead(rest[0]); break;
    case 'select': {
      if (rest[0] === 'next') moveSelection(1);
      else if (rest[0] === 'previous') moveSelection(-1);
      else { const c = findCueByNumber(app.ws, rest[0]); if (c) select(c.id); }
      break;
    }
    case 'select_id': if (rest[0]) select(rest[0]); break;
    case 'cueLists': oscReply(from, address, app.ws.lists.map((l) => ({ uniqueID: l.id, name: l.name, type: l.kind, cues: l.cues.map(cueJson) }))); break;
    case 'runningCues': oscReply(from, address, [...e.runs.values()].map((r) => cueJson(r.cue))); break;
    case 'cue':
    case 'cue_id': {
      const [ref, action] = rest;
      let cues;
      if (ref === 'selected') cues = selectedCues();
      else if (ref === 'playhead') cues = [e.playheadCue()].filter(Boolean);
      else if (ref === '*') cues = allCues(app.ws);
      else cues = [head === 'cue_id' ? findCue(app.ws, ref)?.cue : findCueByNumber(app.ws, ref)].filter(Boolean);
      for (const c of cues) {
        switch (action) {
          case 'start': case 'go': fireCueDirect(c); break;
          case 'stop': e.stopCue(c.id, 0); break;
          case 'hardStop': e.stopCue(c.id, 0); break;
          case 'pause': e.pauseCue(c.id); break;
          case 'resume': e.resumeCue(c.id); break;
          case 'togglePause': e.togglePauseCue(c.id); break;
          case 'panic': e.stopCue(c.id, Number(app.ws.settings.general.panicTime) || 1); break;
          case 'load': if (c.type === 'audio' && c.file) app.audio.load(c.file); break;
          case 'arm': change(() => { c.armed = args[0] === undefined ? true : !!args[0]; }); break;
          case 'disarm': change(() => { c.armed = false; }); break;
          case 'name': case 'number': case 'notes': case 'preWait': case 'postWait': case 'duration': case 'level': case 'opacity':
            if (args.length) change(() => { c[action] = typeof c[action] === 'number' ? Number(args[0]) : String(args[0]); });
            else oscReply(from, address, c[action]);
            break;
          default: if (!action) oscReply(from, address, cueJson(c));
        }
      }
      break;
    }
    default: log(`OSC: unhandled ${address}`);
  }
}

function fireCueDirect(cue) { app.audio.resume(); app.engine.trigger(cue); }

// ------------------------------------------------------------------ MIDI input

function handleMidi({ data, msc }) {
  const s = app.ws.settings.midi;
  if (msc && s.mscReceive && (msc.deviceId === 127 || msc.deviceId === Number(s.mscDeviceId))) {
    switch (msc.command) {
      case 'go': if (msc.cue) app.engine.goToNumber(msc.cue); else go(); break;
      case 'stop': if (msc.cue) { const c = findCueByNumber(app.ws, msc.cue); if (c) app.engine.stopCue(c.id); } else app.engine.pauseAll(); break;
      case 'resume': app.engine.resumeAll(); break;
      case 'all_off': hardStop(); break;
      case 'reset': app.engine.reset(); break;
      case 'fire': if (msc.cue) app.engine.goToNumber(msc.cue); break;
      default: break;
    }
    return;
  }
  const status = data[0] & 0xf0;
  const ch = (data[0] & 0x0f) + 1;
  const isNoteOn = status === 0x90 && data[2] > 0;
  if (app.midiLearn) { app.midiLearn({ data, ch, status }); return; }
  if (isNoteOn && s.goNote !== null && s.goNote !== '' && Number(s.goNote) === data[1]) { go(); return; }
  if (isNoteOn && s.stopNote !== null && s.stopNote !== '' && Number(s.stopNote) === data[1]) { panic(); return; }
  for (const c of allCues(app.ws)) {
    const t = c.midiTrigger;
    if (!t || !t.type) continue;
    if (t.channel && Number(t.channel) !== ch) continue;
    const match = (t.type === 'note' && isNoteOn && Number(t.number) === data[1])
      || (t.type === 'cc' && status === 0xb0 && Number(t.number) === data[1] && data[2] > 0)
      || (t.type === 'program' && status === 0xc0 && Number(t.number) === data[1]);
    if (match) fireCueDirect(c);
  }
}

// ------------------------------------------------------------------ remote (phone) state

let remoteTimer = null;
function pushRemoteState() {
  if (!app.ws.settings.remote.enabled) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => {
    const e = app.engine;
    const list = e.activeList();
    const ph = e.playheadCue();
    const running = new Set([...e.runs.values()].map((r) => r.cue.id));
    window.nq.remoteState({
      name: app.path ? basename(app.path) : 'Untitled',
      lists: app.ws.lists.map((l) => ({ id: l.id, name: l.name, kind: l.kind })),
      activeListId: list?.id,
      playhead: ph ? { id: ph.id, number: ph.number, name: ph.name || CUE_TYPES[ph.type].label, notes: ph.notes } : null,
      cues: list ? [...walk(list.cues)].map(({ cue, depth }) => ({ id: cue.id, number: cue.number, name: cue.name || CUE_TYPES[cue.type].label, type: cue.type, color: cue.color, depth, running: running.has(cue.id) })) : [],
      running: [...e.runs.values()].filter((r) => !r.parentRun).map((r) => ({ id: r.cue.id, number: r.cue.number, name: r.cue.name || CUE_TYPES[r.cue.type].label, elapsed: r.elapsed(), duration: r.duration() })),
    });
  }, 100);
}

function handleRemote(msg) {
  const e = app.engine;
  switch (msg.action) {
    case 'go': go(); break;
    case 'panic': panic(); break;
    case 'hardStop': hardStop(); break;
    case 'pauseAll': e.pauseAll(); break;
    case 'resumeAll': e.resumeAll(); break;
    case 'next': e.movePlayhead(1); break;
    case 'prev': e.movePlayhead(-1); break;
    case 'playhead': e.setPlayhead(msg.id); break;
    case 'fire': fireCue(msg.id); break;
    case 'stop': e.stopCue(msg.id, 0); break;
    default: break;
  }
}

// ------------------------------------------------------------------ boot

export async function boot() {
  window.nq.onWorkspaceOpened(({ path, data }) => openFromData(path, data));
  window.nq.onLog(log);
  window.nq.onOsc(handleOsc);
  window.nq.onRemoteCommand(handleRemote);
  window.nq.onCloseRequest(async () => {
    if (await confirmDiscard()) window.nq.confirmQuit();
  });
  app.midi.onInput(handleMidi);
  app.engine.onChange(() => { pushRemoteState(); app.onEngineChange?.(); });
  setInterval(() => { if (app.engine.runs.size) pushRemoteState(); }, 500);
  setInterval(() => {
    const mins = Number(app.ws.settings.general.autosaveMinutes);
    if (mins > 0 && app.dirty && app.path && Date.now() - (app.lastAutosave || 0) > mins * 60000) {
      app.lastAutosave = Date.now();
      window.nq.autosave({ path: app.path, data: serialize() });
    }
  }, 15000);
  await app.midi.init();
  loadWorkspace(app.ws, null);
}
