import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,mkdir,readFile,writeFile,readdir,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{CompanionStore}from'../dist/main/companion/store.js';import{CompanionEvents,companionChanges}from'../dist/main/companion/events.js';import{claudeAccountSources}from'../dist/main/usage/claude-accounts.js';
async function dir(t){const p=await mkdtemp(join(tmpdir(),'ptb-features-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
const now=1800000000000;
test('damaged save restores newest valid snapshot, preserves corrupt bytes and permits subsequent import',async t=>{
 const root=await dir(t),path=join(root,'companion-v1.json'),store=new CompanionStore(path,()=>false);await store.replaceImport({raised:123,progress:123,active:null,graduated:[]},now);await store.createSnapshot();const[id]=await store.snapshots();const progress=await store.snapshotProgress(id.id);
 await writeFile(join(root,'snapshots','newer-broken.json'),'{');await writeFile(path,'{"bad":');
 const restarted=new CompanionStore(path,()=>false);assert.equal((await restarted.read()).raised,123);const files=await readdir(root),backup=files.find(n=>n.includes('.corrupt-'));assert.equal(await readFile(join(root,backup),'utf8'),'{"bad":');
 await writeFile(path,'{');await restarted.replaceImport(progress,now+1);assert.equal((await restarted.read()).raised,123);
});
test('unrecoverable save is preserved and snapshot retention keeps ten',async t=>{
 const root=await dir(t),path=join(root,'save.json');await writeFile(path,'{');const store=new CompanionStore(path);assert.equal((await store.read()).raised,0);assert.ok((await readdir(root)).some(n=>n.includes('.corrupt-')));
 for(let i=0;i<12;i++)await store.createSnapshot();assert.equal((await store.snapshots()).length,10);
});
test('Claude discovers both account folder patterns, default identity and deduplicates manual aliases',async t=>{
 const root=await dir(t);await mkdir(join(root,'.claude'));await writeFile(join(root,'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:'main@example.invalid'}}));
 for(const name of ['.claude-team','.claude_work']){await mkdir(join(root,name));await writeFile(join(root,name,'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:name+'@example.invalid'}}));}
 await mkdir(join(root,'.claude-empty'));
 const rows=await claudeAccountSources([join(root,'.claude-team')],root);assert.equal(rows[0].identity,'main@example.invalid\n');assert.equal(rows.length,3);assert.ok(rows.some(r=>r.roots.includes(join(root,'.claude_work'))));
});
test('life-cycle notices distinguish evolution, graduation, hatch and Ditto without duplicates after restart/import',async t=>{
 const path=join(await dir(t),'events.json'),store=new CompanionStore(join(await dir(t),'save.json'),()=>false);let view=await store.read();const events=new CompanionEvents(path);assert.deepEqual(await events.observe(view),[]);
 await store.replaceImport({raised:0,progress:4999999,active:null,graduated:[],pendingHatchID:1},now);view=await store.update(new Map([['claude',[{id:'hatch',time:now+1,tokens:{total:1}}]]]),now+1);assert.equal((await events.observe(view))[0].title,view.active.shiny?'✨ 이로치 부화!':'🥚 부화!');assert.deepEqual(await events.observe(view),[]);
 const evolved=structuredClone(view);evolved.current={...view.current,number:2,name:'이상해풀'};assert.equal(companionChanges(view,evolved)[0].title,'✨ 진화!');
 const graduated=structuredClone(view);graduated.active=null;graduated.captures=[{...view.active,graduatedAt:now+2}];assert.equal(companionChanges(view,graduated)[0].title,'🎓 졸업!');
 const revealed={...view,dittoReveal:{id:'ditto',disguise:'이상해씨',shiny:false}};assert.ok(companionChanges(view,revealed).some(n=>n.title.includes('메타몽')));
 const complete=structuredClone(view);complete.collection=Array.from({length:151},(_,i)=>({number:i+1,name:String(i),type:'normal'}));assert.equal((await events.observe(complete)).filter(n=>n.title.includes('도감')).length,1);assert.deepEqual(await events.observe(complete),[]);
 assert.deepEqual(await new CompanionEvents(path).observe(complete),[]);assert.deepEqual(await events.observe({...complete,active:null},false),[]);
});
import {utimes} from 'node:fs/promises';
import {expandScanRoots} from '../dist/main/usage/scan-roots.js';
import {matchingScanFiles,collectUsage} from '../dist/main/usage/scan.js';
test('multiple custom roots expand wildcards, deduplicate aliases and preview exactly the files scanned',async t=>{
 const root=await dir(t);for(const folder of ['claude-a','claude-b']){await mkdir(join(root,folder));await writeFile(join(root,folder,'usage.jsonl'),JSON.stringify({type:'assistant',timestamp:new Date(now).toISOString(),message:{id:folder,model:'claude-sonnet-4',usage:{input_tokens:10,output_tokens:5}}})+'\n');await utimes(join(root,folder,'usage.jsonl'),new Date(now),new Date(now));await writeFile(join(root,folder,'unrelated.txt'),'ignored');}
 const raw=join(root,'claude-*')+'\n'+join(root,'claude-a');assert.equal((await expandScanRoots(raw)).length,2);assert.equal((await matchingScanFiles('claude',raw)).count,2);const usage=await collectUsage('claude',raw,new Date(now+1),[]);assert.equal(usage.today.total,30);assert.equal(usage.unreadable,0);
});

test('one large usage update emits every committed hatch/evolution/graduation event exactly once',async t=>{
 const batches=[],store=new CompanionStore(join(await dir(t),'save.json'),()=>false,events=>batches.push(...events));await store.replaceImport({raised:0,progress:4999999,active:null,graduated:[],pendingHatchID:1},now);const view=await store.update(new Map([['claude',[{id:'large',time:now+1,tokens:{total:10000000000}}]]]),now+1);assert.deepEqual(batches.map(n=>n.title),[view.captures[0].shiny?'✨ 이로치 부화!':'🥚 부화!','✨ 진화!','✨ 진화!','🎓 졸업!']);await store.update(new Map([['claude',[{id:'large',time:now+1,tokens:{total:10000000000}}]]]),now+2);assert.equal(batches.length,4);
});

import{execFileSync}from'node:child_process';
test('concurrent recovery reads preserve one original and return the same valid snapshot',async t=>{
 const root=await dir(t),path=join(root,'save.json'),store=new CompanionStore(path);await store.replaceImport({raised:123,progress:0,active:null,graduated:[]},now);await store.createSnapshot();await writeFile(path,'{');const views=await Promise.all([new CompanionStore(path).read(),new CompanionStore(path).read()]);assert.deepEqual(views.map(v=>v.raised),[123,123]);assert.equal((await readdir(root)).filter(n=>n.includes('.corrupt-')).length,1);
});
test('persistent diagnostics detect an unclean previous run, rotate logs and remove the clean marker',async t=>{
 const root=await dir(t),module=new URL('../dist/main/diagnostics.js',import.meta.url).href;
 const run=clean=>execFileSync(process.execPath,['--input-type=module','-e',`import{installDiagnostics}from ${JSON.stringify(module)};const d=installDiagnostics(${JSON.stringify(root)});d.write('fixture');${clean?'d.clean();':''}`]);
 run(false);run(true);assert.match(await readFile(join(root,'PokeTokenBar.log'),'utf8'),/did not exit cleanly/);assert.equal((await readdir(root)).includes('running'),false);
 await writeFile(join(root,'PokeTokenBar.log'),'x'.repeat(2100000));run(true);assert.equal((await readFile(join(root,'PokeTokenBar.log.1'),'utf8')).length,2100000);
});
