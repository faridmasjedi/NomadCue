const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listen = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('nq', {
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file),

  listDisplays: () => ipcRenderer.invoke('displays:list'),
  openStage: (config) => ipcRenderer.send('stage:open', config),
  closeStage: (id) => ipcRenderer.send('stage:close', id),
  stageCmd: (cmd) => ipcRenderer.send('stage:cmd', cmd),
  openStages: () => ipcRenderer.invoke('stage:list-open'),
  onStageEvent: listen('stage:event'),
  onStageClosed: listen('stage:closed'),

  configureOsc: (cfg) => ipcRenderer.send('osc:config', cfg),
  sendOsc: (msg) => ipcRenderer.send('net:osc', msg),
  sendOscString: (msg) => ipcRenderer.send('net:osc-string', msg),
  sendUdp: (msg) => ipcRenderer.send('net:udp', msg),
  onOsc: listen('osc:in'),

  configureDmx: (cfg) => ipcRenderer.send('dmx:config', cfg),
  sendDmx: (frames) => ipcRenderer.send('dmx:frames', frames),

  configureRemote: (cfg) => ipcRenderer.invoke('remote:config', cfg),
  remoteState: (state) => ipcRenderer.send('remote:state', state),
  onRemoteCommand: listen('remote:command'),

  chooseMedia: (kind, multi) => ipcRenderer.invoke('dialog:media', { kind, multi }),
  filesExist: (paths) => ipcRenderer.invoke('fs:exists', paths),
  readBinary: (p) => ipcRenderer.invoke('fs:read-binary', p),

  openWorkspace: () => ipcRenderer.invoke('ws:open'),
  saveWorkspace: (opts) => ipcRenderer.invoke('ws:save', opts),
  autosave: (opts) => ipcRenderer.invoke('ws:autosave', opts),
  bundleWorkspace: (opts) => ipcRenderer.invoke('ws:bundle', opts),
  onWorkspaceOpened: listen('ws:opened'),

  onMenu: listen('menu'),
  onLog: listen('app:log'),
  onCloseRequest: listen('app:close-request'),
  confirmQuit: () => ipcRenderer.send('app:quit-confirmed'),
  setTitle: (t) => ipcRenderer.send('app:set-title', t),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
});
