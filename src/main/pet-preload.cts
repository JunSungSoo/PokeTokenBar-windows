import { contextBridge, ipcRenderer } from 'electron';
import type { CompanionView } from '../shared/companion.js';

contextBridge.exposeInMainWorld('pet', {
  read: () => ipcRenderer.invoke('pet:read'),
  agent: () => ipcRenderer.invoke('pet:agent-read'),
  dismissAgent: () => ipcRenderer.invoke('pet:agent-dismiss'),
  motion: (reduced: boolean) => ipcRenderer.invoke('pet:motion', reduced),
  onAgent: (handler: (value: unknown) => void) =>
    ipcRenderer.on('pet:agent-updated', (_event, summary) => handler(summary)),
  activate: () => ipcRenderer.invoke('pet:activate'),
  onUpdate: (handler: (subject: CompanionView['pet']) => void) =>
    ipcRenderer.on('pet:updated', (_event, subject) => handler(subject)),
});

contextBridge.exposeInMainWorld('preferences', {
  read: () => ipcRenderer.invoke('settings:read'),
  onChange: (handler: (value: unknown) => void) =>
    ipcRenderer.on('settings:changed', (_event, value) => handler(value)),
});
