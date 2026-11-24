import{createHash,randomInt,randomUUID}from'node:crypto';
import{readFile}from'node:fs/promises';
import{readFileSync}from'node:fs';
import{presentationEvents}from'../../shared/battle-presentation.js';
import{join}from'node:path';
import{BattleDiscovery}from'./discovery.js';
import{BattleTransport,connectionAddress}from'./transport.js';
import{OwnedBattle,REVISION,type Engine,type Member}from'./engine.js';
import{eligible}from'./team.js';
import{writeSaveAtomically}from'../companion/store.js';
import type{BattleAction,BattleFrame,BattleIdentity,BattleRosterMember,LanBattleState,BattleRecord}from'../../shared/battle.js';
import{defaultProfileNickname,playerProfile,profileIcon}from'../../shared/player-profile.js';
interface Decision{decisionID:string;actions:({kind:string;index:number;target:number;mega?:boolean})[];order:number[]}
const uuid=()=>randomUUID().toUpperCase();
function sorted(value:unknown):unknown{return Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:1).map(([key,v])=>[key,sorted(v)])):value;}
export function battleDigest(decision:Decision,nonce:string,matchID:string){return createHash('sha256').update(matchID+':'+nonce+':').update(JSON.stringify(sorted(decision)).replaceAll('/',String.fromCharCode(92)+'/')).digest('hex');}
const roster=(team:Member[]):BattleRosterMember[]=>team.map(member=>({id:member.id,speciesID:member.speciesID,level:member.level,shiny:member.shiny,...(member.form?{form:member.form}:{})}));
function validRoster(value:unknown):value is BattleRosterMember[]{return Array.isArray(value)&&value.length===6&&new Set(value.map(p=>p?.id)).size===6&&new Set(value.map(p=>p?.speciesID)).size===6&&value.every(p=>typeof p.id==='string'&&p.id.length>0&&p.id.length<=128&&eligible(p.speciesID)&&Number.isInteger(p.level)&&p.level>=5&&p.level<=100&&typeof p.shiny==='boolean'&&(p.form==null||typeof p.form==='string'&&p.form.length<=80));}
const sameRoster=(a:BattleRosterMember,b:BattleRosterMember)=>a.id===b.id&&a.speciesID===b.speciesID&&a.level===b.level&&a.shiny===b.shiny&&(a.form??null)===(b.form??null);
const animationManifest=JSON.parse(readFileSync(new URL('../../battle-assets/player/manifest.json',import.meta.url),'utf8'));
function playbackAllowance(frames:BattleFrame[],previous:BattleFrame|undefined){
 if(!previous)return 0;const previousID=(previous.logOffset??0)+previous.log.length-1;
 return Math.max(0,...frames.map((frame,player)=>presentationEvents(frame,player).filter(e=>e.id>previousID).reduce((sum,e)=>{
  const known:Record<string,number>={entry:6,mega:12,'weather-hit':1,hit:1.05,health:.9,state:.25,transition:1.2,ability:2.35};if(e.phase&&known[e.phase]!==undefined)return sum+known[e.phase]*1000;
  const raw=(e.moveID??e.move).toLowerCase().replace(/[^a-z0-9]/g,''),key=(animationManifest.aliases[raw]??raw)+(e.phase==='charge'?':charge':'');
  const entry=animationManifest.entries[key]??animationManifest.fieldEntries?.[key]??animationManifest.statusEntries?.[key];return sum+Math.max(3.2,entry?Math.max(0,...entry.frames)*.05+4:0)*1000;
 },0)));
}
export class LanBattle{
 private discovery=new BattleDiscovery(peers=>this.show({peers}));
 private link?:BattleTransport;private engine?:Engine;private frames:BattleFrame[]=[];private registered:Member[]=[];private own:Member[]=[];private peerTeam:Member[]=[];
 private sequence=0;private received=0;private matchID='';private commits=new Map<number,string>();private reveals=new Map<number,Decision>();private pending?:Decision;private nonce?:string;
 private timer?:ReturnType<typeof setTimeout>;private reconnectTimer?:ReturnType<typeof setTimeout>;private cleanup?:ReturnType<typeof setTimeout>;private startAt=0;private records:BattleRecord[]=[];private historyQueue:Promise<unknown>=Promise.resolve();
 private stateValue:LanBattleState;
 constructor(private directory:string,private changed:(state:LanBattleState)=>void,private milliseconds=60000){this.stateValue={phase:'idle',identity:{nickname:defaultProfileNickname,code:'',nonce:uuid()},host:false,codes:[],registered:[],opponentRoster:[],localReady:false,remoteReady:false,submitted:false};}
 state():LanBattleState{return structuredClone(this.stateValue);}
 private show(patch:Partial<LanBattleState>={}){Object.assign(this.stateValue,patch);this.changed(this.state());}
 active(){return ['preparing','playing','reconnecting'].includes(this.stateValue.phase);}
 private async identity(nickname:string,icon?:number):Promise<BattleIdentity>{let code:string;try{const data=JSON.parse(await readFile(join(this.directory,'battle-identity-v1.json'),'utf8'));if(typeof data.code!=='string'||!/^[A-HJ-NP-Z2-9]{8}$/.test(data.code))throw Error();code=data.code;}catch{const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';code=Array.from({length:8},()=>alphabet[randomInt(alphabet.length)]).join('');await writeSaveAtomically(join(this.directory,'battle-identity-v1.json'),JSON.stringify({version:1,code}));}return{...playerProfile(nickname,icon),code,nonce:uuid()};}
 private makeLink(){const link=new BattleTransport(value=>{if(this.link===link)this.receive(value);},()=>{if(this.link===link)this.connected();},()=>{if(this.link===link)this.disconnected();});this.link=link;return link;}
 private async reset(nickname:string,icon?:number){if(this.active())throw Error('진행 중인 대전을 먼저 종료해 주세요.');this.shutdown(false);const identity=await this.identity(nickname,icon);this.sequence=this.received=0;this.matchID='';this.registered=this.own=this.peerTeam=[];this.frames=[];this.engine=undefined;this.clearDecision();this.stateValue={phase:'searching',identity,host:false,codes:[],registered:[],opponentRoster:[],localReady:false,remoteReady:false,submitted:false};this.show();}
 async host(nickname:string,icon?:number){if(this.stateValue.phase!=='reconnecting')await this.reset(nickname,icon);else this.link?.close();const link=this.makeLink();const codes=await link.listen();if(this.link===link){this.show({codes});if(this.stateValue.phase==='searching')this.discovery.start(this.stateValue.identity,Number(codes[0].split(':')[1]));}return this.state();}
 async connect(code:string,nickname:string,icon?:number){connectionAddress(code);if(this.stateValue.phase!=='reconnecting')await this.reset(nickname,icon);const link=this.link ?? this.makeLink();if(!this.active())this.show({phase:'connecting'});try{link.connect(code);}catch(error){if(this.stateValue.phase!=='reconnecting')this.show({phase:'searching'});throw error;}return this.state();}
 private send(kind:string,values:Record<string,unknown>={}){this.link?.send({version:1,revision:REVISION,sequence:++this.sequence,kind,...(this.matchID?{matchID:this.matchID}:{}),...values});}
 private connected(){this.discovery.stop();this.stateValue.peers=[];if(this.stateValue.phase==='reconnecting'){this.send('resume',{identity:this.stateValue.identity});return;}this.show({phase:'connected',codes:[],error:undefined});this.send('hello',{identity:this.stateValue.identity,mode:'singles'});}
 register(team:Member[]){if(this.stateValue.phase!=='connected'||!this.stateValue.opponent||this.registered.length||!validRoster(roster(team)))throw Error('서로 다른 최종 진화 포켓몬 6마리를 선택해 주세요.');this.registered=structuredClone(team);this.clearReady();this.show({registered:roster(team)});this.send('roster',{mode:'singles',roster:roster(team)});return this.state();}
 ready(order:string[]){if(this.stateValue.phase!=='connected'||this.registered.length!==6||this.stateValue.opponentRoster.length!==6||order.length!==6||new Set(order).size!==6||order.some(id=>!this.registered.some(p=>p.id===id)))throw Error('선발 3마리를 순서대로 선택해 주세요.');this.own=order.map(id=>this.registered.find(p=>p.id===id)!);this.show({localReady:true,error:undefined});this.send('ready',{mode:'singles',team:this.own});this.begin();return this.state();}
 unready(){if(this.stateValue.phase!=='connected')throw Error('이미 시작된 대전입니다.');this.clearReady();this.send('unready');this.show();return this.state();}
 private clearReady(){this.own=this.peerTeam=[];this.stateValue.localReady=this.stateValue.remoteReady=false;}
 private begin(){if(!this.stateValue.localReady||!this.stateValue.remoteReady||this.stateValue.phase!=='connected')return;this.startAt=Date.now();this.show({phase:'preparing',outcome:undefined,frame:undefined,submitted:false});if(this.stateValue.host){try{this.engine=new OwnedBattle('singles',[this.own,this.peerTeam],Array.from({length:4},()=>randomInt(65536)),{profile:'peer'});this.publish();}catch(error){this.engineError(error);}}}
 private receive(raw:unknown){try{
  if(!raw||typeof raw!=='object')throw Error('Invalid message');const message=raw as Record<string,any>;
  if(message.version!==1||message.revision!==REVISION)throw Error('배틀 버전이 일치하지 않습니다.');
  if(message.kind==='hello'){
   const peer=message.identity as BattleIdentity;if(this.stateValue.phase!=='connected'||this.stateValue.opponent)return;
   if(!Number.isSafeInteger(message.sequence)||message.sequence<1||message.mode!=='singles'||!peer||typeof peer.nickname!=='string'||peer.nickname.length>100||typeof peer.code!=='string'||!peer.code.length||peer.code.length>80||typeof peer.nonce!=='string'||!/^[0-9A-F-]{36}$/i.test(peer.nonce)||peer.nonce===this.stateValue.identity.nonce)throw Error('잘못된 대전 상대입니다.');
   this.received=message.sequence;this.matchID=[peer.nonce,this.stateValue.identity.nonce].sort().join(':');const host=this.stateValue.identity.code+this.stateValue.identity.nonce<peer.code+peer.nonce;this.show({opponent:{nickname:peer.nickname,code:peer.code,nonce:peer.nonce,icon:profileIcon(peer.icon)},host,error:undefined});return;
  }
  if(!this.stateValue.opponent||message.matchID!==this.matchID||!Number.isSafeInteger(message.sequence)||message.sequence<=this.received)return;this.received=message.sequence;
  switch(message.kind){
   case'roster':if(this.stateValue.phase!=='connected'||this.stateValue.opponentRoster.length||message.mode!=='singles'||!validRoster(message.roster))throw Error('잘못된 등록 팀입니다.');this.clearReady();this.show({opponentRoster:message.roster});break;
   case'ready':{
    const team=message.team as Member[];if(this.stateValue.phase!=='connected'||message.mode!=='singles'||!Array.isArray(team)||!validRoster(roster(team))||!team.every(p=>this.stateValue.opponentRoster.some(row=>sameRoster(row,roster([p])[0]))))throw Error('잘못된 선발 팀입니다.');
    new OwnedBattle('singles',[team,team],[1,2,3,4],{profile:'peer'});this.peerTeam=team;this.show({remoteReady:true});this.begin();break;
   }
   case'unready':if(this.stateValue.phase==='connected'){this.clearReady();this.show();}break;
   case'frame':if(!this.stateValue.host&&this.active()&&message.frame?.revision===REVISION){this.clearDecision();this.show({phase:'playing',frame:message.frame,submitted:false,deadline:typeof message.deadline==='number'?(message.deadline+978307200)*1000:undefined});if(message.frame.ended)this.finish(message.frame.winner ?? -1,'completed');}break;
   case'commit':if(this.stateValue.host&&this.stateValue.phase==='playing'&&message.reason===this.frames[1]?.decisionID&&typeof message.digest==='string'&&/^[a-f0-9]{64}$/.test(message.digest)){this.commits.set(1,message.digest);this.requestReveals();}break;
   case'revealRequest':if(!this.stateValue.host&&this.pending&&message.reason===this.pending.decisionID)this.send('reveal',{decision:this.pending,nonce:this.nonce});break;
   case'reveal':if(this.stateValue.host&&this.stateValue.phase==='playing'){
    if(typeof message.nonce!=='string'||message.nonce.length>100||!message.decision||battleDigest(message.decision,message.nonce,this.matchID)!==this.commits.get(1))throw Error('대전 명령을 검증하지 못했습니다.');this.reveals.set(1,message.decision);this.resolve();
   }break;
   case'surrender':this.send('surrenderAck');if(this.active())this.finish(this.stateValue.host?0:1,'surrender');break;
   case'timeout':if(!this.stateValue.host&&this.active()&&[-1,0,1].includes(message.winner))this.finish(message.winner,'timeout');break;
   case'error':this.clearDecision();this.show({submitted:false,error:String(message.reason??'Battle error').slice(0,500),...(this.stateValue.phase==='preparing'?{phase:'connected' as const}:{})});break;
   case'abort':if(this.active())this.finish(-1,'engineFailure');break;
   case'cancel':if(!this.active()){this.shutdown(false);this.show({phase:'idle',opponent:undefined,registered:[],opponentRoster:[]});}break;
   case'resume':if(this.stateValue.phase==='reconnecting'&&message.identity?.code===this.stateValue.opponent.code&&message.identity?.nonce===this.stateValue.opponent.nonce&&message.identity?.nickname===this.stateValue.opponent.nickname&&profileIcon(message.identity?.icon)===this.stateValue.opponent.icon){clearTimeout(this.reconnectTimer);this.clearDecision();this.show({phase:'playing',submitted:false,error:undefined});if(this.stateValue.host)this.publish();}break;
  }
 }catch(error){this.show({error:error instanceof Error?error.message:'Invalid battle message'});if(this.active())this.engineError(error);}}
 choose(decisionID:string,actions:BattleAction[]){
  const frame=this.stateValue.frame;if(this.stateValue.phase!=='playing'||this.stateValue.submitted||!frame||frame.waiting||frame.decisionID!==decisionID)throw Error('이미 처리되었거나 지난 턴의 명령입니다.');
  const normalized=actions.map(a=>({kind:a.kind,index:a.kind==='pass'?0:a.index,target:a.kind==='move'?a.target:0,...(a.kind==='move'&&a.mega?{mega:true}:{})}));
  if(normalized.length!==frame.slots.length)throw Error('모든 슬롯의 행동을 선택해 주세요.');
  this.pending={decisionID,actions:normalized,order:[]};this.nonce=uuid();const digest=battleDigest(this.pending,this.nonce,this.matchID);this.show({submitted:true,error:undefined});
  if(this.stateValue.host){this.commits.set(0,digest);this.reveals.set(0,this.pending);this.requestReveals();if(this.frames[1]?.waiting)this.resolve();}else this.send('commit',{digest,reason:decisionID});return this.state();
 }
 private requestReveals(){if(this.commits.has(1)&&(this.commits.has(0)||this.frames[0]?.waiting))this.send('revealRequest',{reason:this.frames[1]?.decisionID});}
 private resolve(){if(!this.engine||!this.frames.length)return;for(let p=0;p<2;p++)if(!this.frames[p].waiting&&!this.reveals.has(p))return;clearTimeout(this.timer);const choices=new Map(this.reveals);this.clearDecision();try{for(let p=0;p<2;p++){const choice=choices.get(p);if(choice)this.engine.choose(p,choice.decisionID,choice.actions as BattleAction[],choice.order);}this.publish();}catch(error){this.engineError(error);}}
 private publish(){if(!this.engine)return;const previous=this.stateValue.frame;this.frames=[this.engine.frame(0),this.engine.frame(1)];const ended=this.frames[0].ended;const allowance=playbackAllowance(this.frames,previous);
  const deadline=ended?undefined:Date.now()+this.milliseconds+allowance;this.clearDecision();this.show({phase:'playing',frame:this.frames[0],deadline,submitted:false});this.send('frame',{frame:this.frames[1],...(deadline?{deadline:deadline/1000-978307200}:{})});
  clearTimeout(this.timer);if(ended)this.finish(this.frames[0].winner ?? -1,'completed');else this.timer=setTimeout(()=>{const missing=this.frames.flatMap((frame,p)=>!frame.waiting&&!this.commits.has(p)?[p]:[]);const winner=missing.length===1?1-missing[0]:-1;this.send('timeout',{winner});this.finish(winner,'timeout');},this.milliseconds+allowance);
 }
 private clearDecision(){this.pending=undefined;this.nonce=undefined;this.commits.clear();this.reveals.clear();}
 private engineError(error:unknown){const reason=error instanceof Error?error.message:String(error);try{this.send('error',{reason});}catch{}this.clearDecision();this.show({error:reason,submitted:false});if(this.stateValue.phase==='preparing'){this.engine=undefined;this.clearReady();this.show({phase:'connected'});}else if(this.engine&&this.stateValue.host){this.frames=[this.engine.frame(0),this.engine.frame(1)];this.publish();}}
 surrender(){if(!this.active())return this.state();try{this.send('surrender');}catch{}this.finish(this.stateValue.host?1:0,'surrender');return this.state();}
 private finish(winner:number,reason:string){if(this.stateValue.phase==='ended')return;clearTimeout(this.timer);clearTimeout(this.reconnectTimer);const player=this.stateValue.host?0:1;const result=winner===-1?(reason==='completed'?'draw':'interrupted'):winner===player?'win':'loss';this.show({phase:'ended',outcome:result,submitted:true,deadline:undefined});
  const peer=this.stateValue.opponent;if(peer){const record:BattleRecord={id:this.matchID,opponentCode:peer.code,opponentName:peer.nickname,mode:'singles',startedAt:this.startAt,endedAt:Date.now(),result,reason,team:roster(this.own.slice(0,3)),turns:this.stateValue.frame?.turn??0};this.historyQueue=this.historyQueue.then(async()=>{const path=join(this.directory,'battle-history-v1.json');let records:BattleRecord[];try{records=JSON.parse(await readFile(path,'utf8'));if(!Array.isArray(records))throw Error('Invalid battle history');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;records=[];}if(!records.some(row=>row.id===record.id))records.unshift(record);await writeSaveAtomically(path,JSON.stringify(records.slice(0,100)));this.records=records.slice(0,100);}).catch(error=>this.show({error:'배틀 기록을 저장하지 못했습니다.'}));}
  this.cleanup=setTimeout(()=>this.link?.close(),3000);
 }
 private disconnected(){if(this.stateValue.phase==='reconnecting')return;if(['idle','ended','searching'].includes(this.stateValue.phase))return;if(!this.active()){this.shutdown(false);this.show({phase:'idle',error:'상대와의 연결이 종료되었습니다.',opponent:undefined,registered:[],opponentRoster:[]});return;}clearTimeout(this.timer);this.show({phase:'reconnecting',submitted:false,deadline:undefined,error:'연결이 끊겼습니다. 30초 이내에 다시 연결해 주세요.'});this.reconnectTimer=setTimeout(()=>this.finish(-1,'disconnected'),30000);}
 async history(){await this.historyQueue;try{const records=JSON.parse(await readFile(join(this.directory,'battle-history-v1.json'),'utf8'));if(Array.isArray(records))this.records=records.slice(0,100);}catch{}this.show({history:this.records});return this.state();}
 cancel(){if(this.active())throw Error('진행 중인 대전에서는 기권을 선택해 주세요.');try{this.send('cancel');}catch{}this.shutdown(false);this.registered=this.own=this.peerTeam=[];this.show({phase:'idle',codes:[],registered:[],opponentRoster:[],opponent:undefined,frame:undefined,localReady:false,remoteReady:false,error:undefined});return this.state();}
 async finishWrites(){await this.historyQueue;}
 shutdown(surrender=true){this.discovery.stop();if(surrender&&this.active())this.surrender();clearTimeout(this.timer);clearTimeout(this.reconnectTimer);clearTimeout(this.cleanup);this.link?.close();this.link=undefined;this.engine=undefined;}
}
