import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import {join,resolve} from 'node:path';
import { sortedShop,itemOrder,productOrder,activityState,typeColors } from '../dist/shared/companion-presentation.js';
import {shopCatalog} from '../dist/shared/companion.js';
import {CompanionStore} from '../dist/main/companion/store.js';
import {speciesFor} from '../dist/main/companion/catalog.js';

test('shop interleaves eggs by price, preserves tied item order and sends owned passives to the end',()=>{
  for(const difficulty of [.1,.5,1,2]){
    const prices=Object.fromEntries(Object.entries(shopCatalog).map(([id,item])=>[id,Math.round(item.price*difficulty)]));
    assert.deepEqual(sortedShop(prices,{}),['mint','redMaple','rareCandy','egg','eggUncommon','shinyCharm','eggRare']);
    assert.deepEqual(sortedShop(prices,{shinyCharm:1}),['mint','redMaple','rareCandy','egg','eggUncommon','eggRare','shinyCharm']);
  }
  assert.deepEqual(itemOrder,['rareCandy','mint','redMaple','shinyCharm']);
  const scrambled={shinyCharm:1,redMaple:2,mint:3,rareCandy:4};
  assert.deepEqual(itemOrder.filter(id=>scrambled[id]>0),['rareCandy','mint','redMaple','shinyCharm']);
});
test('source PNGs are bundled unchanged and the catalog uses original item names',async()=>{
  const sources=JSON.parse(await readFile('src/renderer/assets/items/source.json','utf8'));
  for(const asset of sources){
    const bytes=await readFile('src/renderer/assets/items/'+asset.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.ok(asset.url.startsWith('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/'));
  }
  assert.equal(shopCatalog.rareCandy.sprite,'rare-candy');assert.equal(shopCatalog.shinyCharm.sprite,'shiny-charm');
  assert.equal(shopCatalog.rareCandy.name,'이상한 사탕');assert.equal(shopCatalog.redMaple.name,'붉은 단풍');
  for(const id of ['egg','eggUncommon','eggRare'])assert.equal(shopCatalog[id].sprite,'egg');
});
test('home mood has the same precedence, 3-hour threshold and burn-rate boundaries as Mac',()=>{
  const now=100000000;
  assert.equal(activityState(false,0,0,undefined,true,now),'egg');
  assert.equal(activityState(true,10,500000,now-10800000,true,now),'tired');
  assert.equal(activityState(true,10,500000,now-10800000,false,now),'sulk');
  assert.equal(activityState(true,0,0,undefined,false,now),'sleep');
  assert.equal(activityState(true,10,1000,now,false,now),'idle');
  assert.equal(activityState(true,10,1001,now,false,now),'working');
  assert.equal(activityState(true,10,99999,now,false,now),'working');
  assert.equal(activityState(true,10,100000,now,false,now),'focus');
});
test('home previews guaranteed evolution, conceals branches and preserves the realized path',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ptb-line-preview-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new CompanionStore(join(dir,'save.json'),()=>false);
  async function preview(route,stage=0){return (await store.replaceImport({raised:0,progress:0,graduated:[],active:{id:'line',family:-1,route:route.map(id=>speciesFor(id)),stage,nature:'노력',shiny:false,repeat:true,hatchedAt:0}},Date.now())).companion;}
  const eevee=await preview([133,134]);assert.deepEqual(eevee.evolutionPreview.map(node=>node.species?.number ?? null),[133,null]);
  const caterpie=await preview([10,11,12]);assert.deepEqual(caterpie.evolutionPreview.map(node=>node.species?.number),[10,11,12]);
  assert.deepEqual(caterpie.evolutionPreview.map(node=>node.reached),[true,false,false]);
  assert.equal(caterpie.active.repeatGrowth,true);
  const butterfree=await preview([10,11,12],2);assert.equal(butterfree.evolutionPreview[2].current,true);assert.ok(butterfree.evolutionPreview.every(node=>node.reached));
});
const reference=resolve(process.env.POKE_MAC_REFERENCE ?? '../PokeTokenBar');
test('presentation constants match the checked-out original Mac source', {skip:!existsSync(join(reference,'Sources/PokeTokenBar/Core/CompanionModel.swift'))},async()=>{
  const model=await readFile(join(reference,'Sources/PokeTokenBar/Core/CompanionModel.swift'),'utf8');
  const itemEnum=model.slice(model.indexOf('enum ItemKind:'),model.indexOf('var spriteName:'));
  assert.deepEqual([...itemEnum.matchAll(/case (\w+)/g)].map(match=>match[1]),itemOrder);
  assert.equal(productOrder.length,7);
  const badge=await readFile(join(reference,'Sources/PokeTokenBar/UI/Badge.swift'),'utf8');
  for(const [type,color] of Object.entries(typeColors))assert.ok(new RegExp('case \\.'+type+':\\s*0x'+color.slice(1)).test(badge),type);
  const store=await readFile(join(reference,'Sources/PokeTokenBar/Core/CompanionStore.swift'),'utf8');
  assert.ok(store.includes('currentIsShiny || rarity == .legendary'));
  assert.ok(store.includes('ItemKind.allCases.compactMap'));
});
