import assert from'node:assert/strict';import test from'node:test';import{readFile,readdir,stat}from'node:fs/promises';import{existsSync}from'node:fs';import{join,resolve}from'node:path';import{createHash}from'node:crypto';
import{presentationEvents}from'../dist/shared/battle-presentation.js';
function frame(lines){return{log:lines,logOffset:100,effects:[],scenes:lines.map((line,i)=>({id:100+i,own:[{active:true,status:'tox'}],foe:[{active:true,status:'brn'}]}))};}
test('Mac activation rules distinguish residual toxic, attraction, sleep, guard blocks and weather damage',()=>{
 const f=frame(['|-damage|p1a: One|70/100|[from] psn','|-activate|p2a: Two|move: Attract','|cant|p2a: Two|attract','|cant|p1a: One|slp','|move|p1a: One|Detect|p1a: One','|-activate|p1a: One|move: Protect','|-damage|p2a: Two|80/100|[from] Sandstorm']);const events=presentationEvents(f,0);assert.equal(events[0].move,'commontoxic');assert.equal(events[1].move,'commonattract');assert.notEqual(events[2].phase,'status');assert.equal(events[3].move,'commonsleep');assert.equal(events[5].move,'detect');assert.equal(events[5].phase,'guard');assert.equal(events[6].phase,'weather-hit');assert.equal(events[6].source.own,false);
});
test('successful field activation replaces its preceding move animation and marks global weather',()=>{
 const f=frame(['|move|p2a: Two|Trick Room|p2a: Two','|-fieldstart|move: Trick Room','|-weather|RainDance']);f.effects=[{id:100,move:'trickroom',source:{own:false,slot:0},targets:[{position:{own:false,slot:0},hit:true}]}];const events=presentationEvents(f);assert.equal(events.find(e=>e.id===100)?.phase,'state');assert.equal(events.find(e=>e.id===101).move,'trickroom');assert.equal(events.find(e=>e.id===101).globalField,true);assert.equal(events.find(e=>e.id===101).source.own,false);assert.equal(events.find(e=>e.id===102).move,'commonrain');
});
const reference=resolve(process.env.POKE_MAC_SOURCE??'../PokeTokenBar');
test('the authoritative engine, original animation player and trainer assets retain exact Mac source bytes',{skip:!existsSync(join(reference,'BattleEngine/engine.cjs'))},async()=>{
 const digest=b=>createHash('sha256').update(b).digest('hex');let count=0;
 async function compare(src,dst){for(const entry of await readdir(src,{withFileTypes:true})){if(entry.name==='.DS_Store')continue;const a=join(src,entry.name),b=join(dst,entry.name);if(entry.isDirectory())await compare(a,b);else{assert.equal(digest(await readFile(b)),digest(await readFile(a)),b);count++;}}}
 for(const name of await readdir('src/battle-engine'))if(name!=='LICENSE')assert.equal(digest(await readFile(join('src/battle-engine',name))),digest(await readFile(join(reference,'BattleEngine',name))),name);
 await compare(join(reference,'Sources/PokeTokenBar/Resources/PokeRoguePlayer'),'src/battle-assets/player');await compare(join(reference,'Sources/PokeTokenBar/Resources/BattleText/ChallengeTrainers'),'src/battle-assets/trainers');assert.ok(count>1000);
});
