import assert from'node:assert/strict';import test from'node:test';import{readFile,readdir}from'node:fs/promises';import{join,resolve}from'node:path';import{createHash}from'node:crypto';
import{presentationEvents}from'../dist/shared/battle-presentation.js';
import{hasMacReference,macSourceBlobs}from'./mac-reference.mjs';
function frame(lines){return{log:lines,logOffset:100,effects:[],scenes:lines.map((line,i)=>({id:100+i,own:[{active:true,status:'tox'}],foe:[{active:true,status:'brn'}]}))};}
test('Mac activation rules distinguish residual toxic, attraction, sleep, guard blocks and weather damage',()=>{
 const f=frame(['|-damage|p1a: One|70/100|[from] psn','|-activate|p2a: Two|move: Attract','|cant|p2a: Two|attract','|cant|p1a: One|slp','|move|p1a: One|Detect|p1a: One','|-activate|p1a: One|move: Protect','|-damage|p2a: Two|80/100|[from] Sandstorm']);const events=presentationEvents(f,0);assert.equal(events[0].move,'commontoxic');assert.equal(events[1].move,'commonattract');assert.notEqual(events[2].phase,'status');assert.equal(events[3].move,'commonsleep');assert.equal(events[5].move,'detect');assert.equal(events[5].phase,'guard');assert.equal(events[6].phase,'weather-hit');assert.equal(events[6].source.own,false);
});
test('successful field activation replaces its preceding move animation and marks global weather',()=>{
 const f=frame(['|move|p2a: Two|Trick Room|p2a: Two','|-fieldstart|move: Trick Room','|-weather|RainDance']);f.effects=[{id:100,move:'trickroom',source:{own:false,slot:0},targets:[{position:{own:false,slot:0},hit:true}]}];const events=presentationEvents(f);assert.equal(events.find(e=>e.id===100)?.phase,'state');assert.equal(events.find(e=>e.id===101).move,'trickroom');assert.equal(events.find(e=>e.id===101).globalField,true);assert.equal(events.find(e=>e.id===101).source.own,false);assert.equal(events.find(e=>e.id===102).move,'commonrain');
});
const reference=resolve(process.env.POKE_MAC_SOURCE??'../PokeTokenBar');
test('the engine, animation player and trainer assets match Mac (LF-normalized text, exact binary bytes)',{skip:!hasMacReference},async t=>{
 const mappings=[['BattleEngine','src/battle-engine'],['Sources/PokeTokenBar/Resources/PokeRoguePlayer','src/battle-assets/player'],['Sources/PokeTokenBar/Resources/BattleText/ChallengeTrainers','src/battle-assets/trainers']];
 const blobs=macSourceBlobs(mappings.map(([path])=>path),reference),engineFiles=new Set(await readdir('src/battle-engine'));let count=0;
 for(const [path,expected]of blobs){
  if(path.endsWith('/.DS_Store')||path==='BattleEngine/LICENSE')continue;
  if(path.startsWith('BattleEngine/')&&!engineFiles.has(path.slice('BattleEngine/'.length)))continue;
  const [source,target]=mappings.find(([source])=>path.startsWith(source+'/'));
  const local=join(target,path.slice(source.length+1)),raw=await readFile(local);
  const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(blob(raw)===expected){count++;continue;}
  // Windows Git checkouts use CRLF for text. Binary asset bytes remain untouched.
  const text=raw.toString('utf8'),isText=!raw.includes(0)&&Buffer.from(text).equals(raw);
  const bytes=isText?Buffer.from(text.replaceAll('\r\n','\n')):raw;
  // Git blob IDs hash the header plus exact file bytes, independent of checkout state.
  assert.equal(blob(bytes),expected,local);count++;
 }
 for(const name of await readdir('src/battle-engine'))if(name!=='LICENSE')assert.ok(blobs.has('BattleEngine/'+name),name);
 assert.ok(count>1000);t.diagnostic('Compared '+count+' files against the selected Mac branch');
});
