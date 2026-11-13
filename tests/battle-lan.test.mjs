import assert from 'node:assert/strict';
import test from 'node:test';
import{mkdtemp,rm,writeFile,readFile}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';
import{LanBattle,battleDigest}from'../dist/main/battle/lan.js';
import{practiceTeam}from'../dist/main/battle/team.js';
import{execFileSync,execFile}from'node:child_process';
import{promisify}from'node:util';
async function until(check){for(let i=0;i<400;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,15));}throw Error('Battle timed out');}
async function peers(t){const roots=await Promise.all([mkdtemp(join(tmpdir(),'ptb-lan-left-')),mkdtemp(join(tmpdir(),'ptb-lan-right-'))]);for(const[index,code]of ['AAAAAAAA','ZZZZZZZZ'].entries())await writeFile(join(roots[index],'battle-identity-v1.json'),JSON.stringify({version:1,code}));const a=new LanBattle(roots[0],()=>{}),b=new LanBattle(roots[1],()=>{});t.after(async()=>{a.shutdown(false);b.shutdown(false);await Promise.all([a.finishWrites(),b.finishWrites()]);await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})));});await a.host('Left');await b.connect('127.0.0.1:'+a.state().codes[0].split(':')[1],'Right');await until(()=>a.state().opponent&&b.state().opponent);return{a,b,roots};}
function action(state){return state.frame.slots.map(slot=>{if(slot.canPass)return{kind:'pass'};if(slot.mustSwitch)return{kind:'switch',index:state.frame.own.findIndex(p=>!p.active&&!p.fainted)+1};const move=slot.moves.filter(m=>!m.disabled&&m.pp>0).sort((a,b)=>(b.power??0)-(a.power??0))[0];return{kind:'move',index:move.index,target:0};});}
async function ready(a,b){a.register(practiceTeam());b.register(practiceTeam());await until(()=>a.state().opponentRoster.length===6&&b.state().opponentRoster.length===6);a.ready(practiceTeam().map(p=>p.id));b.ready(practiceTeam().map(p=>p.id));await until(()=>a.state().frame&&b.state().frame);}
test('LAN uses public six-member previews, first-three singles, committed actions and saved bilateral results',async t=>{
 const{a,b,roots}=await peers(t);assert.equal(a.state().host,true);assert.equal(b.state().host,false);a.register(practiceTeam());b.register(practiceTeam());await until(()=>a.state().opponentRoster.length===6&&b.state().opponentRoster.length===6);
 assert.equal('moves' in a.state().opponentRoster[0],false);assert.equal('stats' in a.state().opponentRoster[0],false);assert.equal('ability' in a.state().opponentRoster[0],false);
 a.ready(practiceTeam().map(p=>p.id));b.ready(practiceTeam().map(p=>p.id));await until(()=>a.state().frame&&b.state().frame);
 assert.equal(a.state().frame.own.length,3);assert.equal(a.state().frame.foe.length,1);assert.equal(a.state().frame.foe[0].maxHP,100);assert.equal(a.state().frame.foe[0].stats,undefined);
 const old=a.state().frame.decisionID,guestOld=b.state().frame.decisionID,oldHP=a.state().frame.own[0].hp;
 a.choose(old,action(a.state()));await new Promise(resolve=>setTimeout(resolve,40));assert.equal(a.state().submitted,true);assert.equal(a.state().frame.own[0].hp,oldHP);
 b.choose(guestOld,action(b.state()));await until(()=>a.state().frame.decisionID!==old&&b.state().frame.decisionID!==guestOld);
 assert.ok(a.state().frame.turn>=2);assert.throws(()=>a.choose(old,action(a.state())),/지난 턴/);
 a.surrender();await until(()=>b.state().phase==='ended');assert.equal(a.state().outcome,'loss');assert.equal(b.state().outcome,'win');
 await Promise.all([a.finishWrites(),b.finishWrites()]);const left=JSON.parse(await readFile(join(roots[0],'battle-history-v1.json'),'utf8')),right=JSON.parse(await readFile(join(roots[1],'battle-history-v1.json'),'utf8'));
 assert.equal(left.length,1);assert.equal(left[0].team.length,3);assert.equal(left[0].id,right[0].id);assert.equal(right[0].result,'win');
});
test('LAN reconnect retains the host engine and discards unfinished decisions',async t=>{
 const{a,b}=await peers(t);await ready(a,b);const turn=a.state().frame.turn;a.choose(a.state().frame.decisionID,action(a.state()));a.link.socket.destroy();await until(()=>a.state().phase==='reconnecting'&&b.state().phase==='reconnecting');
 await assert.rejects(()=>b.connect('invalid','Right'),/연결 코드/);assert.equal(b.state().phase,'reconnecting');assert.equal(b.active(),true);await a.host('Left');await b.connect('127.0.0.1:'+a.state().codes[0].split(':')[1],'Right');await until(()=>a.state().phase==='playing'&&b.state().phase==='playing');
 assert.equal(a.state().frame.turn,turn);assert.equal(a.state().submitted,false);assert.equal(b.state().submitted,false);
 a.choose(a.state().frame.decisionID,action(a.state()));b.choose(b.state().frame.decisionID,action(b.state()));await until(()=>a.state().frame.turn>turn);assert.equal(a.state().error,undefined);
});
test('canonical battle commitments include the match, nonce, action and mega choice',()=>{
 const decision={decisionID:'1:move::12',actions:[{kind:'move',index:2,target:0,mega:true}],order:[]};const expected=battleDigest(decision,'nonce','match');assert.equal(expected.length,64);assert.equal(expected,battleDigest({order:[],actions:[{target:0,index:2,kind:'move',mega:true}],decisionID:decision.decisionID},'nonce','match'));assert.notEqual(expected,battleDigest(decision,'other','match'));assert.notEqual(expected,battleDigest({...decision,actions:[{kind:'move',index:2,target:0}]},'nonce','match'));
});
test('Windows LAN discovery lists nearby singles peers and stops when leaving the lobby',async t=>{
 const dirs=await Promise.all([mkdtemp(join(tmpdir(),'ptb-discover-a-')),mkdtemp(join(tmpdir(),'ptb-discover-b-'))]);for(const[i,code]of ['AAAAAAAA','BBBBBBBB'].entries())await writeFile(join(dirs[i],'battle-identity-v1.json'),JSON.stringify({version:1,code}));const a=new LanBattle(dirs[0],()=>{}),b=new LanBattle(dirs[1],()=>{});t.after(async()=>{a.shutdown(false);b.shutdown(false);await Promise.all(dirs.map(dir=>rm(dir,{recursive:true,force:true})));});await a.host('Discovery A');await b.host('Discovery B');await until(()=>a.state().peers?.some(p=>p.code==='BBBBBBBB')&&b.state().peers?.some(p=>p.code==='AAAAAAAA'));assert.equal(a.state().peers[0].nickname,'Discovery B');a.cancel();b.cancel();
});
test('commitment hashes match the original Swift BattleAction, BattleDecision and digest implementation', {skip:!process.env.POKE_MAC_BATTLE_ORACLE},()=>{
 const rows=[{decision:{decisionID:'1:move::12',actions:[{kind:'move',index:1,target:0}],order:[]},nonce:'nonce',matchID:'match'},{decision:{decisionID:'日本語/교체',actions:[{kind:'switch',index:3,target:0}],order:[2,0,1]},nonce:'ABC',matchID:'DEF'},{decision:{decisionID:'mega',actions:[{kind:'move',index:2,target:1,mega:true}],order:[]},nonce:'N',matchID:'M'}];const actual=JSON.parse(execFileSync(process.env.POKE_MAC_BATTLE_ORACLE,[],{input:JSON.stringify(rows),encoding:'utf8'}));assert.deepEqual(actual,rows.map(row=>battleDigest(row.decision,row.nonce,row.matchID)));
});

