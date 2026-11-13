// Visible preview using production renderers and a separate sample save.
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SettingsStore, registerSettingsIPC } from '../dist/main/settings.js';
import { CompanionStore } from '../dist/main/companion/store.js';
import { PokemonDetailsClient } from '../dist/main/companion/pokemon-details.js';
import { speciesFor } from '../dist/main/companion/catalog.js';
import { providers } from '../dist/shared/usage.js';
import { shopCatalog } from '../dist/shared/companion.js';

async function run() {
  const directory = await mkdtemp(join(tmpdir(), 'ptb-collection-preview-'));
  app.setPath('userData', directory);
  await app.whenReady();
  const preferences = new SettingsStore(join(directory, 'settings-v1.json'));
  await preferences.load();
  await preferences.change({ language:'ko', refreshSeconds:0, statusChecks:false, petEnabled:false });
  const companion = new CompanionStore(join(directory, 'companion-v1.json'), () => false);
  const now = Date.now();
  const ivs = { hp:31, attack:25, defense:28, specialAttack:31, specialDefense:30, speed:27 };
  await companion.replaceImport({ raised:320000000, progress:0, active:null, graduated:[
    { id:'preview-venusaur', family:-1, stage:2, hatchedAt:now-3*86400000, graduatedAt:now-86400000, nature:'조심', shiny:false, repeat:false, rarity:'common', level:50,
      route:[1,2,3].map(number => speciesFor(number)),
      macProfile:{ instanceID:'preview-venusaur', seed:'123456789', ivs, level:50, growthTokens:300000000, gender:'female', abilitySlot:1, abilityIsHidden:false, abilityName:'overgrow', moves:[{name:'vine-whip',learnedAtLevel:7},{name:'razor-leaf',learnedAtLevel:20},{name:'solar-beam',learnedAtLevel:53}] } },
  ] }, now);
  const details = new PokemonDetailsClient(join(directory,'pokemon-details-v1'));
  const windows=[];
  registerSettingsIPC(preferences, () => windows, () => preferences.finishWrites());
  ipcMain.handle('companion:read', () => companion.read());
  ipcMain.handle('companion:catalog', () => shopCatalog);
  ipcMain.handle('companion:details', (_event,id) => details.get(id,preferences.get().language === 'ko' ? 'ko' : 'en'));
  ipcMain.handle('companion:change', (_event,action) => companion.change(action));
  ipcMain.handle('usage:statuses', () => []);
  ipcMain.handle('usage:limits', () => []);
  ipcMain.handle('windows:settings', () => ({ supported:false,version:'1.0.0-preview' }));
  ipcMain.handle('trade:state', () => ({ phase:'idle',codes:[],message:'' }));
  ipcMain.handle('trade:choices', () => []);
  ipcMain.handle('battle:choices', () => []);
  ipcMain.handle('battle:resume', () => null);
  const zero={input:0,output:0,cacheWrite:0,cacheRead:0,total:0};
  const cost={amount:0,reported:false,estimated:false,unknown:false};
  ipcMain.handle('usage:refresh', async () => ({ companion:await companion.read(),labels:Object.fromEntries(providers.map(id=>[id,id==='claude'?'Claude Code':id==='codex'?'Codex':id])),usage:Object.fromEntries(providers.map(id=>[id,{today:zero,week:zero,month:zero,cost:{today:cost,week:cost,month:cost},daily:{},dailyCost:{},unreadable:0,lastFiveHours:0,extraRoot:null}])) }));
  const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width=Math.min(490,Math.floor((area.width-48)/2));
  const height=Math.min(840,area.height-48);
  for (const [index,title] of ['포획 기록 미리보기 · 샘플 저장','상세정보 미리보기 · 샘플 저장'].entries()) {
    const window=new BrowserWindow({title,width,height,x:area.x+Math.max(0,Math.round((area.width-width*2-16)/2))+index*(width+16),y:area.y+24,show:false,autoHideMenuBar:true,
      webPreferences:{preload:resolve('dist/main/usage-preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
    windows.push(window);
    window.webContents.on('page-title-updated', event=>event.preventDefault());
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    await window.loadFile(resolve('dist/renderer/index.html'));
    window.show();
  }
  app.on('window-all-closed',()=>app.quit());
  console.log('Preview windows open. Separate sample save: '+directory);
}
void run().catch(error=>{console.error(error);app.exit(1);});
