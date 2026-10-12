// NomadCue — Electron main process.
const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, screen, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const { Readable } = require('stream');
const { encodeMessage, decodeMessage, parseOscString } = require('./osc');
const { DmxOutput } = require('./dmx');
const { RemoteServer } = require('./remote');

const SMOKE = !!process.env.NQ_SMOKE;

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } },
]);

let controlWin = null;
const stages = new Map(); // stageId -> { win, config }
let pendingOpenPath = null;
let allowClose = false;

const MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mid': 'audio/midi', '.midi': 'audio/midi',
};

// media://local/<encodeURIComponent(absolutePath)> with HTTP Range support (needed for video seeking).
function handleMedia(request) {
  const url = new URL(request.url);
  const filePath = decodeURIComponent(url.pathname.slice(1));
  let stat;
  try { stat = fs.statSync(filePath); } catch (_) { return new Response('Not found', { status: 404 }); }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (!m || !m[1]) { if (m && m[2]) { start = stat.size - parseInt(m[2], 10); end = stat.size - 1; } }
    end = Math.min(end, stat.size - 1);
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1),
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200, headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Content-Length': String(stat.size) },
  });
}

function sendControl(channel, payload) {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send(channel, payload);
}

// ---------------------------------------------------------------- windows

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 600,
    title: 'NomadCue', backgroundColor: '#15171c', show: !SMOKE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  controlWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  controlWin.on('close', (e) => {
    if (allowClose || SMOKE) return;
    e.preventDefault();
    sendControl('app:close-request');
  });
  controlWin.on('closed', () => {
    controlWin = null;
    for (const s of stages.values()) if (!s.win.isDestroyed()) s.win.destroy();
    stages.clear();
  });
  controlWin.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) { openWorkspacePath(pendingOpenPath); pendingOpenPath = null; }
  });
  if (SMOKE) runSmoke();
}

function runSmoke() {
  const errors = [];
  controlWin.webContents.on('console-message', (event) => {
    const level = event.level ?? event.params?.level;
    const message = event.message ?? event.params?.message;
    if (level === 'error' || level === 3) errors.push(message);
    console.log('[renderer]', message);
  });
  controlWin.webContents.on('did-finish-load', async () => {
    try {
      const result = await controlWin.webContents.executeJavaScript('window.__nqSelfTest ? window.__nqSelfTest() : "no self-test"');
      console.log('[smoke] self-test:', JSON.stringify(result));
      if (result && result.failed && result.failed.length) errors.push(...result.failed);
    } catch (e) { errors.push(String(e)); }
    if (process.env.NQ_SHOT) {
      await controlWin.webContents.executeJavaScript('window.__nqDemo()');
      await new Promise((r) => setTimeout(r, 1500));
      const img = await controlWin.webContents.capturePage();
      fs.writeFileSync(process.env.NQ_SHOT, img.toPNG());
      console.log('[smoke] screenshot', process.env.NQ_SHOT, img.getSize());
    }
    console.log(errors.length ? `[smoke] FAILED (${errors.length})\n` + errors.join('\n') : '[smoke] OK');
    app.exit(errors.length ? 1 : 0);
  });
}

