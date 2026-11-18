import{join}from'node:path';import{release}from'node:os';
import {DriveReleaseSource} from './drive-updates.js';
import {newerVersion,windowsDriveURL} from '../shared/drive-release.js';
import { resolveLanguage, translate } from '../shared/localization.js';
import type { SettingsStore } from './settings.js';
import { app, ipcMain, Notification,shell, type BrowserWindow } from 'electron';
import { windowsAppID, type UpdateStatus, type WindowsSettings } from '../shared/windows.js';

export const loginArgument = '--login-start';
const loginOptions = () => ({ path: process.execPath, args: [loginArgument] });

export function registerWindowsIPC(
  mainWindow: () => BrowserWindow | undefined,
  togglePet: () => Promise<boolean>,
  finishWrites: () => Promise<void>,
  settingsWindow: () => BrowserWindow | undefined,
  showSettings: () => Promise<void>,
  preferences: SettingsStore,
  updateOptions: {source?:DriveReleaseSource;openDownload?:(url:string)=>Promise<void>;automatic?:boolean} = {},
): void {
  const supported = process.platform === 'win32' && app.isPackaged;
  const source=updateOptions.source??new DriveReleaseSource();
  const openDownload=updateOptions.openDownload??(url=>shell.openExternal(url));

  function authorize(event: Electron.IpcMainInvokeEvent): void {
    const windows = [mainWindow(), settingsWindow()];
    if (!windows.some(window => window && !window.isDestroyed() && event.senderFrame === window.webContents.mainFrame)) {
      throw new Error('Unexpected desktop settings request');
    }
  }

  function settings(): WindowsSettings {
    let openAtLogin = false;
    if (supported) {
      const current = app.getLoginItemSettings(loginOptions());
      openAtLogin = current.openAtLogin && current.executableWillLaunchAtLogin;
    }
    return { supported, updatesSupported:true, driveUpdateURL:windowsDriveURL, version: app.getVersion(), openAtLogin };
  }

  ipcMain.handle('windows:open-settings', event => {
    authorize(event);
    return showSettings();
  });
  ipcMain.handle('windows:settings', event => {
    authorize(event);
    return settings();
  });
  ipcMain.handle('windows:login', (event, enabled: unknown) => {
    authorize(event);
    if (!supported || typeof enabled !== 'boolean') throw new Error('로그인 설정을 변경할 수 없습니다.');
    app.setLoginItemSettings({ ...loginOptions(), name: windowsAppID, openAtLogin: enabled, enabled });
    return settings();
  });
  ipcMain.handle('windows:pet', event => {
    authorize(event);
    return togglePet();
  });

  ipcMain.handle('windows:support',async(event,action:unknown)=>{authorize(event);if(action==='log'){shell.showItemInFolder(join(app.getPath('userData'),'logs','PokeTokenBar.log'));return;}const links:Record<string,string>={github:'https://github.com/chattymin/PokeTokenBar',website:'https://chattymin.github.io/PokeTokenBar/',sponsor:'https://github.com/sponsors/chattymin',report:'mailto:parkdongmin123@gmail.com?subject='+encodeURIComponent('PokeTokenBar Windows problem report')+'&body='+encodeURIComponent('Version: '+app.getVersion()+'\nOS: '+process.platform+' '+release()+'\n\nDescribe the problem:\n\nAttach PokeTokenBar.log if helpful.')};if(typeof action!=='string'||!links[action])throw new Error('Invalid support action');await shell.openExternal(links[action]);});

  let available:string|undefined;
  let lastUpdate:UpdateStatus={state:'current',version:app.getVersion(),delivery:'browser'};
  const publish=(value:UpdateStatus)=>{lastUpdate={...value,delivery:'browser'};for(const window of [mainWindow(),settingsWindow()])if(window&&!window.isDestroyed())window.webContents.send('windows:update-state',lastUpdate);return lastUpdate;};
  ipcMain.handle('windows:update-state',event=>{authorize(event);return lastUpdate;});
  ipcMain.handle('windows:update-skip',async(event,restore:unknown)=>{authorize(event);if(typeof restore!=='boolean')throw new Error('Invalid update action');await preferences.change({skippedUpdateVersion:restore?'':available??''});return publish({state:available?(restore?'available':'skipped'):'current',version:available??app.getVersion()});});
  let notifiedVersion:string|undefined,checking:Promise<UpdateStatus>|undefined;
  function announce(status:UpdateStatus){
    if(status.state!=='available'||!preferences.get().updateNotifications||status.version===notifiedVersion||!Notification.isSupported())return;
    const language=resolveLanguage(preferences.get().language,app.getLocale());const notice=new Notification({title:translate('PokeTokenBar 업데이트',language),body:translate('{version} 버전을 사용할 수 있습니다.',language,{version:status.version})});notice.on('click',()=>{void showSettings().catch(console.error);});notice.show();notifiedVersion=status.version;
  }
  function checkUpdate(minInterval=0):Promise<UpdateStatus>{
    if(checking)return checking;
    checking=source.check(windowsDriveURL,minInterval).then(release=>{
      available=newerVersion(release.version,app.getVersion())?release.version:undefined;
      const status=publish({state:available?(preferences.get().skippedUpdateVersion===available?'skipped':'available'):'current',version:available??app.getVersion()});announce(status);return status;
    }).finally(()=>{checking=undefined;});return checking;
  }
  ipcMain.handle('windows:update-check',event=>{authorize(event);return checkUpdate();});
  const automaticCheck=()=>{if(preferences.get().updateNotifications)void checkUpdate(1800000).catch(error=>console.error('Drive update check failed:',error));};
  if(updateOptions.automatic??app.isPackaged){
    automaticCheck();const timer=setInterval(automaticCheck,1800000);timer.unref();
    const watch=(_event:Electron.Event,window:BrowserWindow)=>window.on('show',()=>{if(window===mainWindow()||window===settingsWindow())automaticCheck();});app.on('browser-window-created',watch);
    let enabled=preferences.get().updateNotifications;preferences.subscribe(value=>{if(value.updateNotifications&&!enabled)automaticCheck();enabled=value.updateNotifications;});
    app.once('before-quit',()=>{clearInterval(timer);app.removeListener('browser-window-created',watch);});
  }
  ipcMain.handle('windows:update-download',async event=>{authorize(event);if(!available||!newerVersion(available,app.getVersion()))throw new Error('먼저 업데이트를 확인해 주세요.');await openDownload(windowsDriveURL);return{...lastUpdate,opened:true};});
  ipcMain.handle('windows:quit',async event=>{authorize(event);await finishWrites();app.quit();});
  ipcMain.handle('windows:update-install',event=>{authorize(event);throw new Error('Drive ZIP을 다운로드한 뒤 압축을 풀어 새 버전을 실행해 주세요.');});
}
