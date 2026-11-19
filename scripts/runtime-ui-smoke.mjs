import{checkHomeUI}from'./home-ui-checks.mjs';
import{checkHeldItemPicker}from'./held-items-ui-checks.mjs';
import { registerMapleWindow } from '../dist/main/companion/maple-window.js';
import { speciesFor } from '../dist/main/companion/catalog.js';
import { detailFixture, method } from '../tests/pokemon-details-fixtures.mjs';
import { parsePokemonDetails, presentPokemonDetails } from '../dist/main/companion/pokemon-details.js';
// Runs actual sandboxed renderer/preloads in invisible Electron windows; no live HTTP or user saves.
import { app, BrowserWindow, ipcMain, session } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SettingsStore, registerSettingsIPC } from '../dist/main/settings.js';
import { PetAgentController } from '../dist/main/pet/controller.js';
import { CompanionStore } from '../dist/main/companion/store.js';
import { providers } from '../dist/shared/usage.js';
import { shopCatalog } from '../dist/shared/companion.js';
app.on('window-all-closed', () => {});
async function run() {
const directory = await mkdtemp(join(tmpdir(), 'ptb-runtime-ui-'));
app.setPath('userData', directory);
const errors = [];
let main, settings, pet;
let controller;
let success = false;
async function snap(name, window=main) {
  if(!process.env.POKE_UI_SCREENSHOTS)return;
  await mkdir(process.env.POKE_UI_SCREENSHOTS,{recursive:true});
  await until("!document.querySelector('#partner-art')?.classList.contains('celebrate') && !document.querySelector('#partner-art')?.classList.contains('mint-feedback')",window);
  await until("[...document.querySelectorAll('img')].filter(img=>img.parentElement?.getClientRects().length && !img.parentElement.closest('[role=tabpanel][hidden]')).every(img=>img.complete)",window);
  await new Promise(resolve=>setTimeout(resolve,120));
  await window.webContents.capturePage();
  await new Promise(resolve=>setTimeout(resolve,80));
  await writeFile(join(process.env.POKE_UI_SCREENSHOTS,name+'.png'),(await window.webContents.capturePage()).toPNG());
}
function check(expression, window = main) { return window.webContents.executeJavaScript(expression); }
async function until(expression, window = main) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check(expression, window)) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Timed out: ' + expression);
}
try {
  await app.whenReady();
  // Public-domain 2-frame GIF generated from embedded bytes; offline sprite decoding.
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAFAAAALAAAAAABAAEAAAICRAEAIfkEAAUAAAAsAAAAAAEAAQAAAgJMAQA7', 'base64');
  let retryUntil=0;
  await session.defaultSession.protocol.handle('https', async request => {
    if(request.url.endsWith('/retry.gif')&&Date.now()<retryUntil)return new Response(null,{status:503});
    if(process.env.POKE_UI_REAL_SPRITES==='1' && request.url.startsWith('https://raw.githubusercontent.com/') && !request.url.endsWith('/test.gif'))return fetch(request.url);
    return new Response(gif,{headers:{'content-type':'image/gif','access-control-allow-origin':'*'}});
  });
  const preferences = new SettingsStore(join(directory, 'settings-v1.json'));
  await preferences.load();
  const companion = new CompanionStore(join(directory, 'companion-v1.json'), () => false);
  let state = await companion.update(new Map(), Date.now());
  const zero = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
  const cost = { amount: 0, reported: false, estimated: false, unknown: false };
  const snapshot = { companion: state, labels: Object.fromEntries(providers.map(id => [id, id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : id])), usage: Object.fromEntries(providers.map(id => [id, { today: zero, week: zero, month: zero, cost: { today: cost, week: cost, month: cost }, daily: {}, dailyCost: {}, unreadable: 0 }])) };
  let statuses = [{ provider: 'claude', component: 'Claude Code', indicator: 'major', checkedAt: Date.now() }];
  let quotaResults = [];
  ipcMain.handle('settings:snapshots', () => []);
  ipcMain.handle('usage:refresh', () => snapshot);
  ipcMain.handle('usage:statuses', () => statuses);
  ipcMain.handle('usage:limits', () => quotaResults);
  let updateFixture={state:'current',version:'1.0.0'};
  const publishUpdate=value=>{updateFixture=value;for(const owner of [main,settings])owner?.webContents.send('windows:update-state',value);return value;};
  ipcMain.handle('windows:update-state',()=>updateFixture);
  let updateDownloads=0;
  ipcMain.handle('windows:update-install',()=>{updateDownloads++;return{...updateFixture,delivery:'browser',opened:true};});
  ipcMain.handle('windows:update-skip',async(_event,restore)=>{await preferences.change({skippedUpdateVersion:restore?'':updateFixture.version});return publishUpdate({...updateFixture,state:restore?'available':'skipped'});});
  ipcMain.handle('usage:scan-roots',async(_event,provider,raw)=>{const {matchingScanFiles}=await import('../dist/main/usage/scan.js');return matchingScanFiles(provider,raw);});
  ipcMain.handle('usage:session-key',()=>({configured:false,organizations:[]}));
  ipcMain.handle('companion:read', () => state);
  ipcMain.handle('companion:catalog', () => shopCatalog);
  const notifyState=value=>{state=value;snapshot.companion=value;main?.webContents.send('companion:updated',value);};
  const mapleWindow=registerMapleWindow(companion,preferences,event=>{
    const owner=[main,settings].find(window=>window && event.senderFrame===window.webContents.mainFrame);
    if(!owner)throw new Error('Unexpected test owner');return owner;
  },notifyState,()=>{});
  ipcMain.handle('companion:change',async(_event,action)=>{const value=await companion.change(action);notifyState(value);mapleWindow.broadcast(value);return value;});
  let loadoutFixture=false;
  function detailsFor(id){
    const fixture=detailFixture(id);
    if(loadoutFixture){
      fixture.pokemon.moves.push({move:{name:'growl'},version_group_details:[method('level-up',1)]},
        {move:{name:'charm'},version_group_details:[method('machine')]},
        {move:{name:'hyper-beam'},version_group_details:[method('level-up',80)]});
    }
    return parsePokemonDetails(fixture.pokemon,fixture.species,id);
  }
  ipcMain.handle('companion:move',async(_event,action)=>{
    const payload=presentPokemonDetails(detailsFor(action.speciesID),preferences.get().language==='system'?'en':preferences.get().language);
    const value=await companion.replaceMove(action,payload);notifyState(value);return value;
  });
  let failDetails = true;
  let delayDetail;
  ipcMain.handle('companion:details', async (_event, id) => {
    if (id === 1 && failDetails) { failDetails = false; throw new Error('fixture offline'); }
    if (id === 2) await new Promise(resolve => { delayDetail = resolve; });
    const details=detailsFor(id);
    const enriched=await companion.enrichMoves(details);if(enriched)notifyState(enriched);
    return presentPokemonDetails(details, preferences.get().language === 'system' ? 'en' : preferences.get().language);
  });
  ipcMain.handle('windows:settings', () => ({ supported: false, version: '1.0.0' }));
  ipcMain.handle('pet:hover',()=>({title:'Pikachu',body:'Today 100 tokens · 25%'}));
  ipcMain.handle('pet:read', () => ({ species: { number: 25, name: 'Pikachu' }, shiny: false }));
  ipcMain.handle('pet:activate', () => { controller.dismiss(); return 1; });
  ipcMain.handle('trade:state', () => ({ phase: 'idle', codes: [], message: '' }));
  ipcMain.handle('trade:choices', () => []);
  ipcMain.handle('battle:choices', () => []);
  ipcMain.handle('battle:lan',()=>({phase:'idle',codes:[],registered:[],opponentRoster:[],localReady:false,remoteReady:false}));
  const supportActions=[];ipcMain.handle('windows:support',(_event,action)=>{supportActions.push(action);});
  ipcMain.handle('battle:resume', () => null);
  ipcMain.handle('battle:read', () => null);
  registerSettingsIPC(preferences, () => [main, settings, pet], () => preferences.finishWrites());
  controller = new PetAgentController(() => pet, preferences);
  async function open(file, preload) {
    const window = new BrowserWindow({ show: false, width: 600, height: 740, webPreferences: { preload: resolve('dist/main/' + preload), sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    window.webContents.on('console-message', event => { if (/Uncaught|not defined|TypeError/.test(event.message ?? '')) errors.push(event.message); });
    window.webContents.on('render-process-gone', (_event, detail) => errors.push(detail.reason));
    if (file === 'index.html') main = window;
    if (file === 'settings.html') settings = window;
    if (file === 'pet.html') pet = window;
    await window.loadFile(resolve('dist/renderer/' + file));
    return window;
  }
  main = await open('index.html', 'usage-preload.cjs');
  settings = await open('settings.html', 'usage-preload.cjs');
  pet = await open('pet.html', 'pet-preload.cjs');
  await until("document.querySelector('#today-total').textContent === '0'");
  await until("document.querySelector('#provider-status-banner').textContent.includes('Claude Code')");
  for (const [language, label] of [['ko','홈'],['en','Home'],['ja','ホーム'],['es','Inicio'],['fr','Accueil'],['pt','Início'],['de','Startseite'],['ru','Главная']]) {
    await preferences.change({ language });
    await until(`document.documentElement.lang === ${JSON.stringify(language)} && document.querySelector('.app-tabs button').textContent.trim() === ${JSON.stringify(label)}`);
    assert.equal(await check('document.documentElement.lang', settings), language);
  }
  // Real quota windows include a reset date; it must not shadow the browser window.
  quotaResults = [{ provider:'claude', status:'available', windows:[{label:'5시간',usedPercent:42,resetsAt:Date.now()+7200000}] }];
  await check("document.querySelector('#load-limits').click()");
  await until("document.querySelector('#limit-rows progress')?.value === 42");
  assert.equal(await check("document.querySelector('#limit-rows').textContent.includes('42%')"),true);
  await preferences.change({limitMode:'remaining'});
  await until("document.querySelector('#limit-rows progress')?.value === 58");
  assert.equal(await check("document.querySelector('#limit-rows').textContent.includes('58%')"),true);
  await preferences.change({limitMode:'used'});
  // Quota presentation must reach the actual sandboxed UI, including identity-based tabs.
  await preferences.change({language:'ko'});
  const quotaNow=Date.now();
  quotaResults=[
    {provider:'claude',accountID:'first',account:'동일한 이름',status:'available',block:{totalTokens:600000,tokensPerMinute:10000,startTime:quotaNow-3600000,endTime:quotaNow+13500000},windows:[{label:'5시간',usedPercent:50,resetsAt:quotaNow+13500000,spanSeconds:18000,forecastEligible:true},{label:'주간',usedPercent:40,resetsAt:quotaNow+302400000,spanSeconds:604800}]},
    {provider:'claude',accountID:'second',account:'동일한 이름',status:'available',block:{totalTokens:20000,tokensPerMinute:20000,startTime:quotaNow-60000,endTime:quotaNow+60000},windows:[{label:'5시간',usedPercent:20,resetsAt:quotaNow+60000,spanSeconds:18000,forecastEligible:true}]},
  ];
  main.webContents.send('usage:limits-updated',quotaResults);
  await until("document.querySelectorAll('.quota-pace-marker').length===2");
  assert.equal(await check("document.querySelector('.quota-forecast').dataset.warning"),'true');
  assert.equal(await check("document.querySelector('#limit-rows li').dataset.gauge"),'4');
  assert.equal(await check("document.querySelector('#limit-rows li').title.includes('빠름')"),true);
  const usedMarker=await check("parseFloat(document.querySelector('.quota-pace-marker').style.left)");
  assert.ok(Math.abs(usedMarker-25)<.1);
  await check("document.querySelector('.official-limits').scrollIntoView({block:'end',behavior:'instant'})");
  await check("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await snap('quota-used');
  // Check rendered fill pixels: a pre-existing ID selector once overrode the tier color.
  const meterPixel=await check("(()=>{const r=document.querySelector('#limit-rows progress').getBoundingClientRect();return{x:Math.floor(r.left+10),y:Math.floor(r.top+r.height/2),width:1,height:1};})()");
  await new Promise(resolve=>setTimeout(resolve,300));
  const meterBounds=await check("(()=>{const r=document.querySelector('#limit-rows progress').getBoundingClientRect();return{x:Math.round(r.left+10),y:Math.round(r.top+1),width:3,height:4};})()");
  const capturedMeter=await main.webContents.capturePage(meterBounds),bitmap=capturedMeter.toBitmap();
  const target=[54,140,220,255];let fillPixel=bitmap.subarray(0,4);for(let offset=0;offset<bitmap.length;offset+=4)if(target.every((v,i)=>bitmap[offset+i]===v)){fillPixel=bitmap.subarray(offset,offset+4);break;}
  assert.deepEqual([...fillPixel.subarray(0,4)],[54,140,220,255],'fast gauge must render orange, including CSS cascade');
  await preferences.change({limitMode:'remaining'});
  await until("parseFloat(document.querySelector('.quota-pace-marker').style.left)>70");
  const remainingMarker=await check("parseFloat(document.querySelector('.quota-pace-marker').style.left)");
  assert.ok(Math.abs(remainingMarker+usedMarker-100)<.1);
  await snap('quota-remaining');
  await check("document.querySelectorAll('#limit-accounts button')[1].click()");
  await until("document.querySelector('#limit-rows progress').value===80");
  assert.equal(await check("document.querySelectorAll('.quota-pace-marker').length"),1);
  assert.equal(await check("document.querySelector('.quota-forecast').dataset.warning"),'false');
  await snap('quota-second-account');
  for(const language of ['ko','en','ja','es','fr','pt','de','ru']){
    await preferences.change({language});
    await until('document.documentElement.lang==='+JSON.stringify(language));
    assert.equal(await check("/[{}]/.test(document.querySelector('.quota-forecast').textContent + document.querySelector('#limit-rows li').title)"),false);
    for(const width of [360,490]){
      main.setContentSize(width,665);
      assert.equal(await check("[...document.querySelectorAll('#limit-rows li,#limit-accounts button')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().right<=innerWidth+1)"),true,language+' quota '+width);
    }
  }
  await preferences.change({language:'ko',theme:'dark'});
  await snap('quota-dark');
  await preferences.change({theme:'light'});
  // Low burn, absent spans, and expired windows suppress unsupported predictions/markers.
  quotaResults[1].block.tokensPerMinute=9999;
  quotaResults[1].windows[0].resetsAt=Date.now()-1000;
  main.webContents.send('usage:limits-updated',quotaResults);
  await until("document.querySelector('.quota-forecast')===null && document.querySelector('.quota-pace-marker')===null");
  quotaResults=[{provider:'claude',status:'available',windows:[{label:'5시간',usedPercent:42,resetsAt:Date.now()+7200000}]}];
  main.webContents.send('usage:limits-updated',quotaResults);
  await preferences.change({limitMode:'used'});
  await until("document.querySelector('#limit-rows progress').value===42");
  await check("document.querySelector('#pane-home').scrollTop=0");
  // Existing DOM updates and translated templates survive switching back to Korean.
  await preferences.change({ language: 'en', petEnabled: true, petAgentActivity: true, animationQuality: 'smooth' });
  await until("document.documentElement.lang === 'en'");
  assert.equal(await check("window.i18n.t('최대 13.3M')"), 'Peak 13.3M');
  assert.equal(await check("window.i18n.t('도감에서 Pikachu 보기')"), 'View Pikachu in Pokédex');
  await until("document.querySelector('[data-setting=animationQuality]').value === 'smooth'", settings);
  publishUpdate({state:'available',version:'9.9.9',delivery:'browser'});await until("!document.querySelector('#update-banner').hidden");
  await check("document.querySelector('#update-banner .primary').click()");await until("document.querySelector('#update-banner').textContent.includes('Run the installer')");assert.equal(updateDownloads,1);
  await check("document.querySelector('#desktop-update').click()",settings);await until("document.querySelector('#desktop-update-status').textContent.includes('Run the installer')",settings);assert.equal(updateDownloads,2);
  await check("document.querySelector('#update-banner button').click()");await until("document.querySelector('#update-banner').hidden");assert.equal(preferences.get().skippedUpdateVersion,'9.9.9');
  await until("!document.querySelector('#desktop-update-skip').hidden",settings);await check("document.querySelector('#desktop-update-skip').click()",settings);await until("!document.querySelector('#update-banner').hidden");
  publishUpdate({state:'current',version:'1.0.0'});
  // Test the actual control's IPC route, rather than only writing the store.
  await check("(() => { const s = document.querySelector('[data-setting=animationQuality]'); s.value='balanced'; s.dispatchEvent(new Event('change')); })()", settings);
  await until("window.appPreferences.animationQuality === 'balanced'");
  controller.accept('poketokenbar://agent?state=working&label=Codex');
  await until("document.querySelector('.egg').classList.contains('working')", pet);
  pet.webContents.send('system:power-saver',true);await until("!document.querySelector('.egg').classList.contains('working')",pet);pet.webContents.send('system:power-saver',false);await until("document.querySelector('.egg').classList.contains('working')",pet);
  controller.accept('poketokenbar://agent?state=waiting&label=Claude&message=hello%20%3Cscript%3E');
  await until("document.querySelector('output').textContent.includes('hello <script>')", pet);
  assert.equal(await check("document.querySelector('output script') === null", pet), true);
  controller.accept('poketokenbar://agent?state=done&label=Codex');
  await until("document.querySelector('output').textContent.includes('finished')", pet);
  await check('window.pet.dismissAgent()', pet);
  await until("document.querySelector('output').hidden", pet);
  await preferences.change({ animated: false });
  controller.accept('poketokenbar://agent?state=working&label=Codex');
  await until("!document.querySelector('.egg').classList.contains('working')", pet);
  await preferences.change({ petAgentActivity: false });
  controller.accept('poketokenbar://agent?state=waiting&message=should-not-show');
  assert.equal(await check("document.querySelector('output').hidden", pet), true);
  await preferences.change({ statusChecks: false });
  await until("document.querySelector('#provider-status-banner').hidden");
  await preferences.change({ animated: true, animationQuality: 'smooth' });
  // Insert a real animated sprite while hidden; ImageDecoder is exercised without showing a window.
  await check("(() => { const box=document.createElement('span'); box.className='pokemon-art'; const img=document.createElement('img'); img.src='https://raw.githubusercontent.com/test.gif'; box.append(img); document.body.append(box); })()");
  await until("document.querySelector('.sprite-canvas') !== null");
  const restored = new SettingsStore(join(directory, 'settings-v1.json')); await restored.load();
  assert.equal(restored.get().language, 'en'); assert.equal(restored.get().animationQuality, 'smooth');
  assert.throws(() => restored.change({ language: 'xx' }));
  assert.throws(() => restored.change({ animationQuality: 'ultra' }));
  assert.equal(restored.get().statusChecks, false); assert.equal(restored.get().petAgentActivity, false);
  pet.webContents.send('pet:notice',{title:'Limit warning',body:'Fixture limit',priority:3});await until("document.querySelector('output').textContent.includes('Fixture limit')",pet);await check("document.querySelector('output').click()",pet);await until("document.querySelector('output').hidden",pet);
  await check("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerenter'));for(const x of [10,50,10,50,10])document.querySelector('.egg').dispatchEvent(new PointerEvent('pointermove',{clientX:x}));",pet);await until("document.querySelector('output').dataset.kind==='heart'&&document.querySelector('output canvas').width===34",pet);await check("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerleave'));document.querySelector('output').click()",pet);
  await check("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerenter'))",pet);await until("document.querySelector('output').textContent.includes('Today 100')",pet);await check("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerleave'))",pet);
  retryUntil=Date.now()+500;
  await check("(()=>{const box=document.createElement('span');box.className='pokemon-art';box.id='retry-fixture';const img=document.createElement('img');img.dataset.staticSrc='https://raw.githubusercontent.com/fallback.png';img.src='https://raw.githubusercontent.com/retry.gif';box.append(img);document.body.append(box);})()");
  await until("document.querySelector('#retry-fixture img').src.endsWith('/fallback.png')");await until("document.querySelector('#retry-fixture img').src.endsWith('/retry.gif') && document.querySelector('#retry-fixture img').classList.contains('sprite-decoded')");await check("document.querySelector('#retry-fixture').remove()");
  await check("document.querySelector('[data-support=log]').click()",settings);assert.deepEqual(supportActions,['log']);
  await check("document.querySelector('#tab-battle').click()");await until("document.querySelector('#battle-panel .battle-preset-controls')!==null");await check("document.querySelector('#battle-panel .battle-preset-controls button:last-child').click()");assert.equal(await check("Boolean(document.querySelector('.battle-presets-popup[open]'))"),true);await check("document.querySelector('.battle-presets-popup .battle-confirm-actions button').click();document.querySelector('#tab-collection').click()");
  // Render capture chains and species metadata without touching the real companion save.
  await preferences.change({ language: 'ko' });
  const route = [{ number:1, name:'이상해씨', type:'풀' }, { number:2, name:'이상해풀', type:'풀' }, { number:3, name:'이상해꽃', type:'풀' }];
  const captured = { id:'chain', hatchedAt:1, graduatedAt:2, species:route, rarity:'common', nature:'고집', shiny:true, level:50, gender:'female', ivs:{ hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31 }, ability:'overgrow', moves:['tackle','vine-whip'] };
  const released = { ...captured, id:'released', species:[route[0]], releasedAt:3 };
  const collection = { ...state, collection:route, captures:[captured,released] };
  await check('window.renderCompanionTabs(' + JSON.stringify(collection) + ')');
  await check("document.querySelector('#tab-collection').click(); document.querySelector('#log-mode').click()");
  await until("document.querySelectorAll('.capture-stage').length === 4");
  assert.deepEqual(await check("[...document.querySelectorAll('.capture-card')].find(card => card.querySelectorAll('.capture-stage').length===3).querySelectorAll('.capture-stage').length"),3);
  assert.equal(await check("[...document.querySelectorAll('.capture-stage img')].every(img => !img.src.endsWith('.gif'))"),true);
  main.setContentSize(360,665);
  assert.equal(await check("[...document.querySelectorAll('.capture-card')].every(card => card.scrollWidth <= card.clientWidth)"),true);
  await check("[...document.querySelectorAll('.capture-card')].find(card => card.querySelectorAll('.capture-stage').length===3).querySelectorAll('.capture-stage')[2].click()");
  await until("document.querySelectorAll('#dex-detail .individual-stats .detail-stat-row').length === 6");
  assert.equal(await check("document.querySelectorAll('#dex-detail .individual-stats .detail-stat-row').length"),6);
  assert.equal(await check("document.querySelectorAll('#dex-detail .detail-abilities > li').length"),2);
  assert.equal(await check("document.querySelectorAll('#dex-detail .complete-moves .detail-move-row').length"),3);
  assert.equal(await check("document.querySelectorAll('#dex-detail .known-moves .move-picker').length"),3);
  assert.equal(await check("document.querySelector('#dex-detail .detail-identity h2').textContent"),'이상해꽃');
  assert.equal(await check("Boolean(document.querySelector('#pokemon-ability'))"),true);
  await check("document.querySelector('#pokemon-mega-info').click()");
  assert.equal(await check("document.querySelector('.pokemon-mega-dialog[open] .detail-stat-row')!==null"),true);
  await check("document.querySelector('.pokemon-mega-dialog').close()");
  assert.equal(await check("document.querySelector('#dex-detail .base-stats') === null"),true);
  assert.equal(await check("document.querySelector('#dex-detail .individual-stats').textContent.includes('120')"),true);
  // Visible layouts must contain their controls at supported widths and long locales.
  for (const width of [360,490,600]) {
    main.setContentSize(width,740); settings.setContentSize(Math.max(400,width),740);
    for (const language of ['ko','de','ru']) {
      await preferences.change({ language });
      await until(`document.documentElement.lang === '${language}'`);
      await until("document.querySelectorAll('#dex-detail .individual-stats .detail-stat-row').length === 6");
      for (const window of [main,settings]) {
        const overflow = await check(`(() => {
          const visible = element => element.getClientRects().length;
          const failures = [];
          for (const element of document.querySelectorAll('select, .surface, .pokemon-detail-card, .capture-card, .settings-group, .collection-filters, .app-tabs')) {
            if (!visible(element)) continue;
            if (element.scrollWidth > element.clientWidth + 1) failures.push(element.tagName + '#' + element.id + '.' + element.className);
            if (element.matches('select')) {
              const bounds=element.getBoundingClientRect(), parent=element.parentElement.getBoundingClientRect();
              const style=getComputedStyle(element);
              if (bounds.left < parent.left-1 || bounds.right > parent.right+1) failures.push('select outside parent: '+element.id);
              if (style.appearance !== 'none' || !style.backgroundImage.includes('chevron.svg') || parseFloat(style.paddingRight)<30) failures.push('uncontained chevron: '+element.id);
            }
          }
          if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('document width');
          return failures;
        })()`,window);
        assert.deepEqual(overflow,[],`Overflow at ${width}px / ${language}`);
      }
      assert.equal(await check("document.querySelector('#dex-detail .base-stats') === null"),true);
      const meter = await check(`(() => {
        const stats=document.querySelector('.detail-stat-row progress'), home=document.querySelector('#growth');
        const statStyle=getComputedStyle(stats), homeStyle=getComputedStyle(home);
        return { sameColor:getComputedStyle(stats,'::-webkit-progress-value').backgroundColor === getComputedStyle(home,'::-webkit-progress-value').backgroundColor,
          sameTrack:statStyle.backgroundColor === homeStyle.backgroundColor, radius:parseFloat(statStyle.borderRadius), appearance:statStyle.appearance };
      })()`);
      assert.equal(meter.sameColor,true); assert.equal(meter.sameTrack,true); assert.ok(meter.radius>=7); assert.equal(meter.appearance,'none');
    }
  }
  await preferences.change({ language:'ko' });
  await until("document.querySelectorAll('#dex-detail .individual-stats .detail-stat-row').length === 6");
  await check("document.querySelector('#dex-detail .evolution-line button').click()");
  await until("document.querySelector('#dex-detail .detail-loading')?.textContent.includes('못했')");
  await check("[...document.querySelectorAll('#dex-detail button')].find(button => button.textContent==='다시 시도').click()");
  await until("document.querySelectorAll('#dex-detail .individual-stats .detail-stat-row').length === 6");
  // Selecting another captured individual keeps its own profile; old network responses do not reopen details.
  await check("(() => { const select=document.querySelector('#dex-detail > select'); select.value='released'; select.dispatchEvent(new Event('change')); })()");
  assert.equal(await check("document.querySelector('#dex-detail > select').value"),'released');
  await check("document.querySelector('#dex-detail > select').value='chain'; document.querySelector('#dex-detail > select').dispatchEvent(new Event('change')); document.querySelectorAll('#dex-detail .evolution-line button')[1].click()");
  await until("document.querySelector('#dex-detail .detail-loading') !== null");
  await check("document.querySelector('#dex-detail > button').click()");
  delayDetail();
  await until("document.querySelector('#collection-list').hidden === false");
  assert.equal(await check("document.querySelector('#dex-detail').hidden"),true);
  const unown={number:201,name:'안농',type:'에스퍼'},forms=['b','c'].map(form=>({...captured,id:'unown-'+form,species:[{...unown,form}],form}));
  await check('window.renderCompanionTabs('+JSON.stringify({...collection,collection:[unown],captures:forms})+')');
  await check("document.querySelector('.capture-stage').click()");
  await until("document.querySelectorAll('.detail-form-grid button').length===28");
  assert.equal(await check("document.querySelectorAll('.detail-form-grid button:disabled').length"),26);
  await check("document.querySelector('.detail-form-grid [data-form=c]').click()");
  assert.equal(await check("document.querySelector('.detail-form-grid [data-form=c]').getAttribute('aria-pressed')"),'true');
  await check('window.renderCompanionTabs('+JSON.stringify(collection)+')');
  const pageSpecies=Array.from({length:20},(_,i)=>speciesFor(i+1)),pageCaptures=pageSpecies.map(p=>({...captured,id:'page-'+p.number,shiny:false,species:[p],championAchievedAt:p.number===1?Date.now():undefined}));
  await check('window.renderCompanionTabs('+JSON.stringify({...collection,collection:pageSpecies,captures:pageCaptures})+')');await check("document.querySelector('#dex-mode').click()");assert.equal(await check("document.querySelectorAll('.dex-card .champion-badge').length"),1);
  await check("document.querySelector('#collection-list').dispatchEvent(new WheelEvent('wheel',{deltaY:40,cancelable:true}))");assert.equal(await check("document.querySelector('#dex-page').textContent"),'2 / 2');
  await check("document.querySelector('#dex-search').value='Bulbizarre';document.querySelector('#dex-search').dispatchEvent(new Event('input'))");assert.equal(await check("document.querySelectorAll('.dex-card').length>0"),true);await check("document.querySelector('#dex-search').value='';document.querySelector('#dex-search').dispatchEvent(new Event('input'))");
  // Apply the same containment requirement to every non-battle main tab.
  for (const width of [360,490]) {
    main.setContentSize(width,740);
    for (const language of ['ko','de','ru']) {
      await preferences.change({ language });
      await until(`document.documentElement.lang === '${language}'`);
      for (const tab of ['home','shop','bag','collection','trade']) {
        await check(`document.querySelector('#tab-${tab}').click()`);
        const failures = await check(`(() => {
          const nodes=[...document.querySelectorAll('select, .surface, .item-heading, .item-actions, .capture-card, .app-tabs')].filter(node=>node.getClientRects().length);
          const failures=nodes.filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>node.tagName+'#'+node.id+'.'+node.className);
          for (const node of nodes.filter(node=>node.matches('select'))) {
            const box=node.getBoundingClientRect(), parent=node.parentElement.getBoundingClientRect();
            if (box.left<parent.left-1 || box.right>parent.right+1) failures.push('select outside: '+node.id);
          }
          if(document.documentElement.scrollWidth>innerWidth+1) failures.push('document width');
          return failures;
        })()`);
        assert.deepEqual(failures,[],`${tab} overflow at ${width}px / ${language}`);
      }
    }
  }
  // Exercise actual purchase/use IPC, the canonical item order and the standalone Maple window.
  await preferences.change({language:'ko'});
  const now=Date.now(), ivs={hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31};
  const profile={instanceID:'commerce',seed:'123',ivs,level:5,growthTokens:0,abilityIsHidden:false,abilityName:'overgrow',moves:[{name:'tackle',learnedAtLevel:1}]};
  const imported=await companion.replaceImport({raised:12000000000,progress:0,inventory:{shinyCharm:0,redMaple:2,mint:3,rareCandy:4},
    active:{id:'commerce',family:-1,stage:0,route:[1,2,3].map(id=>speciesFor(id)),hatchedAt:now,nature:'노력',shiny:false,repeat:false,rarity:'rare',level:5,macProfile:profile},
    graduated:[{id:'maple-target',family:-1,stage:2,route:[1,2,3].map(id=>speciesFor(id)),hatchedAt:now-1000,graduatedAt:now,nature:'조심',shiny:false,repeat:false,rarity:'common',level:50,macProfile:{...profile,instanceID:'maple-target',level:50}}]},now);
  notifyState(imported.companion);
  await checkHomeUI(main,preferences,snapshot,snap);
  await checkHeldItemPicker(main,preferences,[360,490]);
  await check("document.querySelector('#tab-collection').click();if(!document.querySelector('.capture-card'))document.querySelector('#log-mode').click()");
  await until("document.querySelector('.capture-card')");
  await check("[...document.querySelectorAll('.capture-card')].find(card=>card.querySelectorAll('.capture-stage').length===3).querySelectorAll('.capture-stage')[2].click()");
  await until("document.querySelector('#collection-default-battle-item')");
  await check("document.querySelector('#collection-default-battle-item').click();document.querySelector('.battle-item-popup[open] [data-item=leftovers]').click();document.querySelector('.battle-item-popup[open] #battle-item-apply').click()");
  await until("!document.querySelector('.battle-item-popup')");
  assert.equal((await companion.read()).captures.find(p=>p.id==='maple-target').battleDefaultItem,'leftovers');
  await check("document.querySelector('#collection-default-battle-item').click()");
  assert.equal(await check("document.querySelector('#battle-item-apply').disabled"),true);
  await check("document.querySelector('.battle-item-popup .battle-confirm-actions button').click()");
  await snap('collection-default-item');
  main.setContentSize(490,665);
  await check("document.querySelector('#tab-home').click()");await snap('home');
  await check("document.querySelector('#tab-shop').click()");
  await until("document.querySelectorAll('[data-product]').length === 7");
  assert.deepEqual(await check("[...document.querySelectorAll('[data-product]')].map(node=>node.dataset.product)"),['mint','redMaple','rareCandy','egg','eggUncommon','shinyCharm','eggRare']);
  await until("document.querySelector('[data-product=rareCandy] .item-icon img').complete");
  assert.equal(await check("document.querySelector('[data-product=rareCandy] .item-icon img').src.endsWith('/assets/items/rare-candy.png')"),true);
  assert.equal(await check("document.querySelector('[data-product=eggUncommon] .rarity-badge').textContent"),'고급');
  assert.deepEqual(await check("['egg','eggUncommon','eggRare'].map(key=>{const card=document.querySelector('[data-product='+key+']');return [card.querySelector('.item-icon img').getAttribute('src'),card.querySelector('.rarity-badge')?.dataset.rarity ?? null]})"),[['assets/items/egg.png',null],['assets/items/egg.png','uncommon'],['assets/items/egg.png','rare']]);
  await snap('shop');
  const balance=state.economy.wallet;
  await check("(() => { const card=document.querySelector('[data-product=rareCandy]'); const input=card.querySelector('input'); input.value='2';input.dispatchEvent(new Event('input'));card.querySelector('.item-actions button').click(); })()");
  assert.equal(await check("document.querySelector('[data-product=rareCandy] .item-preview').textContent.includes('×2')"),true);
  await check("document.querySelector('[data-product=rareCandy] .item-actions button').click()");
  await until("document.querySelector('[data-product=rareCandy] .item-owned').textContent.includes('6')");
  assert.equal(state.economy.wallet,balance-1000000000);assert.equal(state.economy.inventory.rareCandy,6);
  await check("document.querySelector('[data-product=shinyCharm] .item-actions button').click();document.querySelector('[data-product=shinyCharm] .item-actions button').click()");
  await until("document.querySelector('[data-product=shinyCharm] .passive-owned') !== null");
  assert.equal(await check("[...document.querySelectorAll('[data-product]')].at(-1).dataset.product"),'shinyCharm');
  assert.equal(await check("document.querySelector('[data-product=shinyCharm] button') === null"),true);
  await check("document.querySelector('#tab-bag').click()");
  assert.deepEqual(await check("[...document.querySelectorAll('#bag-items > [data-item]')].map(node=>node.dataset.item)"),['rareCandy','mint','redMaple','shinyCharm']);
  assert.equal(await check("document.querySelector('[data-item=shinyCharm] .item-owned') === null"),true);
  assert.deepEqual(await check("[...document.querySelectorAll('#bag-items .item-actions button:not([hidden])')].map(button=>button.textContent)"),['사용','사용','사용']);
  await snap('bag');
  await check("document.querySelector('[data-item=rareCandy] .item-actions button').click();document.querySelector('[data-item=rareCandy] .item-actions button').click()");
  await until("document.querySelector('#tab-home').getAttribute('aria-selected') === 'true'");
  assert.equal(state.economy.inventory.rareCandy,5);
  assert.equal(await check("document.querySelector('.home-feedback.candy').textContent"),'+100M XP');
  await check("document.querySelector('#tab-bag').click();document.querySelector('[data-item=mint] .item-actions button').click();document.querySelector('[data-item=mint] .item-actions button').click()");
  await until("document.querySelector('#partner-art').classList.contains('mint-feedback')");
  assert.equal(state.economy.inventory.mint,2);assert.notEqual(state.active.nature,'노력');
  // Maple applies from a real isolated window using its own sandboxed preload.
  await check('window.usage.openMaple()');
  const maple=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('/maple.html'));
  assert.ok(maple);await until("document.querySelector('.maple-target') !== null",maple);
  await check("document.querySelector('.maple-target').click();document.querySelector('#maple-apply').click()",maple);
  await until("document.querySelector('#maple-count').textContent === '×1'",maple);
  assert.equal(state.economy.inventory.redMaple,1);assert.equal(maple.isVisible(),false);
  await snap('red-maple',maple);
  const savedState=state;
  const gridSpecies=Array.from({length:16},(_,i)=>speciesFor(i+1));
  const gallery={...state,current:gridSpecies[0],collection:gridSpecies,captures:gridSpecies.map((species,i)=>({id:'grid-'+i,hatchedAt:now,graduatedAt:now,nature:'노력',shiny:i===5,rarity:['common','uncommon','rare','legendary'][i%4],species:[species]})),economy:{...state.economy,representative:{speciesID:6}}};
  await check('window.renderCompanionTabs('+JSON.stringify(gallery)+')');
  await check("document.querySelector('#tab-collection').click();document.querySelector('#dex-mode').click();document.querySelector('#dex-reset').click()");
  await until("document.querySelectorAll('.dex-card').length === 16");
  for(const width of [360,490]){
    main.setContentSize(width,665);
    assert.deepEqual(await check("[...document.querySelectorAll('.dex-card')].filter(node=>node.scrollHeight>node.clientHeight+1 || node.scrollWidth>node.clientWidth+1).map(node=>node.textContent)"),[],'4x4 card containment '+width);
  }
  assert.equal(await check("document.querySelectorAll('.dex-card.representative').length"),1);
  assert.equal(await check("document.querySelectorAll('.dex-raising').length"),1);
  await snap('collection');
  await check("document.querySelector('#log-mode').click()");await snap('capture-log');
  await check('window.renderCompanionTabs('+JSON.stringify(savedState)+')');
  await check("document.querySelector('#tab-shop').click();document.querySelector('[data-product=egg] .item-actions button').click();document.querySelector('[data-product=egg] .item-actions button').click()");
  await until("document.querySelector('#tab-home').getAttribute('aria-selected') === 'true' && document.querySelector('#companion-title').textContent === '알'");
  assert.equal(state.active,null); // a rare, non-shiny companion uses the ordinary confirmation, just like Mac.
  await check("document.querySelector('#tab-shop').click()");
  assert.equal(await check("document.querySelectorAll('[data-product^=egg] .item-actions button:disabled').length"),3);
  // Real stored moves: deferred defaults, immediate replacement, four slots and reload.
  loadoutFixture=true;await companion.enrichMoves(detailsFor(1));
  const moveProfile={...profile,instanceID:'move-owner',level:50,moves:[]};
  const owner={id:'move-owner',family:-1,stage:0,route:[speciesFor(1)],hatchedAt:now,nature:'명랑',rarity:'common',shiny:false,repeat:false,level:50,macProfile:moveProfile};
  state=(await companion.replaceImport({raised:123,progress:42,active:owner,graduated:[{...owner,id:'move-released',graduatedAt:now,releasedAt:now,macProfile:{...moveProfile,instanceID:'move-released',hasCustomMoves:true,moves:[{name:'tackle',learnedAtLevel:1}]}}]},now)).companion;
  snapshot.companion=state;await preferences.change({language:'ko'});await new Promise(resolve=>{main.webContents.once('did-finish-load',resolve);main.reload();});
  await until("document.querySelector('#partner-art button') !== null");
  await check("document.querySelector('#partner-art button').click()");
  await until("document.querySelectorAll('.known-moves .move-picker').length === 4");
  assert.deepEqual((await companion.read()).active.moves,['growl','tackle','vine-whip']);
  await check("document.querySelector('.known-moves .move-picker[data-slot=\"0\"]').click()");
  assert.equal(await check("document.querySelector('.move-option[data-move=hyper-beam]') !== null"),false);
  await check("document.querySelector('.move-option[data-move=toxic]').click()");
  await until("document.querySelector('.known-moves .move-picker[data-slot=\"0\"]').value === 'toxic' && !document.querySelector('.known-moves .move-picker').disabled");
  assert.deepEqual((await companion.read()).active.moves,['toxic','tackle','vine-whip']);
  await check("document.querySelector('.known-moves .move-picker[data-slot=\"1\"]').click()");
  assert.equal(await check("document.querySelector('.move-option[data-move=toxic]').getAttribute('aria-disabled')"),'true');
  await check("document.querySelector('.move-option[data-move=toxic]').click()");
  assert.deepEqual((await companion.read()).active.moves,['toxic','tackle','vine-whip']);
  await check("window.moveUI.close();document.querySelector('.known-moves .move-picker[data-slot=\"3\"]').click();document.querySelector('.move-option[data-move=charm]').click()");
  await until("document.querySelectorAll('.known-moves .move-picker').length===4 && document.querySelector('.known-moves .move-picker[data-slot=\"3\"]').value==='charm' && !document.querySelector('.known-moves .move-picker').disabled");
  assert.deepEqual((await new CompanionStore(join(directory,'companion-v1.json')).read()).active.moves,['toxic','tackle','vine-whip','charm']);
  await new Promise(resolve=>{main.webContents.once('did-finish-load',resolve);main.reload();});await until("document.querySelector('#partner-art button') !== null");await check("document.querySelector('#partner-art button').click()");
  await until("document.querySelector('.known-moves .move-picker[data-slot=\"3\"]')?.value === 'charm'");
  // The open menu is actual app DOM, so hover information also works on Windows.
  const firstMove='.known-moves .move-picker[data-slot="0"]';
  await check("document.querySelector('.known-moves').scrollIntoView({block:'center'})");
  await check(`document.querySelector('${firstMove}').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}))`);
  await until("document.querySelector('#pokemon-move-tooltip:popover-open') !== null");
  const closedTip=await check("document.querySelector('#pokemon-move-tooltip').textContent");
  for(const label of ['맹독','변화','위력','PP','90%','대상'])assert.ok(closedTip.includes(label),label);
  await snap('pokemon-move-tooltip');
  await check(`document.querySelector('${firstMove}').click();document.querySelector('.move-option[data-move=vine-whip]').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}))`);
  assert.equal(await check("document.querySelector('#move-menu-description .move-tooltip-title').textContent"),'덩굴채찍');
  assert.equal(await check("document.querySelector('.move-option[data-move=vine-whip]').getAttribute('aria-disabled')"),'true');
  const savedBeforeHover=(await companion.read()).active.moves;
  await check("document.querySelector('.move-option[data-move=vine-whip]').click()");
  assert.deepEqual((await companion.read()).active.moves,savedBeforeHover);
  await check("document.querySelector('.move-option[data-move=growl]').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}))");
  assert.equal(await check("document.querySelector('#move-menu-description .move-tooltip-title').textContent"),'울음소리');
  assert.match(await check("document.querySelector('#move-menu-description').textContent"),/상대 모두/);
  await snap('pokemon-move-menu');
  await check(`document.querySelector('${firstMove}').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await check("document.querySelector('#move-picker-menu:popover-open') === null"),true);
  assert.deepEqual((await companion.read()).active.moves,savedBeforeHover);
  await check(`document.querySelector('${firstMove}').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));document.querySelector('${firstMove}').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));document.querySelector('${firstMove}').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  const keyboardName=await check("document.querySelector('.move-option.highlighted').dataset.move");
  await check(`document.querySelector('${firstMove}').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(`document.querySelector('${firstMove}').value === ${JSON.stringify(keyboardName)} && !document.querySelector('${firstMove}').disabled`);
  assert.equal((await companion.read()).active.moves[0],keyboardName);
  if(keyboardName!=='toxic'){
    await check(`document.querySelector('${firstMove}').click();document.querySelector('.move-option[data-move=toxic]').click()`);
    await until(`document.querySelector('${firstMove}').value==='toxic' && !document.querySelector('${firstMove}').disabled`);
  }
  for(const language of ['en','ja','es','fr','pt','de','ru','ko']){
    await preferences.change({language});await until(`document.documentElement.lang === '${language}'`);
    await until("document.querySelectorAll('.known-moves .move-picker').length===4");
    for(const width of [360,490]){
      for(const height of [420,740]){
        main.setContentSize(width,height);await until(`innerWidth===${width} && innerHeight===${height}`);
        await check(`document.querySelector('${firstMove}').scrollIntoView({block:'center'});document.querySelector('${firstMove}').click()`);
        assert.equal(await check("document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.known-moves .move-picker,.pokemon-detail-card')].every(node=>node.scrollWidth<=node.clientWidth+1)"),true,language+' move picker '+width);
        const bounds=await check("(() => {const menu=document.querySelector('#move-picker-menu'),description=document.querySelector('#move-menu-description');const r=menu.getBoundingClientRect();return {open:menu.matches(':popover-open'),left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,description:[description.scrollWidth,description.clientWidth],rows:[...document.querySelectorAll('.move-option')].filter(row=>row.scrollWidth>row.clientWidth+1).map(row=>row.textContent)};})()");
        assert.ok(bounds.open && bounds.left>=7 && bounds.top>=7 && bounds.right<=bounds.width-7 && bounds.bottom<=bounds.height-7 && bounds.description[0]<=bounds.description[1]+1 && !bounds.rows.length,language+' popup bounds '+width+'x'+height+' '+JSON.stringify(bounds));
        await check("window.moveUI.close()");
      }
    }
  }
  // Near each viewport corner, long tooltips stay inside the viewport and scroll internally.
  const edgeOptions=[{value:'edge',title:'Long move '.repeat(20),tooltip:['Long move','Description '.repeat(180),'Type · Category · Power: 100 · PP: 10','Accuracy: 100%','Target: all'].join('\n')}];
  for(const corner of ['top','bottom']){
    await check(`(() => {const button=window.moveUI.picker({id:'edge-move',slot:9,selected:'edge',placeholder:'',accessibleLabel:'edge',options:${JSON.stringify(edgeOptions)}});button.style.cssText='position:fixed;z-index:999;right:8px;${corner}:8px;width:180px';document.body.append(button);button.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));})()`);
    await until("document.querySelector('#pokemon-move-tooltip:popover-open') !== null");
    assert.equal(await check("(() => {const tip=document.querySelector('#pokemon-move-tooltip');const r=tip.getBoundingClientRect();return r.left>=7 && r.top>=7 && r.right<=innerWidth-7 && r.bottom<=innerHeight-7 && tip.scrollWidth<=tip.clientWidth+1;})()"),true,'hover '+corner);
    await check("document.querySelector('#edge-move').click()");
    assert.equal(await check("(() => {const r=document.querySelector('#move-picker-menu').getBoundingClientRect();return r.left>=7 && r.top>=7 && r.right<=innerWidth-7 && r.bottom<=innerHeight-7;})()"),true,'menu '+corner);
    await check("document.querySelector('#edge-move').remove()");await until("document.querySelector('#move-picker-menu:popover-open') === null");
  }
  main.setContentSize(490,740);
  await check("document.querySelector('.known-moves').scrollIntoView({block:'center'})");
  await snap('pokemon-moves');
  await check("(() => {const picker=document.querySelector('select[aria-label=\"포획 개체와 형태\"]');picker.value='move-released';picker.dispatchEvent(new Event('change'));})()");
  assert.equal(await check("document.querySelectorAll('.known-moves .move-picker').length"),0);
  assert.equal(await check("document.querySelectorAll('.known-moves .detail-move-row').length"),1);

  maple.destroy();
  if(process.env.POKE_SETTINGS_SPACING_QA==='1'){
    await check("document.querySelector('#difficulty-growth').value='1.2';document.querySelector('#difficulty-shop').value='0.8';document.querySelector('#difficulty-save').click()",settings);
    await until("(async()=>{const c=await window.usage.companion();return c.economy.growthDifficulty===1.2&&c.economy.shopDifficulty===0.8&&!document.querySelector('#difficulty-save').disabled;})()",settings);
    await check("document.querySelector('#difficulty-growth').value='1';document.querySelector('#difficulty-shop').value='1';document.querySelector('#difficulty-save').click()",settings);
    await until("(async()=>{const c=await window.usage.companion();return c.economy.growthDifficulty===1&&c.economy.shopDifficulty===1&&!document.querySelector('#difficulty-save').disabled;})()",settings);
    await check("document.querySelectorAll('details').forEach(d=>d.open=true)",settings);
    for(const language of ['ko','en','ja','es','fr','pt','de','ru']){
      await preferences.change({language});await until('document.documentElement.lang==='+JSON.stringify(language),settings);
      for(const width of [360,490,650]){
        settings.setContentSize(width,740);
        const problems=await check(`(()=>{const issues=[];for(const select of document.querySelectorAll('select')){if(!select.getClientRects().length)continue;const r=select.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1)issues.push(select.id||select.dataset.setting);const label=select.parentElement;if(label.tagName==='LABEL'&&label.firstChild?.nodeType===Node.TEXT_NODE){const range=document.createRange();range.selectNodeContents(label.firstChild);const text=range.getBoundingClientRect();const gap=r.top>=text.bottom-1?r.top-text.bottom:r.left-text.right;if(gap<8)issues.push((select.id||select.dataset.setting)+' text gap '+gap);}}if(document.documentElement.scrollWidth>innerWidth)issues.push('page overflow');return issues;})()`,settings);
        assert.deepEqual(problems,[],language+' settings '+width);
        assert.equal(await check("(()=>{const f=document.querySelector('.settings-actions').getBoundingClientRect(),b=document.querySelector('#difficulty-save').getBoundingClientRect();return f.bottom<=innerHeight+1&&b.top>=0&&b.bottom<=innerHeight&&document.querySelector('#settings-current-version').textContent==='v1.0.0';})()",settings),true,language+' visible save/version '+width);
        if(language==='ko'&&width!==490){await check("document.querySelector('.settings-content').scrollTop=0",settings);await snap('settings-general-'+width,settings);await check("document.querySelector('#advanced-settings').scrollIntoView()",settings);await snap('settings-advanced-'+width,settings);publishUpdate({state:'available',version:'1.0.1',delivery:'browser'});await until("!document.querySelector('#update-banner').hidden",settings);await snap('settings-update-'+width,settings);publishUpdate({state:'current',version:'1.0.0',delivery:'browser'});}
      }
    }
    console.log('PASS: settings dropdown/text spacing and horizontal bounds in eight languages at 360/490/650px.');
  }
  for (const window of [main, settings, pet]) assert.equal(window.isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: hidden UI, 8 languages, settings reload, service banner, GIF/agent reactions, capture evolution, details, retry, rounded meters, four editable moves, open-menu tooltips, keyboard control, popup bounds and reload');
  success = true;
} catch (error) { console.error(error);console.error('Renderer errors:',errors);if(main && !main.isDestroyed())console.error(await check("({title:document.querySelector('#companion-title')?.textContent,art:document.querySelector('#partner-art')?.innerHTML,status:document.querySelector('#companion-status')?.textContent})")); }
finally {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  try { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  catch { /* Chromium may hold profile locks until exit, especially on Windows. OS temp cleanup owns this directory. */ }
  app.exit(success ? 0 : 1);
}

}
void run().catch(error => { console.error(error); app.exit(1); });
