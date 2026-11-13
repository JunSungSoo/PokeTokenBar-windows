(() => {
  let state, selectedID, applying=false;
  const target=document.querySelector('#maple-targets'), apply=document.querySelector('#maple-apply'), result=document.querySelector('#maple-result');
  const names={hp:'HP',attack:'공격',defense:'방어',specialAttack:'특수공격',specialDefense:'특수방어',speed:'스피드'};
  const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
  function render(payload){
    state=payload.state;window.appPreferences=payload.preferences;document.documentElement.dataset.animation=payload.preferences.animated?'on':'off';
    window.dispatchEvent(new CustomEvent('preferences-changed',{detail:payload.preferences}));
    document.querySelector('#maple-count').textContent='×'+(state.economy.inventory.redMaple ?? 0);
    const rows=state.captures.filter(row=>row.releasedAt===undefined && row.ivs);
    if(!rows.some(row=>row.id===selectedID))selectedID=undefined;
    target.replaceChildren(...rows.map(row=>{
      const species=row.species.at(-1), button=document.createElement('button');button.type='button';button.className='maple-target';button.dataset.id=row.id;button.setAttribute('aria-pressed',String(row.id===selectedID));
      const art=document.createElement('span');art.className='pokemon-art';const img=document.createElement('img');img.alt='';
      const color=row.shiny?'shiny/':'';const staticSrc='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+color+(species.spriteID ?? species.number)+'.png';
      img.dataset.staticSrc=staticSrc;img.addEventListener('error',()=>{img.src=staticSrc;},{once:true});img.src=payload.preferences.animated && !matchMedia('(prefers-reduced-motion: reduce)').matches?'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/'+color+(species.animated ?? species.number)+'.gif':staticSrc;art.append(img);
      const info=document.createElement('span');info.append(text('strong',window.speciesNames[species.number]?.[window.i18n.language] ?? species.name));
      info.append(text('small',Object.entries(names).map(([key,label])=>window.i18n.t(label)+' ★('+((row.ivs[key] ?? 0)+1)+')').join(' · ')));
      button.append(art,info,text('span',row.id===selectedID?'◉':'○','maple-selection'));
      button.addEventListener('click',()=>{selectedID=row.id;result.textContent='';render({state,preferences:payload.preferences});});return button;
    }));
    if(!rows.length)target.append(text('p','사용 가능한 졸업 개체가 없습니다.'));
    apply.disabled=applying || !selectedID || !(state.economy.inventory.redMaple>0);
  }
  window.maple.onChange(render);void window.maple.read().then(render).catch(error=>{result.textContent=error.message;});
  apply.addEventListener('click',async()=>{if(applying || !selectedID)return;applying=true;apply.disabled=true;try{render(await window.maple.apply(selectedID));result.textContent=window.i18n.t('스탯의 별을 다시 설정했어요.');}catch(error){result.textContent=error.message;}finally{applying=false;apply.disabled=!selectedID || !(state?.economy.inventory.redMaple>0);}});
})();
