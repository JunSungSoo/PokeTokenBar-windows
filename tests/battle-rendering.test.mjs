import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const json=name=>JSON.parse(readFileSync('src/battle-assets/player/'+name+'.json','utf8'));
test('battle sizes distinguish small and giant species while fitting either facing above the ground',()=>{
 const window={battleCatalog:{sizes:json('pokemon-sizes'),heights:json('pokemon-heights')}};
 runInNewContext(readFileSync('src/renderer/battle-sprites.js','utf8'),{window});
 const size=(speciesID,back=false)=>window.battleSprites.dimensions({speciesID},back);
 for(const back of [false,true]){
  const small=size(595,back),large=size(321,back),pikachu=size(25,back),dragonite=size(149,back);
  assert.ok(large.width*large.height>small.width*small.height*8,'Wailord must remain visibly larger than Joltik');
  assert.ok(dragonite.height>pikachu.height*1.5,'Dragonite and Pikachu must have different silhouettes');
  for(let id=1;id<=649;id++){const s=size(id,back);assert.ok(Number.isFinite(s.width)&&s.width>0&&s.width<=177.001);assert.ok(Number.isFinite(s.height)&&s.height>0&&s.height<=140.001);}
 }
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
