(() => {
  let state, selectedID, applying=false;
  const target=document.querySelector('#maple-targets'), apply=document.querySelector('#maple-apply'), result=document.querySelector('#maple-result');
  const statNames={hp:'HP',attack:'공격',defense:'방어',specialAttack:'특수공격',specialDefense:'특수방어',speed:'스피드'};
  const speciesName=species=>window.speciesNames[species.number]?.[window.i18n.language] ?? species.name;
  const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
  function render(payload){
    state=payload.state;window.appPreferences=payload.preferences;document.documentElement.dataset.animation=payload.preferences.animated?'on':'off';
    window.dispatchEvent(new CustomEvent('preferences-changed',{detail:payload.preferences}));
    document.querySelector('#maple-count').textContent='×'+(state.economy.inventory.redMaple ?? 0);
    const rows=state.captures.filter(row=>row.releasedAt===undefined && row.ivs);
    if(!rows.some(row=>row.id===selectedID))selectedID=undefined;
    // Rebuilding the list keeps keyboard focus on the same radio.
    const focusedID=target.contains(document.activeElement)?document.activeElement.value:undefined;
    target.replaceChildren(...rows.map(row=>{
      const species=row.species.at(-1), label=document.createElement('label');label.className='maple-target party-row';label.dataset.id=row.id;
      const input=document.createElement('input');input.type='radio';input.name='maple-target';input.className='ball-radio';input.value=row.id;input.checked=row.id===selectedID;
      const art=document.createElement('span');art.className='pokemon-art';const img=document.createElement('img');img.alt='';
      const color=row.shiny?'shiny/':'';const staticSrc='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+color+(species.spriteID ?? species.number)+'.png';
      img.dataset.staticSrc=staticSrc;img.addEventListener('error',()=>{img.src=staticSrc;},{once:true});img.src=payload.preferences.animated && !matchMedia('(prefers-reduced-motion: reduce)').matches?'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/'+color+(species.animated ?? species.number)+'.gif':staticSrc;art.append(img);
      const name=speciesName(species), info=document.createElement('span');info.className='party-info';
      const heading=document.createElement('span');heading.className='party-name';heading.append(text('strong',name),text('span','Lv.'+(row.level ?? 100),'party-level px'));
      const detail=Object.entries(statNames).map(([key,label])=>window.i18n.t(label)+' ★('+((row.ivs[key] ?? 0)+1)+')').join(' · ');
      const stars=text('span',Object.keys(statNames).map(key=>(row.ivs[key] ?? 0)>=31?'★':'☆').join(''),'party-stars');stars.title=detail;
      info.append(heading,text('small',detail),stars);
      const control=document.createElement('span');control.className='party-control';control.append(input);
      label.append(art,info,control);
      input.addEventListener('change',()=>{selectedID=row.id;showResult('');syncApply();});return label;
    }));
    if(!rows.length)target.append(text('p','사용 가능한 졸업 개체가 없습니다.'));
    if(focusedID)target.querySelector('input[value="'+CSS.escape(focusedID)+'"]')?.focus();
    syncApply();
  }
  // Reads the selected Pokémon's name in the current language.
  const selectedName=()=>{const row=state?.captures.find(row=>row.id===selectedID);return row?speciesName(row.species.at(-1)):'';};
  function syncApply(){
    apply.disabled=applying || !selectedID || !(state?.economy.inventory.redMaple>0);
    apply.textContent=selectedID?window.i18n.t('{name}에게 사용하기',{name:selectedName()}):window.i18n.t('포켓몬을 골라 주세요');
  }
  function showResult(message){result.textContent=message;result.hidden=!message;}
  window.addEventListener('language-changed',syncApply);
  window.maple.onChange(render);void window.maple.read().then(render).catch(error=>{showResult(error.message);});
  apply.addEventListener('click',async()=>{if(applying || !selectedID)return;applying=true;apply.disabled=true;const appliedName=selectedName();try{render(await window.maple.apply(selectedID));showResult(window.i18n.t('{name}의 별이 다시 정해졌다!',{name:appliedName}));}catch(error){showResult(error.message);}finally{applying=false;syncApply();}});
})();
