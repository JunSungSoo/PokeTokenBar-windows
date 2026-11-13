import type{BattleFrame,BattleVisualEvent}from'./battle.js';
/** Port of the Mac BattlePresentationEvents and field/status/guard activation adapters. */
export function presentationEvents(frame:BattleFrame,ownPlayer=0):BattleVisualEvent[]{
 const key=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,''),position=(token:string)=>{const match=token.match(/^p([12])([ab])(?::|$)/);return match?{own:Number(match[1])===ownPlayer+1,slot:match[2]==='b'?1:0}:undefined;};
 const weather:Record<string,string>={sunnyday:'commonsunny',raindance:'commonrain',sandstorm:'commonsandstorm',hail:'commonhail'},statuses:Record<string,string>={slp:'commonsleep',psn:'commonpoison',tox:'commontoxic',par:'commonparalysis',confusion:'commonconfusion',brn:'commonburn',frz:'commonfrozen',attract:'commonattract'};
 const fields=['trickroom','gravity','magicroom','wonderroom','mudsport','watersport','reflect','lightscreen','safeguard','mist','tailwind','luckychant','spikes','stealthrock','toxicspikes','electricterrain','mistyterrain','fairylock'],global=['electricterrain','mistyterrain','fairylock','trickroom','gravity','magicroom','wonderroom','mudsport','watersport'];
 const offset=frame.logOffset??0,events=new Map((frame.effects??[]).filter(e=>!frame.log[e.id-offset]?.includes('|[notarget]')).map(e=>[e.id,{...e}]));
 for(const scene of frame.scenes??[]){const index=scene.id-offset,parts=(frame.log[index]??'').split('|'),kind=parts[1],source=position(parts[2]??'');let event:BattleVisualEvent|undefined;
  const make=(move:string,phase:string,pos=source??{own:true,slot:0}):BattleVisualEvent=>({id:scene.id,move,moveID:move,type:'',category:'Status',phase,source:pos,targets:[{position:pos,hit:true}]});
  if(['switch','drag','replace'].includes(kind)&&source)event=make('entry','entry');
  else if(kind==='-mega'&&source)event=make('mega','mega');
  else if(kind==='-weather'&&weather[key(parts[2]??'')]){event=make(weather[key(parts[2])],'field');event.globalField=true;}
  else if(['-fieldstart','-fieldactivate','-sidestart','-start'].includes(kind)){
   const name=key((parts[kind==='-fieldstart'||kind==='-fieldactivate'?2:3]??'').split(': ').at(-1)??'');
   if(fields.includes(name)){let previous:BattleVisualEvent|undefined;for(let j=index-1;j>=0;j--)if(frame.log[j].startsWith('|move|')){previous=(frame.effects??[]).find(e=>e.id===offset+j&&key(e.moveID??e.move)===name);break;}event={...make(name,'field',previous?.source),...(previous?{targets:previous.targets}:{})};event.globalField=global.includes(name);if(previous)events.set(previous.id,{...previous,move:'',moveID:'',phase:'state',targets:[]});}
  }
  if(!event&&source){let status:string|undefined;const condition=parts[3]??'';
   if(kind==='-status'||kind==='cant'&&['slp','par','frz'].includes(condition))status=condition;
   else if(['-start','-activate'].includes(kind)&&['confusion','attract'].includes(key(condition.split(': ').at(-1)??'')))status=key(condition.split(': ').at(-1)??'');
   else if(kind==='-damage'){const cause=parts.slice(4).find(s=>s.startsWith('[from] '));if(cause==='[from] brn')status='brn';else if(cause==='[from] psn'){const p=(source.own?scene.own.filter(p=>p.active):scene.foe)[source.slot];status=p?.status==='tox'?'tox':'psn';}else if(cause&&['sandstorm','hail'].includes(key(cause.slice(7))))event=make(key(cause.slice(7)),'weather-hit');}
   if(status&&statuses[status])event=make(statuses[status],'status');
   if(kind==='-activate'&&condition==='move: Protect'){let move='protect';for(let j=index-1;j>=0;j--){const p=frame.log[j].split('|');if(p[1]==='turn')break;if(p[1]==='move'&&p[2]===parts[2]){if(['protect','detect'].includes(key(p[3])))move=key(p[3]);break;}}event=make(move,'guard');}
  }
  if(event)events.set(scene.id,event);else if(!events.has(scene.id)){const visible=['-item','-enditem','faint','cant','-miss','-crit','-supereffective','-resisted','-immune','-fail','-status','-curestatus','-activate','-weather','-fieldstart','-fieldactivate','-fieldend','-sidestart','-sideend','-start','-end'].includes(kind);events.set(scene.id,make('',kind==='-damage'||kind==='-heal'?'health':kind==='-ability'?'ability':visible?'transition':'state'));}
 }
 return [...events.values()].sort((a,b)=>a.id-b.id);
}
