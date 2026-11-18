import test from 'node:test';
import assert from 'node:assert/strict';
import {petPanelSize,petOrigin,petSurfaceSize,petSurfaceShape,prayerHoverLine,prayerQuips,PettingDetector,heartRows,spriteOpaqueTop,spriteVisibleTop} from '../dist/shared/pet-presentation.js';
import {hasMacReference,readMacSource} from './mac-reference.mjs';

test('floating panel keeps the sprite anchored when bubbles appear and disappear',()=>{
 for(const size of [48,96,180,256]){const small=petPanelSize(size,false),large=petPanelSize(size,true);assert.deepEqual(small,{width:size,height:size});assert.equal(large.height,size+72);assert.equal(large.width,Math.max(size,180));assert.deepEqual(petOrigin({x:100-(large.width-size)/2,y:200-72,...large},size),{x:100,y:200});}
});
test('prayer hover persists at each native quip milestone',()=>{
 const t=(s,args)=>s.replace('{n}',String(args?.n));assert.equal(prayerHoverLine(0,t),'');assert.equal(prayerHoverLine(1,t),'기도 1회 · '+prayerQuips[0]);for(const n of [29,30,59,60,299,300,10000])assert.equal(prayerHoverLine(n,t),`기도 ${n}회 · ${prayerQuips[Math.min(Math.floor(n/30),10)]}`);
});
test('Windows keeps a fixed surface and exposes just the pet until speech is visible',()=>{
 for(const size of [48,96,180,192,384]){const surface=petSurfaceSize(size),hidden=petSurfaceShape(size,false),shown=petSurfaceShape(size,true);assert.deepEqual(surface,petPanelSize(size,true));assert.deepEqual(shown,[{x:0,y:0,...surface}]);assert.equal(hidden.length,1);assert.equal(hidden[0].width,size);assert.equal(hidden[0].height,size);assert.equal(hidden[0].y,72);assert.equal(hidden[0].x,(surface.width-size)/2);assert.deepEqual(petOrigin({x:100-hidden[0].x,y:200-hidden[0].y,...surface},size),{x:100,y:200});}
});
test('Windows input region covers fractional centering in the actual native surface',()=>{
 assert.deepEqual(petSurfaceShape(96,false,{width:179,height:169}),[{x:41,y:73,width:97,height:96}]);
 assert.deepEqual(petSurfaceShape(96,true,{width:179,height:169}),[{x:0,y:0,width:179,height:169}]);
});
test('petting needs three real direction changes inside 1.2 seconds',()=>{
 const p=new PettingDetector();for(const [i,x]of [0,20,40,60,80].entries())assert.equal(p.feed(x,i*100,14),false);p.reset();assert.deepEqual([10,50,10,50,10].map((x,i)=>p.feed(x,i*100,14)),[false,false,false,false,true]);p.reset();for(let i=0;i<20;i++)assert.equal(p.feed(i%2,100*i,14),false);p.reset();for(let i=0;i<10;i++)assert.equal(p.feed(i%2?50:10,1300*i,14),false);
});
test('heart follows median central opaque top and preserves image aspect ratio',()=>{
 const rgba=new Uint8ClampedArray(10*20*4);rgba[(0*10+0)*4+3]=255;rgba[(8*10+5)*4+3]=17;assert.equal(spriteOpaqueTop(rgba,10,20),.4);assert.equal(spriteVisibleTop(100,40,20,[.9,0,.3]),40);assert.equal(spriteVisibleTop(100,20,40,[.3]),30);assert.equal(heartRows.length,16);assert.ok(heartRows.every(row=>row.length===17));
});
test('prayer quips and every pixel row match Mac feature/battle',{skip:!hasMacReference},()=>{
 const l=readMacSource('Sources/PokeTokenBar/Core/Localization.swift'),p=readMacSource('Sources/PokeTokenBar/UI/FloatingPetPanel.swift');for(const quip of prayerQuips)assert.ok(l.includes(JSON.stringify(quip)),quip);for(const row of heartRows)assert.ok(p.includes('"'+row+'"'),row);assert.ok(p.includes('width: max(petSize, bubbleMinWidth)'));assert.ok(p.includes('bubbleMinWidth: CGFloat = 180'));
});
