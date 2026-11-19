import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const json=name=>JSON.parse(readFileSync('src/battle-assets/player/'+name+'.json','utf8'));
test('battle sprites keep the original PokéRogue ratio of one atlas pixel per field unit',()=>{
 const sizes=json('pokemon-sizes'),window={battleCatalog:{sizes}};
 runInNewContext(readFileSync('src/renderer/battle-sprites.js','utf8'),{window});
 const size=(speciesID,back=false)=>window.battleSprites.dimensions({speciesID},back);
 for(const unit of [351/132,299/132]){
  window.battleSprites.setFieldUnit(unit);
  for(const back of [false,true]){
   for(const id of [595,321,25,149]){const record=sizes.records[(back?'back/':'')+id],actual=size(id,back);assert.ok(Math.abs(actual.width-record.width*unit)<1e-9&&Math.abs(actual.height-record.height*unit)<1e-9,'species '+id);}
   const small=size(595,back),large=size(321,back);
   assert.ok(large.width*large.height>small.width*small.height*4,'Wailord must remain visibly larger than Joltik');
  }
 }
 window.battleSprites.setFieldUnit(0);assert.equal(size(595).width,sizes.records['595'].width*299/132,'invalid units are ignored');
});

test('native battle layers keep the old sprite until ready and restore the new sprite before clearing',async()=>{
 const classes=new Set(),order=[],box={x:0,y:0,width:282,height:151};let finish=false,release,preparing;
 const waiting=new Promise(resolve=>preparing=resolve),gate=new Promise(resolve=>release=resolve);
 const window={battleCatalog:{playerManifest:{aliases:{}}},battleUI:{key:s=>s},battleSprites:{actor:async(p,own,key)=>({key,own,x:100,y:100})}};
 runInNewContext(readFileSync('src/renderer/battle-effects.js','utf8'),{window,matchMedia:()=>({matches:false}),performance:{now:()=>0},setTimeout:fn=>{queueMicrotask(fn);}});
 const layer=Object.create(window.battleEffects.OriginalLayers.prototype);
 Object.assign(layer,{generation:0,field:{getBoundingClientRect:()=>box,querySelector:()=>({getBoundingClientRect:()=>box}),classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)}},both:async(method)=>{
  order.push(method);
  if(method==='ptbPrepare'){assert.equal(classes.has('effect-playing'),false);preparing();await gate;}
  if(method==='ptbAdvance'&&order.filter(m=>m==='ptbAdvance').length===1)assert.equal(classes.has('effect-playing'),false);
  if(method==='ptbFinish'){assert.equal(finish,true);assert.equal(classes.has('effect-playing'),false);}
  return [{done:true}];
 }});
 const frame={own:[{id:'new',active:true}],foe:[]},previous={own:[{id:'old',active:true}],foe:[]};
 const play=layer.play({phase:'entry',source:{own:true,slot:0},targets:[],move:'switch'},frame,previous,0,()=>{assert.equal(classes.has('effect-playing'),true);finish=true;});
 await waiting;assert.equal(finish,false);assert.equal(classes.size,0);release();await play;assert.equal(finish,true);assert.equal(classes.size,0);
});
