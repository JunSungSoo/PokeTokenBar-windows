(() => {
 // fieldUnit is screen pixels per original 320×132 field unit; sprites keep PokéRogue's 1 atlas pixel = 1 field unit ratio.
 const cache=new Map(),mounts=new WeakMap();let assetBase='',fieldUnit=351/132;
 const data=window.battleCatalog;
 function dimensions(p,back){
  const form=p.form?'-'+p.form:'',lookup=(rear)=>data.sizes.records[(rear?'back/':'')+p.speciesID+form] ?? data.sizes.records[(rear?'back/':'')+p.speciesID] ?? {width:64,height:64};
  const raw=lookup(back);
  return{width:raw.width*fieldUnit,height:raw.height*fieldUnit};
 }
 function urls(p,back){
  const prefix=back?'back/':'',color=p.shiny?'shiny/':'';const form=window.battleCatalog.forms?.[p.speciesID]?.[p.form ?? ''] ?? {};
  if(p.mega){const name=(back?'back-':'')+p.speciesID+'-'+p.form+(p.shiny?'-sh':'');return[assetBase+'player/mega-sprites/'+name+(data.megaSprites.includes(name+'.gif')?'.gif':'.png')];}
  const base='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  const paths=[base+'versions/generation-v/black-white/animated/'+prefix+color+(form.animated ?? p.speciesID)+'.gif',base+prefix+color+(form.spriteID ?? p.speciesID)+'.png'];
  if(p.speciesID===6&&!p.form)paths.unshift(assetBase+'player/base-sprites/'+(back?'back-':'')+'6'+(p.shiny?'-sh':'')+'.gif');return paths;
 }
 async function load(p,back){
  const key=[p.speciesID,p.form,p.shiny,p.mega,back,fieldUnit].join(':');if(cache.has(key))return cache.get(key);
  const promise=(async()=>{
   let decoded;for(const url of urls(p,back))try{
    const response=await fetch(url,{cache:'force-cache',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const bytes=await response.arrayBuffer();
    const decoder=new ImageDecoder({data:bytes,type:url.endsWith('.gif')?'image/gif':'image/png'});await decoder.tracks.ready;const track=decoder.tracks.selectedTrack;if(!track)throw Error();
    const count=Math.min(track.frameCount,300),frames=[];let minX=Infinity,minY=Infinity,maxX=-1,maxY=-1;
    for(let i=0;i<count;i++){const {image}=await decoder.decode({frameIndex:i});const canvas=document.createElement('canvas');canvas.width=image.displayWidth;canvas.height=image.displayHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height);for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels.data[(y*canvas.width+x)*4+3]>2.55){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}frames.push({canvas,delay:image.duration?Math.max(.02,image.duration/1e6):.1});image.close();}
    decoder.close();if(!frames.length||maxX<minX)throw Error('Empty sprite');const width=maxX-minX+1,height=maxY-minY+1;let bodyMoment=0,bodyMass=0,stanceMoment=0,stanceMass=0;
    const cropped=frames.map(frame=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(frame.canvas,minX,minY,width,height,0,0,width,height);const pixels=context.getImageData(0,0,width,height).data;for(let y=0;y<height;y++){let mass=0,moment=0;for(let x=0;x<width;x++){const alpha=pixels[(y*width+x)*4+3];mass+=alpha;moment+=x*alpha;}const m=mass*frame.delay,v=(moment+mass/2)*frame.delay/width;bodyMass+=m;bodyMoment+=v;if(y>=Math.floor(height*3/4)){stanceMass+=m;stanceMoment+=v;}}return{canvas,delay:frame.delay};});
    const center=bodyMass>0?(stanceMass<bodyMass*.1?bodyMoment/bodyMass:stanceMoment/stanceMass):.5;
    const target=dimensions(p,back),fit=Math.min(target.width/width,target.height/height),alignedWidth=Math.ceil(Math.max(target.width,2*Math.max(center,1-center)*width*fit)),alignedHeight=Math.ceil(target.height);
    const images=cropped.map(frame=>{const canvas=document.createElement('canvas');canvas.width=alignedWidth;canvas.height=alignedHeight;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(frame.canvas,alignedWidth/2-center*width*fit,alignedHeight-height*fit,width*fit,height*fit);return{canvas,delay:frame.delay};});
    decoded={key,frames:images,delays:images.map(frame=>frame.delay),width:alignedWidth,height:alignedHeight,encoded:undefined};break;
   }catch{}
   if(!decoded)throw Error('포켓몬 이미지를 불러오지 못했습니다.');return decoded;
  })();cache.set(key,promise);while(cache.size>30)cache.delete(cache.keys().next().value);try{return await promise;}catch(error){cache.delete(key);throw error;}
 }
 function mount(container,p,back,animate=true){
  const token={};mounts.set(container,token);const canvas=document.createElement('canvas');canvas.className='battle-pokemon';container.append(canvas);
  void load(p,back).then(sprite=>{if(mounts.get(container)!==token||!container.isConnected)return;canvas.width=sprite.width;canvas.height=sprite.height;canvas.style.width=sprite.width+'px';canvas.style.height=sprite.height+'px';const context=canvas.getContext('2d');const began=performance.now(),timing=window.spriteTiming,minimum=timing.floors[window.appPreferences?.animationQuality]??.2,frames=timing.capFrameRate(sprite.delays,minimum);let last=-1;function draw(){if(!container.isConnected||mounts.get(container)!==token)return;const moving=animate&&window.appPreferences?.animated&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&!p.fainted;const index=moving?(timing.frameAt(frames,(performance.now()-began)/1000)??0):0;if(index!==last){context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(sprite.frames[index].canvas,0,0);last=index;}if(moving&&frames.length>1)setTimeout(draw,minimum*1000);}draw();}).catch(()=>{if(container.isConnected){const fallback=document.createElement('span');fallback.className='battle-sprite-missing';fallback.textContent='#'+p.speciesID;container.append(fallback);}});
 }
 async function actor(p,back,key,rect){const sprite=await load(p,back);sprite.encoded ??= sprite.frames.map(frame=>frame.canvas.toDataURL('image/png'));return{key,own:back,slot:Number(key.split('-').at(-1)),speciesID:p.speciesID,form:p.form??'',hpRatio:p.hp/Math.max(1,p.maxHP),shiny:p.shiny,texture:sprite.key,sprite:{frames:window.spriteTiming.capFrameRate(sprite.delays,window.spriteTiming.floors[window.appPreferences?.animationQuality]??.2).map(f=>sprite.encoded[f.index]),delays:window.spriteTiming.capFrameRate(sprite.delays,window.spriteTiming.floors[window.appPreferences?.animationQuality]??.2).map(f=>f.duration)},x:rect.x+rect.width/2,y:rect.y+rect.height-11,visible:!p.fainted};}
 window.battleSprites={mount,actor,dimensions,configure:base=>{assetBase=base;},setFieldUnit:unit=>{if(unit>0)fieldUnit=unit;}};
})();
