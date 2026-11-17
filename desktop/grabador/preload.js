const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kit', {
  state: () => ipcRenderer.invoke('kit:state'),
  do: (action, data) => ipcRenderer.invoke('kit:do', action, data),
  onUpdate: (cb) => ipcRenderer.on('kit:update', (e, s) => cb(s)),
});
