// Real sandboxed desktop preload + IPC with a fake signed feed and installer; no network, installs or user saves.
import{app,BrowserWindow,Notification,ipcMain}from'electron';import assert from'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{SettingsStore}from'../dist/main/settings.js';import{registerWindowsIPC}from'../dist/main/windows.js';import{windowsReleasePage}from'../dist/shared/github-release.js';
const updateChannels=['windows:open-settings','windows:settings','windows:login','windows:minimize','windows:close','windows:pet','windows:support','windows:update-state','windows:update-skip','windows:update-check','windows:update-install','windows:update-page','windows:quit'];
const signedRelease=version=>({version,path:`PokeTokenBar-Windows-${version}-x64-Setup.exe`,sha512:Buffer.alloc(64,7).toString('base64')});
const blockedMessage='배틀·챌린지·교환 중에는 업데이트할 수 없습니다.';
async function run(){const directory=await mkdtemp(join(tmpdir(),'ptb-github-updates-'));app.setPath('userData',directory);app.on('window-all-closed',()=>{});await app.whenReady();const originalVersion=app.getVersion,originalShow=Notification.prototype.show,originalSupported=Notification.isSupported;let owner,outsider;const notices=[],opened=[],installs=[];let release=null,failCheck=false,blocked=false,checks=0,shown=0,releaseInstall;
 try{app.getVersion=()=>'1.0.0';Notification.isSupported=()=>true;Notification.prototype.show=function(){notices.push(this);};const preferences=new SettingsStore(join(directory,'settings.json'));await preferences.load();
 const feed={check:async()=>{checks++;if(failCheck)throw Error('offline fixture');return release;}};
 const installer={install:release=>{installs.push(release.version);return new Promise((resolveInstall,rejectInstall)=>{releaseInstall=()=>blocked?rejectInstall(new Error(blockedMessage)):resolveInstall();});}};
 const openPage=async url=>{opened.push(url);};
 owner=new BrowserWindow({show:false,webPreferences:{preload:resolve('dist/main/usage-preload.cjs'),sandbox:true,contextIsolation:true}});
 registerWindowsIPC(()=>owner,async()=>true,async()=>{},()=>undefined,async()=>{shown++;},preferences,{feed,installer,openPage,automatic:false});
 await owner.loadURL('data:text/html,<title>GitHub update IPC fixture</title>');const js=code=>owner.webContents.executeJavaScript(code);const settle=()=>new Promise(resolveWait=>setTimeout(resolveWait,20));
 const settings=await js('window.desktop.settings()');assert.equal(settings.version,'1.0.0');assert.equal(settings.updatesSupported,true);assert.equal('driveUpdateURL' in settings,false);
 assert.equal((await js('window.desktop.checkUpdate()')).state,'current');assert.equal(notices.length,0);await assert.rejects(js('window.desktop.installUpdate()'),/먼저/);
 release=signedRelease('1.0.0');assert.equal((await js('window.desktop.checkUpdate()')).state,'current');
 release=signedRelease('1.0.1');const available=await js('window.desktop.checkUpdate()');assert.equal(available.state,'available');assert.equal(available.delivery,'installer');assert.equal(notices.length,1);await js('window.desktop.checkUpdate()');assert.equal(notices.length,1);
 assert.equal((await js('window.desktop.skipUpdate()')).state,'skipped');assert.equal(preferences.get().skippedUpdateVersion,'1.0.1');assert.equal((await js('window.desktop.checkUpdate()')).state,'skipped');assert.equal((await js('window.desktop.skipUpdate(true)')).state,'available');
 // Button press: downloading is published, repeated presses and checks share one install.
 await js('window.__first=window.desktop.installUpdate();window.__second=window.desktop.installUpdate();0');await settle();assert.equal((await js('window.desktop.updateState()')).state,'downloading');assert.equal((await js('window.desktop.checkUpdate()')).state,'downloading');assert.deepEqual(installs,['1.0.1']);
 releaseInstall();assert.equal((await js('window.__first')).state,'downloading');assert.equal((await js('window.__second')).state,'downloading');
 // Blocked activity surfaces as failed with the reason, and retry calls the installer again.
 blocked=true;const failing=js('window.desktop.installUpdate()');await settle();releaseInstall();const failed=await failing;assert.equal(failed.state,'failed');assert.equal(failed.error,blockedMessage);assert.equal((await js('window.desktop.updateState()')).error,blockedMessage);const recheck=await js('window.desktop.checkUpdate()');assert.equal(recheck.state,'failed');assert.equal(recheck.error,blockedMessage);assert.deepEqual(installs,['1.0.1','1.0.1']);
 blocked=false;const retry=js('window.desktop.installUpdate()');await settle();releaseInstall();assert.equal((await retry).state,'downloading');assert.equal(installs.length,3);
 await js('window.desktop.openUpdatePage()');assert.deepEqual(opened,[windowsReleasePage]);
 failCheck=true;await assert.rejects(js('window.desktop.checkUpdate()'),/offline/);failCheck=false;
 await preferences.change({updateNotifications:false});release=signedRelease('2.0.0');assert.equal((await js('window.desktop.checkUpdate()')).state,'available');assert.equal(notices.length,1);notices[0].emit('click');await settle();assert.equal(shown,1);
 // Without an installer (portable or development builds) the button opens the release page.
 for(const channel of updateChannels)ipcMain.removeHandler(channel);registerWindowsIPC(()=>owner,async()=>true,async()=>{},()=>undefined,async()=>{},preferences,{feed,openPage,automatic:false});
 const browser=await js('window.desktop.checkUpdate()');assert.equal(browser.delivery,'browser');const page=await js('window.desktop.installUpdate()');assert.equal(page.opened,true);assert.deepEqual(opened,[windowsReleasePage,windowsReleasePage]);assert.equal(installs.length,3);
 outsider=new BrowserWindow({show:false,webPreferences:{preload:resolve('dist/main/usage-preload.cjs'),sandbox:true}});await outsider.loadURL('data:text/html,<title>Untrusted window</title>');for(const call of ['checkUpdate()','installUpdate()','openUpdatePage()','minimizeWindow()','closeWindow()'])await assert.rejects(outsider.webContents.executeJavaScript('window.desktop.'+call),/Unexpected/);
 // The owner's own header controls act on its window: hidden on Windows (tray popup), minimized elsewhere, then closed.
 const waitFor=async test=>{for(let i=0;i<100&&!test();i++)await settle();assert.ok(test());};
 owner.showInactive();void js('window.desktop.minimizeWindow()');await waitFor(()=>process.platform==='win32'?!owner.isVisible():owner.isMinimized());
 void js('window.desktop.closeWindow()').catch(()=>{});await waitFor(()=>owner.isDestroyed());
 await preferences.finishWrites();console.log('PASS: GitHub update real IPC, higher/same versions, single notification, skip/restore, shared install while downloading, blocked failure with retry, release page fallback, owner window controls and sender authorization ('+checks+' feed checks).');
 }finally{app.getVersion=originalVersion;Notification.prototype.show=originalShow;Notification.isSupported=originalSupported;for(const window of BrowserWindow.getAllWindows())window.destroy();try{await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}}
}
setTimeout(()=>app.exit(1),30000).unref();void run().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
