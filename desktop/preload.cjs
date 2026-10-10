// Bridge exposed to the game page as window.cerberusDesktop (only in the desktop build).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cerberusDesktop', {
  platform: process.platform,
  quit: () => ipcRenderer.send('desktop:quit'),
  toggleFullscreen: () => ipcRenderer.send('desktop:fullscreen'),
  // Workshop level files: main picks the path (src/levels/<name>.json or a dialog), never the page
  saveLevel: (name, text) => ipcRenderer.invoke('desktop:saveLevel', name, text),
  openLevel: () => ipcRenderer.invoke('desktop:openLevel'),
});
