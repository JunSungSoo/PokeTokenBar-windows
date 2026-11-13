import{execFileSync}from'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm}from'node:fs/promises';
import {join}from'node:path';import{tmpdir}from'node:os';
import {CompanionStore}from'../dist/main/companion/store.js';
import {decodeMacSave}from'../dist/main/companion/mac-save.js';
import {speciesFor}from'../dist/main/companion/catalog.js';
import {formCatalog}from'../dist/main/companion/forms.js';
import {heldItems}from'../dist/main/companion/battle-items.js';
import {assignHeldItems,allowsHeldItem}from'../dist/shared/held-items.js';
import {wireItem,readTradeItem}from'../dist/main/trade/item.js';
const fixture=new URL('./fixtures/poketokenbar-macos-v2.json',import.meta.url);
async function storage(t){const dir=await mkdtemp(join(tmpdir(),'ptb-held-items-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'companion-v1.json'),store=new CompanionStore(path,()=>false);const mon=(id,species)=>({id,family:-1,stage:0,route:[speciesFor(species)],rarity:'common',hatchedAt:100,nature:'성실',shiny:false,repeat:false,level:100});await store.replaceImport({raised:100,progress:0,active:mon('active',3),graduated:[{...mon('one',6),graduatedAt:200},{...mon('two',9),graduatedAt:200},{...mon('released',6),graduatedAt:200,releasedAt:300}]},400);return{dir,path,store};}
test('collection defaults survive restart, Windows backup and trade without spending tokens or modifying profiles',async t=>{
 const{store,path}=await storage(t),before=await store.read();await store.change({kind:'battle-default-item',id:'one',item:'charizarditex'});await store.change({kind:'battle-default-item',id:'two',item:'leftovers'});
 const restored=await new CompanionStore(path).read();assert.equal(restored.captures[0].battleDefaultItem,'charizarditex');assert.equal(restored.captures[1].battleDefaultItem,'leftovers');assert.equal(restored.economy.wallet,before.economy.wallet);assert.equal(restored.captures[0].nature,before.captures[0].nature);
 const raw=JSON.parse(await readFile(path,'utf8'));assert.equal(CompanionStore.decodeWindowsBackup({format:'poketokenbar.windows.backup',version:1,files:{'companion-v1.json':raw}}).graduated[0].battleDefaultItem,'charizarditex');assert.equal(readTradeItem(wireItem(await store.tradeOffer('one'))).item.battleDefaultItem,'charizarditex');
 await store.change({kind:'battle-default-item',id:'one',item:''});assert.equal((await store.read()).captures[0].battleDefaultItem,undefined);
});
test('incompatible, unknown, active and released assignments leave the existing save intact',async t=>{
 const{store,path}=await storage(t);await store.change({kind:'battle-default-item',id:'one',item:'leftovers'});const original=await readFile(path,'utf8');for(const[id,item]of[['two','charizarditex'],['one','unknown'],['active','leftovers'],['released','leftovers']]){await assert.rejects(()=>store.change({kind:'battle-default-item',id,item}));assert.equal(await readFile(path,'utf8'),original);}
 // A collection preference may duplicate another preference; the match-local loadout resolves it.
 await store.change({kind:'battle-default-item',id:'two',item:'leftovers'});assert.equal((await store.read()).captures[1].battleDefaultItem,'leftovers');
});
test('Mac v2 preview/import restores defaults and rejects damaged tool data before replacing a save',async t=>{
 const{store,path}=await storage(t),raw=JSON.parse(await readFile(fixture,'utf8'));raw.state.dex[0].battleDefaultItem='leftovers';const original=await readFile(path,'utf8'),decoded=decodeMacSave(Buffer.from(JSON.stringify(raw)));assert.equal(CompanionStore.previewImport(decoded.progress).captures[0].battleDefaultItem,'leftovers');assert.equal(await readFile(path,'utf8'),original);const result=await store.replaceImport(decoded.progress,500,await store.read());assert.ok(result.backupPath);assert.equal(await readFile(result.backupPath,'utf8'),original);assert.equal((await new CompanionStore(path).read()).captures[0].battleDefaultItem,'leftovers');
 const imported=await readFile(path,'utf8');for(const value of ['unknown',17,'charizarditex']){raw.state.dex[0].battleDefaultItem=value;assert.throws(()=>decodeMacSave(Buffer.from(JSON.stringify(raw))));assert.equal(await readFile(path,'utf8'),imported);}
});
test('assignment priority follows Mac: overrides, compatible collection default, last equipped; duplicate fallbacks preserve preferences',()=>{
 const candidates=[{id:'a',speciesID:6,battleDefaultItem:'leftovers'},{id:'b',speciesID:9,battleDefaultItem:'leftovers'}],remembered={a:'charizarditex',b:'mysticwater'},overrides={};const assign=(ids,input=overrides,rows=candidates)=>({...assignHeldItems(ids,rows,remembered,input,heldItems,formCatalog)});
 assert.deepEqual(assign(['a','b']),{a:'leftovers',b:''});assert.deepEqual(assign(['b','a']),{b:'leftovers',a:''});assert.deepEqual(assign(['a','b'],{a:'charizarditex'}),{a:'charizarditex',b:'leftovers'});assert.deepEqual(assign(['a','b'],{a:''}),{a:'',b:'leftovers'});assert.deepEqual(assign(['a','b'],{},[{id:'a',speciesID:6},{id:'b',speciesID:9,battleDefaultItem:'charizarditex'}]),{a:'charizarditex',b:'mysticwater'});if(process.env.POKE_MAC_HELD_ITEMS_ORACLE){const samples=[];for(const roster of [candidates,[...candidates].reverse(),[{id:'a',speciesID:6},{id:'b',speciesID:9,battleDefaultItem:'charizarditex'}]])for(const overrides of [{},{a:''},{a:'charizarditex'},{b:'mysticwater'},{a:'unknown'}])samples.push({roster,remembered,overrides});const expected=JSON.parse(execFileSync(process.env.POKE_MAC_HELD_ITEMS_ORACLE,{input:JSON.stringify(samples),encoding:'utf8'}));assert.deepEqual(samples.map(row=>({...assignHeldItems(row.roster.map(p=>p.id),row.roster,row.remembered,row.overrides,heldItems,formCatalog)})),expected);}
 assert.deepEqual(remembered,{a:'charizarditex',b:'mysticwater'});assert.deepEqual(overrides,{});
 const stone=heldItems.find(item=>item.id==='charizarditex');assert.equal(allowsHeldItem({id:'a',speciesID:6},stone,formCatalog),true);assert.equal(allowsHeldItem({id:'a',speciesID:6,form:'mega-y'},stone,formCatalog),false);assert.equal(allowsHeldItem({id:'b',speciesID:9},stone,formCatalog),false);
});
