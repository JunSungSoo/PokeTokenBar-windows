(() => {
  const get = id => document.getElementById('trade-' + id);
  const t = (text, values) => window.i18n.t(text, values);
  const rarities = {common:'일반',uncommon:'고급',rare:'희귀',legendary:'전설'};
  const name = species => window.speciesNames?.[species.number]?.[window.i18n.language] ?? species.name;
  let state, companion, working=false, options=[], choiceRequest=0, overwrite=false;
  const choice=get('choice'), nickname=get('nickname');
  function node(tag,text,className) { const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element; }
  function controls() {
    const connected=state?.phase==='connected', committing=state?.phase==='committing';
    get('host').disabled=get('connect').disabled=working || committing || connected || state?.phase==='waiting';
    nickname.disabled=working || connected || committing || state?.phase==='waiting';
    get('code').disabled=working || connected || committing;
    get('close').disabled=working || committing || !state || state.phase==='idle';
    get('offer').disabled=working || !connected || state.accepted || !choice.value;
    get('accept').disabled=working || !state?.canAccept || !companion;
    get('repick').disabled=get('reject').disabled=working || !connected;
    for(const button of get('choices').querySelectorAll('button'))button.disabled=working || !connected || state.accepted;
  }
  function preview(item) {
    const row=node('div',undefined,'trade-mon');
    const art=node('span',undefined,'pokemon-art');
    const img=node('img');img.alt='';
    const base='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
    const color=item.shiny?'shiny/':'';
    const staticSrc=base+color+(item.species.spriteID ?? item.species.number)+'.png';
    img.dataset.staticSrc=staticSrc;
    img.addEventListener('error',()=>{if(img.src!==staticSrc)img.src=staticSrc;else img.remove();});
    img.src=window.appPreferences?.animated && !matchMedia('(prefers-reduced-motion: reduce)').matches
      ? base+'versions/generation-v/black-white/animated/'+color+(item.species.animated ?? item.species.number)+'.gif' : staticSrc;
    art.append(img);const info=node('span',undefined,'trade-mon-info');
    const title=node('span',undefined,'trade-mon-title');title.append(node('strong',name(item.species)));
    const badge=node('span',t(rarities[item.rarity]),'rarity-badge');badge.dataset.rarity=item.rarity;title.append(badge);
    if(item.shiny)title.append(node('span','✦','shiny-indicator'));
    info.append(title,node('small',['#'+String(item.species.number).padStart(3,'0'),item.level?'Lv. '+item.level:'',t(item.nature),item.form ?? ''].filter(Boolean).join(' · ')));
    info.append(node('small',item.active?t('육성 중')+' · '+compactTokens(item.progress)+' '+t('토큰'):t('도감')));
    row.append(art,info);return row;
  }
  function renderWarning() {
    overwrite=false;
    const warning=get('warning');warning.textContent='';warning.hidden=true;
    if(!state?.theirItem?.active || !companion)return;
    if(companion.active){
      warning.textContent=t('상대방이 육성중인 개체를 받으면 지금 키우는 {name}(진행도 {percent}%)가 사라집니다.',{name:name(companion.current),percent:Math.floor(companion.progress/Math.max(1,companion.threshold)*100)});
    } else if(companion.economy.eggTier){
      warning.textContent=t('상대방이 육성중인 개체를 받으면 지금 가진 {guaranteeTierLabel} 알 보증과 부화 진행이 사라집니다.',{guaranteeTierLabel:t(rarities[companion.economy.eggTier])});
    } else if(companion.progress>0)warning.textContent=t('상대방이 육성중인 개체를 받으면 지금까지 쌓은 알 부화 진행이 사라집니다.');
    overwrite=Boolean(warning.textContent);warning.hidden=!overwrite;
  }
  function render(value) {
    const previous=state?.phase;state=value;
    const connected=value.phase==='connected', reviewing=connected && Boolean(value.mineItem), outcome=['complete','closed'].includes(value.phase);
    get('panel').dataset.phase=value.phase;
    get('connection').hidden=connected || value.phase==='committing';
    get('picker').hidden=!connected || reviewing;
    get('proposal').hidden=!reviewing && value.phase!=='committing' && value.phase!=='complete';
    get('peer').textContent=value.peer?t('연결된 상대')+': '+value.peer:'';
    get('codes').replaceChildren(...value.codes.map(code=>{const line=node('p');line.append(node('span',t('내 연결 코드')+': '),node('code',code));return line;}));
    get('mine').replaceChildren(value.mineItem?preview(value.mineItem):node('p',t('교환할 대상 선택')));
    get('theirs').replaceChildren(value.theirItem?preview(value.theirItem):node('p',t('상대의 제안을 기다리는 중…')));
    const message=value.phase==='complete'?'교환 완료':value.phase==='connected'?(value.accepted?'상대의 승인을 기다리는 중…':value.mineItem?(value.theirItem?'두 개체를 확인한 뒤 확정해 주세요.':'상대의 제안을 기다리는 중…'):'교환할 대상 선택'):value.phase==='waiting'?(value.codes.length?'연결 대기 중…':'연결 코드 준비 중…'):value.message;
    get('status').textContent=t(message);
    get('accept').textContent=t(value.accepted?'상대의 승인을 기다리는 중…':'승인');
    get('repick').hidden=get('reject').hidden=outcome || value.phase==='committing';
    get('accept').hidden=outcome;
    get('close').textContent=t(outcome?'닫기':'취소');
    get('backup-panel').hidden=!value.backupPath;
    get('backup').textContent=value.backupPath?t('백업 파일: {fileName}. 되돌리려면 이 파일을 열어 진행 상황을 확인한 뒤, 필요하면 세이브 불러오기로 복원하세요.',{fileName:value.backupPath.split(/[\\/]/).at(-1)}):'';
    renderWarning();controls();
    if((connected && previous!=='connected') || (value.phase==='complete' && previous!=='complete'))void loadChoices().catch(showError);
  }
  async function loadChoices() {
    const request=++choiceRequest, selected=choice.value;
    const result=await window.trade.choices();if(request!==choiceRequest)return;
    options=result;choice.replaceChildren(...options.map(item=>new Option(item.label,item.id)));
    if(options.some(item=>item.id===selected))choice.value=selected;
    get('choices').replaceChildren(...options.map(item=>{
      const button=node('button');button.type='button';button.dataset.id=item.id;button.className='trade-choice';button.append(preview(item));
      button.addEventListener('click',()=>{choice.value=item.id;void run(()=>window.trade.offer(item.id));});return button;
    }));
    if(!options.length)get('choices').append(node('p',t('아직 잡은 포켓몬이 없어요!')));
    get('offer').hidden=true;controls();
  }
  function showError(error) { get('status').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,''); }
  async function run(callback) {if(working)return;working=true;controls();try{await callback();}catch(error){showError(error);}finally{working=false;controls();}}
  function action(id,callback){get(id).addEventListener('click',()=>{void run(callback);});}
  action('host',()=>window.trade.host(nickname.value));
  action('connect',()=>window.trade.connect(get('code').value,nickname.value));
  get('code').addEventListener('keydown',event=>{if(event.key==='Enter' && !get('connect').disabled)get('connect').click();});
  action('offer',()=>window.trade.offer(choice.value));
  action('accept',()=>window.trade.accept(overwrite));
  action('repick',()=>window.trade.withdraw());
  action('reject',()=>window.trade.reject());
  action('backup-open',()=>window.trade.revealBackup());
  action('close',async()=>{await window.trade.close();if(['closed','complete'].includes(state?.phase))render({phase:'idle',codes:[],accepted:false,canAccept:false,message:''});});
  nickname.addEventListener('change',()=>{void window.preferences.change({tradeNickname:nickname.value}).catch(showError);});
  void window.preferences.read().then(settings=>{if(!nickname.value)nickname.value=settings.tradeNickname;}).catch(showError);
  window.preferences.onChange(settings=>{if(document.activeElement!==nickname && !working)nickname.value=settings.tradeNickname;});
  window.usage.onCompanion(value=>{companion=value;renderWarning();controls();if(state?.phase==='connected')void loadChoices().catch(showError);});
  void window.usage.companion().then(value=>{companion=value;renderWarning();controls();}).catch(showError);
  window.addEventListener('language-changed',()=>{if(state)render(state);void loadChoices().catch(showError);});
  window.addEventListener('app-tab-changed',event=>{
    if(event.detail.previous==='trade' && ['waiting','connected','committing'].includes(state?.phase))void window.trade.close().catch(showError);
    if(event.detail.current==='trade'){void loadChoices().catch(showError);void window.trade.state().then(render).catch(showError);}
  });
  window.trade.onState(render);void window.trade.state().then(render).catch(showError);
})();
