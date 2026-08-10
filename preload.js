const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Receive messages from main process
  onOpenRepository: (callback) => {
    ipcRenderer.on('open-repository', (event, path) => callback(path));
  },

  onSubmitReview: (callback) => {
    ipcRenderer.on('submit-review', () => callback());
  },

  // Platform detection
  platform: process.platform,

  // App version
  getVersion: () => process.env.npm_package_version || '1.0.0'
});

console.log('Preload script loaded');
