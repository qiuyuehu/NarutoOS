import { contextBridge, ipcRenderer } from 'electron';
import { AppState, Command, ShellAPI } from '../shared/model';
async function invoke(channel: string, input?: unknown) {
  const response = await ipcRenderer.invoke(channel, input);
  if (!response?.ok) throw new Error(response?.message ?? '操作失败，请重试');
  return response.value;
}
const api: ShellAPI = {
  state: () => invoke('shell:state'), command: (command: Command) => invoke('shell:command', command),
  onState: callback => { const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state); ipcRenderer.on('shell:state', listener); return () => ipcRenderer.removeListener('shell:state', listener); },
  credentials: () => invoke('shell:credentials'), credentialSites: () => invoke('shell:credential-sites'),
  addCredential: (siteId, username, password, expected) => invoke('shell:credential-add', { siteId, username, password, expected }),
  reveal: id => invoke('shell:reveal', id),
  edit: (id, username, password) => invoke('shell:edit', { id, username, password }), remove: id => invoke('shell:remove', id)
};
contextBridge.exposeInMainWorld('naruto', api);
ipcRenderer.on('shell:fullscreen', (_event, fullscreen) => document.documentElement.classList.toggle('fullscreen', fullscreen));
