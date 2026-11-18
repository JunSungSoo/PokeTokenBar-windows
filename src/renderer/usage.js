const periods=['today','week','month'];
const format=new Intl.NumberFormat('ko-KR');
const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
const status=document.querySelector('#status'),refreshButton=document.querySelector('#refresh'),limitButton=document.querySelector('#load-limits'),trendPeriod=document.querySelector('#trend-period');
const primaryProviders=['claude','codex'],H=window.usageHistory;
const t=(text,args)=>window.i18n.t(text,args);
let lastSnapshot,companion,lastRefreshedAt,limitResults,selectedProvider='claude',limitMode='used',selectedAccount;
function element(tag,content,className){const node=document.createElement(tag);if(content!==undefined)node.textContent=content;if(className)node.className=className;return node;}
function renderCompanion(state){if(state){companion=state;if(lastSnapshot){lastSnapshot.companion=state;window.usageRecap.update(lastSnapshot);}}window.renderCompanionTabs(state);}
function sumCost(costs){return costs.reduce((sum,cost)=>({amount:sum.amount+cost.amount,reported:sum.reported||cost.reported,estimated:sum.estimated||cost.estimated,unknown:sum.unknown||cost.unknown}),{amount:0,reported:false,estimated:false,unknown:false});}
function costLabel(cost){const output=element('span',cost.reported||cost.estimated?dollars.format(cost.amount):'','usage-cost');if(cost.unknown)output.title=t(output.textContent?'부분 비용':'비용 정보 없음');else if(cost.estimated)output.title=t('추정 비용 포함');return output;}
function dailyKey(date){return String(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));}
function availableRows(usage){const allowed=window.appPreferences?.providers??Object.keys(usage);return Object.entries(usage).filter(([id])=>allowed.includes(id));}
function renderTrend(usage){
 const now=new Date(),rows=availableRows(usage),history=window.usageRecap.history(),streak=H.currentStreak(history,now),badge=document.querySelector('#usage-streak');
 badge.hidden=!streak.days;badge.textContent='🔥 '+(streak.days>=29?streak.days+'+':streak.days);badge.title=t(streak.includesToday?'{count}일 연속 사용':'{count}일 연속 — 오늘 사용하면 이어집니다',{count:streak.days});
 const mode=window.appPreferences?.activityVisualization??'bars',toggle=document.querySelector('#trend-visualization');toggle.textContent=mode==='bars'?'● ○':'○ ●';toggle.setAttribute('aria-label',t('활동 그래프 전환'));toggle.setAttribute('aria-pressed',String(mode==='heatmap'));
 const readout=document.querySelector('#trend-readout'),chart=document.querySelector('#usage-trend'),legend=document.querySelector('#trend-legend'),peakLabel=document.querySelector('#trend-peak');
 function showDay(date,total,cost){readout.replaceChildren(new Intl.DateTimeFormat(window.i18n.language,{month:'numeric',day:'numeric',weekday:'short'}).format(date)+' '+compactTokens(total)+' ',costLabel(cost));}
 if(mode==='heatmap'){
  trendPeriod.hidden=true;chart.className='activity-heatmap';legend.replaceChildren(element('span',t('최근 16주')));
  const start=H.stepDay(H.recapPeriod('week',now,0,window.usageRecap.firstWeekday()).start,-15*7),today=H.dayKey(now),values=Array.from({length:112},(_,i)=>{const date=H.stepDay(start,i),key=H.dayKey(date);return{date,key,tokens:history.tokensByDay[key]??0,known:key<=today&&(history.coveredSince?key>=history.coveredSince:key===today)};}),peak=Math.max(1,...values.map(day=>day.tokens));
  peakLabel.textContent=t('최근 활동');chart.replaceChildren(...values.map(day=>{const cell=element('button');cell.type='button';cell.className='heatmap-day';cell.dataset.level=day.known?String(day.tokens?Math.max(1,Math.ceil(day.tokens/peak*4)):0):'unknown';cell.disabled=!day.known;const label=new Intl.DateTimeFormat(window.i18n.language,{month:'short',day:'numeric'}).format(day.date)+' · '+(day.known?groupedTokens.format(day.tokens)+' '+t('토큰'):t('기록 없음'));cell.title=label;cell.setAttribute('aria-label',label);for(const event of ['pointerenter','focus','click'])cell.addEventListener(event,()=>showDay(day.date,day.tokens,sumCost([])));return cell;}));
  showDay(now,history.tokensByDay[today]??0,sumCost([]));return;
 }
 trendPeriod.hidden=false;chart.className='trend-bars';
 const length=trendPeriod.value==='month'?now.getDate():Number(trendPeriod.value)||14;
 const ids=[...primaryProviders.filter(id=>rows.some(([p])=>p===id)),...rows.filter(([id,row])=>!primaryProviders.includes(id)&&Object.values(row.daily).some(n=>n>0)).map(([id])=>id)];
 const colors=['#d78162','#538dd7','#6b9b6d','#a887bd','#c79b45','#6cabb0','#bc7794','#8093ac'];
 const values=Array.from({length},(_,i)=>{const date=H.stepDay(now,i-length+1),key=dailyKey(date),amounts=ids.map(id=>usage[id].daily[key]??0);return{date,amounts,total:amounts.reduce((a,b)=>a+b,0),cost:sumCost(rows.flatMap(([,row])=>row.dailyCost[key]?[row.dailyCost[key]]:[]))};});
 const peak=Math.max(0,...values.map(day=>day.total));peakLabel.textContent=t('최대')+' '+compactTokens(peak);
 chart.replaceChildren(...values.map((day,index)=>{const number=day.date.getDate(),today=index===length-1,mark=element('button',undefined,'trend-day'+(today?' today':''));mark.type='button';mark.title=new Intl.DateTimeFormat(window.i18n.language,{month:'short',day:'numeric'}).format(day.date)+' · '+groupedTokens.format(day.total)+' '+t('토큰');mark.setAttribute('aria-label',mark.title);const bar=element('span',undefined,'trend-stack');bar.setAttribute('aria-hidden','true');day.amounts.forEach((amount,i)=>{if(!amount)return;const segment=element('span',undefined,'trend-segment');segment.style.setProperty('--share',amount/(peak||1)*100+'%');segment.style.setProperty('--series',colors[i%colors.length]);bar.append(segment);});mark.append(bar,element('span',today||number===1||index%7===0?String(number):'','trend-axis'));for(const event of ['pointerenter','focus','click'])mark.addEventListener(event,()=>showDay(day.date,day.total,day.cost));return mark;}));
 legend.replaceChildren(...ids.map((id,i)=>{const label=element('span',lastSnapshot.labels[id]);label.style.setProperty('--series',colors[i%colors.length]);return label;}));chart.onpointerleave=()=>showDay(values.at(-1).date,values.at(-1).total,values.at(-1).cost);chart.onpointerleave();
}
function renderProvider(usage){
 const data=usage[selectedProvider],line=document.querySelector('#provider-usage');line.replaceChildren();line.hidden=!data||!availableRows(usage).some(([id])=>id===selectedProvider);
 if(!line.hidden){const heading=element('div',undefined,'provider-summary');heading.append(element('strong',lastSnapshot.labels[selectedProvider]),element('span',compactTokens(data.today.total)),costLabel(data.cost.today));line.append(heading);
  const types=element('dl',undefined,'token-breakdown');for(const[label,key]of [['입력','input'],['출력','output'],['캐시 쓰기','cacheWrite'],['캐시 읽기','cacheRead']])types.append(element('dt',t(label)),element('dd',compactTokens(data.today[key])));line.append(types);
  const models=Object.entries(data.todayModels??{}).sort(([a,x],[b,y])=>y-x||a.localeCompare(b));if(models.length>1){const list=element('dl',undefined,'model-breakdown');for(const[name,tokens]of models){const label=element('dt',name.split('/').at(-1));label.title=name;list.append(label,element('dd',compactTokens(tokens)));}line.append(list);}
 }
 for(const chip of document.querySelectorAll('#usage-providers button'))chip.setAttribute('aria-pressed',String(chip.dataset.provider===selectedProvider));renderLimits();renderServiceStatus();
}
function render({usage,labels,activity,activityGate}){
 if(activityGate)window.dispatchEvent(new CustomEvent('activity-gate',{detail:activityGate}));
 updateRefreshAge();
 if(activity)window.dispatchEvent(new CustomEvent('usage-activity',{detail:activity}));window.usageRecap.update(lastSnapshot);
 const rows=availableRows(usage),all=rows.map(([,row])=>row),total=period=>all.reduce((sum,row)=>sum+row[period].total,0),cost=period=>sumCost(all.map(row=>row.cost[period])),today=total('today');
 document.querySelector('#today-total').textContent=compactTokens(today);document.querySelector('#today-exact').textContent=today>=1000?groupedTokens.format(today):'';document.querySelector('#today-cost').replaceChildren(costLabel(cost('today')));
 document.querySelector('#usage-periods').replaceChildren(...[['week','이번 주'],['month','이번 달']].map(([period,label])=>{const span=element('span');span.append(element('span',t(label)),document.createTextNode(' '),element('strong',compactTokens(total(period))),document.createTextNode(' '),costLabel(cost(period)));return span;}));
 const visible=[...primaryProviders.filter(id=>rows.some(([p])=>p===id)),...rows.filter(([id,row])=>!primaryProviders.includes(id)&&(row.month.total||row.week.total||row.extraRoot)).map(([id])=>id)];
 if(!visible.includes(selectedProvider))selectedProvider=visible[0];const controls=document.querySelector('#usage-providers');controls.hidden=visible.length<2;controls.replaceChildren(...visible.map(id=>{const chip=element('button',labels[id]);chip.type='button';chip.dataset.provider=id;chip.addEventListener('click',()=>{selectedProvider=id;selectedAccount=undefined;renderProvider(lastSnapshot.usage);});return chip;}));
 renderTrend(usage);renderProvider(usage);const errors=all.reduce((sum,row)=>sum+row.unreadable,0);status.hidden=!errors;status.textContent=errors?t('일부 로그를 읽지 못했습니다 ({count}개).',{count:errors}):'';
}
async function refresh(){refreshButton.disabled=true;if(!lastSnapshot){status.hidden=false;status.textContent=t('사용량을 읽는 중입니다…');}try{lastSnapshot=await window.usage.refresh();lastRefreshedAt=Date.now();render(lastSnapshot);renderCompanion(lastSnapshot.companion);}catch{status.hidden=false;status.textContent=t('사용량을 갱신하지 못했습니다. 잠시 후 다시 시도하세요.');}finally{refreshButton.disabled=false;}}
function renderLimits(){
 const section=document.querySelector('.official-limits'),message=document.querySelector('#limit-status'),list=document.querySelector('#limit-rows'),tabs=document.querySelector('#limit-accounts');
 const results=limitResults?.filter(row=>row.provider===selectedProvider)??[];section.hidden=!['claude','codex','antigravity','cursor','opencode','grok'].includes(selectedProvider);if(section.hidden||limitButton.disabled)return;
 const accountKey=(row,i)=>row.accountID??row.account??String(i);
 if(!results.some((row,i)=>accountKey(row,i)===selectedAccount)){const index=results.findIndex(row=>row.status==='available');selectedAccount=results.length?accountKey(results[Math.max(0,index)],Math.max(0,index)):undefined;}
 tabs.hidden=results.length<2;tabs.replaceChildren(...results.map((row,i)=>{const key=accountKey(row,i),button=element('button',row.account??t('기본 계정'));button.type='button';button.setAttribute('aria-pressed',String(key===selectedAccount));button.addEventListener('click',()=>{selectedAccount=key;renderLimits();});return button;}));
 const result=results.find((row,i)=>accountKey(row,i)===selectedAccount);list.replaceChildren();
 if(result?.status==='available'){
  const now=Date.now(),Q=window.quotaPresentation;
  const stale=result.stale||result.checkedAt!==undefined&&now-result.checkedAt>900000;
  const errors={oauthExpired:'Claude Code 로그인 정보가 만료됐습니다.',sessionKeyExpired:'세션 키가 만료됐습니다. 브라우저에서 다시 복사해 붙여넣으세요.',rateLimited:'요청이 너무 많습니다. 잠시 후 다시 시도하세요.',network:'조회 실패'};
  message.textContent=[result.plan,result.account,stale?t('갱신 지연'):'',result.error?t(errors[result.error]??'조회 실패'):''].filter(Boolean).join(' · ');
  if(result.error){const recover=element('button',t('로그인 정보 다시 읽기'));recover.type='button';recover.addEventListener('click',()=>window.desktop.openSettings());message.append(' ',recover);}
  if(results.length>1&&result.accountUsage){const row=element('li'),u=result.accountUsage;row.append(element('span',t('오늘')+' '+compactTokens(u.todayTokens)+' '),costLabel(u.todayCost),element('span',' · '+t('이번 달')+' '+compactTokens(u.monthTokens)+' '),costLabel(u.monthCost));list.append(row);}
  for(const bucket of result.windows){
   const view=Q.quotaPresentation(bucket,result.block,limitMode==='remaining',now,window.appPreferences?.warnThreshold,window.appPreferences?.criticalThreshold);
   const row=element('li'),heading=element('div',undefined,'quota-heading');row.dataset.gauge=String(view.gauge);
   heading.append(element('span',bucket.label.split(' · ').map(part=>t(part)).join(' · ')),element('strong',format.format(view.percent)+'%'));
   const track=element('div',undefined,'quota-track'),meter=document.createElement('progress');meter.max=100;meter.value=Math.min(100,Math.max(0,view.percent));meter.setAttribute('aria-label',bucket.label);track.append(meter);
   if(view.marker!==null){
    const marker=element('span',undefined,'quota-pace-marker');marker.style.left=(view.marker*100)+'%';marker.setAttribute('aria-hidden','true');track.append(marker);
    let help=t('페이스 — 창 시간만큼 균등하게 썼다면 지금 {percent}입니다.',{percent:format.format(Q.displayPercent(view.pace*100,limitMode==='remaining'))+'%'});
    if(view.tier!==null){const names=['여유 많음','여유','페이스대로','조금 빠름','빠름','매우 빠름'];const delta=view.delta>0?t('페이스보다 {points}%p 더 씀',{points:view.delta}):view.delta<0?t('페이스보다 {n}%p 덜 씀',{n:-view.delta}):'';help=t(names[view.tier])+(delta?' · '+delta:'')+'\n'+help;}
    row.title=help;meter.setAttribute('aria-description',help);
   }
   row.append(heading,track);
   if(bucket.resetsAt!==undefined){const minutes=Math.max(0,Math.ceil((bucket.resetsAt-now)/60000)),reset=element('small',t('초기화')+' · '+(minutes>=60?t('{hours}시간 {minutes}분',{hours:Math.floor(minutes/60),minutes:minutes%60}):t('{count}분',{count:minutes})));reset.title=new Date(bucket.resetsAt).toLocaleString(window.i18n.language);row.append(reset);}
   if(view.forecast&&result.tracked!==false){const time=new Date(view.forecast.at).toLocaleTimeString(window.i18n.language,{hour:'2-digit',minute:'2-digit'}),prediction=element('small',view.forecast.beforeReset?t('현재 속도면 {time} 한도 도달',{time}):t('현재 속도로는 리셋 전 한도 도달 없음'),'quota-forecast');prediction.dataset.warning=String(view.forecast.beforeReset);row.append(prediction);}
   list.append(row);
  }
 }
 else{message.textContent=t(result?.status==='failed'?'조회 실패':limitResults?'사용 가능한 한도 없음':'공식 한도 불러오기');if(result?.status==='failed'){const button=element('button',t('로그인 정보 다시 읽기'));button.type='button';button.addEventListener('click',()=>window.desktop.openSettings());list.append(element('li'));list.lastChild.append(button);}}
}
limitButton.addEventListener('click',async()=>{limitButton.disabled=true;document.querySelector('#limit-status').textContent=t('사용 한도를 조회하는 중입니다…');try{limitResults=await window.usage.limits();limitButton.disabled=false;renderLimits();}catch{document.querySelector('#limit-status').textContent=t('사용 한도를 불러오지 못했습니다.');}finally{limitButton.disabled=false;}});
trendPeriod.addEventListener('change',()=>{void window.preferences.change({trend:trendPeriod.value}).catch(()=>{if(lastSnapshot)renderTrend(lastSnapshot.usage);});});
document.querySelector('#trend-visualization').addEventListener('click',()=>{void window.preferences.change({activityVisualization:window.appPreferences?.activityVisualization==='heatmap'?'bars':'heatmap'}).catch(()=>{});});
window.usage.onSnapshot(value=>{lastSnapshot=value;lastRefreshedAt=Date.now();render(value);renderCompanion(value.companion);});
window.usage.onLimits(value=>{limitResults=value;renderLimits();});
refreshButton.addEventListener('click',()=>void refresh());window.usage.onCompanion(renderCompanion);void window.usage.companion().then(state=>{if(!companion&&!lastSnapshot)renderCompanion(state);},()=>{if(!companion&&!lastSnapshot)renderCompanion(null);});void refresh();
window.addEventListener('preferences-changed',event=>{trendPeriod.value=event.detail.trend;limitMode=event.detail.limitMode;if(lastSnapshot)render(lastSnapshot);});
let serviceStatuses=[];
function renderServiceStatus(){const banner=document.querySelector('#provider-status-banner'),entry=serviceStatuses.find(row=>row.provider===selectedProvider);banner.hidden=window.appPreferences?.statusChecks===false||!entry||entry.indicator==='none';if(banner.hidden){banner.textContent='';return;}const names={minor:'성능 저하',major:'부분 장애',critical:'심각한 장애',maintenance:'유지보수',unknown:'상태 불명'};banner.textContent=entry.component+' · '+t(names[entry.indicator]);banner.title=new Date(entry.checkedAt).toLocaleString(window.i18n.language);}
window.usage.onStatuses(rows=>{serviceStatuses=rows;renderServiceStatus();});void window.usage.statuses().then(rows=>{serviceStatuses=rows;renderServiceStatus();}).catch(()=>{});
window.addEventListener('language-changed',()=>{if(lastSnapshot)render(lastSnapshot);});
function updateRefreshAge(){const label=document.querySelector('#refresh-age');if(label&&lastRefreshedAt){const seconds=Math.max(0,Math.floor((Date.now()-lastRefreshedAt)/1000));label.textContent=t('갱신')+' '+(seconds<60?seconds+'s':Math.floor(seconds/60)+'m');}}
setInterval(updateRefreshAge,1000);window.addEventListener('language-changed',updateRefreshAge);
setInterval(renderLimits,60000);

window.desktop.onRefresh?.(()=>void refresh());
