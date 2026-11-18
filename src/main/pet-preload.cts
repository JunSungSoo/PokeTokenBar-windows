import { contextBridge, ipcRenderer } from 'electron';
import type { CompanionView } from '../shared/companion.js';

contextBridge.exposeInMainWorld('pet', {
  read: () => ipcRenderer.invoke('pet:read'),
  layout:(visible:boolean)=>ipcRenderer.invoke('pet:layout',visible),
  repaint:()=>ipcRenderer.invoke('pet:repaint'),
  drag:(phase:'start'|'move'|'end',point:{x:number;y:number})=>ipcRenderer.invoke('pet:drag',phase,point),
  hover:()=>ipcRenderer.invoke('pet:hover'),
  onNotice:(handler:(value:unknown)=>void)=>ipcRenderer.on('pet:notice',(_event,value)=>handler(value)),
  onPowerSaver:(handler:(value:boolean)=>void)=>ipcRenderer.on('system:power-saver',(_event,value)=>handler(value)),
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
  readPower:()=>ipcRenderer.invoke('settings:power-saver'),
  onPowerSaver:(handler:(value:boolean)=>void)=>ipcRenderer.on('system:power-saver',(_event,value)=>handler(value)),
  read: () => ipcRenderer.invoke('settings:read'),
  onChange: (handler: (value: unknown) => void) =>
    ipcRenderer.on('settings:changed', (_event, value) => handler(value)),
});
