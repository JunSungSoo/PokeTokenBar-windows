// Stateless builders for the battle HUD: VS bar, data boxes, move buttons, detail card and party sheet.
(() => {
 const U=window.battleUI,{node,button,t,species,moveText}=U;
 const lightTypes=new Set(['electric','ice','ground','steel']);
 const categoryIcons={Physical:'✦',Special:'◎',Status:'○'};
 const categoryNames={Physical:'물리',Special:'특수',Status:'변화'};
 const boostNames={atk:'공격',def:'방어',spa:'특수공격',spd:'특수방어',spe:'스피드',accuracy:'명중률',evasion:'회피율'};
 const typeKey=type=>String(type??'').toLowerCase();

 function vsBar({ownName,ownIcon,ownSub,foeName,foeIcon,foeAvatar,foeSub}){
  const bar=node('div',undefined,'battle-vs'),own=node('div',undefined,'battle-vs-side own'),foe=node('div',undefined,'battle-vs-side foe'),badge=node('span','VS','battle-vs-badge');
  for(const [side,name,sub,avatar] of [
   [own,ownName,ownSub,window.playerProfile.avatar(ownIcon)],
   [foe,foeName,foeSub,foeAvatar??window.playerProfile.avatar(foeIcon)]
  ]){
   const details=node('div'),heading=node('strong',name);
   heading.dataset.noTranslate='';heading.title=name;
   details.append(heading,node('small',sub));side.append(avatar,details);
  }
  badge.setAttribute('aria-hidden','true');bar.append(own,badge,foe);return bar;
 }
 function progressCells(encounter,count){
  const box=node('span',undefined,'battle-progress');box.setAttribute('role','img');box.setAttribute('aria-label',t('{count}연전 중 {n}번째',{count,n:encounter}));
  for(let i=1;i<=count;i++)box.append(node('i',undefined,i<encounter?'won':i===encounter?'current':''));return box;
 }
 function statusBadge(status){const badge=node('span',t(U.ailments[status]??status),'battle-status-badge');badge.dataset.status=status;return badge;}
 function partyBalls(members,status){
  const strip=node('div',undefined,'battle-party'),count=members?members.length:(status?.selected??6),fainted=status?.fainted??0;
  for(let i=0;i<count;i++){const member=members?.[i],ball=node('i',undefined,'battle-ball');if(member?member.fainted:i>=count-fainted)ball.classList.add('fainted');else if(member?.status){ball.classList.add('ailing');ball.dataset.status=member.status;}strip.append(ball);}
  return strip;
 }
 // Keeps the HP bar plus a trail span that shows the HP lost on the last hit.
 function hpTrack(p){const track=node('span',undefined,'battle-hp-track'),trail=node('span',undefined,'battle-hp-trail');track.append(trail,U.hpBar(p));return track;}
 function databox(p,own,party){
  const card=node('div',undefined,'battle-health '+(own?'own':'foe')+(p.fainted?' fainted':''));card.dataset.member=p.id;
  const plate=node('div',undefined,'battle-databox'),heading=node('div',undefined,'battle-health-title'),name=node('span',undefined,'battle-health-name');
  name.append(node('strong',species(p)));
  if(p.gender==='M'||p.gender==='F'){const gender=node('span',p.gender==='M'?'♂':'♀','battle-gender '+(p.gender==='M'?'male':'female'));gender.setAttribute('aria-label',t(p.gender==='M'?'수컷':'암컷'));name.append(gender);}
  if(p.status)name.append(statusBadge(p.status));if(p.mega)name.append(node('span','MEGA','battle-mega-badge'));
  heading.append(name,node('span','Lv'+p.level,'battle-level px'));
  const hp=node('div',undefined,'hp-line'),tag=node('span','HP','battle-hp-tag px');tag.setAttribute('aria-hidden','true');hp.append(tag,hpTrack(p));
  plate.append(heading);if(own&&p.item){const item=U.item(p.item);plate.append(node('p',item?U.localized(item.names):p.item,'battle-health-item'));}plate.append(hp);
  if(own)plate.append(node('span',p.hp+' / '+p.maxHP,'battle-health-number px'));else plate.title=p.hp+'%';
  card.append(party,plate);
  const boosts=Object.entries(p.boosts??{}).filter(([,value])=>value);
  if(boosts.length){const chips=node('div',undefined,'battle-boosts');for(const [stat,value]of boosts.slice(0,3))chips.append(node('span',t(boostNames[stat]??stat)+' '+(value>0?'▲':'▼')+Math.abs(value)));if(boosts.length>3)chips.append(node('span','+'+(boosts.length-3)));card.append(chips);}
  return card;
 }
 function typeChip(move,text){const chip=node('span',text.type,'battle-type-chip');chip.dataset.type=move.ignoresTypeMatchup?'none':typeKey(move.type);return chip;}
 function categoryIcon(category){const icon=node('span',categoryIcons[category]??'○','battle-category');icon.dataset.category=category??'Status';icon.title=t(categoryNames[category]??category??'');return icon;}
 // Matchup wording and colour for a damage multiplier (0, 0.25, 0.5, 1, 2, 4).
 function matchupLevel(value){if(value===0)return ['효과가 없음','none'];if(value<1)return ['효과가 별로','weak'];if(value>1)return ['효과가 굉장함','super'];return ['효과 보통','normal'];}
 function moveButton(move,{selected,disabled,onPick}){
  const text=moveText(move),pick=button('',onPick,'battle-move');pick.dataset.type=move.ignoresTypeMatchup?'none':typeKey(move.type);pick.disabled=disabled;pick.setAttribute('aria-pressed',String(selected));
  const second=node('span',undefined,'battle-move-meta');
  if(move.disabled||!move.pp)second.append(node('span',U.disabledReason(move),'battle-move-reason'));
  else{const pp=node('span','PP '+move.pp+'/'+move.maxPP,'battle-pp px');pp.dataset.level=move.pp*4<=move.maxPP?'low':'ok';second.append(typeChip(move,text),categoryIcon(move.category??text.category),pp);}
  if(!move.pp){const pp=node('span','PP 0/'+move.maxPP,'battle-pp px');pp.dataset.level='empty';second.append(pp);}
  pick.append(node('strong',text.name,'battle-move-name'),second);
  window.moveUI.bindTooltip(pick,()=>window.moveText.moveTooltip(text,s=>t(s))+(U.disabledReason(move)?'\n'+U.disabledReason(move):''));
  return pick;
 }
 function detailCard(move,{hints,selected}){
  const box=node('div',undefined,'battle-selected-detail');if(!move)return box;const text=moveText(move);
  const head=node('div',undefined,'battle-detail-head');head.append(node('strong',text.name),typeChip(move,text));box.append(head);
  // Shown only after the player picks the move: effectiveness against each opposing target.
  if(hints&&selected&&(move.category??text.category)!=='Status'){
   if(move.ignoresTypeMatchup)box.append(node('p',t('타입 상성을 무시합니다.'),'matchup-note'));
   else for(const match of move.matchups??[]){if(match.multiplier==null)continue;const [label,level]=matchupLevel(match.multiplier),line=node('div',undefined,'matchup'),id=window.battleCatalog.aliases[U.key(match.name)],name=id?U.localized(window.battleCatalog.species[id],match.name):match.name,result=node('strong',t(label)+' ×'+match.multiplier);result.dataset.level=level;line.append(node('span',name),result);box.append(line);}
  }
  const facts=node('dl',undefined,'move-facts'),category=move.category??text.category;
  for(const [label,value]of [['분류',t(categoryNames[category]??category??'—')],['위력',text.power||'—'],['기본 명중률',text.accuracy===true?t('필중'):text.accuracy==null?'—':text.accuracy+'%'],['대상',t(window.moveText.moveTarget(move.targetScope))]])facts.append(node('dt',t(label)),node('dd',String(value)));
  box.append(facts);
  const description=node('p',text.description,'move-description');description.tabIndex=0;window.moveUI.bindTooltip(description,()=>window.moveText.moveTooltip(text,s=>t(s)));box.append(description);
  return box;
 }
 // The sheet keeps the old picker contract: a `value` property plus a bubbling `change` event.
 function partySheet({id,members,isDisabled,selected,message,thumbnail,onChange}){
  const sheet=node('div',undefined,'battle-party-sheet');sheet.id=id;let value=selected??'';
  Object.defineProperty(sheet,'value',{get:()=>value,set:next=>{value=String(next);for(const cell of sheet.querySelectorAll('.battle-party-cell'))cell.setAttribute('aria-pressed',String(cell.dataset.value===value));}});
  sheet.addEventListener('change',()=>onChange(value));
  const box=node('p',message,'battle-message');box.setAttribute('aria-live','polite');const grid=node('div',undefined,'battle-party-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label',t('교체'));
  for(const [index,p]of members.entries()){
   const cellValue=String(index+1),cell=button('',()=>{sheet.value=cellValue;sheet.dispatchEvent(new Event('change',{bubbles:true}));},'battle-party-cell'+(p.fainted?' fainted':''));
   cell.dataset.value=cellValue;cell.disabled=isDisabled(p);cell.setAttribute('aria-pressed',String(cellValue===value));
   const top=node('span',undefined,'battle-party-top');top.append(node('strong',species(p)));if(p.status)top.append(statusBadge(p.status));top.append(node('span','Lv'+p.level,'battle-level px'));
   const hp=node('span',undefined,'battle-party-hp');hp.append(hpTrack(p),node('span',p.hp+'/'+p.maxHP,'px'));
   const info=node('span',undefined,'battle-party-info');info.append(top,hp);cell.append(thumbnail(p),info);
   if(p.active)cell.append(node('span',t('싸우는 중'),'battle-party-flag active'));else if(p.fainted)cell.append(node('span',t('기절'),'battle-party-flag'));
   grid.append(cell);
  }
  sheet.append(box,grid);return sheet;
 }
 window.battleHUD={vsBar,progressCells,partyBalls,databox,moveButton,detailCard,partySheet,statusBadge};
})();
