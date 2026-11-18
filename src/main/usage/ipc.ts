import{prayerHoverLine}from'../../shared/pet-presentation.js';
import {observeSystemState} from '../system-state.js';
import {CompanionEvents,localizedNotice,type CompanionNotice} from '../companion/events.js';
import{defaultClaudeRoots,withAccountBlocks,claudeAccountSources,type ClaudeAccountSource}from'./claude-accounts.js';
import {SessionKeys} from './session-key.js';
import {UsageHistoryStore}from'./history.js';
import { activityState } from '../../shared/companion-presentation.js';
import {limitWarning,preserveLimits,trackedClaudeAccount} from '../../shared/limit-tracking.js';
import { registerMapleWindow } from '../companion/maple-window.js';
import { PokemonDetailsClient } from '../companion/pokemon-details.js';
import { resolveLanguage, translate } from '../../shared/localization.js';
import { ProviderStatusChecker } from './provider-status.js';
import { limitAlertDetails, type AlertLedger } from './limit-alerts.js';
import { writeSaveAtomically } from '../companion/store.js';
import type { SettingsStore } from '../settings.js';
import type { CandyWindow } from '../companion/candy-grants.js';
import type { CompanionView } from '../../shared/companion.js';
import { bagItems, shopCatalog, type BagItem, type CompanionAction, type Product } from '../../shared/companion.js';
import { object } from './jsonl.js';
import { registerBattleIPC } from '../battle/ipc.js';
import { app, BrowserWindow, dialog, ipcMain, Notification,safeStorage } from 'electron';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { providers, providerLabels, type Provider, type UsageSnapshot } from '../../shared/usage.js';
import { collectUsage,matchingScanFiles } from './scan.js';
import type { SaveImportPreview } from '../../shared/companion.js';
import { readMacSave, SaveImportError } from '../companion/mac-save.js';
import { CompanionStore, type ImportedProgress } from '../companion/store.js';
import type { Entry } from './entries.js';
import { registerTradeIPC } from '../trade/ipc.js';
import { fetchLimits } from './limits.js';

function settingsPath(provider: Provider): string {
  return join(app.getPath('userData'), 'usage-' + provider + '-root.json');
}

