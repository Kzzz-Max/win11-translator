'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const surfaceArg = process.argv.find((a) => a.startsWith('--surface='));
const surface = surfaceArg ? surfaceArg.split('=')[1] : 'solid';

const channels = new Set();

contextBridge.exposeInMainWorld('api', {
  surface,
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
  send(channel, payload) {
    ipcRenderer.send(channel, payload);
  },
  on(channel, cb) {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    channels.add(channel);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
