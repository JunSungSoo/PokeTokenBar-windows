import { resolveLanguage, translate } from '../shared/localization.js';
import type { SettingsStore } from './settings.js';
import { app, ipcMain, Notification, type BrowserWindow } from 'electron';
import updaterModule from 'electron-updater';
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
): void {
  const supported = process.platform === 'win32' && app.isPackaged;
  const updater = supported ? updaterModule.autoUpdater : undefined;
  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    // The updater emits errors as well as rejecting promises.
    updater.on('error', error => console.error('Windows update failed:', error.message));
  }

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
    return { supported, version: app.getVersion(), openAtLogin };
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

  let available: string | undefined;
  let downloaded: string | undefined;
  let busy = false;
  async function perform<T>(work: () => Promise<T>): Promise<T> {
    if (busy) throw new Error('다른 업데이트 작업이 진행 중입니다.');
    busy = true;
    try { return await work(); }
    finally { busy = false; }
  }

  let checking: Promise<UpdateStatus> | undefined;
  function checkUpdate(): Promise<UpdateStatus> {
    if (!updater) return Promise.reject(new Error('설치된 Windows 앱에서 업데이트를 확인할 수 있습니다.'));
    if (checking) return checking;
    checking = perform<UpdateStatus>(async () => {
      if (downloaded) return { state: 'downloaded', version: downloaded };
      const result = await updater.checkForUpdates();
      if (!result) throw new Error('업데이트를 확인할 수 없습니다.');
      if (!result.isUpdateAvailable) return { state: 'current', version: app.getVersion() };
      available = result.updateInfo.version;
      return { state: 'available' as const, version: available };
    }).finally(() => { checking = undefined; });
    return checking;
  }
  ipcMain.handle('windows:update-check', event => { authorize(event); return checkUpdate(); });

  let notifiedVersion: string | undefined;
  const automaticCheck = async () => {
    if (!updater || !preferences.get().updateNotifications || busy) return;
    try {
      const status = await checkUpdate();
      if (status.state === 'available' && status.version !== notifiedVersion && Notification.isSupported()) {
        const notice = new Notification({ title: translate('PokeTokenBar 업데이트', resolveLanguage(preferences.get().language, app.getLocale())), body: translate('{version} 버전을 사용할 수 있습니다.', resolveLanguage(preferences.get().language, app.getLocale()), { version: status.version ?? '' }) });
        notice.on('click', () => { void showSettings(); });
        notice.show();
        notifiedVersion = status.version;
      }
    } catch (error) { console.error('Automatic update check failed:', error); }
  };
  if (updater) {
    void automaticCheck();
    const timer = setInterval(() => { void automaticCheck(); }, 6 * 60 * 60 * 1000);
    timer.unref();
    app.once('before-quit', () => clearInterval(timer));
  }

  ipcMain.handle('windows:update-download', async (event): Promise<UpdateStatus> => {
    authorize(event);
    if (!updater) throw new Error('업데이트를 받을 수 없습니다.');
    return perform(async () => {
      if (downloaded) return { state: 'downloaded', version: downloaded };
      if (!available) throw new Error('먼저 업데이트를 확인해 주세요.');
      await updater.downloadUpdate();
      downloaded = available;
      return { state: 'downloaded', version: downloaded };
    });
  });
  ipcMain.handle('windows:quit',async event=>{authorize(event);await finishWrites();app.quit();});
  ipcMain.handle('windows:update-install', async event => {
    authorize(event);
    if (!updater) throw new Error('설치할 업데이트가 없습니다.');
    await perform(async () => {
      if (!downloaded) throw new Error('먼저 업데이트를 다운로드해 주세요.');
      await finishWrites();
      updater.quitAndInstall(false, true);
    });
  });
}
