import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import type { CompanionStore } from './store.js';
import type { SettingsStore } from '../settings.js';
import type { CompanionView } from '../../shared/companion.js';
import { translate,resolveLanguage } from '../../shared/localization.js';

export function registerMapleWindow(companion: CompanionStore, preferences: SettingsStore,
  authorizeOwner: (event: Electron.IpcMainInvokeEvent) => BrowserWindow, notify: (state: CompanionView) => void, reveal: (window: BrowserWindow) => void = window => { if(window.isMinimized())window.restore();window.show();window.focus(); }) {
  let window: BrowserWindow | undefined;
  const payload=(state: CompanionView)=>({state,preferences:preferences.get()});
  function authorize(event: Electron.IpcMainInvokeEvent): BrowserWindow {
    if(!window || window.isDestroyed() || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unexpected item window request');
    return window;
  }
  ipcMain.handle('companion:maple-open', async event=>{
    authorizeOwner(event);
    if(window && !window.isDestroyed()){reveal(window);return;}
    const next=new BrowserWindow({width:500,height:560,minWidth:360,minHeight:420,show:false,autoHideMenuBar:true,frame:false,
      title:translate('붉은 단풍',resolveLanguage(preferences.get().language,app.getLocale())),
      webPreferences:{preload:fileURLToPath(new URL('../maple-preload.cjs',import.meta.url)),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    window=next;next.on('closed',()=>{if(window===next)window=undefined;});
    next.webContents.setWindowOpenHandler(()=>({action:'deny'}));next.webContents.on('will-navigate',event=>event.preventDefault());
    try{await next.loadFile(fileURLToPath(new URL('../../renderer/maple.html',import.meta.url)));if(!next.isDestroyed())reveal(next);}
    catch(error){if(!next.isDestroyed())next.destroy();throw error;}
  });
  ipcMain.handle('companion:maple-minimize',event=>{authorize(event).minimize();});
  ipcMain.handle('companion:maple-close',event=>{authorize(event).close();});
  ipcMain.handle('companion:maple-read',async event=>{authorize(event);return payload(await companion.read());});
  ipcMain.handle('companion:maple-use',async(event,id:unknown)=>{
    authorize(event);if(typeof id!=='string' || id.length>200)throw new Error('Invalid individual');
    const state=await companion.change({kind:'use',item:'redMaple',quantity:1,id});notify(state);return payload(state);
  });
  function broadcast(state: CompanionView) {if(window && !window.isDestroyed())window.webContents.send('maple:changed',payload(state));}
  preferences.subscribe(()=>{void companion.read().then(broadcast).catch(()=>{});});
  return {broadcast};
}
