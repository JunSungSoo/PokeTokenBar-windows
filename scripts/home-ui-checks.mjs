import{mkdir,writeFile}from'node:fs/promises';
import{join}from'node:path';
import assert from'node:assert/strict';
export async function checkHomeUI(window,preferences,snapshot,capture=async()=>{}){
 const js=code=>window.webContents.executeJavaScript(code),until=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,25));}throw Error('Home timed out: '+code);};
 const now=new Date(),key=String(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())),iso=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
 for(const [id,n,input,output,write,read,amount]of [['claude',8000000,1000000,2000000,1000000,4000000,1.5],['codex',5346665,2000000,1000000,0,2346665,.99]]){
  const row=snapshot.usage[id];row.today={input,output,cacheWrite:write,cacheRead:read,total:n};row.week={...row.today};row.month={...row.today};row.daily={[key]:n};row.cost={today:{amount,reported:true,estimated:false,unknown:false},week:{amount,reported:true,estimated:false,unknown:false},month:{amount,reported:true,estimated:false,unknown:false}};row.dailyCost={[key]:row.cost.today};
 }
 snapshot.usage.claude.todayModels={'anthropic/claude-sonnet':5000000,'anthropic/claude-haiku':3000000};snapshot.usage.codex.todayModels={'openai/gpt-5':5346665};
 snapshot.usage.claude.lastHour=100;
 snapshot.usage.codex.lastHour=200;
 snapshot.history={version:1,coveredSince:(now.getFullYear()-1)+'-01-01',tokensByDay:{[iso]:13346665,[(now.getFullYear()-1)+'-02-01']:5000000}};
 await js("document.querySelector('#tab-home').click();document.querySelector('#refresh').click()");await until("document.querySelector('#today-total').textContent==='13.3M'");
 const activeProvider="document.querySelector('#usage-providers [aria-pressed=true]')?.dataset.provider";
 const trendProvider="document.querySelector('#trend-legend span')?.textContent";
 assert.equal(await js(activeProvider),'codex','the largest last-hour total wins over the larger daily total');
 assert.equal(await js(trendProvider),'Codex');
 assert.equal(await js("document.querySelector('.trend-day.today .trend-stack').children.length"),1);
 assert.ok(await js("document.querySelector('#trend-readout').textContent.includes('5.3M')"));
 assert.equal(await js("document.querySelector('#today-exact').textContent.replaceAll(',','')"),'13346665');assert.equal(await js("document.querySelector('#today-cost').textContent"),'$2.49');
 await js("document.querySelector('[data-provider=claude]').click()");assert.equal(await js("document.querySelectorAll('.token-breakdown dd').length"),4);assert.equal(await js("document.querySelectorAll('.model-breakdown dt').length"),2);assert.equal(await js("document.querySelector('.provider-summary').textContent.includes('8M')"),true);
 await js("document.querySelector('[data-provider=codex]').click()");assert.equal(await js("document.querySelector('.provider-summary').textContent.includes('5.3M')"),true);assert.equal(await js("document.querySelector('.model-breakdown')===null"),true);assert.equal(await js("document.querySelector('#today-total').textContent"),'13.3M');
 await js("document.querySelector('#tab-shop').click()");
 snapshot.usage.claude.lastHour=300;
 await js("document.querySelector('#tab-home').click()");
 await until(activeProvider+"==='claude' && !document.querySelector('#refresh').disabled");
 assert.equal(await js(trendProvider),'Claude Code');
 snapshot.usage.gemini.lastHour=400;
 await js("document.querySelector('#refresh').click()");
 await until(activeProvider+"==='gemini' && !document.querySelector('#refresh').disabled");
 assert.equal(await js(trendProvider),snapshot.labels.gemini);
 delete snapshot.usage.gemini.lastHour;
 await js("document.querySelector('[data-provider=codex]').click()");
 window.webContents.send('usage:updated',snapshot);
 await until("document.querySelector('[data-provider=gemini]') === null");
 assert.equal(await js(activeProvider),'codex','background updates must preserve a manual selection');
 assert.equal(await js(trendProvider),'Codex');
 const longPreview={...snapshot.companion,evolutionPreview:Array.from({length:12},()=>({species:snapshot.companion.current,reached:true,current:false}))};await js('window.renderCompanionTabs('+JSON.stringify(longPreview)+')');await until("!document.querySelector('#evolution-forward').hidden");await js("document.querySelector('#evolution-forward').click()");await until("document.querySelector('#evolution-line').scrollLeft>0");await js('window.renderCompanionTabs('+JSON.stringify(snapshot.companion)+')');
 for(const language of ['ko','en','ja','es','fr','pt','de','ru']){
  await preferences.change({language,activityVisualization:'bars'});await until('document.documentElement.lang==='+JSON.stringify(language));
  for(const width of [440,490]){
   window.setContentSize(width,665);await new Promise(r=>setTimeout(r,35));
   assert.ok(Math.abs(await js("parseFloat(getComputedStyle(document.querySelector('#growth')).height)")-8)<.02);assert.equal(await js("getComputedStyle(document.querySelector('#pane-home .companion')).backgroundColor"),'rgba(0, 0, 0, 0)');
   assert.equal(await js("document.querySelectorAll('.trend-day').length"),14);assert.equal(await js("document.querySelectorAll('.trend-legend span').length"),1);
   const homeBounds=await js("[...document.querySelectorAll('#pane-home button,#provider-usage,#usage-providers,#today-total,#today-exact')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.id||e.className)");assert.deepEqual(homeBounds,[],language+' home '+width);
   await js("document.querySelector('#usage-details').click()");await until("!document.querySelector('#recap-screen').hidden");assert.equal(await js("document.querySelector('#pane-home').hidden"),true);
   for(const [scope,count]of [['week',7],['month',new Date(now.getFullYear(),now.getMonth()+1,0).getDate()],['year',12]]){
    await js(`document.querySelector('#recap-scope').value=${JSON.stringify(scope)};document.querySelector('#recap-scope').dispatchEvent(new Event('change'))`);
    assert.equal(await js("document.querySelectorAll('.recap-column').length"),count);assert.equal(await js("document.querySelector('#recap-next').disabled"),true);
    if(language==='ko'&&width===490)await capture('usage-recap-'+scope);
    const bounds=await js("[...document.querySelectorAll('#recap-screen button,#recap-screen select,.recap-device,.recap-lcd,.recap-column')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.id||e.className)");assert.deepEqual(bounds,[],language+' '+scope+' '+width);
   }
   await js("document.querySelector('#recap-previous').click()");assert.equal(await js("document.querySelector('#recap-next').disabled"),false);await js("document.querySelector('#recap-current').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");assert.equal(await js("document.querySelector('#recap-screen').hidden"),true);assert.equal(await js("document.activeElement.id"),'usage-details');
  }
 }
 await preferences.change({language:'ko'});window.setContentSize(490,665);
 await js("document.querySelector('#trend-visualization').click()");await until("document.querySelectorAll('.heatmap-day').length===112");await capture('home-heatmap');assert.equal(await js("document.querySelector('#trend-period').hidden"),true);await js("document.querySelector('#refresh').click()");await until("!document.querySelector('#refresh').disabled");assert.equal(await js("document.querySelectorAll('.heatmap-day').length"),112);
 assert.equal(await js(trendProvider),'Claude Code');
 assert.ok(await js("document.querySelector('#trend-readout').textContent.includes('8M')"));
 await js("document.querySelector('#usage-details').click();document.querySelector('#recap-back').click();document.querySelector('#trend-visualization').click()");await until("document.querySelectorAll('.trend-day').length===14");
 const live=structuredClone(snapshot);live.usage.codex.today.total+=100000;window.webContents.send('usage:updated',live);await until("document.querySelector('#today-total').textContent==='13.4M'");await js("document.querySelector('#refresh').click()");await until("document.querySelector('#today-total').textContent==='13.3M'");
 await preferences.change({limitMode:'used'});window.webContents.send('usage:limits-updated',[{provider:'claude',account:'A',status:'available',windows:[{label:'5시간',usedPercent:42,resetsAt:Date.now()+3600000}]},{provider:'claude',account:'B',status:'available',windows:[{label:'주간',usedPercent:87}]}]);await js("document.querySelector('[data-provider=claude]').click()");await until("document.querySelectorAll('#limit-accounts button').length===2");assert.equal(await js("document.querySelector('#limit-rows progress').value"),58);await js("document.querySelectorAll('#limit-accounts button')[1].click()");assert.equal(await js("document.querySelector('#limit-rows progress').value"),13);
 // Quota rows keep their full-width track and soft pace marker in both themes and every locale.
 const quotaNow=Date.now();window.webContents.send('usage:limits-updated',[{provider:'codex',status:'available',windows:[{label:'codex · 5시간',usedPercent:7,spanSeconds:18000,resetsAt:quotaNow+6180000},{label:'codex · 주간',usedPercent:1,spanSeconds:604800,resetsAt:quotaNow+593000000}]}]);await js("document.querySelector('[data-provider=codex]').click()");
 for(const language of ['ko','en','ja','es','fr','pt','de','ru'])for(const theme of ['light','dark']){
  await preferences.change({language,theme,limitMode:'used'});await until('window.appPreferences.language==='+JSON.stringify(language)+' && window.appPreferences.theme==='+JSON.stringify(theme));
  for(const width of [440,490]){window.setContentSize(width,665);await until('innerWidth==='+width);await js("document.querySelector('.official-limits').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
   const failures=await js(`(()=>{const failures=[];for(const bar of document.querySelectorAll('#limit-rows .hp-bar')){const track=bar.querySelector('.hp-track'),progress=bar.querySelector('progress'),marker=bar.querySelector('.quota-pace-marker'),name=bar.querySelector('.hp-name'),r=track.getBoundingClientRect(),m=marker.getBoundingClientRect(),p=getComputedStyle(progress);if(r.left<0||r.right>innerWidth+1||m.left<r.left-.1||m.right>r.right+.1)failures.push('bounds');if(name.getBoundingClientRect().bottom>r.top+.1)failures.push('label overlaps track');if(p.borderTopColor==='rgb(43, 50, 64)'||parseFloat(p.borderTopWidth)>1)failures.push('heavy border');if(getComputedStyle(marker).backgroundColor==='rgb(36, 43, 50)')failures.push('black marker');}return failures;})()`);assert.deepEqual(failures,[],language+' '+theme+' quota '+width);
   assert.deepEqual(await js("[...document.querySelectorAll('#limit-rows progress')].map(p=>p.value)"),[93,99]);
   if(language==='ko'&&width===490&&process.env.POKE_UI_SCREENSHOTS){await mkdir(process.env.POKE_UI_SCREENSHOTS,{recursive:true});const rect=await js("(()=>{const r=document.querySelector('.official-limits').getBoundingClientRect();return{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()");await writeFile(join(process.env.POKE_UI_SCREENSHOTS,'quota-'+theme+'.png'),(await window.webContents.capturePage(rect)).toPNG());}
  }
  await preferences.change({limitMode:'remaining'});await until("document.querySelector('#limit-rows .hp-bar strong').textContent===window.i18n.t('남음 {percent}%',{percent:'93'})");assert.equal(await js("document.querySelector('#limit-rows progress').value"),93);
 }
 await preferences.change({language:'ko',theme:'light',limitMode:'used'});window.setContentSize(490,665);
 console.log('PASS: quota light/dark styling, 8 locales, 440/490px containment, full-width tracks and used/remaining labels.');
 // Tracked-provider changes cannot retain an old provider detail; all-disabled remains a valid empty home.
 const before=preferences.get();await preferences.change({providers:['codex']});await until("document.querySelector('.provider-summary strong')?.textContent==='Codex'");await preferences.change({providers:[]});await until("document.querySelector('#provider-usage').hidden");assert.equal(await js("document.querySelector('#today-total').textContent"),'0');await preferences.change({providers:before.providers});
 console.log('PASS: compact home totals, last-hour provider selection, provider token/model details, history recap navigation, heatmap persistence, empty providers, 8 languages and 440/490px bounds.');
}
