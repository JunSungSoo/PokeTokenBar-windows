(() => {
 const U=window.battleUI,H=window.battleHUD,{node,button,t,species}=U;
 const params=new URLSearchParams(location.search),kind=params.get('kind')==='lan'?'lan':'challenge',aux=params.get('panel');
 const header=document.querySelector('#battle-header'),screen=document.querySelector('#battle-screen'),footer=document.querySelector('#battle-footer'),problem=document.querySelector('#battle-problem');
 let base='',audio,preferences,current,lan,presented,field,layers,mode='singles',choices=new Map(),editingSlot=0,busy=false,screenName='loading',lastLog=-1,generation=0,logOpen=false,candidates=[],selected=[],pendingView,trainerIntro;
 let megaSlot,sheetOpen=false,playMessage='',skipWait,fastForward=false,holdTimer,longPressed=false,resultPresented=false;const trails=new Map();
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
 const canAnimate=()=>Boolean(preferences?.animated&&!reducedMotion.matches);
 // Message waits can be cut short with "다음"/Space; holding it skips every remaining wait.
 function pause(ms){if(fastForward||!canAnimate())return Promise.resolve();return new Promise(resolve=>{const finish=()=>{clearTimeout(timer);if(skipWait===finish)skipWait=undefined;resolve();},timer=setTimeout(finish,ms);skipWait=finish;});}
 function skip(){skipWait?.();}
 function error(value){problem.hidden=!value;problem.textContent=value?.message?.replace(/^Error invoking remote method '[^']+': Error: /,'') ?? value ?? '';}
 function thumbnail(p,size=32){const box=node('span',undefined,'pokemon-art');box.style.width=size+'px';box.style.height=size+'px';const image=node('img');image.alt='';const appearance=window.battleCatalog.forms?.[p.speciesID]?.[p.form??'']??{};image.src=base+'player/mega-sprites/'+p.speciesID+'-'+p.form+'.png';if(!p.mega)image.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+(p.shiny?'shiny/':'')+(appearance.spriteID??p.speciesID)+'.png';image.addEventListener('error',()=>image.remove());box.append(image);return box;}
 function title(name,sub){const row=node('div',undefined,'battle-heading');row.append(node('span','⚑'));const text=node('div');text.append(node('h2',name),node('p',sub));row.append(text);return row;}
 function stop({keepMusic=false}={}){trainerIntro=undefined;if(field)for(const panel of ['field','stats'])void window.battle.auxiliary(panel,false).catch(()=>{});generation++;skip();fastForward=false;resultPresented=false;trails.clear();clearTimeout(holdTimer);document.body.classList.remove('battle-fight','battle-sheet-open');layers?.destroy();layers=undefined;field=undefined;presented=undefined;if(!keepMusic)window.battleEffects.stopMusic();window.moveUI.close();}
 function basicHeader(){document.body.classList.remove('battle-fight');header.replaceChildren(title(t(kind==='lan'?'배틀':'챌린지'),t(kind==='lan'?'싱글':'싱글 · 6마리')));}
 function addClose(){footer.append(button(t('닫기'),()=>void window.battle.closeWindow()));}
 async function operation(callback){if(busy)return;busy=true;error('');disable();try{return await callback();}catch(cause){error(cause);}finally{busy=false;if(kind==='lan'&&pendingView)await drainLanView();else if(screenName==='battle'&&current)renderCommands(current);else if(screenName==='setup')drawSetup();}}
 function disable(){if(!busy&&!Boolean(lan?.submitted&&kind==='lan'))return;for(const control of document.querySelectorAll('[data-battle-command]'))control.disabled=busy||Boolean(lan?.submitted&&kind==='lan');}
 function command(control){control.dataset.battleCommand='true';return control;}
 async function setup(){stop();for(const id of Object.keys(gearSelections))delete gearSelections[id];screenName='setup';basicHeader();footer.replaceChildren();screen.replaceChildren();candidates=await window.battle.choices();selected=[];drawSetup();}
 function drawSetup(){
  const body=node('div',undefined,'battle-prelude');body.append(node('h3',t('6대6 싱글 · 27연전 · HP·PP 유지')),node('p',t('서로 다른 종의 졸업 포켓몬 6마리를 선택하세요.')));
  body.append(U.presetControls(candidates,(ids,items)=>{selected=ids;Object.assign(gearSelections,items);drawSetup();}));
  const grid=node('div',undefined,'battle-team-grid');for(const[id,index]of selected.map((id,index)=>[id,index])){const p=candidates.find(p=>p.id===id),tile=node('div',undefined,'battle-team-tile');tile.append(...(index===0?[U.teamArtwork(thumbnail(p,55),true)]:[node('small',String(index+1)),thumbnail(p,55)]),node('strong',species(p)));const held=U.item(U.assignments(selected,candidates,gearSelections)[p.id]);const gear=button(held?U.localized(held.names):t('도구 없음'),()=>itemPicker(p,gear));tile.append(gear);grid.append(tile);}body.append(grid);
  body.append(node('p',t('최종 진화 포켓몬만 등록할 수 있습니다.'),'battle-small-note'),node('p',t('같은 종은 중복으로 등록할 수 없습니다.'),'battle-small-note'));
  for(const p of candidates){const index=selected.indexOf(p.id),duplicate=selected.some(id=>id!==p.id&&candidates.find(candidate=>candidate.id===id)?.speciesID===p.speciesID);const choose=button('',()=>{if(index>=0)selected.splice(index,1);else selected.push(p.id);drawSetup();},'battle-candidate');choose.dataset.id=p.id;choose.disabled=index<0&&(duplicate||selected.length===6);choose.append(node('span',index>=0?'●':'○','order'),thumbnail(p),node('strong',species(p)),node('small','Lv. '+p.level));choose.setAttribute('aria-pressed',String(index>=0));body.append(choose);}
  if(!candidates.length)body.append(node('p',t('도감에 졸업한 포켓몬이 없습니다.')));
  screen.replaceChildren(body);footer.replaceChildren(node('span',selected.length+'/6'));const spacer=node('span');spacer.style.flex='1';footer.append(spacer);const start=command(button(t('챌린지 시작'),()=>void operation(async()=>{const view=await window.battle.start('singles',selected,U.assignments(selected,candidates,gearSelections));await show(view,false);}),'primary'));start.id='challenge-start';start.disabled=selected.length!==6||busy;footer.append(start);
 }
 const gearSelections={};
 function itemPicker(p,trigger){U.pickItem(p,U.assignments(selected,candidates,gearSelections),selected,id=>{gearSelections[p.id]=id;trigger.textContent=id?U.localized(U.item(id)?.names,id):t('도구 없음');});}
 function rosterTiles(members,resources,against){
  const grid=node('div',undefined,'battle-team-grid');
  for(const p of members){
   const r=resources?.find(r=>r.id===p.id)??p,tile=node('div',undefined,'battle-team-tile');
   tile.append(thumbnail(p,48),node('strong',species(p)),node('small','Lv. '+p.level));
   if(Number.isFinite(r.hp)){
    tile.append(node('small','HP '+r.hp+'/'+(p.maxHP??p.stats?.hp??100)));
    if(r.moves)tile.append(node('small','PP '+r.moves.reduce((sum,m)=>sum+m.pp,0)+'/'+r.moves.reduce((sum,m)=>sum+m.maxPP,0)));
   }
   U.markLineupMatchup(tile,against,p);
   grid.append(tile);
  }
  return grid;
 }
 function resumePanel(view){current=view;screenName='resume';basicHeader();screen.replaceChildren();const body=node('div',undefined,'battle-prelude');body.append(node('h3',U.trainerName(view.encounterID,view.opponent)),node('p',view.encounter+'/'+view.encounterCount),rosterTiles(view.frame.own));body.append(button(t('이어하기'),()=>void show(view,false),'primary'));screen.append(body);footer.replaceChildren();addClose();}
 function health(p,own,status,members){return H.databox(p,own,H.partyBalls(members,status));}
 function paintScene(frame){
  if(!field?.isConnected)return;presented=frame;const ownParty={selected:frame.own.length,fainted:frame.own.filter(p=>p.fainted).length};for(const own of [false,true]){const side=field.querySelector(own?'.battle-side.own':'.battle-side.foe'),scene=field.querySelector('.battle-scene'),members=own?frame.own.filter(p=>p.active):frame.foe,cards=[],stages=[];for(const [slot,p]of members.entries()){const position=(own?'own':'foe')+'-'+slot,key=[p.id,p.speciesID,p.form,p.shiny,p.mega].join(':');let stage=scene.querySelector('[data-position="'+position+'"]');if(!stage||stage.dataset.sprite!==key){stage=node('div',undefined,'battle-stage');stage.dataset.position=position;stage.dataset.sprite=key;window.battleSprites.mount(stage,p,own,true);}window.battleArena.place(stage,own,slot,members.length);stage.classList.toggle('fainted',p.fainted);cards.push(health(p,own,own?ownParty:frame.foeTeamStatus,own?frame.own:undefined));stages.push(stage);}side.replaceChildren(...cards);showTrails(cards);window.battleArena.replaceStages(scene,own,stages);}
 }
 // Re-applies the lost-HP trail after a repaint so it stays visible for its full time.
 const trailKey=card=>(card.classList.contains('own')?'own:':'foe:')+card.dataset.member;
 function showTrails(cards){const now=Date.now();for(const card of cards){const key=trailKey(card),trail=trails.get(key),span=card.querySelector('.battle-hp-trail');if(!trail||!span)continue;if(trail.until<=now){trails.delete(key);continue;}span.style.width=trail.from+'%';setTimeout(()=>{span.style.width='0';},trail.until-now);}}
 function fieldShell(view){if(field?.isConnected)return;const arena=U.arena(view.preview??view.opponentRoster??view.frame.foe,view.encounterID);field=node('div',undefined,'battlefield');field.dataset.mode=view.mode;field.append(window.battleArena.scene(base,arena),node('div',undefined,'battle-side foe'),node('div',undefined,'battle-side own'));screen.replaceChildren(field,node('div',undefined,'battle-main-content'));window.battleSprites.setFieldUnit(field.clientHeight/132);layers=new window.battleEffects.OriginalLayers(field,base,error);for(const panel of ['field','stats'])void window.battle.auxiliary(panel,true).catch(error);}
 function audioControls(){const music=button(audio.enabled?'♫':'♪',()=>void operation(async()=>{audio=await window.battle.audio({enabled:!audio.enabled});updateMusic(current);renderHeader(current);}));music.setAttribute('aria-label',t('배틀 음악'));const volume=button('☷',()=>{const popup=node('div',undefined,'battle-audio-popup');popup.popover='auto';for(const [key,label]of [['music','음악 볼륨'],['effects','효과음 볼륨']]){const text=node('label',t(label));const input=node('input');input.type='range';input.min=0;input.max=1;input.step=.01;input.value=audio[key];input.setAttribute('aria-label',t(label));input.addEventListener('input',()=>{audio[key]=Number(input.value);if(key==='music')updateMusic(current);else void layers?.both('ptbSetEffectsVolume',audio.effects).catch(error);});input.addEventListener('change',()=>void window.battle.audio({[key]:Number(input.value)}).catch(error));text.append(input);popup.append(text);}const hints=node('label',t('상성 힌트'),'battle-hint-toggle'),hintInput=node('input');hintInput.type='checkbox';hintInput.checked=audio.typeHints!==false;hintInput.addEventListener('change',()=>void operation(async()=>{audio=await window.battle.audio({typeHints:hintInput.checked});}));hints.prepend(hintInput);popup.append(hints);document.body.append(popup);popup.addEventListener('toggle',()=>{if(!popup.matches(':popover-open'))popup.remove();});popup.showPopover();});volume.setAttribute('aria-label',t('볼륨'));return[music,volume];}
 function renderHeader(view){
  const frame=view.frame,lanMode=kind==='lan',foe=lanMode?lan?.opponent?.nickname:U.trainerName(view.encounterID,view.opponent);
  const profile=(lanMode&&lan?.identity)||window.playerProfile.fromSettings(preferences);
  const vs=H.vsBar({ownName:profile.nickname,ownIcon:profile.icon,ownSub:t('내 팀 {count}마리',{count:frame.own.length}),foeName:foe??'…',foeIcon:lanMode?lan?.opponent?.icon:undefined,foeAvatar:!lanMode&&view.encounterID?U.trainerSprite(view.encounterID,base):undefined,foeSub:lanMode?t('LAN 대전'):t('챌린지 상대 · {n}번째',{n:view.encounter})});
  const bar=node('div',undefined,'battle-toolbar'),turn=node('span',undefined,'battle-turn-label px');turn.append('TURN ',node('span',String(frame.turn),'battle-turn'));bar.append(turn,node('span',t(lanMode?'싱글 · 3대3':'싱글 · 6대6'),'battle-mode-label'));
  if(!lanMode&&view.encounterCount>1){const progress=node('span',undefined,'battle-progress-wrap');progress.append(H.progressCells(view.encounter,view.encounterCount),node('span',view.encounter+'/'+view.encounterCount,'px'));bar.append(progress);}
  if(lan?.deadline&&lanMode){const timer=node('span',String(Math.max(0,Math.ceil((lan.deadline-Date.now())/1000))),'battle-timer');timer.dataset.deadline=String(lan.deadline);bar.append(timer);}
  const tools=node('div',undefined,'battle-header-tools');for(const [panel,icon,label]of [['field','☁','날씨·필드'],['stats','≡','능력치']]){const open=button(icon,()=>void window.battle.auxiliary(panel).catch(error));open.setAttribute('aria-label',t(label));open.title=t(label);tools.append(open);}tools.append(...audioControls());bar.append(tools);header.replaceChildren(vs,bar);
 }
 function updateMusic(view){
  if(!view)return;
  const phase=screenName==='battle'&&!resultPresented?'battling':view.phase;
  const cues={
   battling:view.encounterID==='red'?'champion':'battle',
   reward:'victory',intermission:'victory',
   cleared:kind==='lan'?'victory':'championVictory',lost:'lost',
  };
  const cue=cues[phase];
  if(!cue){window.battleEffects.stopMusic();return;}
  void window.battleEffects.music(base,cue,audio.music,audio.enabled).catch(error);
 }
 function selectedDetails(move,selected){return H.detailCard(move,{hints:audio.typeHints!==false,selected});}
 const commandSlot=view=>view.frame.slots.find(slot=>slot.slot===editingSlot)??view.frame.slots[0];
 function commandPanel(view){const frame=view.frame,container=node('div',undefined,'battle-command');const slots=frame.slots;
  if(slots.length>1){const tabs=node('div',undefined,'battle-choice-tabs');for(const slot of slots)tabs.append(button(String(slot.slot+1)+' · '+species(frame.own.filter(p=>p.active)[slot.slot]),()=>{editingSlot=slot.slot;renderCommands(view);}));container.append(tabs);}
  const slot=commandSlot(view);if(!slot)return container;editingSlot=slot.slot;
  const choice=choices.get(slot.slot),actor=frame.own.filter(p=>p.active)[slot.slot],locked=busy||Boolean(kind==='lan'&&lan?.submitted),trapped=slot.trapped&&!slot.mustSwitch;
  const message=node('p',kind==='lan'&&lan?.submitted?t('상대의 선택을 기다리는 중…'):slot.mustSwitch?t('누구를 내보낼까?'):t('{name}은(는) 무엇을 할까?',{name:actor?species(actor):''}),'battle-message');message.setAttribute('aria-live','polite');container.append(message);
  if(slot.canPass){choices.set(slot.slot,{kind:'pass'});container.append(node('p',t('대기'),'battle-small-note'));return container;}
  if(!slot.mustSwitch){const layout=node('div',undefined,'battle-command-layout'),grid=node('div',undefined,'battle-move-grid');
   for(const m of slot.moves){const pick=command(H.moveButton(m,{selected:choice?.kind==='move'&&choice.index===m.index,disabled:locked||m.disabled||m.pp===0,onPick:()=>{choices.set(slot.slot,{kind:'move',index:m.index,target:m.targetRequired?(m.targets.find(target=>target.location>0)?.location??m.targets[0]?.location??0):0,...(megaSlot===slot.slot?{mega:true}:{})});renderCommands(view);}}));pick.id='battle-move-'+slot.slot+'-'+m.index;grid.append(pick);}
   const selected=choice?.kind==='move'?slot.moves.find(m=>m.index===choice.index):undefined;layout.append(grid,selectedDetails(selected??slot.moves[0],Boolean(selected)));container.append(layout);}
  if(slot.mustSwitch)sheetOpen=true;
  const sheet=H.partySheet({id:'battle-switch-'+slot.slot,members:frame.own,thumbnail:p=>thumbnail(p,40),selected:choice?.kind==='switch'?String(choice.index):undefined,message:t(trapped?'교체할 수 없다!':slot.mustSwitch?'누구를 내보낼까?':'누구와 교대할까?'),isDisabled:p=>locked||p.active||p.fainted||trapped,onChange:value=>{choices.set(slot.slot,{kind:'switch',index:Number(value)});renderCommands(view);}});
  sheet.hidden=!sheetOpen;document.body.classList.toggle('battle-sheet-open',sheetOpen);container.append(sheet);return container;
 }
 function confirmLabel(view){const slots=view.frame.slots;if(slots.length>1)return slots.every(slot=>choices.has(slot.slot))?t('선택 확정'):t('2마리 모두 고르면 확정할 수 있어요');
  const slot=slots[0],choice=slot&&choices.get(slot.slot);if(choice?.kind==='move')return t('{move} 사용',{move:U.moveText(slot.moves.find(m=>m.index===choice.index)).name});if(choice?.kind==='switch')return t('{name}으로 교체',{name:species(view.frame.own[choice.index-1])});return choice?t('선택 확정'):t('기술을 골라 주세요');}
 function openSheet(){sheetOpen=true;renderCommands(current);document.querySelector('.battle-party-sheet:not([hidden]) .battle-party-cell:not(:disabled)')?.focus();}
 function closeSheet(){sheetOpen=false;renderCommands(current);document.querySelector('#battle-party-open')?.focus();}
 function actionBar(view){const slot=commandSlot(view),locked=busy||Boolean(kind==='lan'&&lan?.submitted),spacer=node('span');spacer.style.flex='1';
  if(sheetOpen){if(!slot?.mustSwitch){const back=button(t('돌아가기'),()=>closeSheet(),'battle-action');back.id='battle-party-open';footer.append(back);}footer.append(button(t('능력치 보기'),()=>void window.battle.auxiliary('stats').catch(error),'battle-action'));}
  else{if(!slot?.canPass){const party=command(button(t('포켓몬'),()=>openSheet(),'battle-action'));party.id='battle-party-open';party.setAttribute('aria-haspopup','true');footer.append(party);}
   if(slot?.canMegaEvo&&!slot.mustSwitch){const mega=command(button(t('메가진화'),()=>{megaSlot=megaSlot===slot.slot?undefined:slot.slot;const choice=choices.get(slot.slot);if(choice?.kind==='move')choices.set(slot.slot,{...choice,mega:megaSlot===slot.slot});renderCommands(view);},'battle-mega-toggle'));mega.setAttribute('aria-pressed',String(megaSlot===slot.slot));mega.disabled=locked;footer.append(mega);}
   footer.append(button(t('기권'),()=>confirmSurrender(),'battle-surrender'));}
  if(kind==='challenge'&&preferences.rewardTest&&view.practice){
   const win=command(button(t('테스트 승리'),()=>void operation(async()=>{
    await show(await window.battle.cpu('test-victory',{checkpoint:view.checkpoint}),false);
   }),'battle-action'));
   win.id='battle-test-victory';win.disabled=locked;footer.append(win);
  }
  const confirm=command(button('',()=>void submit(),'primary battle-confirm-button'));confirm.id='battle-confirm';confirm.append(node('span',confirmLabel(view)),node('kbd','Enter'));confirm.disabled=locked||view.frame.waiting||!view.frame.slots.every(slot=>choices.has(slot.slot));footer.append(spacer,confirm);
 }
 function playbackBar(view){const spacer=node('span');spacer.style.flex='1';const log=button(t('전체 기록 보기'),()=>{logOpen=!logOpen;renderCommands(view);},'battle-action');log.setAttribute('aria-expanded',String(logOpen));
  const next=button('',()=>{if(longPressed){longPressed=false;return;}skip();},'battle-next');next.append(node('span',t('다음')),node('kbd','Space'));next.addEventListener('pointerdown',()=>{longPressed=false;clearTimeout(holdTimer);holdTimer=setTimeout(()=>{longPressed=true;fastForward=true;skip();},500);});footer.append(log,spacer,next);}
 function renderCommands(view){if(!field)return;const content=screen.querySelector('.battle-main-content'),focused=document.activeElement,focusID=focused?.id,focusCell=focused?.dataset?.value;document.body.classList.remove('battle-sheet-open');const strip=node('div',undefined,'battle-roster-strip');for(const p of view.frame.own){const name=node('span',undefined,p.fainted?'fainted':'');name.append(node('i'),document.createTextNode(species(p)));strip.append(name);}footer.replaceChildren();
  if(busy){const message=node('p',playMessage,'battle-message playing');message.setAttribute('aria-live','polite');message.addEventListener('click',()=>skip());content.replaceChildren(strip,message,turnLog(view.frame));playbackBar(view);return;}
  if(view.phase==='battling'){content.replaceChildren(strip,commandPanel(view),turnLog(view.frame));actionBar(view);}
  else{const won=view.phase==='reward'||view.phase==='cleared',foe=kind==='lan'?lan?.opponent?.nickname:U.trainerName(view.encounterID,view.opponent),message=node('p',won?t('{name}에게 이겼다!',{name:foe??''}):t('눈앞이 캄캄해졌다…'),'battle-message');message.setAttribute('aria-live','polite');content.replaceChildren(node('div',t(won?'승리':'패배'),'battle-result'),strip,message,turnLog(view.frame));footer.append(button(t(kind==='lan'?'닫기':'계속'),()=>kind==='lan'?void window.battle.closeWindow():void rewardScreen(view),'primary'));}
  if(focusID)document.getElementById(focusID)?.focus();else if(focusCell&&focused.classList.contains('battle-party-cell'))document.querySelector('.battle-party-cell[data-value="'+focusCell+'"]')?.focus();
 }
 function describe(line,ownPlayer=0){const parts=line.split('|'),who=parts[2]??'',id=U.key(who.replace(/^p[12][ab]: /,'')),speciesID=window.battleCatalog.aliases[id],name=speciesID?U.localized(window.battleCatalog.species[speciesID],who):who.replace(/^p[12][ab]: /,'');const detail=parts[3]??'';const move=U.move(detail).name;
  const map={move:()=>name+' · '+move,switch:()=>name+' '+t('출전'),drag:()=>name+' '+t('강제 교체'),faint:()=>name+' '+t('기절'),'-damage':()=>name+' · HP '+detail,'-heal':()=>name+' · '+t('회복')+' '+detail,'-status':()=>name+' · '+t(U.ailments[detail]??detail),'-curestatus':()=>name+' · '+t('상태이상 회복'),'-miss':()=>name+' · '+t('빗나감'),'-immune':()=>name+' · '+t('효과 없음'),'-supereffective':()=>name+' · '+t('효과가 굉장했다!'),'-resisted':()=>name+' · '+t('효과가 별로인 듯하다…'),'-crit':()=>name+' · '+t('급소에 맞았다!'),'-fail':()=>name+' · '+t('실패'),'-weather':()=>U.move(detail).name,'-ability':()=>name+' · '+U.ability(detail),'-item':()=>name+' · '+U.localized(U.item(detail)?.names,detail),'-enditem':()=>name+' · '+U.localized(U.item(detail)?.names,detail)+' · '+t('사용'),'-mega':()=>name+' · '+t('메가진화'),'-boost':()=>name+' · '+t({atk:'공격',def:'방어',spa:'특수공격',spd:'특수방어',spe:'스피드',accuracy:'명중률',evasion:'회피율'}[detail]??detail)+' +'+parts[4],'-unboost':()=>name+' · '+t({atk:'공격',def:'방어',spa:'특수공격',spd:'특수방어',spe:'스피드'}[detail]??detail)+' −'+parts[4],cant:()=>name+' · '+t('행동할 수 없습니다.')};return map[parts[1]]?.()??'';}
 function turnLog(frame){const details=node('details',undefined,'battle-log');details.open=logOpen;details.append(node('summary',t('전체 기록 보기')));details.addEventListener('toggle',()=>{logOpen=details.open;});const entries=node('div',undefined,'battle-log-entries');let turn=0;const groups=[];for(const line of frame.log){if(line.startsWith('|turn|')){turn=Number(line.split('|')[2]);groups.push({turn,lines:[]});}const text=describe(line);if(text){if(!groups.length)groups.push({turn:0,lines:[]});groups.at(-1).lines.push(text);}}for(const group of groups.reverse()){const section=node('section');section.append(node('h4',t('턴')+' '+group.turn),...group.lines.map(line=>node('p',line)));entries.append(section);}details.append(entries);return details;}
 function eventPosition(token){const match=String(token).match(/^p([12])([ab]):/);if(!match)return null;return{own:Number(match[1])-1===(kind==='lan'&&!lan?.host?1:0),slot:match[2]==='b'?1:0};}
 function say(message){if(!message)return;playMessage=message;const box=screen.querySelector('.battle-message.playing');if(box)box.textContent=message;}
 function healthChanges(previous,scene){
  const changes=[];
  for(const side of ['own','foe']){
   for(const card of field.querySelectorAll('.battle-side.'+side+' .battle-health')){
    const prior=previous[side].find(p=>p.id===card.dataset.member),next=scene[side].find(p=>p.id===card.dataset.member);
    if(prior&&next&&prior.maxHP===next.maxHP&&prior.hp!==next.hp)changes.push({card,prior,next});
   }
  }
  return changes;
 }
 async function animateHealth(changes,token){
  if(!changes.length||fastForward||!canAnimate())return;
  const duration=Math.max(...changes.map(({prior,next})=>400+400*Math.min(1,Math.abs(next.hp-prior.hp)/Math.max(1,next.maxHP))));
  const bars=changes.map(({card,prior,next})=>{
   if(next.hp<prior.hp){
    trails.set(trailKey(card),{from:prior.hp/next.maxHP*100,until:Date.now()+duration+600});
    showTrails([card]);
   }else{
    trails.delete(trailKey(card));
    card.querySelector('.battle-hp-trail').style.width='0';
   }
   const bar=card.querySelector('.battle-hp');
   U.updateHPBar(bar,next);
   const number=card.querySelector('.battle-health-number');
   if(number)number.textContent=next.hp+' / '+next.maxHP;
   const maxHP=Math.max(1,next.maxHP);
   return {bar,from:prior.hp/maxHP,to:next.hp/maxHP};
  });
  const start=performance.now();
  while(token===generation&&!fastForward&&canAnimate()){
   const progress=Math.min(1,(performance.now()-start)/duration);
   for(const {bar,from,to} of bars)bar.style.setProperty('--hp-ratio',from+(to-from)*progress);
   if(progress===1)return;
   await delay(16);
  }
 }
 function settleScene(frame){
  fastForward=false;
  trainerIntro?.remove();trainerIntro=undefined;
  field.classList.remove('intro-own-hidden','intro-foe-hidden');
  paintScene(frame);
  lastLog=(frame.logOffset??0)+frame.log.length-1;
 }
 async function animateScenes(view,opening){fastForward=false;
  const token=generation,frame=view.frame,scenes=frame.scenes??[],events=new Map(window.battlePresentation.events(frame,kind==='lan'&&!lan?.host?1:0).filter(event=>!['health','state','transition','ability'].includes(event.phase)).map(event=>[event.id,event]));const start=lastLog;
  for(const scene of scenes){
   if(scene.id<=start)continue;
   if(token!==generation)return;
   if(!canAnimate())break;
   const previous=presented??scene,line=frame.log[scene.id-(frame.logOffset??0)]??'',type=line.split('|')[1],effect=events.get(scene.id);
   const changes=healthChanges(previous,scene),message=describe(line);
   if(effect){
    const entry=effect.phase==='entry';
    if(entry&&trainerIntro&&!effect.source.own){
     trainerIntro.style.opacity='0';await pause(450);
     if(token!==generation)return;
     if(!canAnimate())break;
     trainerIntro.remove();trainerIntro=undefined;
    }
    if(!entry&&!changes.length)paintScene(scene);
    say(message);
    await pause(opening?100:450);
    if(token!==generation)return;
    if(!canAnimate())break;
    try{
     await layers.play(effect,scene,previous,audio.effects,()=>{
      if(!changes.length)paintScene(scene);
      if(entry)field.classList.remove(effect.source.own?'intro-own-hidden':'intro-foe-hidden');
     });
    }catch(cause){if(token===generation&&canAnimate())error(cause);}
   }else if(message){
    say(message);
    if(!['-damage','-heal','move'].includes(type))await pause(type==='-ability'?2350:1200);
   }
   if(token!==generation)return;
   if(!canAnimate())break;
   await animateHealth(changes,token);
   if(token!==generation)return;
   if(!canAnimate())break;
   if(!effect||changes.length)paintScene(scene);
   if(effect)await pause(550);
  }
  if(token===generation)settleScene(frame);
 }
 async function finishHealthTrails(token){
  // The damage trail holds after the HP fill stops, then retracts with a CSS transition.
  const cards=[...field.querySelectorAll('.battle-health')];
  const until=Math.max(0,...cards.map(card=>trails.get(trailKey(card))?.until??0));
  if(until>Date.now())await delay(until-Date.now());
  if(token!==generation)return;
  const animations=[...field.querySelectorAll('.battle-hp-trail')].flatMap(trail=>{
   trail.style.width='0';
   return trail.getAnimations().map(animation=>animation.finished);
  });
  await Promise.allSettled(animations);
 }
 async function show(view,animate=true){if(aux){renderAux(view);return;}if(!view)return setup();current=view;mode=view.mode;if(kind==='challenge'&&view.progress){if(view.phase==='preparation')return preparation(view);if(view.phase==='intermission'||view.phase!=='battling'&&!animate)return rewardScreen(view);}
  const opening=screenName!=='battle',playScenes=animate&&canAnimate(),ended=view.phase!=='battling';
  if(opening){
   stop();screenName='battle';document.body.classList.add('battle-fight');screen.replaceChildren();choices.clear();editingSlot=0;lastLog=-1;fieldShell(view);
   if(playScenes&&!ended){
    field.classList.add('intro-own-hidden','intro-foe-hidden');
    if(kind==='challenge'){trainerIntro=U.trainerSprite(view.encounterID,base);trainerIntro.classList.add('battle-trainer-intro');field.append(trainerIntro);}
   }
  }renderHeader(view);
  const changed=presented?.decisionID!==view.frame.decisionID;if(changed){choices.clear();megaSlot=undefined;sheetOpen=false;for(const slot of view.frame.slots)if(slot.canPass)choices.set(slot.slot,{kind:'pass'});}
  fieldShell(view);const presentationGeneration=generation;if(!presented&&playScenes)paintScene(view.frame);playMessage='';busy=true;resultPresented=false;renderCommands(view);
  if(!ended)updateMusic(view);
  if(playScenes)await animateScenes(view,opening);else settleScene(view.frame);
  if(presentationGeneration!==generation)return;
  if(ended)await finishHealthTrails(presentationGeneration);
  if(presentationGeneration!==generation)return;
  busy=false;resultPresented=ended;renderHeader(view);renderCommands(view);
  if(ended){
   updateMusic(view);
   if(kind==='challenge'&&view.progress){await delay(700);if(presentationGeneration===generation)await modernReward(view);}
  }
 }
 async function submit(){if(busy||!current)return;const actions=current.frame.slots.map(slot=>choices.get(slot.slot));if(actions.some(action=>!action))return;busy=true;disable();error('');try{if(kind==='lan'){await window.battle.lan('choose',{decisionID:current.frame.decisionID,actions});}else{const view=await window.battle.choose(mode,current.checkpoint,actions);await show(view,true);}}catch(cause){error(cause);}finally{busy=false;if(kind==='lan'&&pendingView)await drainLanView();else if(current)renderCommands(current);}}
 function confirmSurrender(){const box=node('div',undefined,'battle-confirm');box.append(node('p',t('이 배틀을 기권하시겠습니까?')));const actions=node('div',undefined,'battle-confirm-actions');actions.append(button(t('취소'),()=>box.remove()),button(t('기권'),()=>void operation(async()=>{box.remove();if(kind==='lan'){await window.battle.lan('surrender');}else{const view=await window.battle.surrender(mode);await show(view,false);}}),'primary'));box.append(actions);screen.querySelector('.battle-main-content')?.prepend(box);}
 function rewardScreen(view){if(view.progress)return modernReward(view);stop();screenName='reward';basicHeader();const body=node('div',undefined,'battle-prelude');body.append(node('h3',U.trainerName(view.encounterID,view.opponent)),node('h2',t(view.phase==='cleared'?'챌린지 완료':view.phase==='lost'?'챌린지 종료':'회복 보상')),rosterTiles(view.frame.own));
  if(view.phase==='reward')for(const reward of view.rewards)body.append(command(button(t(reward.label),()=>void operation(async()=>{const next=await window.battle.advance(mode,reward.kind,view.checkpoint);await show(next,false);}))));else body.append(button(t('새 챌린지'),()=>void setup(),'primary'));
  screen.replaceChildren(body);footer.replaceChildren();addClose();}
 const shopName=id=>U.localized(window.battleCatalog.shopText[id]?.names,id),shopDescription=id=>U.localized(window.battleCatalog.shopText[id]?.descriptions,'');
 const buffNames={attack:'공격',specialAttack:'특수공격',speed:'스피드',defense:'방어',specialDefense:'특수방어'};
 function trainer(view){const box=node('div',undefined,'battle-trainer-heading');const label=node('div');label.append(node('h2',U.trainerName(view.encounterID,view.opponent)),node('p',view.encounter+' / '+view.encounterCount));box.append(U.trainerSprite(view.encounterID,base),label);return box;}
 function preparation(view){stop();candidates=view.progress.team;current=view;screenName='preparation';basicHeader();const p=view.progress;selected=p.team.map(m=>m.id);for(const m of p.team)gearSelections[m.id]=p.resources.find(r=>r.id===m.id)?.item??'';let order=[];
  function draw(){
   const body=node('div',undefined,'battle-prelude');
   body.append(trainer(view),node('p',t('출전 순서를 선택하세요. 첫 번째 포켓몬이 선봉입니다.')));
   const columns=node('div',undefined,'battle-preparation-grid'),own=node('div'),foe=node('div');
   const grid=node('div',undefined,'battle-team-grid');
   for(const m of p.team){
    const tile=node('div',undefined,'battle-team-tile'),index=order.indexOf(m.id);
    const pick=button('',()=>{index<0?order.push(m.id):order.splice(index,1);draw();});
    pick.setAttribute('aria-pressed',String(index>=0));
    if(index>=0)tile.dataset.lineupOrder=String(index+1);
    pick.append(...(index===0?[U.teamArtwork(thumbnail(m,50),true)]:[node('small',index<0?'○':String(index+1)),thumbnail(m,50)]),node('strong',species(m)));
    const r=p.resources.find(r=>r.id===m.id),gear=button(gearSelections[m.id]?U.localized(U.item(gearSelections[m.id])?.names):t('도구 없음'),()=>itemPicker(m,gear));
    tile.append(pick,node('small','HP '+r.hp+'/'+m.stats.hp),gear);
    grid.append(tile);
   }
   const latest=p.team.find(m=>m.id===order.at(-1));
   own.append(node('h3',t('내 팀')),grid);
   foe.append(node('h3',t('상대 팀')),rosterTiles(view.preview??[],undefined,latest));
   columns.append(own,foe);body.append(columns);screen.replaceChildren(body);footer.replaceChildren();
   const save=button(t('저장 후 닫기'),()=>void operation(async()=>{await window.battle.cpu('prepare',{order:[...order,...selected.filter(id=>!order.includes(id))],items:U.assignments(selected,candidates,gearSelections),begin:false});await window.battle.closeWindow();}));
   const start=button(t('배틀 시작'),()=>void operation(async()=>{await show(await window.battle.cpu('prepare',{order,items:U.assignments(selected,candidates,gearSelections),begin:true}),true);}),'primary');
   start.id='challenge-begin';start.disabled=order.length!==6||busy;footer.append(save,start);
  }
  draw();
 }
 function targetGrid(view,id,onPick,enabled=()=>true){const grid=node('div',undefined,'battle-team-grid');for(const m of view.progress.team){const r=view.progress.resources.find(r=>r.id===m.id),tile=button('',()=>onPick(m.id),'battle-team-tile');tile.dataset.id=m.id;tile.setAttribute('aria-pressed',String(id===m.id));tile.disabled=!enabled(r,m);tile.append(thumbnail(m,50),node('strong',species(m)),node('small','HP '+r.hp+'/'+m.stats.hp),node('small','PP '+r.moves.reduce((n,m)=>n+m.pp,0)+'/'+r.moves.reduce((n,m)=>n+m.maxPP,0)));if(r.status)tile.append(node('small',t(U.ailments[r.status]??r.status)));grid.append(tile);}return grid;}
 function moveTargets(resource,index,onPick){const box=node('div',undefined,'battle-reward-moves');for(const [i,m]of resource?.moves.entries()??[]){const pick=button((index===i?'● ':'○ ')+U.move(m.id).name+' · PP '+m.pp+'/'+m.maxPP,()=>onPick(i));pick.disabled=m.pp===m.maxPP;box.append(pick);}return box;}
 function purchasePanel(view,offer){const p=view.progress,teamWide=['fullRecovery','teamHeal30'].includes(offer.id),popup=node('dialog',undefined,'battle-purchase-popup');let id='',moveIndex;
  const needs=(r,m)=>offer.id==='statusCure'?r.hp>0&&!!r.status:offer.id==='ppRecovery'||offer.id==='ppMoveRecovery'?r.moves.some(m=>m.pp<m.maxPP):offer.id==='fullRecovery'?r.hp<m.stats.hp||!!r.status||r.moves.some(m=>m.pp<m.maxPP):r.hp<m.stats.hp;
  id=p.team.find(m=>needs(p.resources.find(r=>r.id===m.id),m))?.id??'';
  function draw(){popup.replaceChildren(node('h2',shopName(offer.id)),node('p',U.points(p.points)),node('p',shopDescription(offer.id)));popup.append(targetGrid(view,id,next=>{id=next;moveIndex=undefined;draw();},teamWide?()=>false:needs));const r=p.resources.find(r=>r.id===id);if(offer.id==='ppMoveRecovery'){moveIndex??=r?.moves.findIndex(m=>m.pp<m.maxPP);popup.append(moveTargets(r,moveIndex,index=>{moveIndex=index;draw();}));}const actions=node('div',undefined,'battle-confirm-actions'),buy=button(t('구매')+' · '+U.points(offer.price),()=>void operation(async()=>{const next=await window.battle.cpu('purchase',{item:offer.id,id,moveIndex});popup.close();popup.remove();await modernReward(next);}),'primary');buy.id='challenge-shop-buy';buy.disabled=!id||offer.id==='ppMoveRecovery'&&!(moveIndex>=0);actions.append(button(t('취소'),()=>{popup.close();popup.remove();}),buy);popup.append(actions);}draw();popup.addEventListener('close',()=>popup.remove());document.body.append(popup);popup.showModal();
 }
 async function modernReward(view){stop({keepMusic:true});current=view;screenName='reward';basicHeader();updateMusic(view);const p=view.progress,body=node('div',undefined,'battle-prelude');body.append(trainer(view));footer.replaceChildren();
  if(view.phase==='lost'||view.phase==='cleared'){body.append(node('h2',t(view.phase==='cleared'?'챌린지 완료':'챌린지 종료')),rosterTiles(p.team,p.resources));if(view.phase==='lost'){await window.battle.cpu('claim');body.append(node('p',t('보상')+' '+(p.cash/1000000)+'M'));body.append(button(t('새 챌린지'),()=>void setup(),'primary'));}else if(p.champion?.claimed){body.append(node('p',t('보상을 받았습니다.')),button(t('새 챌린지'),()=>void setup(),'primary'));}else{body.append(node('p',t('이로치로 바꿀 졸업 포켓몬을 선택하세요.')));const owned=await window.battle.choices('champion');for(const m of owned.filter(m=>!m.shiny)){const choose=button(species(m),()=>void operation(async()=>{await modernReward(await window.battle.cpu('claim',{id:m.id}));}));choose.prepend(thumbnail(m));if(m.championAchievedAt!==undefined)choose.append(node('small','★ '+t('챌린지 챔피언')));body.append(choose);}}screen.replaceChildren(body);addClose();return;}
  body.append(node('h3',t('챌린지 상점')+' · '+U.points(p.points)));const shop=node('div',undefined,'battle-shop-grid');for(const offer of p.shop){const pick=button('',()=>purchasePanel(view,offer));const icon=node('span',offer.id.startsWith('pp')?'ϟ':'♥','battle-shop-icon'+(offer.id.startsWith('pp')?' pp':'')),label=node('span');label.append(node('strong',shopName(offer.id)),node('small',U.points(offer.price)));pick.append(icon,label);window.moveUI.bindTooltip(pick,()=>shopName(offer.id)+'\n'+shopDescription(offer.id));pick.id='challenge-shop-'+offer.id;pick.disabled=p.points<offer.price;shop.append(pick);}body.append(shop,node('hr'));
  if(p.buffs.length)body.append(node('p',p.buffs.map(b=>t(buffNames[b.kind])+' +1 · '+b.remaining+' '+t('배틀')).join(' / '),'battle-buffs'));
  if(view.phase==='intermission'){body.append(node('p','✓ '+t('보상이 적용되었습니다.')),rosterTiles(p.team,p.resources));const next=button(t('다음 배틀'),()=>void operation(async()=>{await show(await window.battle.cpu('next'),false);}),'primary');next.id='challenge-next';footer.append(next);}
  else{let kind='points',id=p.team[0].id,moveIndex=0,incoming;const reward=node('div'),milestone=view.encounter%3===0,enhanced=view.encounter>=16;const options=milestone?['allHeal','replace','buff','points']:['heal','pp','replace','buff','points'];const labels={allHeal:'팀 전체 HP·PP·상태 회복',heal:enhanced?'HP 전부 회복':'HP 35% 회복',pp:enhanced?'모든 기술 PP 회복':'기술 하나 PP +3',replace:'포켓몬 교체',buff:t(buffNames[p.roll])+' +1 · '+t('3배틀'),points:'+'+U.points(50)};
   candidates=await window.battle.choices();function draw(){reward.replaceChildren(node('h3',t('보상 선택')));for(const option of options){const pick=button((kind===option?'● ':'○ ')+t(labels[option]),()=>{kind=option;draw();});pick.id='challenge-reward-'+option;reward.append(pick);}if(!['points','buff','allHeal'].includes(kind))reward.append(targetGrid(view,id,next=>{id=next;moveIndex=0;draw();}));else if(kind==='allHeal')reward.append(rosterTiles(p.team,p.resources));if(kind==='pp'&&!enhanced)reward.append(moveTargets(p.resources.find(r=>r.id===id),moveIndex,index=>{moveIndex=index;draw();}));if(kind==='replace'){for(const m of candidates.filter(m=>!p.team.some(row=>row.id===m.id||row.speciesID===m.speciesID)&&!p.retired.includes(m.id))){reward.append(button((incoming===m.id?'● ':'○ ')+species(m),()=>{incoming=m.id;draw();}));}}const apply=button(t('보상 적용'),()=>void operation(async()=>{await modernReward(await window.battle.cpu('reward',{kind,id,moveIndex,incoming}));}),'primary');apply.id='challenge-apply-reward';const r=p.resources.find(r=>r.id===id),m=p.team.find(m=>m.id===id);apply.disabled=kind==='replace'&&!incoming||kind==='heal'&&r.hp===m.stats.hp||kind==='pp'&&(enhanced?!r.moves.some(m=>m.pp<m.maxPP):!r.moves[moveIndex]||r.moves[moveIndex].pp===r.moves[moveIndex].maxPP);reward.append(apply);}draw();body.append(reward);}
  screen.replaceChildren(body);addClose();
 }
 // LAN publishes the final engine frame before it broadcasts the settled match outcome.
 function lanView(state){if(!state.frame)return null;const ended=state.phase==='ended'||state.frame.ended,won=state.phase==='ended'?state.outcome==='win':state.frame.winner===(state.host?0:1);return{mode:'singles',practice:false,checkpoint:state.frame.decisionID,phase:ended?(won?'cleared':'lost'):'battling',encounter:1,encounterCount:1,opponent:state.opponent?.nickname??'',frame:{...state.frame,ended},rewards:[],opponentRoster:state.opponentRoster};}
 async function drainLanView(){
  while(!busy&&pendingView){
   const view=pendingView;pendingView=undefined;
   if(current?.frame.decisionID===view.frame.decisionID&&current?.phase===view.phase){current=view;renderHeader(view);renderCommands(view);}
   else{
    const firstTurn=view.frame.turn===1&&view.phase==='battling'&&view.frame.log.some(line=>line.startsWith('|switch|'))&&
     !view.frame.log.some(line=>line.startsWith('|move|')||line.startsWith('|faint|'));
    await show(view,Boolean(current)||firstTurn);
   }
  }
 }
 async function receiveLan(state){lan=state;const view=lanView(state);if(aux){if(view)renderAux(view);return;}if(view){pendingView=view;await drainLanView();}else{pendingView=undefined;if(field)stop();current=undefined;busy=false;screenName='waiting';basicHeader();const waiting=node('div',undefined,'battle-prelude');waiting.append(window.playerProfile.participants(state.identity,state.opponent),node('p',t(state.phase==='reconnecting'?'재연결 중…':'상대가 준비할 때까지 기다려 주세요.')));screen.replaceChildren(waiting);footer.replaceChildren();addClose();}if(state.error&&lan===state)error(state.error);}
 function renderAux(view){current=view;basicHeader();footer.replaceChildren();const body=node('div',undefined,'battle-aux'),statNames={atk:'공격',def:'방어',spa:'특수공격',spd:'특수방어',spe:'스피드',accuracy:'명중률',evasion:'회피율'};
  if(aux==='field'){const field=view.frame.field??{},hasEffects=field.weather||['conditions','ownSide','foeSide'].some(key=>field[key]?.length);body.append(node('h3',t('필드')));if(!hasEffects)body.append(node('p',t('필드 효과 없음')));const timing=value=>' · '+(value?value.remaining+'/'+value.maximum:t('해제까지'));function effect(id,label,time,layers){const section=node('section');section.append(node('strong',label+(layers>1?' ×'+layers:'')+timing(time)));const description=U.move(id).description;if(description&&description!==t('기술 설명을 불러올 수 없습니다.'))section.append(node('p',description));body.append(section);}if(field.weather)effect(field.weather,t({sunnyday:'쾌청',raindance:'비',sandstorm:'모래바람',hail:'싸라기눈'}[field.weather]??field.weather)+(field.weatherSuppressed?' · '+t('날씨 효과 억제'):''),field.weatherTiming);for(const id of field.conditions??[])effect(id,U.move(id).name,field.conditionTimings?.[id]);for(const own of [true,false])for(const condition of field[own?'ownSide':'foeSide']??[])effect(condition.id,t(own?'내 진영':'상대 진영')+' · '+U.move(condition.id).name,condition.timing,condition.layers);
  }else for(const p of view.frame.own.filter(p=>p.active)){const section=node('section');section.append(node('h3',species(p)));if(p.ability)section.append(node('p','✦ '+U.ability(p.ability)));for(const [stat,label]of Object.entries(statNames)){const value=p.boosts?.[stat]??0,row=node('div',undefined,'battle-stat-line');row.append(node('span','('+t(label)+' : '),node('strong',(value>0?'+':'')+value),node('span',')'));row.dataset.stage=String(Math.sign(value));section.append(row);}const item=U.item(p.item);section.append(node('p',t('소지 도구')+': '+(item?U.localized(item.names):t('도구 없음'))));if(item)section.append(node('p',U.localized(item.descriptions)));for(const effect of p.effects??[])section.append(node('p',t({confusion:'혼란',trapped:'교체 불가',partiallytrapped:'교체 불가',choicelock:'구애 도구로 기술 고정'}[effect]??U.move(effect).name),'battle-active-effect'));body.append(section);}screen.replaceChildren(body);
 }
 function applyContext(context){preferences=context;window.appPreferences=context;document.documentElement.dataset.animation=context.animated?'on':'off';document.documentElement.style.colorScheme=context.theme==='system'?'light dark':context.theme;window.dispatchEvent(new CustomEvent('preferences-changed',{detail:context}));}
 function cancelMotion(){
  skip();layers?.stop();trails.clear();
  for(const trail of field?.querySelectorAll('.battle-hp-trail')??[])trail.style.width='0';
 }
 window.battle.onContext(context=>{
  const wasAnimated=canAnimate();
  applyContext(context);
  if(wasAnimated&&!canAnimate())cancelMotion();
  if(!current)return;
  if(aux)renderAux(current);
  else if(screenName==='battle'){renderHeader(current);if(!busy)paintScene(presented??current.frame);renderCommands(current);}
  else if(screenName==='resume')resumePanel(current);
 });
 reducedMotion.addEventListener('change',event=>{if(event.matches)cancelMotion();});
 window.battle.onState(view=>{if(kind==='challenge'&&aux)renderAux(view);});
 window.battle.onLan(state=>{if(kind==='lan'&&base&&audio&&preferences)void receiveLan(state);});
 const deadlineTimer=setInterval(()=>{const timer=document.querySelector('.battle-timer');if(timer){const seconds=Math.max(0,Math.ceil((Number(timer.dataset.deadline)-Date.now())/1000));timer.textContent=String(seconds);timer.classList.toggle('urgent',seconds<=10);}},1000);
 // Battle shortcuts; ignored while typing or while a popover/dialog is open.
 document.addEventListener('keydown',event=>{
  if(screenName!=='battle'||!current||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,textarea,select,[contenteditable]')||document.querySelector(':popover-open:not(#pokemon-move-tooltip):not(#move-picker-menu),dialog[open]')||screen.querySelector('.battle-confirm'))return;
  if(event.key===' '){if(busy){event.preventDefault();if(event.repeat)fastForward=true;skip();}else if(!event.target.matches?.('button,summary'))event.preventDefault();return;}
  if(busy)return;
  if(event.key==='Escape'){if(logOpen){logOpen=false;renderCommands(current);}else if(sheetOpen&&!commandSlot(current)?.mustSwitch)closeSheet();return;}
  if(/^[1-4]$/.test(event.key)&&!sheetOpen){document.querySelectorAll('.battle-move-grid .battle-move')[Number(event.key)-1]?.click();return;}
  if(event.key.toLowerCase()==='p'&&!sheetOpen&&!commandSlot(current)?.canPass){openSheet();return;}
  if(event.key==='Enter'){if(event.target.matches?.('button,summary')&&!event.target.matches('.battle-move,.battle-party-cell'))return;const confirm=document.querySelector('#battle-confirm');if(confirm&&!confirm.disabled){event.preventDefault();confirm.click();}return;}
  const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-2,ArrowDown:2}[event.key];if(!step)return;
  const items=[...document.querySelectorAll(sheetOpen?'.battle-party-sheet:not([hidden]) .battle-party-cell:not(:disabled)':'.battle-move-grid .battle-move:not(:disabled)')];if(!items.length)return;event.preventDefault();
  const index=items.indexOf(document.activeElement);items[index<0?0:Math.min(items.length-1,Math.max(0,index+step))].focus();
 });
 document.addEventListener('keyup',event=>{if(event.key===' ')fastForward=false;});
 for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{clearTimeout(holdTimer);fastForward=false;});
 // Phaser in the effect iframes calls window.focus() on boot; hand focus back so battle shortcuts keep working.
 window.addEventListener('blur',()=>setTimeout(()=>{const frame=document.activeElement;if(!frame?.matches('iframe.battle-effect-frame'))return;frame.blur();window.focus();}));
 window.addEventListener('beforeunload',()=>{clearInterval(deadlineTimer);stop();});
 void(async()=>{try{[base,audio]=await Promise.all([window.battle.assets(),window.battle.audio()]);window.battleSprites.configure(base);applyContext(await window.battle.context());if(kind==='lan'){await receiveLan(await window.battle.lan('state'));}else{const view=await window.battle.resume('singles');if(aux&&view)renderAux(view);else if(view&&preferences.rewardTest&&view.practice&&view.phase==='battling')await show(view,false);else if(view)resumePanel(view);else await setup();}}catch(cause){error(cause);}})();
})();