function openStage(config) {
  let entry = stages.get(config.id);
  const displays = screen.getAllDisplays();
  const display = displays.find((d) => String(d.id) === String(config.displayId)) || displays[displays.length - 1];
  if (!entry || entry.win.isDestroyed()) {
    const win = new BrowserWindow({
      x: display.bounds.x + 40, y: display.bounds.y + 40,
      width: config.width || 960, height: config.height || 540,
      title: `NomadCue Stage — ${config.name || config.id}`,
      backgroundColor: '#000000', frame: !config.fullscreen, show: !SMOKE,
      webPreferences: {
        preload: path.join(__dirname, 'stage-preload.js'),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    win.loadFile(path.join(__dirname, '..', 'stage', 'stage.html'), { query: { id: config.id } });
    win.on('closed', () => {
      stages.delete(config.id);
      sendControl('stage:closed', config.id);
    });
    entry = { win, config, ready: false, queue: [] };
    stages.set(config.id, entry);
    const e = entry;
    // Commands sent before the stage page has loaded are queued, not lost.
    win.webContents.once('did-finish-load', () => {
      e.ready = true;
      win.webContents.send('stage:config', e.config);
      for (const cmd of e.queue.splice(0)) win.webContents.send('stage:cmd', cmd);
    });
    if (SMOKE) win.webContents.on('console-message', (ev) => console.log('[stage]', ev.message ?? ev.params?.message));
  }
  entry.config = config;
  const { win } = entry;
  if (config.fullscreen) {
    win.setBounds(display.bounds);
    win.setFullScreen(true);
  } else if (win.isFullScreen()) {
    win.setFullScreen(false);
  }
  if (entry.ready) win.webContents.send('stage:config', config);
}

function sendStage(entry, cmd) {
  if (entry.win.isDestroyed()) return;
  if (entry.ready) entry.win.webContents.send('stage:cmd', cmd); else entry.queue.push(cmd);
}

// ---------------------------------------------------------------- OSC / UDP

const oscOut = dgram.createSocket({ type: 'udp4', reuseAddr: true });
oscOut.on('error', (e) => console.error('[osc-out]', e.message));
oscOut.bind(() => { try { oscOut.setBroadcast(true); } catch (_) {} });

let oscIn = null;
let textIn = null;

function startOscServer(port, textPort) {
  for (const s of [oscIn, textIn]) if (s) try { s.close(); } catch (_) {}
  oscIn = textIn = null;
  if (!port) return;
  oscIn = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  oscIn.on('message', (msg, rinfo) => {
    try {
      for (const m of decodeMessage(msg)) sendControl('osc:in', { ...m, from: { address: rinfo.address, port: rinfo.port } });
    } catch (e) { console.error('[osc-in] bad packet', e.message); }
  });
  oscIn.on('error', (e) => sendControl('app:log', `OSC port ${port}: ${e.message}`));
  oscIn.bind(port);
  if (textPort) {
    textIn = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    textIn.on('message', (msg, rinfo) => {
      for (const line of String(msg).split(/\r?\n/).filter(Boolean)) {
        const m = parseOscString(line.trim());
        sendControl('osc:in', { address: m.address, args: m.args.map((a) => a.value ?? (a.type === 'T')), from: { address: rinfo.address, port: rinfo.port } });
      }
    });
    textIn.on('error', (e) => sendControl('app:log', `UDP text port ${textPort}: ${e.message}`));
    textIn.bind(textPort);
  }
}

// ---------------------------------------------------------------- workspace files

function backupDir(wsPath) {
  return path.join(path.dirname(wsPath), 'NomadCue Backups');
}

function writeBackup(wsPath, data, keep = 20) {
  const dir = backupDir(wsPath);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(wsPath, path.extname(wsPath));
  fs.writeFileSync(path.join(dir, `${base} ${stamp}.nomadcue`), data);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(base + ' ')).sort();
  while (files.length > keep) fs.unlinkSync(path.join(dir, files.shift()));
}

function openWorkspacePath(p) {
  try {
    const data = fs.readFileSync(p, 'utf8');
    sendControl('ws:opened', { path: p, data });
    app.addRecentDocument(p);
  } catch (e) {
    dialog.showErrorBox('Could not open workspace', e.message);
  }
}

async function chooseAndOpen() {
  const r = await dialog.showOpenDialog(controlWin, {
    properties: ['openFile'], filters: [{ name: 'NomadCue Workspace', extensions: ['nomadcue', 'json'] }],
  });
  if (!r.canceled && r.filePaths[0]) openWorkspacePath(r.filePaths[0]);
}

// ---------------------------------------------------------------- IPC

const dmx = new DmxOutput();
const remote = new RemoteServer({ onCommand: (msg) => sendControl('remote:command', msg) });

function registerIpc() {
  ipcMain.handle('displays:list', () => screen.getAllDisplays().map((d) => ({
    id: String(d.id), label: d.label || `Display ${d.id}`, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id,
  })));

  ipcMain.on('stage:open', (_e, config) => openStage(config));
  ipcMain.on('stage:close', (_e, id) => { const s = stages.get(id); if (s && !s.win.isDestroyed()) s.win.close(); });
  ipcMain.on('stage:cmd', (_e, { stageId, ...cmd }) => {
    const targets = stageId === '*' ? [...stages.values()] : [stages.get(stageId)].filter(Boolean);
    for (const s of targets) sendStage(s, cmd);
  });
  ipcMain.on('stage:event', (_e, evt) => sendControl('stage:event', evt));
  ipcMain.handle('stage:list-open', () => [...stages.keys()]);

  ipcMain.on('osc:config', (_e, { port, textPort }) => startOscServer(port, textPort));
  ipcMain.on('net:osc', (_e, { host, port, address, args }) => {
    try { oscOut.send(encodeMessage(address, args || []), port, host || '127.0.0.1'); }
    catch (e) { sendControl('app:log', 'OSC send failed: ' + e.message); }
  });
  ipcMain.on('net:osc-string', (_e, { host, port, text }) => {
    try { const m = parseOscString(text); oscOut.send(encodeMessage(m.address, m.args), port, host || '127.0.0.1'); }
    catch (e) { sendControl('app:log', 'OSC send failed: ' + e.message); }
  });
  ipcMain.on('net:udp', (_e, { host, port, text }) => {
    oscOut.send(Buffer.from(String(text)), port, host || '127.0.0.1');
  });

  ipcMain.on('dmx:config', (_e, cfg) => dmx.configure(cfg));
  ipcMain.on('dmx:frames', (_e, frames) => dmx.send(frames));

  ipcMain.handle('remote:config', (_e, { enabled, port, passcode }) => {
    if (enabled) remote.start(port || 53100, passcode); else remote.stop();
    return remote.urls();
  });
  ipcMain.on('remote:state', (_e, state) => remote.broadcast(state));

  ipcMain.handle('dialog:media', async (_e, { kind, multi }) => {
    const filters = {
      audio: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'mp3', 'flac', 'ogg', 'm4a', 'aac', 'opus'] }],
      video: [{ name: 'Video & Images', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
      midi: [{ name: 'MIDI File', extensions: ['mid', 'midi'] }],
    }[kind] || [];
    const r = await dialog.showOpenDialog(controlWin, { properties: ['openFile', ...(multi ? ['multiSelections'] : [])], filters });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('fs:exists', (_e, paths) => paths.map((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }));
  ipcMain.handle('fs:read-binary', (_e, p) => fs.readFileSync(p));

  ipcMain.handle('ws:open', () => chooseAndOpen());
  ipcMain.handle('ws:save', async (_e, { path: p, data, saveAs, backups }) => {
    let target = p;
    if (!target || saveAs) {
      const r = await dialog.showSaveDialog(controlWin, {
        defaultPath: target || 'Untitled.nomadcue', filters: [{ name: 'NomadCue Workspace', extensions: ['nomadcue'] }],
      });
      if (r.canceled) return null;
      target = r.filePath;
    }
    fs.writeFileSync(target, data);
    if (backups) try { writeBackup(target, data); } catch (e) { console.error('[backup]', e.message); }
    app.addRecentDocument(target);
    return target;
  });
  ipcMain.handle('ws:autosave', (_e, { path: p, data }) => {
    if (!p) return false;
    try { writeBackup(p, data); return true; } catch (_) { return false; }
  });
  // Copies all referenced media next to the workspace so the folder can be moved to another computer.
  ipcMain.handle('ws:bundle', async (_e, { files }) => {
    const r = await dialog.showOpenDialog(controlWin, { properties: ['openDirectory', 'createDirectory'], title: 'Choose a folder to bundle the workspace into' });
    if (r.canceled) return null;
    const mediaDir = path.join(r.filePaths[0], 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    const mapping = {};
    const used = new Set();
    for (const f of files) {
      try {
        let dest = path.join(mediaDir, path.basename(f));
        let i = 1;
        while (used.has(dest)) dest = path.join(mediaDir, `${i++}-${path.basename(f)}`);
        used.add(dest);
        fs.copyFileSync(f, dest);
        mapping[f] = dest;
      } catch (e) { sendControl('app:log', `Bundle: could not copy ${f}: ${e.message}`); }
    }
    return { folder: r.filePaths[0], mapping };
  });

  ipcMain.on('app:quit-confirmed', () => { allowClose = true; if (controlWin) controlWin.close(); });
  ipcMain.on('app:set-title', (_e, title) => { if (controlWin) controlWin.setTitle(title); });
  ipcMain.on('app:open-external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
}

// ---------------------------------------------------------------- menu

function buildMenu() {
  const cmd = (name) => () => sendControl('menu', name);
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Workspace', accelerator: 'CmdOrCtrl+N', click: cmd('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: cmd('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('saveAs') },
        { type: 'separator' },
        { label: 'Bundle Workspace (copy media)…', click: cmd('bundle') },
        { label: 'Workspace Settings…', accelerator: 'CmdOrCtrl+,', click: cmd('settings') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: cmd('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: cmd('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Duplicate Cue', accelerator: 'CmdOrCtrl+D', click: cmd('duplicate') },
        { label: 'Renumber Selected Cues', click: cmd('renumber') },
      ],
    },
    {
      label: 'Show',
      submenu: [
        { label: 'Panic (fade out everything)', click: cmd('panic') },
        { label: 'Hard Stop All', click: cmd('hardStop') },
        { label: 'Pause All', click: cmd('pauseAll') },
        { label: 'Resume All', click: cmd('resumeAll') },
        { label: 'Reset Workspace', click: cmd('reset') },
        { type: 'separator' },
        { label: 'Toggle Show Mode', accelerator: 'CmdOrCtrl+Shift+M', click: cmd('showMode') },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Light Dashboard', accelerator: 'CmdOrCtrl+Shift+L', click: cmd('lightDashboard') },
        { label: 'Audio Output Meters', click: cmd('meters') },
        { label: 'Open All Stages', click: cmd('openStages') },
        { label: 'Log', click: cmd('log') },
        { type: 'separator' },
        { role: 'minimize' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      ],
    },
    { role: 'help', submenu: [{ label: 'NomadCue on GitHub', click: () => shell.openExternal('https://github.com/faridmasjedi/NomadCue') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- lifecycle

app.on('open-file', (e, p) => {
  e.preventDefault();
  if (controlWin && !controlWin.webContents.isLoading()) openWorkspacePath(p); else pendingOpenPath = p;
});

const argPath = process.argv.slice(1).find((a) => a.endsWith('.nomadcue'));
if (argPath) pendingOpenPath = path.resolve(argPath);

app.whenReady().then(() => {
  protocol.handle('media', handleMedia);
  const allowed = new Set(['media', 'midi', 'midiSysex', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  registerIpc();
  buildMenu();
  createControlWindow();
  app.on('activate', () => { if (!controlWin) createControlWindow(); });
});

app.on('window-all-closed', () => {
  remote.stop();
  app.quit();
});
