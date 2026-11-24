const egg=document.querySelector('.egg'),bubble=document.querySelector('output'),P=window.petPresentation;
const spriteBox=document.createElement('span'),particles=document.createElement('span');spriteBox.className='pet-sprite';particles.className='pet-particles';particles.setAttribute('aria-hidden','true');egg.append(spriteBox,particles);
let subject,identity,notice,noticeTimer,heartsUntil=0,heartTimer,hovering=false,hoverInfo,hoverTimer,hoverHideTimer,hoverGeneration=0,layoutHeight=0,agent={working:false,otherWaitingCount:0},pointer,suppressClick=false,dragFrame;
const bubbleCopy=document.createElement('span'),bubbleTitle=document.createElement('strong'),bubbleBody=document.createElement('span');
bubbleCopy.className='pet-bubble-copy';bubbleCopy.append(bubbleTitle,bubbleBody);
let lastTitle,lastBody;
const detector=new P.PettingDetector(),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const motion=()=>window.appPreferences?.animated!==false&&!reducedMotion.matches&&!window.systemPowerSaver;
const tr=(text,args)=>window.i18n.t(text,args);
let repaintFrame,closing=false;
function repaint(){if(closing)return;cancelAnimationFrame(repaintFrame);repaintFrame=requestAnimationFrame(()=>{repaintFrame=requestAnimationFrame(()=>{if(!closing)void window.pet.repaint().catch(()=>{});});});}
window.addEventListener('resize',repaint);
window.addEventListener('pagehide',()=>{closing=true;cancelAnimationFrame(repaintFrame);});
function layout(height){if(layoutHeight!==height){layoutHeight=height;void window.pet.layout(height).then(repaint).catch(()=>{});}}
function fitTextBubble(){
 if(closing||bubble.hidden||bubbleCopy.parentNode!==bubble)return;
 const borders=bubble.offsetHeight-bubble.clientHeight;
 layout(bubble.scrollHeight+borders+10);
}
new ResizeObserver(fitTextBubble).observe(bubbleCopy);
function agentNote(){return window.appPreferences?.petAgentActivity===false?undefined:agent.done??agent.waiting;}
function textNotice(value,kind){
 const title=value.title??'',body=value.body??'';
 if(bubble.dataset.kind!==kind||title!==lastTitle||body!==lastBody){
  bubble.dataset.kind=kind;
  lastTitle=title;lastBody=body;
  bubbleTitle.textContent=title;bubbleTitle.hidden=!title;bubbleBody.textContent=body;
  if(bubbleCopy.parentNode!==bubble)bubble.replaceChildren(bubbleCopy);
  bubble.scrollTop=0;
 }
 bubble.tabIndex=0;
 bubble.hidden=false;
 fitTextBubble();
}
function heart(){bubble.dataset.kind='heart';bubble.removeAttribute('tabindex');bubble.replaceChildren();const canvas=document.createElement('canvas');canvas.width=P.heartRows[0].length*2;canvas.height=P.heartRows.length*2;canvas.setAttribute('aria-label',tr('하트'));const context=canvas.getContext('2d');for(const[y,row]of P.heartRows.entries())for(const[x,cell]of [...row].entries())if(P.heartColors[cell]){context.fillStyle=P.heartColors[cell];context.fillRect(x*2,y*2,2,2);}bubble.append(canvas);bubble.hidden=false;layout(32);}
function render(){
 egg.classList.toggle('working',window.appPreferences?.petAgentActivity!==false&&agent.working&&motion());
 bubble.classList.toggle('working',egg.classList.contains('working'));const note=agentNote();if(notice&&notice.priority>=3){textNotice(notice,'alert');return;}
 if(note){textNotice({title:(note.label?note.label+' · ':'')+tr(agent.done?'완료!':'에이전트가 기다려요'),body:(note.message??tr(agent.done?'에이전트가 작업을 마쳤어요.':'입력을 기다리고 있어요.'))+(!agent.done&&agent.otherWaitingCount?' +'+agent.otherWaitingCount:'')},'agent');return;}
 if(notice){textNotice(notice,'event');return;}
 if(heartsUntil>Date.now()){heart();return;}
 if(hovering&&hoverInfo){textNotice({body:hoverInfo.body},'hover');return;}
 bubble.hidden=true;bubble.replaceChildren();delete bubble.dataset.kind;layout(0);
}
function showNotice(value){if(notice&&notice.priority>value.priority)return;clearTimeout(noticeTimer);notice=value;noticeTimer=setTimeout(()=>{notice=undefined;render();},6000);render();}
async function refreshHover(){const generation=++hoverGeneration;try{const info=await window.pet.hover();if(generation!==hoverGeneration||!hovering)return;hoverInfo=info;render();}catch{}}
function clearHover(){hovering=false;hoverInfo=undefined;render();}
function leaveHover(){
 clearTimeout(hoverTimer);clearTimeout(hoverHideTimer);hoverGeneration++;
 // Allow the pointer to cross the gap above the sprite into the scrollable bubble.
 if(bubble.dataset.kind==='hover')hoverHideTimer=setTimeout(clearHover,180);
 else clearHover();
}
egg.addEventListener('pointerenter',()=>{if(pointer?.dragging)return;hovering=true;clearTimeout(hoverHideTimer);clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>void refreshHover(),300);});
egg.addEventListener('pointerleave',()=>{detector.reset();leaveHover();});
bubble.addEventListener('pointerenter',()=>clearTimeout(hoverHideTimer));
bubble.addEventListener('pointerleave',()=>{if(bubble.dataset.kind==='hover')leaveHover();});
function drag(phase,point){void window.pet.drag(phase,point).catch(()=>{});}
const screenPoint=event=>({x:event.screenX,y:event.screenY});
egg.addEventListener('pointerdown',event=>{
 if(event.button!==0||pointer)return;
 egg.setPointerCapture(event.pointerId);
 suppressClick=false;
 const start=screenPoint(event);
 pointer={id:event.pointerId,start,last:start,dragging:false};
});
egg.addEventListener('pointermove',event=>{
 if(pointer){
  if(event.pointerId!==pointer.id)return;
  const point=screenPoint(event);
  pointer.last=point;
  if(!pointer.dragging&&Math.hypot(point.x-pointer.start.x,point.y-pointer.start.y)>4){
   pointer.dragging=true;suppressClick=true;
   drag('start',pointer.start);egg.classList.add('dragging');
   hovering=false;hoverInfo=undefined;hoverGeneration++;clearTimeout(hoverTimer);clearTimeout(hoverHideTimer);render();
  }
  if(pointer.dragging){cancelAnimationFrame(dragFrame);dragFrame=requestAnimationFrame(()=>drag('move',point));}
  return;
 }
 if(detector.feed(event.clientX,performance.now(),Math.max(10,(window.appPreferences?.petSize??96)*.15))&&!agentNote()&&!notice){heartsUntil=Date.now()+1800;clearTimeout(heartTimer);heartTimer=setTimeout(render,1810);render();}
});
function endDrag(event){
 if(!pointer||event.pointerId!==pointer.id)return;
 const finished=pointer;pointer=undefined;
 if(!finished.dragging)return;
 cancelAnimationFrame(dragFrame);
 drag('end',event.type==='pointerup'?screenPoint(event):finished.last);
 egg.classList.remove('dragging');
}
egg.addEventListener('pointerup',endDrag);egg.addEventListener('pointercancel',endDrag);egg.addEventListener('lostpointercapture',endDrag);
function prayerParticle(){const size=window.appPreferences?.petSize??96,edge=Math.min(32,Math.max(14,size*.25)),particle=document.createElement('span');particle.className='prayer-particle'+(motion()?' moving':'');particle.textContent='🙏';particle.style.width=particle.style.height=edge+'px';particle.style.fontSize=edge*.8+'px';particle.style.left=(edge/2+Math.random()*(size-edge))+'px';particle.style.top=size*.7+'px';particle.style.setProperty('--rise',(edge/2-size*.7)+'px');particles.append(particle);setTimeout(()=>particle.remove(),1100);if(motion()){egg.classList.remove('react');void egg.offsetWidth;egg.classList.add('react');setTimeout(()=>egg.classList.remove('react'),310);}}
egg.addEventListener('click',async()=>{if(suppressClick){suppressClick=false;return;}hoverGeneration++;clearTimeout(hoverTimer);try{const count=await window.pet.activate();if(count==null)return;prayerParticle();if(hovering)await refreshHover();}catch{}});
function renderPet(updated){subject=updated;const species=updated.species,name=species?(window.speciesNames?.[species.number]?.[window.i18n.language]??species.name):tr('알에게 기도하기');egg.setAttribute('aria-label',name);egg.removeAttribute('title');
 const key=JSON.stringify([species?.number,species?.form,species?.spriteID,species?.animated,updated.shiny,window.appPreferences?.back,window.appPreferences?.petSize,motion()]);if(key!==identity){identity=key;particles.replaceChildren();document.documentElement.style.setProperty('--sprite-visible-top','0px');spriteBox.replaceChildren();spriteBox.className='pet-sprite '+(species?'pokemon-art':'egg-art');egg.classList.toggle('pokemon',Boolean(species));const image=document.createElement('img');image.alt='';image.crossOrigin='anonymous';image.addEventListener('sprite-cropped',()=>{if(!image.isConnected)return;const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const cropped=spriteBox.querySelector('.egg-canvas')??canvas;if(cropped!==canvas){canvas.width=cropped.width;canvas.height=cropped.height;ctx.drawImage(cropped,0,0);}const fraction=P.spriteOpaqueTop(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);document.documentElement.style.setProperty('--sprite-visible-top',P.spriteVisibleTop(window.appPreferences?.petSize??96,canvas.width,canvas.height,[fraction])+'px');});if(!species){image.src='assets/items/egg.png';}else{const base='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/',variant=(window.appPreferences?.back?'back/':'')+(updated.shiny?'shiny/':'');const png=base+variant+(species.spriteID??species.number)+'.png';image.dataset.staticSrc=png;image.addEventListener('error',()=>{image.src=png;},{once:true});image.src=motion()?base+'versions/generation-v/black-white/animated/'+variant+(species.animated??species.number)+'.gif':png;}spriteBox.append(image);}if(hovering)void refreshHover();render();}
function syncMotion(){document.documentElement.dataset.animation=motion()?'on':'off';void window.pet.motion(!motion()).catch(()=>{});if(subject)renderPet(subject);else render();}
window.pet.onUpdate(renderPet);void window.pet.read().then(renderPet).catch(()=>{});
window.pet.onAgent(value=>{agent=value;render();});void window.pet.agent().then(value=>{agent=value;render();}).catch(()=>{});
window.pet.onNotice(showNotice);window.pet.onPowerSaver(enabled=>{window.systemPowerSaver=enabled;syncMotion();});
window.addEventListener('preferences-changed',()=>{document.documentElement.dataset.theme=window.appPreferences?.theme??'system';syncMotion();});window.addEventListener('language-changed',()=>{if(subject)renderPet(subject);});window.addEventListener('system-power-changed',syncMotion);reducedMotion.addEventListener('change',syncMotion);
bubble.addEventListener('click',()=>{clearTimeout(noticeTimer);notice=undefined;heartsUntil=0;hoverInfo=undefined;void window.pet.dismissAgent();render();});syncMotion();
