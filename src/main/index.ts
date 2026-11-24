import {installDiagnostics} from './diagnostics.js';
import{InstanceHandoff}from'./instance-handoff.js';
import{migrateLaunchAssociations}from'./launch-associations.js';
import { resolveLanguage, translate } from '../shared/localization.js';
import { PetAgentController } from './pet/controller.js';
import {petSurfaceSize}from'../shared/pet-presentation.js';
import type { UsageSnapshot, LimitResult } from '../shared/usage.js';
import { SettingsStore, registerSettingsIPC } from './settings.js';
import { app, BrowserWindow, Menu, screen, Tray,dialog } from 'electron';
import { mkdirSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { windowsAppID } from '../shared/windows.js';
import { loginArgument, registerWindowsIPC } from './windows.js';
import { fileURLToPath } from 'node:url';
import { registerUsageIPC } from './usage/ipc.js';
import { createAppUpdateInstaller, readUpdateSource } from './update/app-updater.js';
import { GitHubUpdateFeed } from './update/github-feed.js';

const isWindows = process.platform === 'win32';
if (isWindows) {
  app.setAppUserModelId(windowsAppID);
  const data = process.env.PTB_STATE_DIR || join(app.getPath('appData'), 'PokeTokenBar Windows');
  mkdirSync(data, { recursive: true });
  app.setPath('userData', data);
}
const rendererPath = (name: string): string =>
  fileURLToPath(new URL(`../renderer/${name}`, import.meta.url));

let tray: Tray;
let mainWindow: BrowserWindow | undefined;
let petWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let usageSummary: UsageSnapshot | undefined;
let limitSummary: LimitResult[] = [];
let agentController: PetAgentController | undefined;
let handingOff=false;
const shortTokens = (amount: number) => {
  if (amount < 1000) return String(amount);
  if (amount < 999950) return (amount / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (amount < 999950000) return (amount / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  return (amount / 1000000000).toFixed(2).replace(/\.?0+$/, '') + 'B';
};

function trayLines(): string[] {
  const settings = preferences.get();
  const lines: string[] = [];
  if (usageSummary) {
    const records = Object.values(usageSummary.usage);
    if (settings.trayTokens) lines.push('오늘 ' + shortTokens(records.reduce((sum, row) => sum + row.today.total, 0)) + ' 토큰');
    if (settings.trayCost) {
      const recordsWithCost = records.filter(row => row.cost.today.reported || row.cost.today.estimated);
      if (recordsWithCost.length) lines.push('오늘 비용 $' + recordsWithCost.reduce((sum, row) => sum + row.cost.today.amount, 0).toFixed(2));
    }
    const growth = usageSummary.companion;
    if (settings.trayGrowth && growth) {
      lines.push((growth.current?.name ?? '알') + ' 성장 ' + Math.min(100, Math.floor(growth.progress / growth.threshold * 100)) + '%');
    }
  }
  if (settings.trayLimits) {
    const results = limitSummary.filter(row => settings.providers.includes(row.provider)&&row.tracked!==false).flatMap(row => row.windows);
    if (results.length) {
      const max = Math.max(...results.map(row => row.usedPercent));
      lines.push((settings.limitMode === 'remaining' ? '한도 잔여 ' + Math.max(0, 100 - max).toFixed(0) : '한도 사용 ' + max.toFixed(0)) + '%');
    }
  }
  return lines;
}

const t = (source: string, args: Record<string, string | number> = {}) => translate(source, resolveLanguage(preferences.get().language, app.getLocale()), args);
const preferences = new SettingsStore(join(app.getPath('userData'), 'settings-v1.json'));

async function showSettings(): Promise<void> {
  if (settingsWindow) { if (settingsWindow.isMinimized()) settingsWindow.restore(); settingsWindow.show(); settingsWindow.focus(); return; }
  const window = createWindow({
    width: 600, height: 740, minWidth: 400, minHeight: 420, title: t('PokeTokenBar 설정'),
    autoHideMenuBar: true, frame: false,
    webPreferences: { preload: fileURLToPath(new URL('./usage-preload.cjs', import.meta.url)) },
  });
  settingsWindow = window;
  window.on('closed', () => { settingsWindow = undefined; });
  try { await window.loadFile(rendererPath('settings.html')); window.show(); }
  catch (error) { window.destroy(); throw error; }
}


function createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...options,
    show: false,
    webPreferences: { ...options.webPreferences, nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  return window;
}

// Narrowest width that still shows the lens, LEDs, title and all six header buttons.
const mainMinimumWidth = 440;

async function showMainWindow(): Promise<void> {
  if (mainWindow) {
    if (!mainWindow.webContents.isLoading()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }

  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(490, workArea.width);
  const height = Math.min(740, workArea.height);
  const window = createWindow({
    width, height, minWidth: Math.min(width, mainMinimumWidth), minHeight: Math.min(height, 430), skipTaskbar: isWindows, autoHideMenuBar: isWindows, frame: false,
    webPreferences: { preload: fileURLToPath(new URL('./usage-preload.cjs', import.meta.url)) },
  });
  mainWindow = window;
  window.on('closed', () => { mainWindow = undefined; });

  if (isWindows) {
    const anchor = tray.getBounds();
    const { workArea } = screen.getDisplayMatching(anchor);
    const x = Math.round(anchor.x + (anchor.width - width) / 2);
    const y = anchor.y - height;
    window.setPosition(
      Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width)),
      Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height)),
    );
  }

  try {
    await window.loadFile(rendererPath('index.html'));
    if (!window.isDestroyed()) window.show();
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

function toggleMainWindow(): void {
  if (mainWindow?.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
  else void showMainWindow().catch(reportError);
}

async function togglePet(): Promise<boolean> {
  if (petWindow) {
    petWindow.close();
    await preferences.change({ petEnabled: false });
    return false;
  }

  const size=preferences.get().petSize;
  const {width,height}=isWindows?petSurfaceSize(size):{width:size,height:size};
  const position=preferences.get().petPosition;
  const { workArea } = screen.getDisplayNearestPoint(position??screen.getCursorScreenPoint());
  const window = createWindow({
    width, height,
    x: Math.round(Math.max(workArea.x,Math.min(position?.x??workArea.x+workArea.width-size-24,workArea.x+workArea.width-size))-(width-size)/2),
    y: Math.max(workArea.y,Math.min(position?.y??workArea.y+workArea.height-size-24,workArea.y+workArea.height-size)-(height-size)),
    title: t('PokeTokenBar 플로팅 펫'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: fileURLToPath(new URL('./pet-preload.cjs', import.meta.url)), backgroundThrottling:false },
  });
  petWindow = window;
  updateTrayMenu();
  window.on('closed', () => {
    petWindow = undefined;
    if (!handingOff&&preferences.get().petEnabled) void preferences.change({ petEnabled: false }).catch(reportError);
    if (!tray.isDestroyed()) updateTrayMenu();
  });
  window.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: t('PokeTokenBar 열기'), click: () => void showMainWindow().catch(reportError) },
      { label: t('플로팅 펫 숨기기'), click: () => window.close() },
    ]).popup({ window });
  });

  try {
    await window.loadFile(rendererPath('pet.html'));
    if (!window.isDestroyed()) {
      agentController?.sync();
      window.showInactive();
      if (!preferences.get().petEnabled) await preferences.change({ petEnabled: true });
    }
    return !window.isDestroyed();
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

function updateTrayMenu(): void {
  const lines = trayLines();
  const menu = Menu.buildFromTemplate([
    ...lines.map(label => ({ label, enabled: false })),
    ...(lines.length ? [{ type: 'separator' as const }] : []),
    { label: t('PokeTokenBar 열기'), click: () => void showMainWindow().catch(reportError) },
    {
      label: t(petWindow ? '플로팅 펫 숨기기' : '플로팅 펫 표시'),
      click: () => void togglePet().catch(reportError),
    },
    { label: t('지금 새로고침'),click:()=>{mainWindow?.webContents.send('desktop:refresh');if(!mainWindow)void showMainWindow().then(()=>mainWindow?.webContents.send('desktop:refresh')).catch(reportError);}},
    { label:t('도감'),click:()=>void showMainWindow().then(()=>mainWindow?.webContents.send('desktop:open-dex')).catch(reportError)},
    {label:t('뒷모습'),type:'checkbox',checked:preferences.get().back,click:()=>void preferences.change({back:!preferences.get().back}).catch(reportError)},
    { label: t('설정'), click: () => void showSettings().catch(reportError) },
    { type: 'separator' },
    { label: t('종료'), role: 'quit' },
  ]);
  tray.setToolTip(['PokeTokenBar', ...lines].join(' · ').slice(0, 127));
  tray.removeAllListeners('right-click');
  if (isWindows) tray.setContextMenu(menu);
  else tray.on('right-click', () => tray.popUpContextMenu(menu));
}

function reportError(error: unknown): void {
  console.error('PokeTokenBar 창을 열지 못했습니다:', error);
}

async function startApplication(){
  let initialized!:()=>void;const readyForUI=new Promise<void>(r=>initialized=r);
  const normal=(argv:string[])=>{void readyForUI.then(()=>{const urls=argv.filter(argument=>/^poketokenbar:/i.test(argument));if(urls.length){for(const url of urls)agentController?.accept(url);return;}if(isWindows&&argv.includes(loginArgument))return;return showMainWindow();}).catch(reportError);};
  const handoff=isWindows&&app.isPackaged?new InstanceHandoff(app.getPath('userData'),normal,(...values)=>console.error(...values)):undefined;
  if(handoff?!await handoff.acquire():!app.requestSingleInstanceLock()){app.quit();return;}
  if(!handoff)app.on('second-instance',(_event,argv)=>normal(argv));
  const diagnostics=installDiagnostics(join(app.getPath('userData'),'logs'));
  app.on('will-quit',()=>diagnostics.clean());
  app.on('render-process-gone',(_event,_contents,details)=>diagnostics.write('Renderer exited',details));
  app.on('child-process-gone',(_event,details)=>diagnostics.write('Child process exited',details));
  app.on('open-url',(event,url)=>{event.preventDefault();void readyForUI.then(()=>agentController?.accept(url));});
  app.on('activate', () => void showMainWindow().catch(reportError));
  app.on('window-all-closed', () => { /* 트레이를 통해 앱을 다시 열 수 있습니다. */ });

  await app.whenReady();
  {
    await preferences.load();
    agentController = new PetAgentController(() => petWindow, preferences);
    const finishUsage = registerUsageIPC(() => mainWindow, () => petWindow, showMainWindow, () => settingsWindow, preferences,
      snapshot => { usageSummary = snapshot; if (tray) updateTrayMenu(); },
      results => { limitSummary = results; if (tray) updateTrayMenu(); }, () => agentController?.dismiss());
    const finishWrites = async () => { await finishUsage(); await preferences.finishWrites(); };
    // Flushes saves and keeps pet state before another process replaces this one.
    const prepareReplacement = async () => { await finishUsage.forHandoff(); await preferences.finishWrites(); handingOff = true; };
    // Restarts the current version when an update fails after saves were flushed and usage suspended.
    const recoverFromFailedUpdate = () => { console.error('Update install failed after preparing; restoring current app'); app.relaunch(); app.exit(0); };
    const updateSource = readUpdateSource();
    const installer = createAppUpdateInstaller(finishUsage.updateBlocked, prepareReplacement, recoverFromFailedUpdate, updateSource);
    const feed = new GitHubUpdateFeed(fetch, Date.now, updateSource.feed, updateSource.keys);
    registerWindowsIPC(() => mainWindow, togglePet, finishWrites, () => settingsWindow, showSettings, preferences, { installer, feed });
    registerSettingsIPC(preferences, () => [mainWindow, settingsWindow, petWindow], finishWrites);
    preferences.subscribe(settings => {
      if (tray) updateTrayMenu();
      settingsWindow?.setTitle(t('PokeTokenBar 설정'));
      petWindow?.setTitle(t('PokeTokenBar 플로팅 펫'));
      if (settings.petEnabled && !petWindow) void togglePet().catch(reportError);
      if (!settings.petEnabled && petWindow) petWindow.close();
      agentController?.sync();
    });
    tray = new Tray(rendererPath(isWindows ? 'assets/tray.ico' : 'assets/tray.png'));
    tray.setToolTip('PokeTokenBar');
    if (!isWindows) tray.setIgnoreDoubleClickEvents(true);
    tray.on('click', toggleMainWindow);
    updateTrayMenu();
    diagnostics.write('Desktop ready');
    if (isWindows && app.isPackaged && !process.env.PTB_STATE_DIR){const result=await migrateLaunchAssociations(process.execPath,app.getVersion(),handoff?.previousExecutables()??[]);diagnostics.write('Launch registrations updated',result);}
    await handoff?.activate();
    if (preferences.get().petEnabled) await togglePet();
    for (const argument of process.argv) if (/^poketokenbar:/i.test(argument)) agentController.accept(argument);
    if (!isWindows || process.argv.includes('--show')) await showMainWindow();
    const reloadFile = process.env.PTB_DEV_RELOAD_FILE;
    if (!app.isPackaged && reloadFile) {
      let timer: ReturnType<typeof setTimeout>;
      const reloadWatcher = watch(reloadFile, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            const command = readFileSync(reloadFile, 'utf8');
            if (command === 'reload') {
              for (const window of BrowserWindow.getAllWindows()) window.webContents.reloadIgnoringCache();
            } else if (command === 'quit') {
              void finishWrites().catch(reportError).finally(() => app.quit());
            }
          } catch (error) { reportError(error); }
        }, 60);
      });
      reloadWatcher.on('error', reportError);
      app.once('before-quit', () => { clearTimeout(timer); reloadWatcher.close(); });
    }
    handoff?.setReady(prepareReplacement);
    initialized();
    diagnostics.write('Version owner ready',{version:app.getVersion(),pid:process.pid});
  }
}
void startApplication().catch(async(error:unknown)=>{reportError(error);if(isWindows&&app.isPackaged&&!process.env.PTB_STATE_DIR){await app.whenReady();dialog.showErrorBox('PokeTokenBar 버전 전환',error instanceof Error?error.message:String(error));}app.exit(1);});
