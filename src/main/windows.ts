import{join}from'node:path';
import {GitHubUpdateFeed} from './update/github-feed.js';
import type {UpdateInstaller} from './update/installer.js';
import type {SignedRelease} from './update/manifest.js';
import {newerVersion} from '../shared/release-version.js';
import {windowsRepositoryPage,windowsReleasePage} from '../shared/github-release.js';
import { resolveLanguage, translate } from '../shared/localization.js';
import type { SettingsStore } from './settings.js';
import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import { windowsAppID, type UpdateStatus, type WindowsSettings } from '../shared/windows.js';

export const loginArgument = '--login-start';
const loginOptions = () => ({ path: process.execPath, args: [loginArgument] });
const updateCheckInterval = 30 * 60 * 1000;

// Installer is passed only for installed builds; without it the update button opens the release page.
export type WindowsUpdateOptions = {
  feed?: Pick<GitHubUpdateFeed, 'check'>;
  installer?: Pick<UpdateInstaller, 'install'>;
  openPage?: (url: string) => Promise<void>;
  automatic?: boolean;
};

export function registerWindowsIPC(
  mainWindow: () => BrowserWindow | undefined,
  togglePet: () => Promise<boolean>,
  finishWrites: () => Promise<void>,
  settingsWindow: () => BrowserWindow | undefined,
  showSettings: () => Promise<void>,
  preferences: SettingsStore,
  updateOptions: WindowsUpdateOptions = {},
): void {
  const supported = process.platform === 'win32' && app.isPackaged;
  const feed=updateOptions.feed??new GitHubUpdateFeed();
  const installer=updateOptions.installer;
  const delivery:UpdateStatus['delivery']=installer?'installer':'browser';
  const openPage=updateOptions.openPage??(url=>shell.openExternal(url));

  function authorize(event: Electron.IpcMainInvokeEvent): void {
    const windows = [mainWindow(), settingsWindow()];
    if (!windows.some(window => window && !window.isDestroyed() && event.senderFrame === window.webContents.mainFrame)) {
      throw new Error('Unexpected desktop settings request');
    }
  }

  // Resolves the authorized main/settings window that sent a window-control request.
  function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
    authorize(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) throw new Error('Unexpected window control request');
    return window;
  }

  function settings(): WindowsSettings {
    let openAtLogin = false;
    if (supported) {
      const current = app.getLoginItemSettings(loginOptions());
      openAtLogin = current.openAtLogin && current.executableWillLaunchAtLogin;
    }
    return { supported, updatesSupported:true, version: app.getVersion(), openAtLogin };
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
  // The tray popup skips the Windows taskbar, so minimizing it hides it until the tray reopens it.
  ipcMain.handle('windows:minimize', event => {
    const window = senderWindow(event);
    if (process.platform === 'win32' && window === mainWindow()) window.hide();
    else window.minimize();
  });
  // Same result as the former native close button: the window is destroyed and the tray keeps the app alive.
  ipcMain.handle('windows:close', event => { senderWindow(event).close(); });
  ipcMain.handle('windows:pet', event => {
    authorize(event);
    return togglePet();
  });

  ipcMain.handle('windows:support', async (event, action: unknown) => {
    authorize(event);
    if (action === 'log') {
      shell.showItemInFolder(join(app.getPath('userData'), 'logs', 'PokeTokenBar.log'));
      return;
    }
    if (action !== 'github') throw new Error('Invalid support action');
    await shell.openExternal(windowsRepositoryPage);
  });

  let availableRelease:SignedRelease|undefined;
  let lastUpdate:UpdateStatus={state:'current',version:app.getVersion(),delivery};
  const publish=(value:UpdateStatus)=>{lastUpdate={...value,delivery};for(const window of [mainWindow(),settingsWindow()])if(window&&!window.isDestroyed())window.webContents.send('windows:update-state',lastUpdate);return lastUpdate;};
  ipcMain.handle('windows:update-state',event=>{authorize(event);return lastUpdate;});
  ipcMain.handle('windows:update-skip',async(event,restore:unknown)=>{authorize(event);if(typeof restore!=='boolean')throw new Error('Invalid update action');const available=availableRelease?.version;await preferences.change({skippedUpdateVersion:restore?'':available??''});return publish({state:available?(restore?'available':'skipped'):'current',version:available??app.getVersion()});});
  let notifiedVersion:string|undefined,checking:Promise<UpdateStatus>|undefined,installing:Promise<UpdateStatus>|undefined;
  function announce(status:UpdateStatus){
    if(status.state!=='available'||!preferences.get().updateNotifications||status.version===notifiedVersion||!Notification.isSupported())return;
    const language=resolveLanguage(preferences.get().language,app.getLocale());const notice=new Notification({title:translate('PokeTokenBar 업데이트',language),body:translate('{version} 버전을 사용할 수 있습니다.',language,{version:status.version})});notice.on('click',()=>{void showSettings().catch(console.error);});notice.show();notifiedVersion=status.version;
  }
  // Checks are ignored while an install runs so the downloading state is not overwritten.
  function checkUpdate(minInterval=0):Promise<UpdateStatus>{
    if(installing)return Promise.resolve(lastUpdate);
    if(checking)return checking;
    checking=feed.check(minInterval).then(release=>{
      if(installing)return lastUpdate;
      availableRelease=release&&newerVersion(release.version,app.getVersion())?release:undefined;const available=availableRelease?.version;
      // A failed install keeps its reason and recovery button until the version changes or the user retries.
      if(lastUpdate.state==='failed'&&available&&lastUpdate.version===available)return lastUpdate;
      const status=publish({state:available?(preferences.get().skippedUpdateVersion===available?'skipped':'available'):'current',version:available??app.getVersion()});announce(status);return status;
    }).finally(()=>{checking=undefined;});return checking;
  }
  ipcMain.handle('windows:update-check',event=>{authorize(event);return checkUpdate();});
  const automaticCheck=()=>{if(preferences.get().updateNotifications)void checkUpdate(updateCheckInterval).catch(error=>console.error('Update check failed:',error));};
  if(updateOptions.automatic??app.isPackaged){
    automaticCheck();const timer=setInterval(automaticCheck,updateCheckInterval);timer.unref();
    const watch=(_event:Electron.Event,window:BrowserWindow)=>window.on('show',()=>{if(window===mainWindow()||window===settingsWindow())automaticCheck();});app.on('browser-window-created',watch);
    let enabled=preferences.get().updateNotifications;preferences.subscribe(value=>{if(value.updateNotifications&&!enabled)automaticCheck();enabled=value.updateNotifications;});
    app.once('before-quit',()=>{clearInterval(timer);app.removeListener('browser-window-created',watch);});
  }
  // Publishes downloading, then failed with the reason; on success the installer quits the app.
  function installRelease(activeInstaller:Pick<UpdateInstaller,'install'>,release:SignedRelease):Promise<UpdateStatus>{
    publish({state:'downloading',version:release.version});
    return activeInstaller.install(release).then(()=>lastUpdate,error=>{console.error('Update install failed:',error);return publish({state:'failed',version:release.version,error:error instanceof Error?error.message:String(error)});}).finally(()=>{installing=undefined;});
  }
  ipcMain.handle('windows:update-install',async event=>{
    authorize(event);const release=availableRelease;
    if(!release||!newerVersion(release.version,app.getVersion()))throw new Error('먼저 업데이트를 확인해 주세요.');
    if(!installer){await openPage(windowsReleasePage);return{...lastUpdate,opened:true};}
    installing??=installRelease(installer,release);return installing;
  });
  ipcMain.handle('windows:update-page',async event=>{authorize(event);await openPage(windowsReleasePage);});
  ipcMain.handle('windows:quit',async event=>{authorize(event);await finishWrites();app.quit();});
}
