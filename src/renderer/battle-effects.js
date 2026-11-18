(() => {
 class OriginalLayers {
  constructor(field,base,onError){this.field=field;this.base=base;this.origin=new URL(base).origin;this.onError=onError;this.pending=new Map();this.counter=0;this.generation=0;this.frames=[];
   this.listener=event=>{const frame=this.frames.find(frame=>frame.element.contentWindow===event.source);if(!frame||event.origin!==this.origin)return;const message=event.data;if(message?.ptbPlayer&&message.kind==='ready'){frame.resolve();}if(message?.ptbPlayer&&message.kind==='error')this.onError(String(message.message));if(message?.ptbReply){const pending=this.pending.get(message.ptbReply);if(pending){clearTimeout(pending.timer);this.pending.delete(message.ptbReply);message.error?pending.reject(Error(message.error)):pending.resolve(message.result);}}};window.addEventListener('message',this.listener);
   for(const background of [true,false]){const element=document.createElement('iframe');element.className='battle-effect-frame'+(background?' background':'');element.title='Original battle animation';element.setAttribute('aria-hidden','true');element.tabIndex=-1;element.sandbox='allow-scripts allow-same-origin';const record={element};record.ready=new Promise((resolve,reject)=>{record.resolve=resolve;record.reject=reject;});this.frames.push(record);element.src=base+'player/electron-player.html'+(background?'?layer=background':'');field.append(element);}
  }
  async call(frame,method,...args){let readyTimer;try{await Promise.race([frame.ready,new Promise((_,reject)=>{readyTimer=setTimeout(()=>reject(Error('배틀 연출을 불러오지 못했습니다.')),15000);})]);}finally{clearTimeout(readyTimer);}return new Promise((resolve,reject)=>{const id=++this.counter;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Battle animation timed out'));},15000);this.pending.set(id,{resolve,reject,timer});frame.element.contentWindow.postMessage({ptbCall:true,id,method,args},this.origin);});}
  async both(method,...args){return Promise.all(this.frames.map(frame=>this.call(frame,method,...args)));}
  async play(event,frame,previous,volume,settled){
   const generation=this.generation,fieldRect=this.field.getBoundingClientRect(),actors=[];
   for(const own of [false,true]){const members=own?frame.own.filter(p=>p.active):frame.foe;for(const [slot,pokemon]of members.entries()){const stage=this.field.querySelector(`[data-position="${own?'own':'foe'}-${slot}"]`);if(!stage)continue;const rect=stage.getBoundingClientRect();actors.push(await window.battleSprites.actor(pokemon,own,(own?'own':'foe')+'-'+slot,{x:rect.x-fieldRect.x,y:rect.y-fieldRect.y,width:rect.width,height:rect.height}));}}
   if(event.phase==='entry'&&event.source.own&&this.field.classList.contains('intro-foe-hidden'))for(const actor of actors)if(!actor.own)actor.visible=false;
   const source=(event.source.own?'own':'foe')+'-'+event.source.slot;const targets=event.targets.filter(target=>target.hit);const hit=targets.length>0;const manifest=window.battleCatalog.playerManifest,raw=window.battleUI.key(event.moveID??event.move),move=(manifest.aliases[raw]??raw)+(event.phase==='charge'?':charge':'');
   const payload={move,actors,source,targets:(hit?targets:event.targets).map(target=>({key:(target.position.own?'own':'foe')+'-'+target.position.slot})),hit,width:fieldRect.width,height:fieldRect.height,scale:1,effectsVolume:volume,globalField:event.globalField??false,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
   if(event.phase==='entry'){payload.transition=true;payload.entrySources=[source];const old=(event.source.own?previous?.own.filter(p=>p.active):previous?.foe)?.[event.source.slot];if(old&&!old.fainted&&old.id!==(event.source.own?frame.own.filter(p=>p.active):frame.foe)[event.source.slot]?.id){const current=actors.find(actor=>actor.key===source);payload.previousActors=[{...await window.battleSprites.actor(old,event.source.own,'entry-outgoing-'+source,{x:current.x,y:current.y,width:0,height:11}),key:'entry-outgoing-'+source,x:current.x,y:current.y}];}}
   if(event.phase==='mega')payload.mega=true;
   if(event.phase==='weather-hit')payload.weatherHit=true;
   // Keep the DOM battlers until both native layers have a rendered first frame.
   try{await this.both('ptbPrepare',payload);await this.both('ptbSetEffectsVolume',volume);await this.both('ptbAdvance',0);if(generation!==this.generation)return;this.field.classList.add('effect-playing');let previousTime=performance.now(),done=false;const start=previousTime;
    while(!done&&generation===this.generation){await new Promise(resolve=>setTimeout(resolve,33));const now=performance.now(),delta=(now-previousTime)*(!event.phase||['move','charge'].includes(event.phase)?1.5:1);previousTime=now;const results=await this.both('ptbAdvance',Math.min(delta,250));done=results.every(result=>result.done);if(now-start>25000)throw Error('Battle animation exceeded its deadline');}
   }finally{if(generation===this.generation){settled?.();this.field.classList.remove('effect-playing');}await this.both('ptbFinish').catch(()=>{});}
  }
  stop(){this.generation++;this.field.classList.remove('effect-playing');void this.both('ptbFinish').catch(()=>{});}
  destroy(){this.generation++;window.removeEventListener('message',this.listener);for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error('Battle animation closed'));}this.pending.clear();for(const frame of this.frames)frame.element.remove();this.frames=[];}
 }
 const contextCache=new Map();let context,gain,current,source;
 async function music(base,cue,volume,enabled){
  if(!enabled){source?.stop();source=undefined;current=undefined;return;}
  context ??= new AudioContext({sampleRate:44100});gain ??= context.createGain();gain.connect(context.destination);gain.gain.value=volume;
  if(current===cue&&source)return;source?.stop();source=undefined;current=cue;await context.resume();
  const files={battle:'wild-battle.ogg',victory:'trainer-victory.ogg',lost:'player-lost.ogg',champion:'RubySapphireChampionBattle.ogg',championVictory:'RubySapphireChampionVictory.ogg'};const file=files[cue]??files.battle;
  let buffer=contextCache.get(file);if(!buffer){const response=await fetch(base+'music/'+file);if(!response.ok)throw Error('배틀 음악을 불러오지 못했습니다.');buffer=await context.decodeAudioData(await response.arrayBuffer());contextCache.set(file,buffer);}if(current!==cue)return;
  const node=context.createBufferSource();node.buffer=buffer;node.connect(gain);node.loop=cue!=='lost';const info=cue==='battle'?window.battleCatalog.musicBattle:cue==='victory'?window.battleCatalog.musicVictory:null;
  if(info){node.loopStart=info.loopStartFrame/info.sampleRate;node.loopEnd=(info.loopStartFrame+info.loopFrameCount)/info.sampleRate;}source=node;node.start();
 }
 window.battleEffects={OriginalLayers,music,stopMusic:()=>{source?.stop();source=undefined;current=undefined;}};
})();