async function extraRoot(provider: Provider): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(await readFile(settingsPath(provider), 'utf8'));
    return typeof value === 'string' ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function registerUsageIPC(mainWindow: () => BrowserWindow | undefined, petWindow: () => BrowserWindow | undefined, showMainWindow: () => Promise<void>, settingsWindow: () => BrowserWindow | undefined, preferences: SettingsStore, onUsage: (snapshot: UsageSnapshot) => void, onLimits: (results: import('../../shared/usage.js').LimitResult[]) => void, onPetClick: () => void): (() => Promise<void>) & {forHandoff:()=>Promise<void>} {
  function authorized(event: Electron.IpcMainInvokeEvent): BrowserWindow {
    const window = [mainWindow(), settingsWindow()].find(window => window && !window.isDestroyed() && event.senderFrame === window.webContents.mainFrame);
    if (!window) {
      throw new Error('Unexpected usage request');
    }
    return window;
  }

  const companion = new CompanionStore(join(app.getPath('userData'), 'companion-v1.json'),undefined,emitNotices);
  ipcMain.handle('companion:export-mac',async event=>{const owner=authorized(event);const choice=await dialog.showSaveDialog(owner,{title:translate('세이브 내보내기',resolveLanguage(preferences.get().language,app.getLocale())),defaultPath:'poketokenbar-save.json',filters:[{name:'PokeTokenBar save v2',extensions:['json']}]});if(choice.canceled||!choice.filePath)return null;await writeSaveAtomically(choice.filePath,await companion.exportMac(app.getVersion(),resolveLanguage(preferences.get().language,app.getLocale())));return choice.filePath;});
  const sessionKeys=new SessionKeys(join(app.getPath('userData'),'claude-session-keys'),{
    encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error('운영체제 암호화를 사용할 수 없습니다.');return safeStorage.encryptString(value);},
    decrypt:value=>safeStorage.decryptString(value),
  });
  ipcMain.handle('usage:session-key',async(event,account:unknown,action:unknown,value:unknown)=>{
    authorized(event);const sources=await claudeAccountSources(preferences.get().claudeRoots);
    if(typeof account!=='string'||!sources.some(source=>source.id===account))throw new Error('계정을 선택해 주세요.');
    if(action==='read')return sessionKeys.state(account);
    if(action==='organizations')return sessionKeys.organizations(account);
    await limits?.catch(()=>{});
    if(action==='save'&&typeof value==='string')await sessionKeys.save(account,value);
    else if(action==='clear')await sessionKeys.clear(account);
    else if(action==='select'&&typeof value==='string')await sessionKeys.select(account,value);
    else throw new Error('Invalid session key command');
    await refreshLimits();return sessionKeys.state(account);
  });
  const maple = registerMapleWindow(companion,preferences,authorized,notifyCompanion);
  let battle:ReturnType<typeof registerBattleIPC>|undefined;
  const activity=()=>({trade:trade.blocksUpdate(),battle:battle?.isBusy()??false});
  const notifyActivity=()=>{const owner=mainWindow();if(owner&&!owner.isDestroyed())owner.webContents.send('usage:activity-gate',activity());};
  const trade = registerTradeIPC(companion, mainWindow, state=>notifyCompanion(state,false),{canEnter:()=>!battle?.isBusy(),activityChanged:notifyActivity});
  battle=registerBattleIPC(companion,mainWindow,preferences,undefined,notifyCompanion,{tradeActive:()=>trade.blocksUpdate(),activityChanged:notifyActivity});
  ipcMain.handle('companion:read', event => {
    authorized(event);
    return companion.read();
  });

  const companionEvents=new CompanionEvents(join(app.getPath('userData'),'companion-events-v1.json'));
  function petNotice(title:string,body:string,priority=1){const pet=petWindow();if(pet&&!pet.isDestroyed())pet.webContents.send('pet:notice',{title,body,priority});}
  function emitNotices(events:CompanionNotice[]){for(const event of events)try{const {title,body}=localizedNotice(event,resolveLanguage(preferences.get().language,app.getLocale()));petNotice(title,body);if(preferences.get().companionNotifications&&Notification.isSupported())new Notification({title,body}).show();}catch(error){console.error('Companion notification failed:',error);}}
  function notifyCompanion(state: CompanionView | null,announce=true): void {
    if(state)void companionEvents.observe(state,announce,false).then(emitNotices).catch(error=>console.error('Companion event failed:',error));
    if (state) maple.broadcast(state);
    for (const window of [mainWindow(), settingsWindow()]) {
      if (window && !window.isDestroyed()) window.webContents.send('companion:updated', state);
    }
    const pet = petWindow();
    if (state && pet && !pet.isDestroyed()) pet.webContents.send('pet:updated', state.pet);
  }

  let latestSnapshot:UsageSnapshot|undefined;
  function authorizePet(event: Electron.IpcMainInvokeEvent): void {
    const pet = petWindow();
    if (!pet || event.senderFrame !== pet.webContents.mainFrame) throw new Error('Unexpected pet request');
  }
  ipcMain.handle('pet:hover',async event=>{authorizePet(event);const state=await companion.read(),language=resolveLanguage(preferences.get().language,app.getLocale()),today=Object.values(latestSnapshot?.usage??{}).reduce((sum,row)=>sum+row.today.total,0);const usedToday=new Set(Object.entries(latestSnapshot?.usage??{}).filter(([,row])=>row.today.total>0).map(([id])=>id));const percentages=presentedCurrent.filter(row=>row.tracked!==false&&usedToday.has(row.provider)).flatMap(row=>row.windows.filter(window=>!/personal|individual|개인/i.test(window.label)).map(window=>window.usedPercent));let body=t('오늘')+' '+today.toLocaleString(language)+' '+t('토큰');if(percentages.length){const used=Math.max(...percentages),remaining=preferences.get().limitMode==='remaining';body+=' · '+Math.max(0,remaining?100-used:used).toFixed(0)+'% '+t(remaining?'남음':'사용');}if(!state.pet.species&&state.prayers>0)body+='\n'+prayerHoverLine(state.prayers,t);return{body,prayers:state.pet.species?0:state.prayers};});
  ipcMain.handle('pet:read', async event => {
    authorizePet(event);
    return (await companion.read()).pet;
  });
  ipcMain.handle('pet:activate', async event => {
    authorizePet(event);
    onPetClick();
    const state = await companion.read();
    if (state.pet.species) {
      await showMainWindow();
      return null;
    }
    const next = await companion.pray();
    notifyCompanion(next);
    if (next.prayers > state.prayers && next.prayers % 30 === 0) {
      void refresh().catch(error => console.error('Pet refresh failed:', error));
    }
    return next.prayers;
  });

  const detailsClient = new PokemonDetailsClient(join(app.getPath('userData'), 'pokemon-details-v1'));
  ipcMain.handle('companion:details', async (event, speciesID: unknown) => {
    authorized(event);
    if (typeof speciesID !== 'number' || !Number.isInteger(speciesID)) throw new Error('Invalid Pokédex number');
    const owned=await companion.read();
    const knownMoves=[...(owned.active?[owned.active]:[]),...owned.captures]
      .filter(row=>row.species.some(species=>species.number===speciesID)).flatMap(row=>row.moves ?? []);
    const payload=await detailsClient.get(speciesID, resolveLanguage(preferences.get().language, app.getLocale()),knownMoves);
    const state=await companion.enrichMoves({...payload.details,moves:payload.baseMoves ?? payload.details.moves});
    if(state)notifyCompanion(state);
    return payload;
  });

  ipcMain.handle('companion:move',async(event,input:unknown)=>{
    authorized(event);const row=object(input);
    if(typeof row?.id!=='string' || row.id.length>256 || typeof row.speciesID!=='number' || !Number.isInteger(row.speciesID) ||
       typeof row.slot!=='number' || !Number.isInteger(row.slot) || row.slot<0 || row.slot>=4 ||
       typeof row.name!=='string' || !/^[a-z0-9-]{1,100}$/.test(row.name) ||
       (row.form!==undefined && (typeof row.form!=='string' || row.form.length>100)) ||
       !Array.isArray(row.expectedMoves) || row.expectedMoves.length>4 || !row.expectedMoves.every(name=>typeof name==='string' && name.length<=100))throw new Error('잘못된 기술 변경 요청입니다.');
    const payload=await detailsClient.get(row.speciesID,resolveLanguage(preferences.get().language,app.getLocale()));
    const state=await companion.replaceMove({id:row.id,speciesID:row.speciesID,form:row.form as string|undefined,
      slot:row.slot,name:row.name,expectedMoves:row.expectedMoves as string[]},payload);
    notifyCompanion(state);return state;
  });

  ipcMain.handle('companion:catalog', event => { authorized(event); return shopCatalog; });
  ipcMain.handle('companion:change', async (event, input: unknown) => {
    authorized(event);
    const row = object(input);
    let action: CompanionAction;
    if (row?.kind === 'difficulty' && typeof row.growth === 'number' && typeof row.shop === 'number') {
      action = { kind: 'difficulty', growth: row.growth, shop: row.shop };
    } else if (row?.kind === 'buy' && typeof row.product === 'string' && Object.hasOwn(shopCatalog, row.product) &&
        typeof row.quantity === 'number' && Number.isSafeInteger(row.quantity) &&
        (row.activeID === undefined || typeof row.activeID === 'string')) {
      action = { kind: 'buy', product: row.product as Product, quantity: row.quantity, activeID: row.activeID };
    } else if (row?.kind === 'use' && bagItems.includes(row.item as BagItem) &&
        typeof row.quantity === 'number' && Number.isSafeInteger(row.quantity) && typeof row.id === 'string') {
      action = { kind: 'use', item: row.item as BagItem, quantity: row.quantity, id: row.id };
    } else if(row?.kind==='ability'&&typeof row.id==='string'&&row.id.length<=256&&typeof row.name==='string'&&row.name.length<=100){
      action={kind:'ability',id:row.id,name:row.name};
    } else if(row?.kind==='battle-default-item'&&typeof row.id==='string'&&row.id.length<=256&&typeof row.item==='string'&&row.item.length<=100){
      action={kind:'battle-default-item',id:row.id,item:row.item};
    } else if (row?.kind === 'representative' && (row.speciesID === null ||
        (typeof row.speciesID === 'number' && Number.isSafeInteger(row.speciesID))) &&
        (row.form === undefined || typeof row.form === 'string')) {
      action = { kind: 'representative', speciesID: row.speciesID, form: row.form };
    } else throw new Error('잘못된 육성 요청입니다.');
    const state = await companion.change(action);
    notifyCompanion(state);
    return state;
  });

  const t = (source: string, args: Record<string, string | number> = {}) => translate(source, resolveLanguage(preferences.get().language, app.getLocale()), args);
  const statusChecker = new ProviderStatusChecker();
  let claudeSources:ClaudeAccountSource[]=[],claudeEntries:readonly Entry[]=[],limitGeneration=0;
  let presentedCurrent:import('../../shared/usage.js').LimitResult[]=[];
  async function presentedLimits(){const generation=++limitGeneration,raw=currentLimits;const enriched=await withAccountBlocks(raw,claudeEntries,claudeSources),tracked=trackedClaudeAccount(enriched,preferences.get().claudeTrackedAccount);const result=enriched.map(row=>({...row,tracked:row.provider!=='claude'||row===tracked}));if(generation===limitGeneration){presentedCurrent=result;for(const owner of [mainWindow(),settingsWindow()])if(owner&&!owner.isDestroyed())owner.webContents.send('usage:limits-updated',result);onLimits(result);}return result;}
  let currentLimits: import('../../shared/usage.js').LimitResult[] = [];
  let warningPreferences=JSON.stringify([preferences.get().claudeTrackedAccount,preferences.get().criticalThreshold]);
  preferences.subscribe(()=>{if(currentLimits.length)void presentedLimits();const next=JSON.stringify([preferences.get().claudeTrackedAccount,preferences.get().criticalThreshold]);if(next!==warningPreferences){warningPreferences=next;void refresh().catch(error=>console.error('Limit tracking refresh failed:',error));}});
  function sendStatuses() {
    const statuses = statusChecker.current();
    for (const window of [mainWindow(), settingsWindow()]) {
      if (window && !window.isDestroyed()) window.webContents.send('usage:statuses', statuses);
    }
  }
  function refreshStatuses() {
    const settings = preferences.get();
    return statusChecker.refresh(settings.statusChecks, settings.providers).then(sendStatuses);
  }
  ipcMain.handle('usage:statuses', event => {
    authorized(event);
    return statusChecker.current();
  });
  let statusPreferences = JSON.stringify([preferences.get().statusChecks, preferences.get().providers]);
  preferences.subscribe(settings => {
    const next = JSON.stringify([settings.statusChecks, settings.providers]);
    if (next === statusPreferences) return;
    statusPreferences = next;
    void refreshStatuses().catch(error => console.error('Provider status check failed:', error));
  });

  const historyStore=new UsageHistoryStore(join(app.getPath('userData'),'usage-history-v1.json'));
  let nextSnapshotCheck=0;
  let scan: Promise<UsageSnapshot> | undefined;
  function refresh(): Promise<UsageSnapshot> {
    scan ??= (async () => {
      const now = new Date();
      const observations = new Map<Provider, readonly Entry[]>();
      const tracked = preferences.get().providers;
      const records = await Promise.all(providers.map(async provider => {
        if (!tracked.includes(provider)) {
          return [provider, { daily: {}, dailyCost: {}, today: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
            week: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
            month: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
            cost: Object.fromEntries(['today', 'week', 'month'].map(key => [key, { amount: 0, reported: false, estimated: false, unknown: false }])),
            lastFiveHours: 0, extraRoot: null, unreadable: 0 }] as const;
        }
        const usage = await collectUsage(provider, await extraRoot(provider), now, provider==='claude'?(await claudeAccountSources(preferences.get().claudeRoots)).flatMap(source=>source.roots.map(root=>join(root,'projects'))):undefined,
          process.env.CURSOR_USAGE_API === '1', entries => { observations.set(provider, entries); });
        return [provider, usage] as const;
      }));
      const growth = await companion.update(observations, +now).catch((error: unknown) => {
        console.error('Companion state could not be saved:', error);
        return null;
      });
      notifyCompanion(growth);
      if (growth&&(growth.raised>0||growth.active||growth.captures.length)) {
        if (+now>=nextSnapshotCheck) {
          try {
            const previous = (await companion.snapshots())[0];
            if (!previous || now.getTime() - previous.createdAt >= 43_200_000){await companion.createSnapshot();nextSnapshotCheck=+now+43_200_000;}else nextSnapshotCheck=previous.createdAt+43_200_000;
          } catch (error) { console.error('Automatic snapshot could not be saved:', error); }
        }
      }
      const entries=[...observations.values()].flat().filter(entry=>entry.tokens.total>0);
      const lastUsageAt=entries.reduce<number|undefined>((last,entry)=>last===undefined?entry.time:Math.max(last,entry.time),undefined);
      const burn=[...observations.values()].reduce((sum,rows)=>{
        const recent=rows.filter(entry=>entry.time>=+now-5*3600000 && entry.tokens.total>0);
        if(!recent.length)return sum;
        const first=recent.reduce((first,entry)=>Math.min(first,entry.time),Infinity);
        return sum+recent.reduce((total,entry)=>total+entry.tokens.total,0)/Math.max(1,(+now-first)/60000);
      },0);
      claudeEntries=observations.get('claude')??[];if(currentLimits.length)await presentedLimits();
      const usage=Object.fromEntries(records) as UsageSnapshot['usage'];
      const today=Object.values(usage).reduce((sum,row)=>sum+row.today.total,0);
      const warning=limitWarning(presentedCurrent.filter(row=>tracked.includes(row.provider)),preferences.get().criticalThreshold,preferences.get().claudeTrackedAccount,+now);
      const daily:Record<string,number>={};for(const row of Object.values(usage))for(const [day,tokens]of Object.entries(row.daily))daily[day]=(daily[day]??0)+tokens;
      const history=await historyStore.merge(daily,now);
      const snapshot: UsageSnapshot = { activityGate:activity(),history, labels: providerLabels, usage, companion: growth, activity:activityState(Boolean(growth?.active),today,burn,lastUsageAt,warning,+now) };
      const owner=mainWindow();if(owner&&!owner.isDestroyed())owner.webContents.send('usage:updated',snapshot);
      latestSnapshot=snapshot;
      onUsage(snapshot);
      return snapshot;
    })().finally(() => { scan = undefined; });
    return scan;
  }

  ipcMain.handle('usage:refresh', event => {
    authorized(event);
    void refreshLimits().catch(error => console.error('Limit refresh failed:', error));
    void refreshStatuses().catch(error => console.error('Provider status check failed:', error));
    return refresh();
  });

  let limits: ReturnType<typeof fetchLimits> | undefined;
  function refreshLimits() {
    if (!limits) {
      const windows: CandyWindow[] = [];
      limits = fetchLimits(windows, preferences.get().claudeRoots, preferences.get().providers,sources=>{claudeSources=sources;},sessionKeys).then(async result => {
        try {
          const tracked = preferences.get().providers;
          const reward = await companion.grantCandies(windows.filter(window =>
            tracked.includes(window.key.split('.')[0] as Provider)));
          if (reward) {
            notifyCompanion(reward.state);
            if (reward.count && preferences.get().companionNotifications && Notification.isSupported()) {
              new Notification({ title: t('이상한사탕 {count}개 획득', { count: reward.count }), body: t('사용 한도에 도달해 가방에 넣었습니다.') }).show();
            }
          }
        } catch (error) { console.error('Candy rewards could not be saved:', error); }
        currentLimits=preserveLimits(currentLimits,result);
        const presented=await presentedLimits();
        if (preferences.get().limitNotifications) {
          try {
            const path = join(app.getPath('userData'), 'limit-notices-v1.json');
            let ledger: AlertLedger = {};
            try { ledger = JSON.parse(await readFile(path, 'utf8')); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            const tracked = preferences.get().providers;
            const messages = limitAlertDetails(result.filter(row => tracked.includes(row.provider)), ledger,
              preferences.get().warnThreshold, preferences.get().criticalThreshold);
            await writeSaveAtomically(path, JSON.stringify(ledger));
            for (const message of messages) {
              const name=(providerLabels[message.provider]??message.provider)+(message.account?' '+message.account:'')+' · '+t(message.label);
              const body=t('{name} · {percent}% 사용',{name,percent:message.percent.toFixed(0)});
              petNotice(t('사용 한도 알림'),body,3);
              if(Notification.isSupported())new Notification({ title: t('사용 한도 알림'), body }).show();
            }
          } catch (error) { console.error('Limit notifications could not be saved:', error); }
        }
        return presented;
      }).finally(() => { limits = undefined; });
    }
    return limits;
  }

  let suspended=false;
  const backgroundRefresh = () => {
    if(suspended)return;
    void refreshStatuses().catch(error => console.error('Provider status check failed:', error));
    void refresh().catch(error => console.error('Usage refresh failed:', error));
    void refreshLimits().catch(error => console.error('Limit refresh failed:', error));
  };
  backgroundRefresh();
  let timer: ReturnType<typeof setInterval> | undefined;
  function scheduleRefresh() {
    clearInterval(timer);
    const seconds = preferences.get().refreshSeconds;
    timer = seconds ? setInterval(backgroundRefresh, seconds * 1000) : undefined;
    timer?.unref();
  }
  scheduleRefresh();
  preferences.subscribe(scheduleRefresh);
  observeSystemState((kind,enabled)=>{if(kind==='saver'){for(const owner of [mainWindow(),petWindow(),settingsWindow()])owner?.webContents.send('system:power-saver',enabled);return;}if(kind==='display'){suspended=!enabled;if(enabled)backgroundRefresh();}else if(enabled)backgroundRefresh();});
  app.once('before-quit', () => clearInterval(timer));

  let pickingImport = false;
  const importWindows = new WeakSet<BrowserWindow>();
  let applyingImport: Promise<unknown> | undefined;
  let pendingImport: { owner: BrowserWindow; preview: SaveImportPreview; progress: ImportedProgress } | undefined;
  ipcMain.handle('companion:import-preview', async (event, format: unknown = 'mac') => {
    const owner = authorized(event);
    if (pickingImport) return null;
    pendingImport = undefined;
    pickingImport = true;
    try {
      if (format !== 'windows' && format !== 'mac') throw new Error('저장 형식을 선택해 주세요.');
      const chosen = await dialog.showOpenDialog(owner, {
        title: format === 'windows' ? 'Windows 백업 선택' : 'Mac에서 내보낸 PokeTokenBar 저장 선택',
        properties: ['openFile'],
        filters: [{ name: 'PokeTokenBar 저장', extensions: ['json', 'save'] }, { name: '모든 파일', extensions: ['*'] }],
      });
      const path = chosen.filePaths[0];
      if (chosen.canceled || !path || owner.isDestroyed()) return null;
      const incoming = format === 'mac' ? await readMacSave(path) : {
        progress: await readWindowsBackup(path), appVersion: app.getVersion(), sourceDevice: 'Windows', exportedAt: Date.now(),
      };
      const { progress, ...metadata } = incoming;
      const preview = {
        ...metadata, file: basename(path), token: randomUUID(),
        incoming: CompanionStore.previewImport(progress), current: await companion.read(),
      };
      pendingImport = { owner, preview, progress };
      if (!importWindows.has(owner)) {
        importWindows.add(owner);
        owner.once('closed', () => { if (pendingImport?.owner === owner) pendingImport = undefined; });
      }
      return preview;
    } catch (error) {
      if (error instanceof SaveImportError) throw error;
      throw new Error('저장 파일을 읽거나 현재 Windows 저장을 미리 볼 수 없습니다.');
    } finally { pickingImport = false; }
  });

  async function readWindowsBackup(path: string): Promise<ImportedProgress> {
    const bytes = await readFile(path);
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('백업 파일이 너무 큽니다.');
    return CompanionStore.decodeWindowsBackup(JSON.parse(bytes.toString('utf8')));
  }

  ipcMain.handle('settings:snapshots', event => { authorized(event); return companion.snapshots(); });
  ipcMain.handle('settings:snapshot', async event => { authorized(event); await companion.createSnapshot(); });
  ipcMain.handle('companion:snapshot-preview', async (event, id: unknown) => {
    const owner = authorized(event);
    if (typeof id !== 'string') throw new Error('스냅샷을 선택해 주세요.');
    const progress = await companion.snapshotProgress(id);
    const preview: SaveImportPreview = { file: id, token: randomUUID(), appVersion: app.getVersion(),
      sourceDevice: 'Windows 스냅샷', exportedAt: Date.now(),
      incoming: CompanionStore.previewImport(progress), current: await companion.read() };
    pendingImport = { owner, preview, progress };
    return preview;
  });

  ipcMain.handle('companion:import-cancel', (event, token: unknown) => {
    const owner = authorized(event);
    if (pendingImport?.owner === owner && pendingImport.preview.token === token) pendingImport = undefined;
  });

  ipcMain.handle('companion:import-confirm', async (event, token: unknown) => {
    const owner = authorized(event);
    const selected = pendingImport;
    if (!selected || selected.owner !== owner || selected.preview.token !== token) {
      throw new Error('파일을 다시 선택해 미리보기를 확인해 주세요.');
    }
    pendingImport = undefined;
    await scan?.catch(() => {});
    const write = companion.replaceImport(selected.progress, Date.now(), selected.preview.current);
    applyingImport = write;
    try {
      const result = await write;
      notifyCompanion(result.companion,false);
      return result;
    } finally {
      if (applyingImport === write) applyingImport = undefined;
    }
  });

  ipcMain.handle('usage:limits', event => {
    authorized(event);
    return refreshLimits();
  });

  const configuring = new Set<Provider>();
  ipcMain.handle('usage:scan-roots',async(event,provider:unknown,raw:unknown,save:unknown)=>{authorized(event);if(typeof provider!=='string'||!Object.hasOwn(providerLabels,provider)||typeof raw!=='string'||raw.length>32768||typeof save!=='boolean')throw new Error('Invalid scan roots');const result=await matchingScanFiles(provider as Provider,raw);if(save){await scan?.catch(()=>{});await writeSaveAtomically(settingsPath(provider as Provider),JSON.stringify(raw));}return result;});
  ipcMain.handle('usage:configure', async (event, provider: unknown, reset: unknown) => {
    const window = authorized(event);
    if (typeof provider !== 'string' || !Object.hasOwn(providerLabels, provider) || typeof reset !== 'boolean') {
      throw new Error('Invalid usage settings');
    }
    const id = provider as Provider;
    if (configuring.has(id)) return;
    configuring.add(id);
    try {
      await scan?.catch(() => {});
      const path = settingsPath(id);
      if (reset) {
        await rm(path, { force: true });
        return;
      }
      const selection = await dialog.showOpenDialog(window, {
        title: '추가 로그 폴더 선택',
        properties: ['openDirectory'],
      });
      if (selection.canceled || !selection.filePaths[0]) return;
      const temporary = path + '.' + randomUUID();
      try {
        await writeFile(temporary, JSON.stringify([await extraRoot(id),...selection.filePaths].filter(Boolean).join('\n')), { flag: 'wx' });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    } finally {
      configuring.delete(id);
    }
  });

  const finish=async () => {
    if (trade.blocksUpdate()) {
      throw new Error('LAN 교환 연결을 종료한 뒤 업데이트해 주세요.');
    }
    if(battle?.blocksUpdate())throw new Error('LAN 대전을 종료한 뒤 업데이트해 주세요.');
    await scan?.catch(() => {});
    await applyingImport?.catch(() => {});
    await battle?.finishWrites();
    await historyStore.finishWrites();
    await companionEvents.finishWrites();
    await companion.finishWrites();
  };
  return Object.assign(finish,{forHandoff:async()=>{suspended=true;clearInterval(timer);try{await trade.prepareHandoff();await scan?.catch(()=>{});await limits?.catch(()=>{});await applyingImport?.catch(()=>{});await historyStore.finishWrites();await companionEvents.finishWrites();await companion.finishWrites();await battle?.prepareHandoff();}catch(error){suspended=false;scheduleRefresh();throw error;}}});
}
