const { contextBridge, shell } = require('electron');

contextBridge.exposeInMainWorld('stark', {
  openExternal: (url) => shell.openExternal(url)
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('STARK_INDUSTRIAL_PRELOAD: ACTIVE');
});
