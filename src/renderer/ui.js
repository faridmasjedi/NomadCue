// Main window UI: top bar, toolbar, sidebar, cue list / cart, active cues, status bar, keyboard & drag-drop.
import {
  app, boot, render, go, panic, hardStop, select, moveSelection, addCue, deleteSelected, duplicateSelected, groupSelected,
  renumberSelected, moveCues, moveCuesToList, addFiles, isBroken, viewList, showList, addList, deleteList, change, undo, redo,
  save, newWorkspace, openWorkspace, bundleWorkspace, fireCue, selectedCues, log,
} from './app.js';
import { walk, CUE_TYPES, TOOLBAR_ORDER, cueSummary, findCue } from './lib/model.js';
import { h, clear } from './lib/dom.js';
import { formatTime } from './lib/util.js';
import { renderInspector } from './inspector.js';
import { openSettings, openLightDashboard, openLog, openMeters } from './settings.js';
import { runSelfTest, showDemo } from './selftest.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ top bar

function renderTopbar() {
  const ph = app.engine.playheadCue();
  $('sbCue').textContent = ph ? `${ph.number ? ph.number + ' · ' : ''}${cueSummary(ph, app.ws)}` : '— end of list —';
  $('sbNotes').textContent = ph?.notes || '';
  $('goBtn').disabled = !ph;
  document.body.classList.toggle('show-mode', !!app.ws.settings.general.showMode);
  $('showModeBtn').classList.toggle('on', !!app.ws.settings.general.showMode);
  $('remoteBtn').classList.toggle('on', !!app.ws.settings.remote.enabled);
  $('remoteBtn').title = app.ws.settings.remote.enabled ? 'Web remote ON: ' + (app.remoteUrls || []).join('  ') : 'Web remote is off (enable in Settings → Remote)';
}

function renderToolbar() {
  const bar = clear($('toolbar'));
  for (const type of TOOLBAR_ORDER) {
    const def = CUE_TYPES[type];
    bar.appendChild(h('button', {
      class: `tool t-${type}`, title: `New ${def.label} cue`, draggable: true,
      onClick: async () => {
        if (type === 'audio' || type === 'video' || type === 'midifile') {
          const files = await window.nq.chooseMedia(type === 'midifile' ? 'midi' : type, true);
          if (files.length) addFiles(files); else addCue(type);
        } else addCue(type);
      },
    }, h('span', { class: 'glyph' }, def.glyph), h('span', { class: 'lbl' }, def.label)));
  }
}

// ------------------------------------------------------------------ sidebar

