// Exercise production usage IPC and OS-notification routing against an isolated home/save.
import{app,BrowserWindow,ipcMain,Notification}from'electron';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{SettingsStore,registerSettingsIPC}from'../dist/main/settings.js';import{registerUsageIPC}from'../dist/main/usage/ipc.js';import{CompanionStore}from'../dist/main/companion/store.js';
async function run(){
app.on('window-all-closed',()=>{});const root=await mkdtemp(join(tmpdir(),'ptb-state-ui-'));app.setPath('userData',root);process.env.USERPROFILE=root;process.env.CLAUDE_CONFIG_DIR='';let main,pet,finish;const notices=[],petNotices=[];const originalFetch=globalThis.fetch;const originalShow=Notification.prototype.show;Notification.prototype.show=function(){notices.push({title:this.title,body:this.body});};
const timedUsage=process.env.POKE_TIMED_USAGE_SMOKE==='1';
setTimeout(()=>{console.error('State IPC smoke deadline');app.exit(1);},timedUsage?85000:45000).unref();
try{await app.whenReady();console.log('State fixture ready');
 const settingsPath=join(root,'settings.json');
 await writeFile(settingsPath,JSON.stringify({providers:['claude','gemini','gemini-takeout'],language:'en'}));
 const prefs=new SettingsStore(settingsPath);await prefs.load();
 assert.deepEqual(prefs.get().providers,['claude','gemini','gemini-takeout']);
 assert.equal(prefs.get().language,'en');
 await prefs.change({providers:['claude'],language:'en',statusChecks:false,refreshSeconds:0,updateNotifications:false,limitNotifications:false});
 console.log('Preferences ready');const store=new CompanionStore(join(root,'companion-v1.json'),()=>false);await store.replaceImport({raised:0,progress:4999999,active:null,graduated:[],pendingHatchID:1},Date.now());
 console.log('Save ready');finish=registerUsageIPC(()=>main,()=>pet,async()=>{},()=>undefined,prefs,()=>{},()=>{},()=>{});registerSettingsIPC(prefs,()=>[main],async()=>{await finish();await prefs.finishWrites();});
 console.log('IPC registered');main=new BrowserWindow({show:false,webPreferences:{preload:resolve('dist/main/usage-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});await main.loadURL('data:text/html,<title>Isolated IPC fixture</title>');console.log('Page loaded');const js=code=>main.webContents.executeJavaScript(code);await js('window.usage.refresh()');console.log('Baseline refreshed');
 const logs=join(root,'.claude','projects','fixture');await mkdir(logs,{recursive:true});const path=join(logs,'session.jsonl'),event=(id,total)=>JSON.stringify({type:'assistant',timestamp:new Date().toISOString(),message:{id,model:'claude-sonnet-4',usage:{input_tokens:total,output_tokens:0}}})+'\n';
 await writeFile(path,event('hatch',1));const snapshot=await js('window.usage.refresh()');assert.equal(snapshot.companion.current.number,1);assert.ok(notices.some(n=>n.title==='🥚 Hatched!'||/hatch/i.test(n.title)),JSON.stringify(notices));assert.equal(notices.find(n=>/hatch/i.test(n.title))?.body,'Bulbasaur');
 const count=notices.length;await js('window.usage.refresh()');assert.equal(notices.length,count);
 await prefs.change({companionNotifications:false});await writeFile(path,event('hatch',1)+event('evolve',500000000));await js('window.usage.refresh()');assert.equal(notices.length,count);
 const preview=await js('window.usage.scanRoots("claude",'+JSON.stringify(logs)+',true)');assert.equal(preview.count,1);assert.equal((await js('window.usage.refresh()')).usage.claude.today.total,500000001);
 await js('window.usage.limits()');
 pet=new BrowserWindow({show:false,webPreferences:{sandbox:true}});await pet.loadURL('data:text/html,<title>Pet IPC fixture</title>');const originalSend=pet.webContents.send.bind(pet.webContents);pet.webContents.send=(channel,...args)=>{if(channel==='pet:notice')petNotices.push(args[0]);originalSend(channel,...args);};
 await writeFile(join(root,'.claude','.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'fixture-only-not-a-real-token',expiresAt:Date.now()+60000}}));globalThis.fetch=async url=>{assert.equal(String(url),'https://api.anthropic.com/api/oauth/usage');return Response.json({five_hour:{utilization:90,resets_at:new Date(Date.now()+7200000).toISOString()}});};
 await prefs.change({limitNotifications:true});const limits=await js('window.usage.limits()');assert.equal(limits[0].windows[0].usedPercent,90);assert.ok(petNotices.some(n=>n.priority===3&&n.body.includes('90% used')),JSON.stringify(petNotices));const warned=notices.length;await js('window.usage.limits()');assert.equal(notices.length,warned);assert.equal(petNotices.filter(n=>n.priority===3).length,1);
 console.log('PASS: real official-limit fetch → deduplicated OS warning and prioritized, localized pet bubble.');
 console.log('PASS: production usage IPC, real log-driven hatch notification with localized species, disabled-notice guard, deduplication and scan-root persistence.');
 const chatExports=join(root,'chat-exports');
 await mkdir(chatExports);
 const time=new Date();
 await writeFile(join(chatExports,'conversations.json'),JSON.stringify([
   {chat_messages:[{uuid:'claude-chat-fixture',sender:'human',created_at:time.toISOString(),text:'12345678'}]},
   {mapping:{answer:{message:{id:'chatgpt-fixture',author:{role:'assistant'},create_time:+time/1000,
     content:{content_type:'text',parts:['123456789012']}}}}},
 ]));
 await writeFile(join(chatExports,'MyActivity.json'),JSON.stringify([
   {header:'Gemini Apps',time:time.toISOString(),title:'Prompted 12345678',safeHtmlItem:[{html:'<p>abcd</p>'}]},
 ]));
 await prefs.change({providers:['claude','claude-chat','chatgpt-chat','gemini-takeout']});
 for(const provider of ['claude-chat','chatgpt-chat','gemini-takeout']){
   const result=await js('window.usage.scanRoots('+JSON.stringify(provider)+','+JSON.stringify(chatExports)+',true)');
   assert.equal(result.count,1);
 }
 const chats=await js('window.usage.refresh(true)');
 assert.equal(chats.usage['claude-chat'].today.input,2);
 assert.equal(chats.usage['chatgpt-chat'].today.output,3);
 assert.equal(chats.usage['gemini-takeout'].today.total,3);
 console.log('PASS: Claude Chat, ChatGPT and Gemini Apps exports reach separate usage totals through production IPC.');
 if(timedUsage){
   await prefs.change({providers:['claude-chat','chatgpt-chat','gemini-takeout'],limitNotifications:false});
   ipcMain.handle('windows:update-state',()=>({state:'current',version:app.getVersion()}));
   await main.loadFile(resolve('dist/renderer/index.html'));
   async function until(expression,timeout){
     const deadline=Date.now()+timeout;
     do{
       if(await js(expression))return;
       await new Promise(resolve=>setTimeout(resolve,100));
     }while(Date.now()<deadline);
     throw new Error('Timed out: '+expression);
   }
   const geminiButton='document.querySelector(\'[data-provider="gemini-takeout"]\')';
   const total="document.querySelector('.provider-summary span')?.textContent";
   const legend="document.querySelector('#trend-legend span')?.textContent";
   await until(geminiButton+" && !document.querySelector('#refresh').disabled",5000);
   await js(geminiButton+'.click()');
   assert.equal(await js(legend),'Gemini Apps (≈)');
   assert.equal(await js(total),'3');
   await writeFile(join(chatExports,'MyActivity.json'),JSON.stringify([
     {header:'Gemini Apps',time:time.toISOString(),title:'Prompted 12345678',safeHtmlItem:[{html:'<p>abcd</p>'}]},
     {header:'Gemini Apps',time:new Date().toISOString(),title:'Prompted 123456789012',safeHtmlItem:[{html:'<p>efgh</p>'}]},
   ]));
   const scheduledAt=Date.now();
   await prefs.change({refreshSeconds:60});
   await until(total+" === '7' && document.querySelector('.trend-day.today')?.getAttribute('aria-label')?.includes(' · 7 ')",65000);
   assert.ok(Date.now()-scheduledAt>=59000,'the periodic refresh must deliver the new file');
   assert.equal(await js(legend),'Gemini Apps (≈)');
   assert.equal(await js(geminiButton+'.getAttribute("aria-pressed")'),'true');
   assert.equal(await js("document.querySelectorAll('.trend-day.today .trend-segment').length"),1);
   console.log('PASS: the 60-second background refresh re-reads Takeout and updates the selected home graph from 3 to 7 tokens.');
 }
 await finish();await prefs.finishWrites();app.exit(0);
}catch(error){console.error(error);app.exit(1);}finally{Notification.prototype.show=originalShow;globalThis.fetch=originalFetch;pet?.destroy();main?.destroy();try{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{}}

}
void run().catch(error=>{console.error(error);app.exit(1);});
