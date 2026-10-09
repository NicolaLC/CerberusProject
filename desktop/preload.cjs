// Bridge exposed to the game page as window.cerberusDesktop (only in the desktop build).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cerberusDesktop', {
  platform: process.platform,
  quit: () => ipcRenderer.send('desktop:quit'),
  toggleFullscreen: () => ipcRenderer.send('desktop:fullscreen'),
});
