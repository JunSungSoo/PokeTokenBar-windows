import{checkBattleSwitch}from'./battle-switch-ui-check.mjs';
import{checkHeldItemPicker}from'./held-items-ui-checks.mjs';
// Exercises the real sandboxed battle window, preload, IPC and Node engine with an isolated save.
import{app,session,dialog}from'electron';import assert from'node:assert/strict';
import{registerTradeIPC}from'../dist/main/trade/ipc.js';
import{mkdtemp,rm,writeFile,mkdir}from'node:fs/promises';import{join,resolve}from'node:path';import{tmpdir}from'node:os';
import{CompanionStore}from'../dist/main/companion/store.js';import{speciesFor}from'../dist/main/companion/catalog.js';
import{SettingsStore}from'../dist/main/settings.js';import{registerBattleIPC}from'../dist/main/battle/ipc.js';import{practiceTeam}from'../dist/main/battle/team.js';
console.log('Battle UI smoke boot');setTimeout(()=>{console.error('Battle UI smoke deadline');app.exit(1);},180000).unref();
app.commandLine.appendSwitch('force-prefers-no-reduced-motion');
app.on('window-all-closed',()=>{});let controller,dir;const errors=[];
async function run(){dir=await mkdtemp(join(tmpdir(),'ptb-battle-ui-'));app.setPath('userData',dir);await app.whenReady();console.log('Electron ready');if(process.env.POKE_UI_REAL_SPRITES!=='1'){const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAFAAAALAAAAAABAAEAAAICRAEAIfkEAAUAAAAsAAAAAAEAAQAAAgJMAQA7','base64');await session.defaultSession.protocol.handle('https',()=>new Response(gif,{headers:{'content-type':'image/gif','access-control-allow-origin':'*'}}));}
 const prefs=new SettingsStore(join(dir,'settings-v1.json'));await prefs.load();await prefs.change({language:'ko',animationQuality:'smooth',animated:false,tradeNickname:'Trainer',profileIcon:25});
 const store=new CompanionStore(join(dir,'companion-v1.json'),()=>false),now=Date.now();
 await store.replaceImport({raised:1000000000,progress:0,active:null,graduated:[...practiceTeam(),{id:'reward-sylveon',speciesID:700,ability:'cutecharm',moves:['moonblast']}].map(m=>({id:m.id,family:-1,stage:0,route:[speciesFor(m.speciesID)],rarity:'common',hatchedAt:now-100000,graduatedAt:now,nature:'성실',shiny:false,repeat:false,level:100,macProfile:{instanceID:m.id,seed:'123456789',ivs:{hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31},level:100,growthTokens:100000000,gender:'male',abilitySlot:1,abilityName:m.ability,abilityIsHidden:false,moves:m.moves.map(name=>({name,learnedAtLevel:1}))}}))},now);
 await store.change({kind:'battle-default-item',id:practiceTeam().find(p=>p.speciesID===6).id,item:'mysticwater'});
 await writeFile(join(dir,'battle-presentation-v1.json'),JSON.stringify({music:0,effects:0,enabled:false}));
 let tradeActive=false;
 controller=registerBattleIPC(store,()=>undefined,prefs,w=>{},undefined,{seed:()=>[1,2,3,4],tradeActive:()=>tradeActive});console.log('Opening hidden battle');await controller.windows.open('challenge');console.log('Battle loaded');const w=controller.windows.main;
 registerTradeIPC(store,()=>w,()=>{},prefs,{canEnter:()=>!controller.isBusy()});
 w.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});w.webContents.on('render-process-gone',(_,d)=>errors.push(d.reason));
 const js=code=>w.webContents.executeJavaScript(code);async function until(code){for(let i=0;i<1000;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out: '+code+' / '+await js("document.body.innerText"));}
 const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
 tradeActive=true;await assert.rejects(()=>js("window.battle.open('challenge')"),/교환/);tradeActive=false;
 await assert.rejects(()=>js("window.trade.host('test')"),/배틀/);
 async function snap(name,target=w){if(!process.env.POKE_UI_SCREENSHOTS)return;await mkdir(process.env.POKE_UI_SCREENSHOTS,{recursive:true});await new Promise(r=>setTimeout(r,200));await writeFile(join(process.env.POKE_UI_SCREENSHOTS,name+'.png'),(await target.webContents.capturePage()).toPNG());}
 await checkHeldItemPicker(w,prefs,[660]);
 assert.equal(await js("(async()=>{const rows=await window.battle.choices(),p=rows.find(p=>p.speciesID===6);if(p.battleDefaultItem!=='mysticwater')return false;localStorage.setItem('battlePokemonHeldItems.v1',JSON.stringify({[p.id]:'charcoal'}));return window.battleUI.assignments([p.id],rows,{})[p.id]==='mysticwater';})()"),true);
 console.log('Checking setup');await until("document.querySelectorAll('.battle-candidate').length===6");assert.equal((await js("window.battle.choices('champion')")).some(p=>p.speciesID===700),true);for(let i=0;i<6;i++)await js(`document.querySelectorAll('.battle-candidate')[${i}].click()`);await click('.battle-team-grid .battle-team-tile button');await until("document.querySelector('[data-item=leftovers]')");await click('[data-item=leftovers]');assert.equal(await js("Boolean(document.querySelector('.battle-item-popup[open]'))"),true);await click('.battle-item-popup .battle-confirm-actions button:last-child');await snap('cpu-team-setup');await click('#challenge-start');await until("document.querySelector('#challenge-begin')");
 const pickOrder=index=>js(`document.querySelectorAll('.battle-preparation-grid > div:first-child .battle-team-tile')[${index}].querySelector('button').click()`);
 const matchups=()=>js("[...document.querySelectorAll('.battle-preparation-grid > div:last-child .battle-team-tile')].map(tile=>tile.dataset.lineupMatchup??null)");
 assert.deepEqual(await matchups(),Array(6).fill(null));
 await pickOrder(0);
 assert.deepEqual(await matchups(),['advantage','advantage','advantage',null,null,'advantage']);
 await pickOrder(1);
 assert.deepEqual(await matchups(),Array(6).fill('disadvantage'));
 assert.deepEqual(await js("[...document.querySelectorAll('[data-lineup-order]')].map(tile=>[tile.dataset.lineupOrder,parseFloat(getComputedStyle(tile).outlineWidth)>2])"),[['1',true],['2',true]]);
 await pickOrder(1);
 assert.deepEqual(await matchups(),['advantage','advantage','advantage',null,null,'advantage']);
 for(let i=1;i<6;i++)await pickOrder(i);
 await until("document.querySelector('.battle-trainer-art canvas')?.width===48");assert.equal(await js("[...document.querySelector('.battle-trainer-art canvas').getContext('2d').getImageData(0,0,48,52).data].some((value,index)=>index%4===3&&value>0)"),true);assert.equal(await js("(()=>{const badges=document.querySelectorAll('.battle-lead-badge');if(badges.length!==1)return false;const badge=badges[0].getBoundingClientRect(),art=badges[0].parentElement.getBoundingClientRect();return badge.left>=art.left&&badge.top>=art.top&&badge.right<=art.right&&badge.bottom<=art.bottom&&Math.abs(badge.left-art.left)<1&&Math.abs(badge.top-art.top)<1;})()"),true);
 await snap('cpu-preparation');
 if(process.env.POKE_BATTLE_OPENING==='1'){
  await prefs.change({animated:true});
  await js(`(()=>{
   window.foeEntry={balls:[],sounds:[]};
   const proto=window.battleEffects.OriginalLayers.prototype,both=proto.both;
   proto.both=async function(method,...args){
    const audit=window.foeEntry;
    if(audit.active&&method==='ptbFinish'){
     const state=await both.call(this,'ptbInspect');
     audit.sounds=state[1].soundEvents.map(({key})=>key);
     audit.active=false;
    }
    const result=await both.call(this,method,...args);
    if(method==='ptbPrepare')audit.active=args[0].transition&&args[0].source==='foe-0';
    if(audit.active&&method==='ptbAdvance'){
     const entry=result[1].entry;
     if(entry.ball.visible)audit.balls.push({x:entry.ball.x,y:entry.ball.y,actorVisible:entry.incomingVisible});
    }
    return result;
   };
  })()`);
 }
 await click('#challenge-begin');await until("document.querySelector('#battle-move-0-1') && !document.querySelector('#battle-move-0-1').disabled");
 if(process.env.POKE_BATTLE_OPENING==='1'){
  assert.equal(await js("Boolean(document.querySelector('.battle-trainer-intro'))"),false);
  const entry=await js('window.foeEntry');
  assert.ok(entry.balls.length>2);
  assert.ok(entry.balls[0].x-entry.balls.at(-1).x>20,'opponent ball travels from right to left');
  assert.ok(entry.balls.every(ball=>!ball.actorVisible),'opponent appears after the ball opens');
  assert.deepEqual(entry.sounds.filter(key=>key==='entry-throw'||key==='entry-release'),['entry-throw','entry-release']);
  await prefs.change({animated:false});
  console.log('PASS: opponent opens with an in-flight Poké Ball, throw and release sounds, then reveals the Pokémon.');
 }
 await until("document.querySelector('.battle-vs-side.own img')?.naturalWidth > 0");assert.equal(await js("document.querySelector('.battle-vs-side.own strong').textContent"),'Trainer');assert.equal(await js("document.querySelector('.battle-vs-side.own img').getAttribute('src')"),'assets/profile/25.png');
 assert.equal(await js("document.querySelector('.battlefield').getBoundingClientRect().height"),351);assert.ok(Math.abs(w.getContentBounds().width-660)<=1,"DIP width rounds within one pixel at display scale");assert.equal((await controller.store.resume('singles',true)).frame.own[0].item,'leftovers');
 assert.ok(await js("[...document.querySelectorAll('.battle-hp-track')].every(track=>{const style=getComputedStyle(track),width=parseFloat(style.borderTopWidth);return width>0&&width<=1&&style.borderTopStyle==='solid';})"));
 await prefs.change({animated:true});
 await until("document.documentElement.dataset.animation === 'on'");
 await click('#battle-move-0-1');assert.equal(await js("document.querySelector('#battle-confirm').disabled"),false);
 const healthDuringTurn=await js(`new Promise(resolve=>{
  const before=new Map([...document.querySelectorAll('.battle-health')].map(card=>[card.dataset.member,Number(card.querySelector('.battle-hp').style.getPropertyValue('--hp-ratio'))]));
  const deadline=performance.now()+35000;
  let recordShown=false;
  const decreasing=new Set();
  document.querySelector('#battle-confirm').click();
  function sample(){
   recordShown ||= Boolean(document.querySelector('.battle-turn-record'));
   for(const card of document.querySelectorAll('.battle-health')){
    const fill=card.querySelector('.battle-hp'),target=Number(fill.getAttribute('aria-valuenow'))/Number(fill.getAttribute('aria-valuemax'));
    const actual=fill.getBoundingClientRect().width/fill.offsetWidth;
    if(target+.01<actual&&actual<before.get(card.dataset.member)-.01)decreasing.add(card.classList.contains('own')?'own':'foe');
   }
   if(document.querySelector('.battle-turn')?.textContent==='2'&&!document.querySelector('.battle-message.playing')||performance.now()>deadline){
    resolve({decreasing:[...decreasing].sort(),recordShown,settled:!document.querySelector('.battle-message.playing')});
   }else setTimeout(sample,16);
  }
  sample();
 })`);
 assert.deepEqual(healthDuringTurn,{decreasing:['foe','own'],recordShown:false,settled:true},'HP must visibly shrink on both sides during playback without a separate turn record');
 await prefs.change({animated:false});
 console.log('PASS: the battle HP meter decreases across rendered frames; the separate turn record is absent.');
 await until("[...document.querySelectorAll('.battle-stage canvas')].every(c=>c.width>1)");console.log('Visible battle sprites',JSON.stringify(await js("(async()=>{const v=await window.battle.resume('singles');return{own:v.frame.own.filter(p=>p.active).map(p=>({id:p.id,speciesID:p.speciesID})),foe:v.frame.foe.map(p=>({id:p.id,speciesID:p.speciesID})),stages:[...document.querySelectorAll('.battle-stage')].map(s=>({position:s.dataset.position,sprite:s.dataset.sprite}))};})()")));assert.equal(await js("[...document.querySelectorAll('.battle-effect-frame')].every(f=>getComputedStyle(f).opacity==='0')"),true);await snap('singles-battle');await click('#battle-move-0-1');await snap('singles-move-details');const state=await controller.store.resume('singles',true);assert.equal(state.frame.turn,2);
 await js("document.querySelector('#battle-move-0-1').dispatchEvent(new PointerEvent('pointerenter'))");await until("document.querySelector('#pokemon-move-tooltip')?.matches(':popover-open')");assert.equal(await js("document.querySelector('#pokemon-move-tooltip').innerText.includes('PP')"),true);const bounded=await js("(()=>{const r=document.querySelector('#pokemon-move-tooltip').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()");assert.equal(bounded,true);await snap('singles-move-tooltip');await js('window.moveUI.close()');
 for(const language of ['ko','en','ja','es','fr','pt','de','ru']){await prefs.change({language});await until('document.documentElement.lang==='+JSON.stringify(language));assert.equal(await js("[...document.querySelectorAll('button,.battle-health,.battle-selected-detail')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1})"),true,language);}await prefs.change({language:'ko'});console.log('PASS: battle move hover details, contained tooltip and eight-language horizontal bounds.');
 await controller.windows.auxiliary('field');await controller.windows.auxiliary('stats');assert.equal(controller.windows.all().length,3);
 await w.reload();await until("document.querySelector('.battle-prelude button')?.textContent==='이어하기'");await click('.battle-prelude button');await until("document.querySelector('.battle-turn')?.textContent==='2'");
 const overflow=await js("[...document.querySelectorAll('button,.battle-health,.battle-stage')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1}).map(e=>e.className)");assert.deepEqual(overflow,[]);
 await until("document.querySelectorAll('iframe').length===2");const player=await js("Promise.all([...document.querySelectorAll('iframe')].map(async f=>{const a=await fetch(f.src);return a.ok}))");assert.deepEqual(player,[true,true]);
 if(process.env.POKE_BATTLE_EFFECTS==='1'){
  await js(`(()=>{window.fxAudit={errors:[],hold:false};window.fxAudit.run=(async()=>{const view=await window.battle.resume('singles'),fx=new window.battleEffects.OriginalLayers(document.querySelector('.battlefield'),await window.battle.assets(),e=>window.fxAudit.errors.push(e));window.fxAudit.fx=fx;const both=fx.both.bind(fx);let ticks=0;fx.both=async(method,...args)=>{const value=await both(method,...args);if(method==='ptbAdvance'&&++ticks===12){window.fxAudit.mid=await both('ptbInspect');window.fxAudit.hold=true;await new Promise(resolve=>window.fxAudit.resume=resolve);}return value;};try{await fx.play({id:999,phase:'move',move:'surf',source:{own:true,slot:0},targets:[{position:{own:false,slot:0},hit:true}]},view.frame,view.frame,0);return{errors:window.fxAudit.errors,result:await both('ptbInspect')};}finally{fx.destroy();}})();return true;})()`);
  await until('window.fxAudit?.hold');const mid=await js('window.fxAudit.mid');assert.ok(mid.some(r=>r.tracks>0));assert.ok(mid.every(r=>r.actors.length===2&&r.actors.every(a=>a.width>1&&a.height>1&&Number.isFinite(a.x)&&Number.isFinite(a.y))));console.log('Effect middle actors',JSON.stringify(mid.map(r=>({layer:r.layer,actors:r.actors,graphics:r.graphics,clock:r.clock}))));await snap('surf-mid-effect');console.log('PASS: live Surf middle frame has two positioned actors and active animation tracks.');await js('window.fxAudit.resume()');const result=await js('window.fxAudit.run');
  assert.deepEqual(result.errors,[]);assert.equal(result.result.length,2);console.log(JSON.stringify(result.result.map(({done,effectsVolume,layer,tracks,audioState})=>({done,effectsVolume,layer,tracks,audioState}))));assert.ok(result.result.every(r=>r.done&&r.tracks===0));console.log('PASS: original Phaser animation layers prepare, advance, finish and inspect.');
 }
 let v=await controller.store.resume('singles',true),turns=0;while(v.phase==='battling'&&turns++<100){const bench=v.frame.own.flatMap((p,i)=>!p.active&&!p.fainted?[i+1]:[]),actions=v.frame.slots.map(slot=>{if(slot.canPass)return{kind:'pass'};if(slot.mustSwitch)return{kind:'switch',index:bench.shift()};const move=slot.moves.filter(m=>!m.disabled&&m.pp>0).sort((a,b)=>b.power*Math.max(0,...b.matchups.map(t=>t.multiplier??0))-a.power*Math.max(0,...a.matchups.map(t=>t.multiplier??0)))[0];return{kind:'move',index:move.index,target:move.targetRequired?move.targets.find(t=>t.location>0).location:0};});v=await controller.store.choose('singles',v.checkpoint,actions);}assert.equal(v.phase,'reward');
 await js("window.battle.audio({enabled:true,music:0})");
 await w.reload();await until("document.querySelector('.battle-prelude button')?.textContent==='이어하기'");
 await js(`(()=>{
  window.musicAudit={requests:[],starts:0,stops:0};
  const fetchAsset=window.fetch;
  window.fetch=(url,options)=>{
   if(typeof url==='string'&&url.includes('/music/'))window.musicAudit.requests.push(url.split('/').at(-1));
   return fetchAsset(url,options);
  };
  const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start=function(...args){window.musicAudit.starts++;return start.apply(this,args);};
  AudioBufferSourceNode.prototype.stop=function(...args){window.musicAudit.stops++;return stop.apply(this,args);};
 })()`);
 await click('.battle-prelude button');await until("document.querySelector('#challenge-shop-fullRecovery') && window.musicAudit.starts===1");
 const rewardRows=await js(`[...document.querySelectorAll('.battle-reward-options button')].map(button=>{
   const {x,top,bottom,width}=button.getBoundingClientRect();
   return {x,top,bottom,width};
 })`);
 assert.equal(rewardRows.length,5);
 assert.ok(rewardRows.every((row,index)=>row.x===rewardRows[0].x&&row.width===rewardRows[0].width&&
   (!index||row.top>=rewardRows[index-1].bottom)),'each reward choice should occupy a separate row');
 const rewardHeadingGap=await js(`(()=>{
   const options=document.querySelector('.battle-reward-options');
   return {
     margin:getComputedStyle(options).marginBlockStart,
     gap:options.firstElementChild.getBoundingClientRect().top-options.previousElementSibling.getBoundingClientRect().bottom
   };
 })()`);
 assert.equal(rewardHeadingGap.margin,'10px');
 assert.ok(rewardHeadingGap.gap>=9,'the reward heading should have space above the first option: '+rewardHeadingGap.gap);
 await snap('cpu-reward-shop');
 if(process.env.POKE_UI_SCREENSHOTS){
   await js("document.querySelector('.battle-reward-options').scrollIntoView({block:'center'})");
   await snap('challenge-reward-options');
 }
 await click('#challenge-shop-fullRecovery');await until("document.querySelector('#challenge-shop-buy')");
 await click('#challenge-shop-buy');await until("!document.querySelector('dialog')");
 await click('#challenge-reward-points');await click('#challenge-apply-reward');await until("document.querySelector('#challenge-next')");
 assert.equal((await controller.store.resume('singles',true)).progress.points,50);
 assert.deepEqual(await js('window.musicAudit'),{requests:['trainer-victory.ogg'],starts:1,stops:0});
 await click('#challenge-next');await until("document.querySelector('#challenge-begin')");
 assert.equal((await controller.store.resume('singles',true)).encounter,2);
 assert.deepEqual(await js('window.musicAudit'),{requests:['trainer-victory.ogg'],starts:1,stops:1});
 console.log('PASS: reward, purchase, and intermission share one victory track; next battle preparation is silent.');
 assert.equal(await js("document.querySelector('#battle-problem').hidden"),true);assert.deepEqual(errors,[]);console.log('PASS: real battle IPC, six-member setup, ordering, engine turn, geometry, auxiliary windows, reload and bounded UI.');
 for(let i=0;i<6;i++)await js(`document.querySelectorAll('.battle-preparation-grid .battle-team-tile')[${i}].querySelector('button').click()`);
 w.webContents.debugger.attach('1.3');
 await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await prefs.change({animated:true});
 await until("window.appPreferences.animated && matchMedia('(prefers-reduced-motion: reduce)').matches");
 await click('#challenge-begin');
 await until("document.querySelector('#battle-move-0-1') && window.musicAudit.starts===2");
 assert.equal(await js("Boolean(document.querySelector('.battle-trainer-intro,.intro-own-hidden,.intro-foe-hidden,.effect-playing'))"),false);
 assert.deepEqual(await js('window.musicAudit.requests'),['trainer-victory.ogg','wild-battle.ogg']);
 w.webContents.debugger.detach();
 await prefs.change({animated:false});
 console.log('PASS: battle music begins at battle start; reduced motion leaves both battlers visible without entry effects.');
 const originalDialog=dialog.showMessageBox;let prompts=0,response=0;dialog.showMessageBox=async()=>{prompts++;return{response,checkboxChecked:false};};
 try{w.close();for(let i=0;i<50&&!prompts;i++)await new Promise(r=>setTimeout(r,20));await new Promise(r=>setTimeout(r,50));assert.equal(w.isDestroyed(),false);assert.equal((await controller.store.resume('singles',true)).phase,'battling');response=1;w.close();for(let i=0;i<100&&!w.isDestroyed();i++)await new Promise(r=>setTimeout(r,20));assert.equal(w.isDestroyed(),true);assert.equal((await controller.store.resume('singles',true)).phase,'lost');assert.equal(prompts,2);}finally{dialog.showMessageBox=originalDialog;}
 console.log('PASS: reciprocal trade/battle IPC gates, CPU close cancellation and confirmed surrender persistence.');
   await controller.store.start('singles',practiceTeam(),true,true);const checkpoint=await controller.store.prepare('singles',practiceTeam().map(p=>p.id),{},true);assert.equal(checkpoint.phase,'battling');await controller.windows.open('challenge');const handoffWindow=controller.windows.main;if(process.env.POKE_BATTLE_SWITCH_QA==='1'){for(let i=0;i<200&&!await handoffWindow.webContents.executeJavaScript("Boolean(document.querySelector('.battle-prelude button'))");i++)await new Promise(r=>setTimeout(r,20));await handoffWindow.webContents.executeJavaScript("document.querySelector('.battle-prelude button').click()");await checkBattleSwitch(handoffWindow,prefs,name=>snap(name,handoffWindow));}const preservedCheckpoint=(await controller.store.resume('singles',true)).checkpoint,oldMessageBox=dialog.showMessageBox;dialog.showMessageBox=async()=>{throw Error('handoff must preserve the CPU checkpoint without a surrender prompt');};try{await new Promise(r=>setTimeout(r,50));await controller.prepareHandoff();handoffWindow.close();for(let i=0;i<100&&!handoffWindow.isDestroyed();i++)await new Promise(r=>setTimeout(r,20));assert.equal(handoffWindow.isDestroyed(),true);const restored=await controller.store.resume('singles',true);assert.equal(restored.phase,'battling');assert.equal(restored.checkpoint,preservedCheckpoint);}finally{dialog.showMessageBox=oldMessageBox;}console.log('PASS: version handoff closes the CPU window while preserving its resumable checkpoint.');
}
void run().catch(e=>{console.error(e);if(errors.length)console.error('Renderer errors:',errors);process.exitCode=1;}).finally(async()=>{controller?.lan.shutdown(false);controller?.assets.close();for(const w of controller?.windows.all()??[])w.destroy();await controller?.finishWrites();if(dir)try{await rm(dir,{recursive:true,force:true,maxRetries:0});}catch{/* Chromium profile locks expire when Electron exits. */}app.exit(process.exitCode??0);});