function renderSidebar() {
  const lists = clear($('lists'));
  for (const l of app.ws.lists) {
    const active = app.engine.activeList()?.id === l.id;
    const row = h('div', {
      class: `list-item${l.id === viewList().id ? ' viewing' : ''}${active ? ' active' : ''}`,
      onClick: () => showList(l.id),
      onDblclick: () => {
        const input = h('input', { value: l.name, class: 'inline-edit', onBlur: () => finish(), onKeydown: (e) => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') render(); } });
        const finish = () => { if (input.value.trim() && input.value !== l.name) change(() => { l.name = input.value.trim(); }); else render(); };
        row.replaceChildren(input);
        input.select();
      },
      onDragover: (e) => { if (e.dataTransfer.types.includes('nq/cues')) { e.preventDefault(); row.classList.add('drop'); } },
      onDragleave: () => row.classList.remove('drop'),
      onDrop: (e) => { e.preventDefault(); row.classList.remove('drop'); moveCuesToList(JSON.parse(e.dataTransfer.getData('nq/cues')), l.id); },
    },
    h('span', { class: 'list-icon' }, l.kind === 'cart' ? '▦' : '☰'),
    h('span', { class: 'list-name' }, l.name),
    h('span', { class: 'list-count' }, String(l.cues.length)),
    h('button', { class: 'icon-btn small', title: 'Delete list', onClick: (e) => { e.stopPropagation(); deleteList(l.id); } }, '✕'));
    lists.appendChild(row);
  }
}

// ------------------------------------------------------------------ cue list

const COLS = ['', '', '', 'Number', 'Name', 'Target', 'Pre-wait', 'Action', 'Post-wait', ''];

function rowStatus(cue) {
  const runs = app.engine.runsFor(cue.id);
  if (runs.some((r) => r.paused)) return 'paused';
  if (runs.some((r) => r.state === 'prewait')) return 'waiting';
  if (runs.length) return 'running';
  return '';
}

function targetText(cue) {
  const def = CUE_TYPES[cue.type];
  if (def.targets === 'file') return cue.file ? cue.file.split(/[\\/]/).pop() : '—';
  if (def.targets === 'cue') {
    const t = cue.target && findCue(app.ws, cue.target)?.cue;
    return t ? (t.number || cueSummary(t, app.ws)) : '?';
  }
  if (cue.type === 'group') return `${cue.children.length} cues`;
  return '';
}

function staticDuration(cue) {
  if (['fade', 'light', 'wait', 'timecode'].includes(cue.type)) return Number(cue.duration) || 0;
  if (cue.type === 'text' && cue.duration > 0) return Number(cue.duration);
  if (cue.type === 'audio' && app.durations?.[cue.file] !== undefined) {
    const d = app.durations[cue.file];
    const end = Number(cue.endTime) > 0 ? Math.min(cue.endTime, d) : d;
    return Number(cue.loops) === 0 ? Infinity : ((end - (Number(cue.startTime) || 0)) * Math.max(1, Number(cue.loops) || 1)) / (Number(cue.rate) || 1);
  }
  return null;
}

function contGlyph(mode) { return mode === 'auto-continue' ? '↓' : mode === 'auto-follow' ? '⇣' : ''; }

function renderCueList() {
  const list = viewList();
  const pane = clear($('cuelist'));
  pane.classList.toggle('cart', list.kind === 'cart');
  if (list.kind === 'cart') { renderCart(list, pane); return; }
  pane.appendChild(h('div', { class: 'row header' }, COLS.map((c) => h('div', {}, c))));
  const body = h('div', { class: 'rows' });
  pane.appendChild(body);
  if (!list.cues.length) {
    body.appendChild(h('div', { class: 'empty' },
      h('div', { class: 'empty-title' }, 'This cue list is empty'),
      h('div', {}, 'Drag audio, video or image files here, or use the toolbar above. Press ', h('kbd', {}, 'Space'), ' to GO.')));
  }
  const hidden = new Set();
  for (const { cue, parent, depth } of walk(list.cues)) {
    if (parent && (hidden.has(parent.id) || parent.collapsed)) { hidden.add(cue.id); continue; }
    body.appendChild(cueRow(cue, depth));
  }
}

function cueRow(cue, depth) {
  const def = CUE_TYPES[cue.type];
  const isPH = app.engine.playheadId === cue.id;
  const status = rowStatus(cue);
  const dur = staticDuration(cue);
  const row = h('div', {
    class: ['row', `c-${cue.color}`, app.selection.has(cue.id) && 'selected', isPH && 'playhead', status, isBroken(cue) && 'broken',
      !cue.armed && 'disarmed', cue.type === 'group' && 'group', cue.flagged && 'flagged'].filter(Boolean).join(' '),
    dataset: { id: cue.id }, draggable: true,
    onMousedown: (e) => { if (e.button === 0 && !e.target.closest('input,button')) select(cue.id, { add: e.metaKey || e.ctrlKey, range: e.shiftKey }); },
    onDblclick: (e) => { if (!e.target.closest('.c-name')) return; editInline(row.querySelector('.c-name'), cue, 'name'); },
    onDragstart: (e) => {
      const ids = app.selection.has(cue.id) ? [...app.selection] : [cue.id];
      e.dataTransfer.setData('nq/cues', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragover: (e) => {
      if (!e.dataTransfer.types.includes('nq/cues') && !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      const where = cue.type === 'group' && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'before' : 'after';
      row.dataset.drop = where;
    },
    onDragleave: () => { delete row.dataset.drop; },
    onDrop: (e) => {
      const where = row.dataset.drop || 'after';
      delete row.dataset.drop;
      if (e.dataTransfer.types.includes('nq/cues')) {
        e.preventDefault(); e.stopPropagation();
        moveCues(JSON.parse(e.dataTransfer.getData('nq/cues')), cue.id, where);
      }
    },
  },
  h('div', { class: 'c-ph', title: 'Playhead', onClick: () => app.engine.setPlayhead(cue.id) }, isPH ? '▶' : ''),
  h('div', { class: 'c-status' }, isBroken(cue) ? '⚠' : status === 'running' ? '●' : status === 'paused' ? '❙❙' : status === 'waiting' ? '◌' : ''),
  h('div', { class: `c-type t-${cue.type}`, title: def.label }, def.glyph),
  h('div', { class: 'c-num' }, cue.number),
  h('div', { class: 'c-name', style: { paddingLeft: depth * 18 + 'px' } },
    cue.type === 'group' ? h('span', { class: 'twisty', onMousedown: (e) => { e.stopPropagation(); change(() => { cue.collapsed = !cue.collapsed; }); } }, cue.collapsed ? '▸' : '▾') : null,
    h('span', { class: 'name-text' }, cueSummary(cue, app.ws)),
    cue.notes ? h('span', { class: 'has-notes', title: cue.notes }, '¶') : null,
    cue.hotkey ? h('kbd', { class: 'hk' }, cue.hotkey) : null),
  h('div', { class: 'c-target' }, targetText(cue)),
  h('div', { class: 'c-time c-pre' }, cue.preWait ? formatTime(cue.preWait) : ''),
  h('div', { class: 'c-time c-action' }, dur === null ? '' : dur === Infinity ? '∞' : formatTime(dur)),
  h('div', { class: 'c-time c-post' }, cue.continueMode === 'auto-continue' && cue.postWait ? formatTime(cue.postWait) : ''),
  h('div', { class: 'c-cont', title: cue.continueMode }, contGlyph(cue.continueMode)),
  h('div', { class: 'progress' }));
  return row;
}

function editInline(cell, cue, key) {
  if (app.ws.settings.general.showMode) return;
  const input = h('input', { class: 'inline-edit', value: cue[key] || '' });
  const done = (ok) => { if (ok && input.value !== cue[key]) change(() => { cue[key] = input.value; }); else render(); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  input.addEventListener('blur', () => done(true));
  cell.replaceChildren(input);
  input.focus();
  input.select();
}

function renderCart(list, pane) {
  const grid = h('div', { class: 'cart-grid' });
  for (const cue of list.cues) {
    const status = rowStatus(cue);
    grid.appendChild(h('div', {
      class: ['tile', `c-${cue.color}`, status, app.selection.has(cue.id) && 'selected', isBroken(cue) && 'broken'].filter(Boolean).join(' '),
      dataset: { id: cue.id }, draggable: true,
      onClick: (e) => { if (e.altKey || e.metaKey || e.ctrlKey) select(cue.id, { add: e.metaKey || e.ctrlKey }); else fireCue(cue.id); },
      onDragstart: (e) => e.dataTransfer.setData('nq/cues', JSON.stringify([cue.id])),
      onDragover: (e) => { if (e.dataTransfer.types.includes('nq/cues')) e.preventDefault(); },
      onDrop: (e) => { e.preventDefault(); moveCues(JSON.parse(e.dataTransfer.getData('nq/cues')), cue.id, 'before'); },
    },
    h('button', { class: 'tile-edit', title: 'Select / edit', onClick: (e) => { e.stopPropagation(); select(cue.id); } }, '✎'),
    h('div', { class: 'tile-type' }, CUE_TYPES[cue.type].glyph, ' ', cue.number),
    h('div', { class: 'tile-name' }, cueSummary(cue, app.ws)),
    cue.hotkey ? h('kbd', { class: 'hk' }, cue.hotkey) : null,
    h('div', { class: 'progress' })));
  }
  if (!list.cues.length) grid.appendChild(h('div', { class: 'empty' }, 'Empty cart. Add cues with the toolbar or drop files here. Click a tile to fire it, ⌥-click or ✎ to edit.'));
  pane.appendChild(grid);
}

// ------------------------------------------------------------------ active cues & live progress

function renderActive() {
  const box = clear($('active'));
  const runs = [...app.engine.runs.values()];
  if (!runs.length) { box.appendChild(h('div', { class: 'muted pad' }, 'No active cues')); return; }
  for (const r of runs) {
    box.appendChild(h('div', { class: `active-item${r.paused ? ' paused' : ''}`, dataset: { run: r.id } },
      h('div', { class: 'ai-top' },
        h('span', { class: `c-type t-${r.cue.type}` }, CUE_TYPES[r.cue.type].glyph),
        h('span', { class: 'ai-name' }, `${r.cue.number ? r.cue.number + ' · ' : ''}${cueSummary(r.cue, app.ws)}`),
        h('button', { class: 'icon-btn small', title: r.paused ? 'Resume' : 'Pause', onClick: () => app.engine.togglePauseCue(r.cue.id) }, r.paused ? '▶' : '❙❙'),
        h('button', { class: 'icon-btn small', title: 'Stop', onClick: () => app.engine.stopCue(r.cue.id, 0) }, '■')),
      h('div', { class: 'ai-bar' }, h('div', { class: 'ai-fill' })),
      h('div', { class: 'ai-times' }, h('span', { class: 'ai-el' }), h('span', { class: 'ai-rem' }))));
  }
}

function liveUpdate() {
  for (const r of app.engine.runs.values()) {
    const el = r.elapsed();
    const dur = r.duration();
    const pre = r.preWaitRemaining();
    const frac = dur && isFinite(dur) && dur > 0 ? Math.min(1, el / dur) : r.state === 'prewait' ? 0 : null;
    const item = document.querySelector(`.active-item[data-run="${r.id}"]`);
    if (item) {
      item.querySelector('.ai-fill').style.width = frac === null ? '100%' : (frac * 100).toFixed(1) + '%';
      item.querySelector('.ai-fill').classList.toggle('indeterminate', frac === null);
      item.querySelector('.ai-el').textContent = r.state === 'prewait' ? `pre-wait ${formatTime(pre)}` : formatTime(el);
      item.querySelector('.ai-rem').textContent = dur && isFinite(dur) ? '-' + formatTime(Math.max(0, dur - el)) : dur === Infinity ? '∞' : '';
    }
    for (const row of document.querySelectorAll(`[data-id="${r.cue.id}"]`)) {
      const p = row.querySelector('.progress');
      if (p) p.style.width = frac === null ? '0' : (frac * 100).toFixed(1) + '%';
      const action = row.querySelector('.c-action');
      if (action && dur && isFinite(dur) && r.state === 'running') action.textContent = formatTime(Math.max(0, dur - el));
      const preCell = row.querySelector('.c-pre');
      if (preCell && r.state === 'prewait') preCell.textContent = formatTime(pre);
    }
  }
  drawMiniMeters();
  requestAnimationFrame(liveUpdate);
}

function drawMiniMeters() {
  const c = $('miniMeters');
  if (!c || !app.audio.ctx) return;
  const levels = app.audio.levels();
  const n = levels.length;
  const w = c.width = Math.min(240, n * 8 + 4);
  const hgt = c.height;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, hgt);
  const bw = Math.max(2, Math.floor((w - 4) / n) - 2);
  levels.forEach((v, i) => {
    const db = v > 0 ? 20 * Math.log10(v) : -60;
    const frac = Math.max(0, Math.min(1, (db + 60) / 60));
    g.fillStyle = db > -1 ? '#ff4d4d' : db > -12 ? '#f5c542' : '#3ddc84';
    g.fillRect(2 + i * (bw + 2), hgt - frac * hgt, bw, frac * hgt);
  });
}

// ------------------------------------------------------------------ status bar

function renderStatus() {
  const list = viewList();
  const count = [...walk(list.cues)].length;
  $('statusLeft').textContent = `${count} cues · ${app.ws.lists.length} lists · ${app.audioInfo ? `${app.audioInfo.outputs}/${app.audioInfo.max} audio outs @ ${app.audioInfo.sampleRate} Hz` : 'audio off'} · OSC ${app.ws.settings.osc.enabled ? ':' + app.ws.settings.osc.port : 'off'}`;
}

// ------------------------------------------------------------------ keyboard

function inEditable(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function onKey(e) {
  if (document.querySelector('.modal-overlay') && e.key !== 'Escape') return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape' && !document.querySelector('.modal-overlay')) {
    if (inEditable(e)) { e.target.blur(); return; }
    e.preventDefault(); panic(); return;
  }
  if (inEditable(e)) return;
  // per-cue hotkeys
  if (!mod && e.key.length === 1 && e.key !== ' ') {
    const hits = [...walk(app.ws.lists.flatMap((l) => l.cues))].filter(({ cue }) => cue.hotkey && cue.hotkey.toLowerCase() === e.key.toLowerCase());
    if (hits.length) { e.preventDefault(); hits.forEach(({ cue }) => fireCue(cue.id)); return; }
  }
  const showMode = app.ws.settings.general.showMode;
  switch (true) {
    case e.key === ' ': e.preventDefault(); if (!e.repeat) go(); break;
    case e.key === 'ArrowDown' && !mod: e.preventDefault(); if (showMode) app.engine.movePlayhead(1); else moveSelection(1); break;
    case e.key === 'ArrowUp' && !mod: e.preventDefault(); if (showMode) app.engine.movePlayhead(-1); else moveSelection(-1); break;
    case (e.key === 'Backspace' || e.key === 'Delete') && !showMode: e.preventDefault(); deleteSelected(); break;
    case e.key === 'Enter' && !showMode: e.preventDefault(); { const c = selectedCues()[0]; if (c) document.querySelector(`.row[data-id="${c.id}"] .c-name`) && editInlineByCue(c); } break;
    case mod && e.key.toLowerCase() === 'g' && !showMode: e.preventDefault(); groupSelected(); break;
    case mod && e.key.toLowerCase() === 'a' && !e.shiftKey: e.preventDefault(); app.selection = new Set([...walk(viewList().cues)].map((x) => x.cue.id)); render(); break;
    case mod && /^[0-9]$/.test(e.key) && !showMode: {
      e.preventDefault();
      const map = { 1: 'audio', 2: 'mic', 3: 'video', 4: 'camera', 5: 'text', 6: 'light', 7: 'fade', 8: 'network', 9: 'midi', 0: 'group' };
      addCue(map[e.key]);
      break;
    }
    case !mod && e.key.toLowerCase() === 'p': { e.preventDefault(); const sel = selectedCues(); if (sel.length) sel.forEach((c) => app.engine.togglePauseCue(c.id)); else if (app.engine.runs.size) [...app.engine.runs.values()].some((r) => !r.paused) ? app.engine.pauseAll() : app.engine.resumeAll(); break; }
    case !mod && e.key.toLowerCase() === 's' && !showMode: { e.preventDefault(); selectedCues().forEach((c) => app.engine.stopCue(c.id, 0)); break; }
    case !mod && e.key.toLowerCase() === 'v' && !showMode: { e.preventDefault(); selectedCues().forEach((c) => fireCue(c.id)); break; } // audition selected
    default: break;
  }
}

function editInlineByCue(cue) {
  const cell = document.querySelector(`.row[data-id="${cue.id}"] .c-name`);
  if (cell) editInline(cell, cue, 'name');
}

// ------------------------------------------------------------------ wiring

function wire() {
  $('goBtn').addEventListener('click', () => go());
  $('panicBtn').addEventListener('click', () => panic());
  $('pauseBtn').addEventListener('click', () => ([...app.engine.runs.values()].some((r) => !r.paused) ? app.engine.pauseAll() : app.engine.resumeAll()));
  $('resetBtn').addEventListener('click', () => app.engine.reset());
  $('settingsBtn').addEventListener('click', () => openSettings());
  $('lightsBtn').addEventListener('click', () => openLightDashboard());
  $('logBtn').addEventListener('click', () => openLog());
  $('remoteBtn').addEventListener('click', () => openSettings('remote'));
  $('showModeBtn').addEventListener('click', () => change(() => { app.ws.settings.general.showMode = !app.ws.settings.general.showMode; }));
  $('addListBtn').addEventListener('click', () => addList('list'));
  $('addCartBtn').addEventListener('click', () => addList('cart'));
  $('miniMeters').addEventListener('click', () => openMeters());
  document.addEventListener('keydown', onKey);

  // file drag & drop (anywhere)
  document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('dropping');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map((f) => window.nq.pathForFile(f)).filter(Boolean);
    addFiles(paths);
  });

  window.nq.onMenu((cmd) => {
    const active = document.activeElement;
    const editable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    switch (cmd) {
      case 'new': newWorkspace(); break;
      case 'open': openWorkspace(); break;
      case 'save': save(); break;
      case 'saveAs': save(true); break;
      case 'bundle': bundleWorkspace(); break;
      case 'settings': openSettings(); break;
      case 'undo': if (editable) document.execCommand('undo'); else undo(); break;
      case 'redo': if (editable) document.execCommand('redo'); else redo(); break;
      case 'duplicate': duplicateSelected(); break;
      case 'renumber': renumberSelected(); break;
      case 'panic': panic(); break;
      case 'hardStop': hardStop(); break;
      case 'pauseAll': app.engine.pauseAll(); break;
      case 'resumeAll': app.engine.resumeAll(); break;
      case 'reset': app.engine.reset(); break;
      case 'showMode': change(() => { app.ws.settings.general.showMode = !app.ws.settings.general.showMode; }); break;
      case 'lightDashboard': openLightDashboard(); break;
      case 'meters': openMeters(); break;
      case 'log': openLog(); break;
      case 'openStages': app.ws.settings.stages.forEach((s) => app.video.openStage(s)); break;
      default: break;
    }
  });

  app.onLog = (line) => { $('statusLog').textContent = line; };
  app.onEngineChange = () => { renderTopbar(); renderActive(); renderCueListStatusOnly(); };
}

// Cheap refresh of status classes without rebuilding the list (keeps inline edits & scroll).
function renderCueListStatusOnly() {
  for (const row of document.querySelectorAll('#cuelist [data-id]')) {
    const id = row.dataset.id;
    const cue = findCue(app.ws, id)?.cue;
    if (!cue) continue;
    const status = rowStatus(cue);
    for (const s of ['running', 'paused', 'waiting']) row.classList.toggle(s, status === s);
    const isPH = app.engine.playheadId === id;
    row.classList.toggle('playhead', isPH);
    const ph = row.querySelector('.c-ph');
    if (ph) ph.textContent = isPH ? '▶' : '';
    const st = row.querySelector('.c-status');
    if (st && !isBroken(cue)) st.textContent = status === 'running' ? '●' : status === 'paused' ? '❙❙' : status === 'waiting' ? '◌' : '';
    if (!status) {
      const p = row.querySelector('.progress'); if (p) p.style.width = '0';
      const a = row.querySelector('.c-action');
      if (a) { const d = staticDuration(cue); a.textContent = d === null ? '' : d === Infinity ? '∞' : formatTime(d); }
      const pre = row.querySelector('.c-pre'); if (pre) pre.textContent = cue.preWait ? formatTime(cue.preWait) : '';
    }
  }
  if (app.engine.playheadId) document.querySelector(`.row[data-id="${app.engine.playheadId}"]`)?.scrollIntoView({ block: 'nearest' });
}

// Cache media durations for the Action column (decoded lazily).
app.durations = {};
async function refreshDurations() {
  for (const { cue } of walk(app.ws.lists.flatMap((l) => l.cues))) {
    if (cue.type === 'audio' && cue.file && app.durations[cue.file] === undefined && !app.broken.has(cue.file) && app.audio.ctx) {
      app.durations[cue.file] = null;
      app.audio.load(cue.file).then((b) => { app.durations[cue.file] = b.duration; renderCueList(); }).catch(() => { delete app.durations[cue.file]; });
    }
  }
}

app.renderers.add(() => {
  renderTopbar();
  renderSidebar();
  renderCueList();
  renderActive();
  renderInspector($('inspector'));
  renderStatus();
  refreshDurations();
});

renderToolbar();
wire();
boot().then(() => {
  log('NomadCue ready — every feature unlocked, free forever.');
  requestAnimationFrame(liveUpdate);
});

window.__nqSelfTest = runSelfTest;
window.__nqDemo = showDemo;