for(const macHost of [false,true])test('the original Mac BattleCoordinator completes a committed singles turn as '+(macHost?'host':'guest')+' over manual TCP', {skip:!process.env.POKE_MAC_BATTLE_PEER},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ptb-original-battle-'));const a=new LanBattle(dir,()=>{});t.after(async()=>{a.shutdown(false);await a.finishWrites();await rm(dir,{recursive:true,force:true});});await writeFile(join(dir,'battle-identity-v1.json'),JSON.stringify({version:1,code:macHost?'ZZZZZZZZ':'AAAAAAAA'}));await a.host('Windows Fixture');const port=a.state().codes[0].split(':')[1],team=join(dir,'mac-team.json');await writeFile(team,JSON.stringify(practiceTeam()));const child=promisify(execFile)(process.env.POKE_MAC_BATTLE_PEER,['127.0.0.1:'+port,team,join(dir,'mac-history.json'),macHost?'host':'guest'],{timeout:20000,env:{...process.env,LLVM_PROFILE_FILE:join(dir,'mac.profraw')}});void child.catch(()=>{});await until(()=>a.state().opponent&&a.state().opponentRoster.length===6);assert.equal(a.state().host,!macHost);a.register(practiceTeam());await until(()=>a.state().remoteReady);a.ready(practiceTeam().map(m=>m.id));await until(()=>a.state().frame);a.choose(a.state().frame.decisionID,action(a.state()));await until(()=>a.state().phase==='ended');assert.equal(a.state().outcome,'win');const output=JSON.parse((await child).stdout);assert.equal(output.played,true);assert.equal(output.result,'loss');assert.equal(output.turn,2);assert.equal(output.teamCount,3);assert.equal(output.historyCount,1);await a.finishWrites();assert.equal((await a.history()).history.length,1);
});
