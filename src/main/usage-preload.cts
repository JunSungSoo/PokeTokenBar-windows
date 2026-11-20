import type { SettingsAPI } from '../shared/settings.js';
import type { BattleAPI } from '../shared/battle.js';
import type { TradeAPI } from '../shared/trade.js';
import { contextBridge, ipcRenderer } from 'electron';
import type { WindowsAPI } from '../shared/windows.js';
import type { UsageAPI } from '../shared/usage.js';

contextBridge.exposeInMainWorld('usage', {
  scanRoots:(provider,raw,save=false)=>ipcRenderer.invoke('usage:scan-roots',provider,raw,save),
  onActivity:handler=>ipcRenderer.on('usage:activity-gate',(_event,state)=>handler(state)),
  exportMac:()=>ipcRenderer.invoke('companion:export-mac'),
  manageSessionKey:(account,action,value)=>ipcRenderer.invoke('usage:session-key',account,action,value),
  onSnapshot:handler=>ipcRenderer.on('usage:updated',(_event,snapshot)=>handler(snapshot)),
  onLimits:handler=>ipcRenderer.on('usage:limits-updated',(_event,results)=>handler(results)),
  openMaple: () => ipcRenderer.invoke('companion:maple-open'),
  pokemonDetails: speciesID => ipcRenderer.invoke('companion:details', speciesID),
  setPokemonMove: change => ipcRenderer.invoke('companion:move', change),
  previewImport: format => ipcRenderer.invoke('companion:import-preview', format),
  previewSnapshot: id => ipcRenderer.invoke('companion:snapshot-preview', id),
  cancelImport: token => ipcRenderer.invoke('companion:import-cancel', token),
  confirmImport: token => ipcRenderer.invoke('companion:import-confirm', token),
  onCompanion: handler => {
    ipcRenderer.on('companion:updated', (_event, state) => handler(state));
  },
  changeCompanion: action => ipcRenderer.invoke('companion:change', action),
  companion: () => ipcRenderer.invoke('companion:read'),
  onStatuses: handler => ipcRenderer.on('usage:statuses', (_event, statuses) => handler(statuses)),
  statuses: () => ipcRenderer.invoke('usage:statuses'),
  limits: () => ipcRenderer.invoke('usage:limits'),
  refresh: () => ipcRenderer.invoke('usage:refresh'),
  configure: (provider, reset) => ipcRenderer.invoke('usage:configure', provider, reset),
} satisfies UsageAPI);

contextBridge.exposeInMainWorld('desktop', {
  support:action=>ipcRenderer.invoke('windows:support',action),
  updateState:()=>ipcRenderer.invoke('windows:update-state'),
  skipUpdate:(restore=false)=>ipcRenderer.invoke('windows:update-skip',restore),
  onUpdate:handler=>ipcRenderer.on('windows:update-state',(_event,value)=>handler(value)),
  onRefresh:handler=>ipcRenderer.on('desktop:refresh',()=>handler()),
  onOpenDex:handler=>ipcRenderer.on('desktop:open-dex',()=>handler()),
  quit: () => ipcRenderer.invoke('windows:quit'),
  minimizeWindow: () => ipcRenderer.invoke('windows:minimize'),
  closeWindow: () => ipcRenderer.invoke('windows:close'),
  openSettings: () => ipcRenderer.invoke('windows:open-settings'),
  settings: () => ipcRenderer.invoke('windows:settings'),
  login: enabled => ipcRenderer.invoke('windows:login', enabled),
  checkUpdate: () => ipcRenderer.invoke('windows:update-check'),
  openUpdatePage: () => ipcRenderer.invoke('windows:update-page'),
  installUpdate: () => ipcRenderer.invoke('windows:update-install'),
  togglePet: () => ipcRenderer.invoke('windows:pet'),
} satisfies WindowsAPI);

contextBridge.exposeInMainWorld('trade', {
  state: () => ipcRenderer.invoke('trade:state'),
  choices: () => ipcRenderer.invoke('trade:choices'),
  host: nickname => ipcRenderer.invoke('trade:host', nickname),
  connect: (code, nickname) => ipcRenderer.invoke('trade:connect', code, nickname),
  offer: id => ipcRenderer.invoke('trade:offer', id),
  withdraw: () => ipcRenderer.invoke('trade:withdraw'),
  reject: () => ipcRenderer.invoke('trade:reject'),
  accept: replaceCurrent => ipcRenderer.invoke('trade:accept', replaceCurrent),
  revealBackup: () => ipcRenderer.invoke('trade:reveal-backup'),
  close: () => ipcRenderer.invoke('trade:close'),
  onState: handler => ipcRenderer.on('trade:state-changed', (_event, state) => handler(state)),
} satisfies TradeAPI);

contextBridge.exposeInMainWorld('battle', {
  open: kind => ipcRenderer.invoke('battle:open',kind),
  closeWindow: () => ipcRenderer.invoke('battle:close-window'),
  auxiliary: (kind,visible) => ipcRenderer.invoke('battle:auxiliary',kind,visible),
  assets: () => ipcRenderer.invoke('battle:assets'),
  audio: patch => ipcRenderer.invoke('battle:audio',patch),
  context: () => ipcRenderer.invoke('battle:context'),
  onContext: handler => ipcRenderer.on('battle:context-changed',(_event,value)=>handler(value)),
  onState: handler => ipcRenderer.on('battle:state-changed',(_event,value)=>handler(value)),
  lan: (command,value) => ipcRenderer.invoke('battle:lan',command,value),
  onLan: handler => ipcRenderer.on('battle:lan-changed',(_event,value)=>handler(value)),
  cpu: (command,value) => ipcRenderer.invoke('battle:cpu',command,value),
  choices: purpose => ipcRenderer.invoke('battle:choices',purpose),
  resume: mode => ipcRenderer.invoke('battle:resume', mode),
  start: (mode, ids,items) => ipcRenderer.invoke('battle:start', mode, ids,items),
  choose: (mode, id, actions) => ipcRenderer.invoke('battle:choose', mode, id, actions),
  advance: (mode, reward, checkpoint) => ipcRenderer.invoke('battle:advance', mode, reward, checkpoint),
  surrender: mode => ipcRenderer.invoke('battle:surrender', mode),
} satisfies BattleAPI);

contextBridge.exposeInMainWorld('shopCatalog', () => ipcRenderer.invoke('companion:catalog'));

contextBridge.exposeInMainWorld('preferences', {
  readPower:()=>ipcRenderer.invoke('settings:power-saver'),
  onPowerSaver:handler=>ipcRenderer.on('system:power-saver',(_event,value)=>handler(value)),
  read: () => ipcRenderer.invoke('settings:read'),
  change: patch => ipcRenderer.invoke('settings:change', patch),
  onChange: handler => ipcRenderer.on('settings:changed', (_event, settings) => handler(settings)),
  backup: () => ipcRenderer.invoke('settings:backup'),
  openDataFolder: () => ipcRenderer.invoke('settings:open-data-folder'),
  snapshots: () => ipcRenderer.invoke('settings:snapshots'),
  snapshot: () => ipcRenderer.invoke('settings:snapshot'),
  addClaudeRoot: () => ipcRenderer.invoke('settings:add-claude-root'),
} satisfies SettingsAPI);
