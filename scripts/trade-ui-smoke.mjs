// Actual sandboxed trade renderer + production IPC against a second LAN session.
import {app,BrowserWindow,ipcMain,session} from 'electron';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CompanionStore} from '../dist/main/companion/store.js';
import {speciesFor} from '../dist/main/companion/catalog.js';
import {LanTrade} from '../dist/main/trade/session.js';
import {registerTradeIPC} from '../dist/main/trade/ipc.js';
import {SettingsStore,registerSettingsIPC} from '../dist/main/settings.js';
async function run(){
const directory=await mkdtemp(join(tmpdir(),'ptb-trade-ui-'));
app.setPath('userData',directory);app.on('window-all-closed',()=>{});
let main,trade,peer,success=false;const errors=[];
const check=code=>main.webContents.executeJavaScript(code);
async function until(predicate){for(let i=0;i<160;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Trade UI timed out: '+predicate);}
try{
  await app.whenReady();
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAFAAAALAAAAAABAAEAAAICRAEAIfkEAAUAAAAsAAAAAAEAAQAAAgJMAQA7','base64');
  session.defaultSession.protocol.handle('https',request=>process.env.POKE_UI_REAL_SPRITES==='1'?fetch(request.url):new Response(gif,{headers:{'content-type':'image/gif','access-control-allow-origin':'*'}}));
  const left=new CompanionStore(join(directory,'left.json')),right=new CompanionStore(join(directory,'right.json'));
  const mon=(id,number)=>({id,family:-1,stage:0,route:[speciesFor(number)],hatchedAt:42,nature:'명랑',rarity:'rare',shiny:true,repeat:false,level:25});
  await left.replaceImport({raised:12000000000,progress:123,inventory:{rareCandy:4},active:mon('left-active',1),graduated:[{...mon('left-dex',6),graduatedAt:1234}]},Date.now());
  await right.replaceImport({raised:500,progress:100,active:mon('right-active',25),graduated:[]},Date.now());
  const original=await readFile(join(directory,'left.json'),'utf8');
  const settings=new SettingsStore(join(directory,'settings.json'));await settings.load();await settings.change({language:'ko',animated:true});
  registerSettingsIPC(settings,()=>[main],async()=>{});
  ipcMain.handle('companion:read',()=>left.read());
  trade=registerTradeIPC(left,()=>main,value=>main.webContents.send('companion:updated',value));
  peer=new LanTrade(right,()=>{},()=>{});
  const source=await readFile('dist/renderer/index.html','utf8');
  const section=source.match(/<section id="trade-panel"[\s\S]*?(?=\s*<section role="tabpanel" id="pane-battle")/)[0];
  const asset=file=>pathToFileURL(resolve('dist/renderer',file)).href;
  const scripts=['locale-data.js','localization.js','token-format.js','species-names.js','sprite-timing.js','sprite-player.js','preferences.js','trade.js'];
  const html='<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="'+asset('style.css')+'">'+scripts.map(file=>'<script defer src="'+asset(file)+'"></script>').join('')+'</head><body><main>'+section+'</main></body></html>';
  const path=join(directory,'trade.html');await writeFile(path,html);
  main=new BrowserWindow({width:490,height:800,show:false,webPreferences:{preload:resolve('dist/main/usage-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  main.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  await main.loadFile(path);await until(()=>check("document.querySelector('#trade-panel').dataset.phase === 'idle'"));
  await check("document.querySelector('#trade-code').value='invalid';document.querySelector('#trade-connect').click()");
  await until(()=>check("document.querySelector('#trade-status').textContent.includes('IPv4')"));
  async function connect(){await check("document.querySelector('#trade-host').click()");await until(()=>trade.state().codes.length>0);peer.connect('127.0.0.1:'+trade.state().codes[0].split(':')[1],'Peer');await until(()=>trade.state().phase==='connected');await until(()=>check("document.querySelectorAll('.trade-choice').length === 2"));}
  await connect();
  assert.equal(await check("document.querySelector('.trade-choice').dataset.id"),'left-active');
  await check("document.querySelector('[data-id=left-dex]').click()");await peer.offer('right-active');
  await until(()=>check("!document.querySelector('#trade-accept').disabled"));
  assert.equal(await check("document.querySelector('#trade-warning').hidden"),false);
  assert.equal(await check("document.querySelectorAll('.trade-preview img').length"),2);
  
  for(const language of ['en','ja','es','fr','pt','de','ru','ko']){
    await settings.change({language});await until(()=>check('window.i18n.language === '+JSON.stringify(language)));
    for(const width of [360,490]){main.setSize(width,800);await new Promise(resolve=>setTimeout(resolve,35));
      assert.equal(await check("document.documentElement.scrollWidth <= innerWidth"),true,language+' '+width);
      assert.deepEqual(await check("[...document.querySelectorAll('#trade-panel button,#trade-panel input,.trade-preview,.trade-mon-info')].filter(node=>node.getClientRects().length && node.scrollWidth>node.clientWidth+1).map(node=>node.id || node.className)"),[],language+' '+width);
    }
  }
  await check("document.querySelector('#trade-accept').click()");await until(()=>trade.state().accepted);
  peer.withdraw();await until(()=>!trade.state().accepted && !trade.state().theirItem);
  assert.equal(await check("document.querySelector('#trade-accept').disabled"),true);
  assert.equal(await check("document.querySelector('#trade-backup-panel').hidden"),true);
  await peer.offer('right-active');await until(()=>trade.state().canAccept);
  await check("document.querySelector('#trade-repick').click()");await until(()=>!trade.state().mineItem);
  await until(()=>check("!document.querySelector('#trade-picker').hidden"));
  await check("document.querySelector('[data-id=left-dex]').click()");await until(()=>trade.state().canAccept);
  if(process.env.POKE_TRADE_SCREENSHOTS){await mkdir(process.env.POKE_TRADE_SCREENSHOTS,{recursive:true});await until(()=>check("[...document.querySelectorAll('.trade-preview img')].every(img=>img.complete && img.naturalWidth>0)"));await new Promise(resolve=>setTimeout(resolve,150));await writeFile(join(process.env.POKE_TRADE_SCREENSHOTS,'trade-review.png'),(await main.webContents.capturePage()).toPNG());}
  await check("document.querySelector('#trade-reject').click()");await until(()=>trade.state().phase==='closed' && peer.state().phase==='closed');
  assert.equal(await readFile(join(directory,'left.json'),'utf8'),original);
  await connect();await check("document.querySelector('[data-id=left-dex]').click()");await peer.offer('right-active');await until(()=>trade.state().canAccept);
  await check("document.querySelector('#trade-accept').click()");await until(()=>trade.state().accepted);await peer.accept();
  await until(()=>trade.state().phase==='complete' && peer.state().phase==='complete');
  await until(()=>check("document.querySelector('#trade-panel').dataset.phase === 'complete'"));
  assert.equal((await new CompanionStore(join(directory,'left.json')).read()).active.id,'right-active');
  assert.equal(await readFile(trade.state().backupPath,'utf8'),original);
  assert.equal(await check("document.querySelector('#trade-backup-panel').hidden"),false);
  await check("document.querySelector('#trade-close').click()");await until(()=>check("document.querySelector('#trade-panel').dataset.phase === 'idle'"));
  await check("document.querySelector('#trade-host').click()");await until(()=>trade.state().phase==='waiting');
  await check("window.dispatchEvent(new CustomEvent('app-tab-changed',{detail:{previous:'trade',current:'home'}}))");await until(()=>trade.state().phase==='closed');
  assert.deepEqual(errors,[]);assert.equal(main.isVisible(),false);success=true;
  console.log('PASS: trade renderer/IPC, LAN offers, 8 languages at 360/490px, warning, withdraw, repick, reject, bilateral commit, exact backup, reload and tab cancellation');
} catch(error){console.error(error);} finally{
  trade?.close();peer?.close();main?.destroy();
  try{await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  catch{ /* Chromium profile locks can outlive the hidden window, especially on Windows. OS temp cleanup owns this test directory. */ }
  app.exit(success?0:1);
}

}
void run().catch(error=>{console.error(error);app.exit(1);});
