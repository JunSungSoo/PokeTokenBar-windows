// Two actual TCP battle peers and the production sandboxed LAN battle window.
import{app}from'electron';import assert from'node:assert/strict';import{mkdtemp,rm,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{registerBattleIPC}from'../dist/main/battle/ipc.js';import{LanBattle}from'../dist/main/battle/lan.js';import{practiceTeam}from'../dist/main/battle/team.js';import{SettingsStore}from'../dist/main/settings.js';import{CompanionStore}from'../dist/main/companion/store.js';
app.commandLine.appendSwitch('force-prefers-no-reduced-motion');
app.on('window-all-closed',()=>{});let dirs=[],controller,peer;setTimeout(()=>app.exit(1),45000).unref();
async function until(check){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error('LAN UI timed out');}
async function checkResultAudio(w,prefs,state){
 const js=code=>w.webContents.executeJavaScript(code);
 await prefs.change({animated:true});
 await until(()=>js("window.appPreferences.animated"));
 await js(`(()=>{
  window.resultCues=[];
  window.battleEffects.music=(_base,cue)=>{
   if(!['victory','lost'].includes(cue))return Promise.resolve();
   const own=cue==='lost',side=document.querySelector('.battle-side.'+(own?'own':'foe'));
   window.resultCues.push({cue,effectPlaying:Boolean(document.querySelector('.effect-playing')),
    hp:Number(side.querySelector('.battle-hp').style.getPropertyValue('--hp-ratio')),
    trail:parseFloat(getComputedStyle(side.querySelector('.battle-hp-trail')).width),
    result:document.querySelector('.battle-result')?.textContent??null});
   return Promise.resolve();
  };
  window.battleEffects.OriginalLayers.prototype.play=async function(event,_frame,_previous,_volume,settled){
   if(event.phase!=='move')return;
   this.field.classList.add('effect-playing');
   await new Promise(resolve=>{window.releaseFinalMove=resolve;});
   settled?.();
   this.field.classList.remove('effect-playing');
  };
 })()`);
 let offset=(state.frame.logOffset??0)+state.frame.log.length+1;
 for(const lost of [true,false]){
  const before=structuredClone(state.frame);
  const side=lost?'own':'foe',selector='.battle-side.'+side+' .battle-hp';
  const target=lost?before.own.find(p=>p.active):before.foe[0];
  Object.assign(target,{hp:target.maxHP,fainted:false});
  Object.assign(before,{decisionID:'before-'+offset,ended:false,winner:null,log:[],logOffset:offset,effects:[],scenes:[]});
  const playing={...state,phase:'playing',outcome:undefined,submitted:false,frame:before};
  w.webContents.send('battle:lan-changed',playing);
  await until(()=>js("document.querySelector('#battle-move-0-1') && !document.querySelector('.battle-result')"));
  const after=structuredClone(before),damage=after[side].find(p=>p.id===target.id);
  damage.hp=0;
  const actor=lost?'p2a':'p1a',victim=lost?'p1a':'p2a';
  const scene=(id,frame)=>({id,turn:frame.turn,own:frame.own,foe:frame.foe});
  const moveEffect={id:offset,phase:'move',move:'Surf',source:{own:!lost,slot:0},targets:[{position:{own:lost,slot:0},hit:true}]};
  const final=structuredClone(after);final[side].find(p=>p.id===target.id).fainted=true;
  Object.assign(final,{decisionID:'final-'+offset,ended:true,winner:lost?1:0,slots:[],
   log:[`|move|${actor}: Blastoise|Surf|${victim}: Blastoise`,`|-damage|${victim}: Blastoise|0 fnt`,`|faint|${victim}: Blastoise`],
   effects:[moveEffect],scenes:[scene(offset,before),scene(offset+1,after),scene(offset+2,final)]});
  w.webContents.send('battle:lan-changed',{...playing,frame:final});
  await until(()=>js("Boolean(window.releaseFinalMove)"));
  const expectedCount=lost?1:2;
  w.webContents.send('battle:lan-changed',{...playing,phase:'ended',outcome:lost?'loss':'win',frame:final});
  assert.equal(await js('window.resultCues.length'),expectedCount-1);
  await js("window.releaseFinalMove();window.releaseFinalMove=undefined");
  await until(()=>js(`(()=>{const hp=Number(document.querySelector('${selector}').style.getPropertyValue('--hp-ratio'));return hp>0&&hp<1;})()`));
  assert.equal(await js('window.resultCues.length'),expectedCount-1);
  await until(()=>js('window.resultCues.length==='+expectedCount));
  assert.deepEqual(await js('window.resultCues.at(-1)'),{cue:lost?'lost':'victory',effectPlaying:false,hp:0,trail:0,result:lost?'패배':'승리'});
  offset+=final.log.length+1;
 }
 console.log('PASS: win and loss music wait for the final move, HP drain, and damage trail; duplicate LAN result frames keep one cue.');
}
async function run(){dirs=await Promise.all([mkdtemp(join(tmpdir(),'ptb-lan-ui-a-')),mkdtemp(join(tmpdir(),'ptb-lan-ui-b-'))]);app.setPath('userData',dirs[0]);await app.whenReady();for(const[i,code]of ['AAAAAAAA','ZZZZZZZZ'].entries())await writeFile(join(dirs[i],'battle-identity-v1.json'),JSON.stringify({version:1,code}));await writeFile(join(dirs[0],'battle-presentation-v1.json'),JSON.stringify({music:0,effects:0,enabled:false}));
 const prefs=new SettingsStore(join(dirs[0],'settings-v1.json'));await prefs.load();await prefs.change({animated:false,language:'ko'});controller=registerBattleIPC(new CompanionStore(join(dirs[0],'companion-v1.json')),()=>undefined,prefs,w=>{});peer=new LanBattle(dirs[1],()=>{});await controller.lan.host('Windows A');await peer.connect('127.0.0.1:'+controller.lan.state().codes[0].split(':')[1],'Windows B');await until(()=>controller.lan.state().opponent&&peer.state().opponent);controller.lan.register(practiceTeam());peer.register(practiceTeam());await until(()=>controller.lan.state().opponentRoster.length===6&&peer.state().opponentRoster.length===6);controller.lan.ready(practiceTeam().map(m=>m.id));peer.ready(practiceTeam().map(m=>m.id));await until(()=>controller.windows.main&&!controller.windows.main.webContents.isLoading());const w=controller.windows.main,js=s=>w.webContents.executeJavaScript(s);await until(()=>js("document.querySelector('#battle-move-0-1')"));assert.equal(await js("document.querySelector('.battle-roster-strip').children.length"),3);await js("document.querySelector('#battle-move-0-1').click();document.querySelector('#battle-confirm').click()");await until(()=>controller.lan.state().submitted);assert.equal(await js("document.querySelector('#battle-confirm').disabled"),true);const f=peer.state().frame,move=f.slots[0].moves.find(m=>!m.disabled&&m.pp>0);peer.choose(f.decisionID,[{kind:'move',index:move.index,target:0}]);await until(()=>js("document.querySelector('.battle-turn')?.textContent==='2'"));assert.equal(controller.lan.state().submitted,false);await js("window.battle.lan('surrender')");await until(()=>js("document.querySelector('.battle-result')?.textContent==='패배'"));await until(()=>peer.state().phase==='ended');assert.equal(peer.state().outcome,'win');await controller.finishWrites();assert.equal((await controller.lan.history()).history.length,1);await checkResultAudio(w,prefs,controller.lan.state());console.log('PASS: actual two-peer LAN window, three selected Pokémon, committed turn, waiting controls, surrender and bilateral history.');}
void run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{controller?.lan.shutdown(false);peer?.shutdown(false);controller?.assets.close();for(const w of controller?.windows.all()??[])w.destroy();await controller?.finishWrites();await peer?.finishWrites();await Promise.all(dirs.map(d=>rm(d,{recursive:true,force:true,maxRetries:2,retryDelay:50}).catch(error=>{if(!['EBUSY','EPERM'].includes(error.code)){console.error(error);process.exitCode=1;}})));app.exit(process.exitCode??0);});
