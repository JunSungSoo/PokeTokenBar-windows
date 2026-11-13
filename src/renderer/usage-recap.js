(() => {
 const H=window.usageHistory,get=id=>document.getElementById(id),t=(text,args)=>window.i18n.t(text,args);
 let snapshot,scope='week',offset=0,open=false,focusBefore,scrollBefore=0;
 const firstWeekday=()=>{const locale=new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale);return((locale.getWeekInfo?.()??locale.weekInfo)?.firstDay??1)%7;};
 const localeDate=(key,options)=>new Intl.DateTimeFormat(window.i18n.language,options).format(H.dayDate(key));
 function history(){if(snapshot?.history)return snapshot.history;const daily={};for(const row of Object.values(snapshot?.usage??{}))for(const[key,value]of Object.entries(row.daily))daily[key]=(daily[key]??0)+value;return H.mergeHistory({version:1,tokensByDay:{}},daily,new Date());}
 function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
 function render(){if(!snapshot||!open)return;
  const now=new Date(),recap=H.makeRecap(history(),scope,now,offset,firstWeekday()),start=H.dayDate(recap.start),end=H.dayDate(recap.end);
  const name=scope==='year'?String(start.getFullYear()):scope==='month'?localeDate(recap.start,{year:'numeric',month:'long'}):new Intl.DateTimeFormat(window.i18n.language,{year:'numeric',month:'short',day:'numeric'}).formatRange(start,H.stepDay(end,-1));
  get('recap-period').textContent=name;get('recap-total').textContent=compactTokens(recap.total);get('recap-total').title=groupedTokens.format(recap.total);
  const delta=get('recap-delta');delta.hidden=recap.delta===null;delta.textContent=recap.delta===null?'':(recap.delta>=0?'▲':'▼')+new Intl.NumberFormat(window.i18n.language,{maximumFractionDigits:1}).format(Math.abs(recap.delta)*100)+'%';delta.dataset.direction=recap.delta<0?'down':'up';
  const peak=Math.max(1,...recap.buckets.map(b=>b.tokens));get('recap-chart').dataset.scope=scope;
  get('recap-chart').replaceChildren(...recap.buckets.map(bucket=>{
   const column=node('div',undefined,'recap-column'),label=scope==='year'?localeDate(bucket.key,{month:'narrow'}):scope==='week'?localeDate(bucket.key,{weekday:'short'}):[1,8,15,22,29].includes(H.dayDate(bucket.key).getDate())?String(H.dayDate(bucket.key).getDate()):'';
   const text=localeDate(bucket.key,scope==='year'?{year:'numeric',month:'long'}:{year:'numeric',month:'short',day:'numeric'})+' · '+(bucket.hasData?groupedTokens.format(bucket.tokens)+' '+t('토큰'):t('기록 없음'));
   column.tabIndex=0;column.title=text;column.setAttribute('aria-label',text);column.dataset.current=String(bucket.isCurrent);const meter=node('span',undefined,'recap-meter');meter.setAttribute('aria-hidden','true');const filled=Math.ceil(bucket.tokens/peak*8);for(let i=0;i<8;i++){const block=node('i');block.dataset.filled=String(bucket.hasData&&i<filled);block.dataset.known=String(bucket.hasData);meter.append(block);}column.append(meter,node('small',label));return column;
  }));
  const graduates=(snapshot.companion?.captures??[]).filter(row=>row.releasedAt===undefined&&row.graduatedAt!==undefined&&row.graduatedAt>=+start&&row.graduatedAt<+end).sort((a,b)=>b.graduatedAt-a.graduatedAt);
  get('recap-facts').replaceChildren(...[['최고의 날',recap.bestDay?compactTokens(recap.bestDay.tokens):'—'],['활동한 날',recap.activeDays+'/'+recap.countedDays],['최장 연속',t('{count}일',{count:recap.bestStreak})],['졸업',String(graduates.length)]].flatMap(([label,value])=>[node('dt',t(label)),node('dd',value)]));
  get('recap-graduates').replaceChildren(...(graduates.length?graduates.slice(0,4).map(row=>{const p=row.species.at(-1),chip=node('span',undefined,'recap-graduate'),name=window.speciesNames?.[p.number]?.[window.i18n.language]??p.name,img=node('img');img.alt='';img.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+(row.shiny?'shiny/':'')+(p.spriteID??p.number)+'.png';img.addEventListener('error',()=>img.remove());chip.append(img,node('span',name));return chip;}):[node('span',t('이 기간에 졸업한 포켓몬이 없어요.'))]));
  get('recap-best-day').hidden=!recap.bestDay;get('recap-best-day').textContent=recap.bestDay?t('최고의 날은 {day} — {tokens} 토큰.',{day:localeDate(recap.bestDay.key,{month:'short',day:'numeric'}),tokens:groupedTokens.format(recap.bestDay.tokens)}):'';
  get('recap-comparison').textContent=recap.inProgress&&recap.delta!==null?t({week:'지난주 같은 기간과 비교',month:'지난달 같은 기간과 비교',year:'작년 같은 기간과 비교'}[scope]):'';
  get('recap-previous').disabled=!recap.canGoBack;get('recap-next').disabled=offset>=0;get('recap-current').disabled=offset===0;get('recap-current').textContent=t({week:'이번 주',month:'이번 달',year:'올해'}[scope]);
 }
 function close(restore=true){if(!open)return;open=false;get('recap-screen').hidden=true;document.body.classList.remove('showing-recap');get('pane-home').hidden=document.body.dataset.tab!=='home';get('pane-home').scrollTop=scrollBefore;if(restore)focusBefore?.focus({preventScroll:true});}
 document.addEventListener('DOMContentLoaded',()=>{
  get('usage-details').addEventListener('click',()=>{if(!snapshot)return;focusBefore=get('usage-details');scrollBefore=get('pane-home').scrollTop;open=true;offset=0;get('pane-home').hidden=true;get('recap-screen').hidden=false;document.body.classList.add('showing-recap');render();get('recap-back').focus();});
  get('recap-back').addEventListener('click',()=>close());get('recap-scope').addEventListener('change',event=>{scope=event.target.value;offset=0;render();});
  for(const[id,move]of [['recap-previous',-1],['recap-next',1],['recap-current',0]])get(id).addEventListener('click',()=>{offset=move?Math.min(0,offset+move):0;render();});
 });
 document.addEventListener('keydown',event=>{if(open&&event.key==='Escape'&&!document.querySelector('dialog[open],:popover-open')){event.preventDefault();close();}});
 window.addEventListener('app-tab-changed',()=>close(false));window.addEventListener('language-changed',render);
 window.usageRecap={update(value){snapshot=value;render();},history,firstWeekday,isOpen:()=>open};
})();
