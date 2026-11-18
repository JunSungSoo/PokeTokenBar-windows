import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompanionStore} from '../dist/main/companion/store.js';
import {generateProfile,enrichIdentity,abilityOptions} from '../dist/main/companion/profile.js';
import {trackedClaudeAccount,limitWarning,preserveLimits} from '../dist/shared/limit-tracking.js';
import {projectDetailView} from '../dist/shared/pokemon-details.js';
import {SessionKeys} from '../dist/main/usage/session-key.js';
import {parsePokemonDetails,presentPokemonDetails} from '../dist/main/companion/pokemon-details.js';
import {detailFixture,method} from './pokemon-details-fixtures.mjs';
const now=1800000000000;
async function directory(t){const path=await mkdtemp(join(tmpdir(),'ptb-parity-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
test('seeded profile enrichment fills gender and slots, keeps chosen values and repairs BW2 abilities',()=>{
 const fixture=detailFixture(),details=parsePokemonDetails(fixture.pokemon,fixture.species,1);
 let hidden=0;
 for(let seed=0;seed<512;seed++){const profile=generateProfile(BigInt(seed),'test');enrichIdentity(profile,details);assert.ok(['male','female'].includes(profile.gender));assert.ok(profile.abilityName);assert.ok([1,3].includes(profile.abilitySlot));if(profile.abilityIsHidden)hidden++;const before=structuredClone(profile);enrichIdentity(profile,details);assert.deepEqual(profile,before);}
 assert.ok(hidden>0&&hidden<20);
 const profile=generateProfile(123n,'gengar');enrichIdentity(profile,{speciesID:94,genderRate:4,abilities:[{name:'cursed-body',slot:1,isHidden:false}]});assert.equal(profile.abilityName,'Levitate');
 assert.deepEqual(abilityOptions(94).map(a=>a.name),['Levitate']);
});
test('new hatch retains prayers and identity without network; ability changes persist without changing IVs',async t=>{
 const path=join(await directory(t),'save.json'),store=new CompanionStore(path,()=>false);
 await store.replaceImport({raised:0,progress:4999999,active:null,graduated:[],pendingHatchID:1,eggPrayers:3},now);
 await store.update(new Map([['claude',[{id:'hatch',time:now+1,tokens:{total:1}}]]]),now+1);
 const initial=await store.read();assert.equal(initial.active.prayers,3);assert.ok(initial.active.gender);assert.ok(initial.active.ability);
 const result=await store.change({kind:'ability',id:initial.active.id,name:'Chlorophyll'});
 assert.equal(result.active.ability,'Chlorophyll');assert.equal(result.active.abilityIsHidden,true);assert.deepEqual(result.active.ivs,initial.active.ivs);assert.equal(result.active.nature,initial.active.nature);
 const bytes=await readFile(path,'utf8');await assert.rejects(()=>store.change({kind:'ability',id:initial.active.id,name:'Levitate'}));assert.equal(await readFile(path,'utf8'),bytes);
 assert.equal((await new CompanionStore(path).read()).active.ability,'Chlorophyll');
});
test('tracking follows activity/highest/pinned fallback and warnings use critical or depletion',()=>{
 const row=(id,used,last)=>({provider:'claude',accountID:id,status:'available',lastActivityAt:last,windows:[{label:'5시간',usedPercent:used,resetsAt:now+7200000,forecastEligible:true}]});
 const a=row('claude-default',85,now-1000),b=row('claude-second',50,now);
 assert.equal(trackedClaudeAccount([a,b]).accountID,b.accountID);assert.equal(trackedClaudeAccount([a,b],'highest').accountID,a.accountID);assert.equal(trackedClaudeAccount([a,b],'defaultAccount').accountID,a.accountID);assert.equal(trackedClaudeAccount([a,b],'missing').accountID,b.accountID);
 assert.equal(limitWarning([a],95,'automatic',now),false);
 b.block={totalTokens:600000,tokensPerMinute:10000,startTime:now-3600000,endTime:now+7200000};assert.equal(limitWarning([a,b],95,'automatic',now),true);assert.equal(limitWarning([a,b],95,'claude-default',now),false);
 const stale=preserveLimits([a],[{...a,status:'failed',windows:[],checkedAt:now,error:'oauthExpired'}])[0];assert.equal(stale.status,'available');assert.deepEqual(stale.windows,a.windows);assert.equal(stale.stale,true);assert.equal(stale.error,'oauthExpired');
});
test('Arceus form projection updates type and Judgment without mutating metadata',()=>{
 const fixture=detailFixture(493);fixture.pokemon.name='arceus';fixture.pokemon.types=[{slot:1,type:{name:'normal'}}];fixture.pokemon.moves=[{move:{name:'judgment'},version_group_details:[method('level-up',100)]}];
 const raw=presentPokemonDetails(parsePokemonDetails(fixture.pokemon,fixture.species,493),'en'),before=structuredClone(raw),view=projectDetailView(raw,'fire');
 assert.deepEqual(view.details.types,['fire']);assert.equal(view.labels.moves.judgment.type,'Fire');assert.deepEqual(raw,before);
});
test('session keys isolate accounts, skip unusable orgs, pick active org and fall back after 403',async t=>{
 const root=await directory(t),calls=[],key='sk-ant-'+ 'a'.repeat(40),cipher={encrypt:value=>Buffer.from(value).reverse(),decrypt:value=>Buffer.from(value).reverse().toString()};
 let forbid=false;
 const keys=new SessionKeys(root,cipher,async(url,options)=>{calls.push(url);assert.equal(options.headers.Cookie,'sessionKey='+key);if(url.endsWith('/organizations'))return Response.json([{uuid:'api',capabilities:['api']},{uuid:'idle',name:'Idle'},{uuid:'active',name:'Active'}]);if(url.includes('/api/usage'))throw Error('API-only organization requested');if(url.includes('/active/')&&forbid)return new Response(null,{status:403});return Response.json({five_hour:{utilization:url.includes('/active/')?50:0,resets_at:null}});});
 await keys.save('claude-default',key);await keys.usage('claude-default');assert.equal((await keys.state('claude-default')).organizationID,'active');assert.equal((await keys.state('claude-other')).configured,false);assert.equal((await readFile(join(root,'claude-default.bin'))).includes(Buffer.from(key)),false);
 forbid=true;await keys.usage('claude-default');assert.equal((await keys.state('claude-default')).organizationID,'idle');await keys.clear('claude-default');assert.equal((await keys.state('claude-default')).configured,false);
});

test('Mac v2 export preserves profiles, prayers, history, claims and items through import',async t=>{
 const {decodeMacSave}=await import('../dist/main/companion/mac-save.js');
 const fixture=JSON.parse(await readFile(new URL('./fixtures/poketokenbar-macos-v2.json',import.meta.url),'utf8'));
 fixture.state.active.prayers={count:7};fixture.state.collectedFinals=['133:197','1:3'];fixture.state.inventory.redMaple=2;
 const progress=decodeMacSave(Buffer.from(JSON.stringify(fixture))).progress;
 const path=join(await directory(t),'save.json'),store=new CompanionStore(path,()=>false);await store.replaceImport(progress,now);
 const before=await readFile(path),text=await store.exportMac('1.0.0','ko',now),exported=JSON.parse(text),roundtrip=decodeMacSave(Buffer.from(text));
 assert.equal(exported.schema,2);assert.equal(exported.format,'poketokenbar.save');assert.equal(exported.state.active.prayers.count,7);assert.ok(!/\.\d{3}Z/.test(text));
 assert.equal(roundtrip.progress.active.prayers,7);assert.equal(roundtrip.progress.inventory.redMaple,2);assert.ok(roundtrip.progress.collectedFinals.includes('1:3'));assert.equal(roundtrip.progress.graduated[1].releasedAt,progress.graduated[1].releasedAt);
 assert.deepEqual(roundtrip.progress.active.macProfile,progress.active.macProfile);assert.deepEqual(await readFile(path),before);
 const imported=new CompanionStore(join(await directory(t),'imported.json'));await imported.replaceImport(roundtrip.progress,now);assert.deepEqual((await imported.read()).active,(await store.read()).active);
});

test('candy preview reports graduation loss and evolution carryover',async()=>{
 const {candyPreview}=await import('../dist/shared/companion-presentation.js');
 assert.deepEqual(candyPreview(90000000,[{threshold:100000000,species:{number:2}},{threshold:200000000,species:null}],1),{evolves:true,graduates:false,carryoverXP:90000000,discardedXP:0});
 assert.deepEqual(candyPreview(90000000,[{threshold:100000000,species:null}],1),{evolves:false,graduates:true,carryoverXP:0,discardedXP:90000000});
});

test('late organization discovery cannot restore a cleared or replaced session credential',async t=>{
 const root=await directory(t),cipher={encrypt:v=>Buffer.from(v),decrypt:v=>v.toString()};
 for(const action of ['clear','replace']){
  let release,started;const entered=new Promise(r=>started=r),wait=new Promise(r=>release=r);
  const keys=new SessionKeys(root,cipher,async url=>{if(url.endsWith('/organizations')){started();await wait;return Response.json([{uuid:'old'}]);}return Response.json({five_hour:{utilization:1}});});
  await keys.save('claude-default','sk-ant-'+'a'.repeat(40));const usage=keys.usage('claude-default');await entered;
  if(action==='clear')await keys.clear('claude-default');else await keys.save('claude-default','sk-ant-'+'b'.repeat(40),'new');release();await usage;
  const state=await keys.state('claude-default');assert.equal(state.configured,action!=='clear');assert.equal(state.organizationID,action==='clear'?undefined:'new');assert.deepEqual(state.organizations,[]);
 }
});

test('generated identity matches original Swift for identical seeds and metadata',{skip:!process.env.POKE_MAC_PROFILE_ORACLE&&'Run portable Swift parity to compile the original Mac profile oracle'},async()=>{
 const {execFileSync}=await import('node:child_process');const {profileMetadata}=await import('../dist/main/companion/profile.js');
 const rows=[1,29,32,81,94,133,493,649].flatMap(speciesID=>[0n,1n,123456789n,18446744073709551615n,...Array.from({length:64},(_,i)=>BigInt(i+10))].map(seed=>({seed:String(seed),details:profileMetadata(speciesID),legal:abilityOptions(speciesID)})));
 const swift=JSON.parse(execFileSync(process.env.POKE_MAC_PROFILE_ORACLE,[],{input:JSON.stringify(rows),maxBuffer:8000000}));
 for(const [index,row]of rows.entries()){const p=generateProfile(BigInt(row.seed),'test');enrichIdentity(p,row.details);for(const field of ['ivs','gender','abilitySlot','abilityName','abilityIsHidden'])assert.deepEqual(p[field],swift[index][field],`${row.details.speciesID}/${row.seed}/${field}`);}
});

test('evolution planning chooses the only uncollected Eevee final and retains released history',async t=>{
 const store=new CompanionStore(join(await directory(t),'save.json'),()=>false);
 const finals=[134,135,136,196,197,470].map(id=>'133:'+id);
 await store.replaceImport({raised:0,progress:4999999,active:null,graduated:[],pendingHatchID:133,collectedFinals:finals},now);
 await store.update(new Map([['claude',[{id:'eevee',time:now+1,tokens:{total:1}}]]]),now+1);
 assert.equal((await store.read()).active.species.at(-1).number,133);
 // The evolution route is persisted in the Mac-compatible export, including future stages.
 const exported=JSON.parse(await store.exportMac('1','en',now));assert.deepEqual(exported.state.active.plannedPathIDs,[133,471]);assert.ok(exported.state.collectedFinals.includes('133:197'));
});

test('account activity, daily/monthly tokens and costs follow prompt ownership on shared sessions',async t=>{
 const {mkdir,writeFile}=await import('node:fs/promises');const {withAccountBlocks}=await import('../dist/main/usage/claude-accounts.js');
 const root=await directory(t),sources=[];
 for(const [id,offset]of [['a',-60000],['b',-20000]]){const path=join(root,id);await mkdir(path);await writeFile(join(path,'history.jsonl'),JSON.stringify({sessionId:'shared',timestamp:now+offset})+'\n');sources.push({id:'claude-'+id,roots:[path],isDefault:false});}
 const tokens=total=>({input:total,output:0,cacheRead:0,cacheWrite:0,total});
 const entries=[{id:'a',time:now-50000,claudeSessions:['shared'],tokens:tokens(100),explicitCost:1},{id:'b',time:now-10000,claudeSessions:['shared'],tokens:tokens(200),explicitCost:2},{id:'unknown',time:now-10000,claudeSessions:['other'],tokens:tokens(999),explicitCost:9}];
 const rows=await withAccountBlocks(sources.map(source=>({provider:'claude',accountID:source.id,status:'available',windows:[]})),entries,sources,now);
 assert.deepEqual(rows.map(row=>row.accountUsage.todayTokens),[100,200]);assert.deepEqual(rows.map(row=>row.accountUsage.monthCost.amount),[1,2]);assert.equal(trackedClaudeAccount(rows.map(row=>({...row,windows:[{usedPercent:10}]}))).accountID,'claude-b');
});

test('session authentication and throttling errors remain distinguishable',async t=>{
 const {LimitsError}=await import('../dist/main/usage/session-key.js');
 for(const [status,kind]of [[401,'sessionKeyExpired'],[429,'rateLimited']]){const keys=new SessionKeys(await directory(t),{encrypt:v=>Buffer.from(v),decrypt:v=>v.toString()},async()=>new Response(null,{status}));await keys.save('claude-default','sk-ant-'+'a'.repeat(40));await assert.rejects(()=>keys.usage('claude-default'),error=>error instanceof LimitsError&&error.kind===kind);}
});

test('organization refresh preserves an explicitly selected organization',async t=>{
 const keys=new SessionKeys(await directory(t),{encrypt:v=>Buffer.from(v),decrypt:v=>v.toString()},async url=>url.endsWith('/organizations')?Response.json([{uuid:'first',capabilities:['chat']},{uuid:'chosen',capabilities:['chat']}]):Response.json({five_hour:{utilization:url.includes('/chosen/')?60:20,resets_at:'2030-01-01T00:00:00Z'}}));
 await keys.save('claude-default','sk-ant-'+'a'.repeat(40));await keys.usage('claude-default');await keys.select('claude-default','chosen');await keys.organizations('claude-default');assert.equal((await keys.state('claude-default')).organizationID,'chosen');assert.equal((await keys.usage('claude-default')).five_hour.utilization,60);
});
test('organization-list 403 is session expiry, while an individual forbidden organization can be rediscovered',async t=>{
 const keys=new SessionKeys(await directory(t),{encrypt:v=>Buffer.from(v),decrypt:v=>v.toString()},async()=>new Response(null,{status:403}));await keys.save('claude-default','sk-ant-'+'a'.repeat(40),'old');await assert.rejects(()=>keys.usage('claude-default'),error=>error.kind==='sessionKeyExpired');
});

test('limit warning receipts distinguish equal display names and repeated window labels',async()=>{
 const {limitAlerts}=await import('../dist/main/usage/limit-alerts.js');const ledger={};
 const windows=[{label:'주간',usedPercent:90,resetsAt:2000000000000},{label:'주간',usedPercent:90,resetsAt:2000000000000}];const rows=['claude-one','claude-two'].map(accountID=>({provider:'claude',accountID,account:'same@example.invalid',status:'available',windows}));
 assert.equal(limitAlerts(rows,ledger,80,95).length,4);assert.deepEqual(limitAlerts(rows,ledger,80,95),[]);
});
