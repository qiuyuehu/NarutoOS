import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('prototypeHost', {
  onFullscreen: (callback: (value: boolean) => void) => ipcRenderer.on('prototype:fullscreen', (_event, value) => callback(value)),
  command: (type: string, id?: string) => ipcRenderer.invoke('prototype:command', { type, id }),
  onState: (callback: (state: unknown) => void) => ipcRenderer.on('prototype:state', (_event, value) => callback(value))
});
