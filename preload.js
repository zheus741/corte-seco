/* Corte Seco — bridge between the editor page and the desktop shell. */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = { download: new Set(), pool: new Set() };
ipcRenderer.on('asr:download', (e, p) => { for (const f of listeners.download) try { f(p); } catch (_) {} });
ipcRenderer.on('asr:pool', (e, n) => { for (const f of listeners.pool) try { f(n); } catch (_) {} });

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  info: () => ipcRenderer.invoke('info'),
  asr: {
    models: () => ipcRenderer.invoke('asr:models'),
    download: (id) => ipcRenderer.invoke('asr:download', id),
    cancelDownload: () => ipcRenderer.invoke('asr:cancelDownload'),
    deleteModel: (id) => ipcRenderer.invoke('asr:deleteModel', id),
    onDownload: (fn) => { listeners.download.add(fn); return () => listeners.download.delete(fn); },
    onPool: (fn) => { listeners.pool.add(fn); return () => listeners.pool.delete(fn); },
    load: (id) => ipcRenderer.invoke('asr:load', id),
    chunk: (pcm, lang) => ipcRenderer.invoke('asr:chunk', { pcm, lang }),
    cancel: () => ipcRenderer.invoke('asr:cancel')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  files: {
    outDir: () => ipcRenderer.invoke('files:outDir'),
    pickFolder: () => ipcRenderer.invoke('files:pickFolder'),
    save: (name, data, sub) => ipcRenderer.invoke('files:save', { name, data, sub }),
    open: (name, sub) => ipcRenderer.invoke('files:open', { name, sub }),
    write: (handle, data, position) => ipcRenderer.invoke('files:write', { handle, data, position }),
    close: (handle, discard) => ipcRenderer.invoke('files:close', { handle, discard }),
    reveal: (p) => ipcRenderer.invoke('files:reveal', p),
    openFolder: () => ipcRenderer.invoke('files:openFolder'),
    pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
    stat: (p) => ipcRenderer.invoke('files:stat', p)
  },
  ai: { claude: (args) => ipcRenderer.invoke('ai:claude', args) },
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
});
