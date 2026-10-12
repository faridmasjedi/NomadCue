const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stageBridge', {
  onConfig: (cb) => ipcRenderer.on('stage:config', (_e, c) => cb(c)),
  onCmd: (cb) => ipcRenderer.on('stage:cmd', (_e, c) => cb(c)),
  emit: (evt) => ipcRenderer.send('stage:event', evt),
});
