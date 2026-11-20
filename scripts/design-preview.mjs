// Capture the actual sandboxed app UI with isolated sample data, never user saves.
// pnpm build && pnpm exec electron scripts/design-preview.mjs
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { CompanionStore } from '../dist/main/companion/store.js';
import { speciesFor } from '../dist/main/companion/catalog.js';
import { SettingsStore, registerSettingsIPC } from '../dist/main/settings.js';
import { providers } from '../dist/shared/usage.js';
import { shopCatalog } from '../dist/shared/companion.js';
import { detailFixture } from '../tests/pokemon-details-fixtures.mjs';
import { parsePokemonDetails, presentPokemonDetails } from '../dist/main/companion/pokemon-details.js';
app.on('window-all-closed', () => {});
async function run() {
const temporary = await mkdtemp(join(tmpdir(), 'ptb-design-preview-'));
app.setPath('userData', temporary);
const output = resolve('output/design-preview');
let main, board;
const errors = [];
async function evaluate(code) { return main.webContents.executeJavaScript(code); }
async function until(code) {
  for (let i = 0; i < 625; i++) {
    if (await evaluate(code)) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Preview timed out: ' + code + '\n' + JSON.stringify(await evaluate("({status:document.querySelector('#status')?.textContent,limit:document.querySelector('#limit-status')?.textContent,rows:document.querySelector('#limit-rows')?.outerHTML})")) + '\n' + errors.join('\n'));
}
async function capture(name) {
  await until("[...document.images].filter(img=>img.parentElement.getClientRects().length).every(img=>img.complete)");
  await new Promise(resolve => setTimeout(resolve, 200));
  await writeFile(join(output, name + '.png'), (await main.webContents.capturePage()).toPNG());
}
try {
  await app.whenReady();
  const images = new Map();
  await session.defaultSession.protocol.handle('https', async request => {
    if (!images.has(request.url)) images.set(request.url, (async () => {
      for (let attempt=0; attempt<3; attempt++) {
        try { return await fetch(request.url, { signal: AbortSignal.timeout(15000) }); }
        catch (error) {
          if (attempt===2) throw error;
          await new Promise(resolve=>setTimeout(resolve,400));
        }
      }
    })());
    return (await images.get(request.url)).clone();
  });
  await mkdir(output, { recursive: true });
  const preferences = new SettingsStore(join(temporary, 'settings.json'));
  await preferences.load();
  await preferences.change({ language: 'ko', theme: 'light', animated: false, statusChecks: false, refreshSeconds: 0, trend: '14' });
  const store = new CompanionStore(join(temporary, 'companion.json'), () => false);
  await store.update(new Map(), Date.now());
  const now = Date.now();
  const profile = { instanceID: 'preview', seed: '123', ivs: { hp:31, attack:31, defense:31, specialAttack:31, specialDefense:31, speed:31 }, level:12, growthTokens:0, abilityIsHidden:false, abilityName:'overgrow', moves:[{name:'tackle', learnedAtLevel:1}] };
  let { companion: state } = await store.replaceImport({ raised:24600000000, progress:380000000, inventory:{shinyCharm:1, redMaple:2, mint:3, rareCandy:4},
    active:{ id:'preview', family:-1, stage:0, route:[1,2,3].map(id=>speciesFor(id)), hatchedAt:now, nature:'노력', shiny:false, repeat:false, rarity:'rare', level:12, macProfile:profile },
    graduated:Array.from({length:16},(_,i)=>({id:'preview-'+i,family:-1,stage:0,route:[speciesFor(i+1)],hatchedAt:now-86400000,graduatedAt:now,nature:'노력',shiny:false,repeat:false,rarity:'common',level:50,macProfile:{...profile,instanceID:'preview-'+i,level:50}})) }, now);
  const date = new Date();
  const today = Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
  const amount = total => ({input:Math.round(total*.7),output:Math.round(total*.3),cacheWrite:0,cacheRead:0,total});
  const cost = total => ({amount:total,reported:false,estimated:total>0,unknown:false});
  const snapshot = { companion:state, labels:Object.fromEntries(providers.map(id=>[id,id==='claude'?'Claude Code':id==='codex'?'Codex':id])), usage:Object.fromEntries(providers.map(id=>{
    const share=id==='codex'?.64:id==='claude'?.36:0;
    return [id,{today:amount(Math.round(1280000*share)),week:amount(Math.round(6840000*share)),month:amount(Math.round(24600000*share)),cost:{today:cost(3.42*share),week:cost(18.28*share),month:cost(65.78*share)},daily:Object.fromEntries(Array.from({length:14},(_,i)=>[today-(13-i)*86400000,Math.round(([.6,.9,.4,.8,1.1,.7,1.3,.8,1,1.1,.9,1.4,.7,1.28][i])*1000000*share)])),dailyCost:{},unreadable:0}];
  })) };
  ipcMain.handle('usage:refresh',()=>snapshot);
  ipcMain.handle('usage:statuses',()=>[]);
  ipcMain.handle('usage:limits',()=>['claude','codex'].map(provider=>({provider,status:'available',windows:[{label:'5시간',usedPercent:42,resetsAt:now+7200000}]})));
  ipcMain.handle('companion:read',()=>state);
  ipcMain.handle('companion:catalog',()=>shopCatalog);
  ipcMain.handle('companion:details',(_event,id)=>{const f=detailFixture(id);return presentPokemonDetails(parsePokemonDetails(f.pokemon,f.species,id),'ko');});
  ipcMain.handle('trade:state',()=>({phase:'idle',codes:[],message:''}));
  ipcMain.handle('trade:choices',()=>[]);
  ipcMain.handle('trade:close',()=>({phase:'idle',codes:[],message:''}));
  ipcMain.handle('battle:lan',()=>({phase:'idle',codes:[],registered:[],opponentRoster:[],history:[]}));
  ipcMain.handle('battle:choices',()=>[]);
  registerSettingsIPC(preferences,()=>[main].filter(Boolean),()=>preferences.finishWrites());
  main = new BrowserWindow({show:false,width:490,height:740,webPreferences:{preload:resolve('dist/main/usage-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  main.setContentSize(490,740);
  main.webContents.on('console-message',event=>{if(event.level==='error' && !event.message.includes('ERR_'))errors.push(event.message);});
  await main.loadFile(resolve('dist/renderer/index.html'));
  await until("document.querySelector('#today-total').textContent==='1.3M' || document.querySelector('#today-total').textContent==='1.28M'");
  await evaluate("document.querySelector('#load-limits').click()");
  await until("document.querySelector('#limit-rows progress') !== null");
  await capture('home-light');
  await evaluate("document.querySelector('#pane-home').scrollTop=10000");
  await capture('home-usage-light');
  for (const [tab,name] of [['shop','shop-light'],['bag','bag-light'],['collection','collection-light'],['trade','trade-light'],['battle','battle-launcher-light']]) {
    await evaluate(`document.querySelector('#tab-${tab}').click()`);
    await capture(name);
  }
  // Supported compact widths: cards must keep an actual visible sprite area.
  for(const width of [440,490]) {
    main.setContentSize(width,665);
    await evaluate("document.querySelector('#tab-collection').click()");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.dex-card')].filter(card=>card.scrollWidth>card.clientWidth+1 || card.scrollHeight>card.clientHeight+1).map(card=>card.textContent)"),[]);
    assert.equal(await evaluate("[...document.querySelectorAll('.dex-card .pokemon-art')].every(art=>art.getBoundingClientRect().height>=28)"),true);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await capture('collection-'+width);
  }
  main.setContentSize(490,740);
  await preferences.change({theme:'dark'});
  await capture('collection-dark');
  await preferences.change({theme:'light'});
  const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f6f3ea;color:#27323a;font-family:system-ui,-apple-system,sans-serif;padding:28px}header{display:flex;align-items:baseline;gap:16px;margin-bottom:18px}h1{font-size:26px;margin:0;letter-spacing:-1px}header p{margin:0;font-size:13px;color:#626962}.screens{display:grid;grid-template-columns:repeat(3,490px);gap:18px}.screen{border:1px solid #8b9189;border-radius:10px;overflow:hidden;background:#fffdf7}.screen img{display:block;width:490px;height:740px}footer{margin-top:16px;font-size:12px;color:#626962;display:flex;justify-content:space-between}</style><header><h1>PokeTokenBar</h1><p>실제 앱 렌더링 · 홈 / 도감 / 배틀 진입</p></header><div class="screens">${['home-light','collection-light','battle-launcher-light'].map(file=>`<div class="screen"><img src="${file}.png"></div>`).join('')}</div><footer><span>크림 · 잉크 · 레드 / 원본 포켓몬 이미지 유지</span><span>예시 데이터 · macOS Electron 캡처</span></footer></html>`;
  await writeFile(join(output,'preview.html'),html);
  board=new BrowserWindow({show:false,width:1562,height:865,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  board.setContentSize(1562,865);
  await board.loadFile(join(output,'preview.html'));
  await new Promise(resolve=>setTimeout(resolve,200));
  await writeFile(join(output,'app-redesign.png'),(await board.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);
  console.log('PASS: light/dark captures, 440/490px containment and visible original sprites. Output: '+output);
} catch(error) { console.error(error); process.exitCode=1; }
finally {
  board?.destroy();main?.destroy();
  try { await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
  finally { app.quit(); }
}

}
void run();
