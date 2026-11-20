import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('maple',{
  read:()=>ipcRenderer.invoke('companion:maple-read'),
  apply:(id:string)=>ipcRenderer.invoke('companion:maple-use',id),
  onChange:(handler:(value:unknown)=>void)=>ipcRenderer.on('maple:changed',(_event,value)=>handler(value)),
});
// Window controls for the frameless header, read by ui-icons.js.
contextBridge.exposeInMainWorld('desktop',{
  minimizeWindow:()=>ipcRenderer.invoke('companion:maple-minimize'),
  closeWindow:()=>ipcRenderer.invoke('companion:maple-close'),
});
