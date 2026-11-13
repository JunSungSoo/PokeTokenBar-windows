(() => {
  const statNames = { hp: 'HP', attack: '공격', defense: '방어', 'special-attack': '특수공격', 'special-defense': '특수방어', speed: '스피드' };
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function card(title, className = '') {
    const section = node('section', undefined, 'pokemon-detail-card ' + className);
    section.append(node('h3', title));
    return section;
  }
  function methods(move) {
    return [...new Set(move.learnMethods.map(row => {
      if (row.method === 'level-up') return row.level > 0 ? 'Lv. ' + row.level : window.i18n.t('시작');
      const labels = { machine: 'TM', egg: '교배', tutor: '가르침', evolution: '진화', relearn: '기술 떠올리기', 'light-ball-egg': '전기구 교배', 'form-change': '폼 체인지', 'pokerogue-egg': 'PokéRogue 알 기술' };
      return window.i18n.t(labels[row.method] ?? row.method.replaceAll('-', ' '));
    }))].join(' · ');
  }
  function statsCard(title, rows) {
    const section = card(title, 'individual-stats');
    const scale = Math.ceil(Math.max(300, ...rows.map(row => row.value)) / 100) * 100;
    for (const row of rows) {
      const line = node('div', undefined, 'detail-stat-row');
      const bar = document.createElement('progress'); bar.max = scale; bar.value = row.value;
      bar.setAttribute('aria-label', window.i18n.t(statNames[row.name]));
      line.append(node('span', statNames[row.name]), bar, node('strong', String(row.value)));
      const grade = node('span', '★(' + (Math.min(31, Math.max(0, row.iv)) + 1) + ')', 'iv-grade');
      grade.title = 'IV ' + row.iv + '/31'; line.append(grade);
      section.append(line);
    }
    return section;
  }
  function tooltipFor(name,labels){
    return window.moveText.moveTooltip(labels.moves[name] ?? {name,description:'',type:'—',category:'',power:0,pp:0,accuracy:null},text=>window.i18n.t(text));
  }
  function moveTitle(name,labels){
    const text=labels.moves[name];const category={Physical:'물리',Special:'특수',Status:'변화'}[text?.category];
    return text?[text.name,text.type,category?window.i18n.t(category):''].filter(Boolean).join(' · '):name;
  }
  function moveRow(name, labels, method) {
    const text = labels.moves[name];
    const row = node('li', undefined, 'detail-move-row');
    const heading = node('span');
    heading.append(node('strong', text?.name ?? name));
    if (text) {
      const category = { Physical: '물리', Special: '특수', Status: '변화' }[text.category] ?? text.category;
      heading.append(node('small', [text.type, window.i18n.t(category), 'PP ' + text.pp,
        window.i18n.t('위력') + ' ' + (text.power || '—'), window.i18n.t('명중') + ' ' + (text.accuracy === true ? window.i18n.t('필중') : text.accuracy === null ? '—' : text.accuracy+'%')].filter(Boolean).join(' · ')));
      row.tabIndex=0;window.moveUI.bindTooltip(row,()=>tooltipFor(name,labels));
    }
    row.append(heading);
    if (method) row.append(node('span', method, 'move-method'));
    return row;
  }
  window.renderPokemonDetails = (payload, current, onMove, onItem) => {
    const { details, labels, stale } = payload;
    const content = node('div', undefined, 'pokemon-detail-sections');
    if (stale) content.append(node('p', '오프라인 · 저장된 정보', 'offline-cache-note'));
    if (current.form) content.append(node('p', '정보는 기본 폼 기준', 'settings-hint'));
    const individual = card('개체', 'individual-data');
    const identity = node('dl', undefined, 'detail-value-pairs');
    const gender = { male: '수컷', female: '암컷', genderless: '무성' }[current.gender];
    for (const [name, value] of [['레벨', current.level ?? '—'], ['성별', gender ?? '—'], ['성격', current.nature ?? '—']]) identity.append(node('dt', name), node('dd', String(value)));
    individual.append(identity);
    individual.append(node('h4', '특성'));
    const ability = labels.abilities[current.ability];
    const abilityValue = node('p', (ability?.name ?? current.ability ?? '—') + (current.abilityIsHidden ? ' · ' + window.i18n.t('숨겨진 특성') : ''));
    if(ability){abilityValue.tabIndex=0;window.moveUI.bindTooltip(abilityValue,()=>ability.name+'\n'+ability.description);} individual.append(abilityValue);
    if(onItem&&current.graduatedAt!==undefined&&current.releasedAt===undefined&&current.species.at(-1)?.number===details.speciesID){
      const U=window.battleUI,section=node('div',undefined,'collection-default-item');section.append(node('h4',U.t('기본 배틀 도구')));
      const held=U.item(current.battleDefaultItem),pick=node('button',held?U.localized(held.names):U.t('없음'),'move-picker');pick.type='button';pick.id='collection-default-battle-item';pick.setAttribute('aria-label',U.t('기본 배틀 도구'));pick.setAttribute('aria-haspopup','dialog');
      pick.addEventListener('click',()=>U.pickItem({id:current.id,speciesID:details.speciesID,form:current.form},{[current.id]:current.battleDefaultItem??''},[],onItem,{collectionDefault:true}));
      section.append(pick,node('p',U.t('컬렉션 도구를 우선 장착합니다. 없으면 최근 배틀 도구를 사용합니다.'),'settings-hint'));individual.append(section);
    }
    const actual = window.pokemonMath.computedStats(details.speciesID, details.baseStats, current.level, current.ivs ?? {}, current.nature ?? '');
    if (actual.length === 6) individual.append(statsCard('현재 능력치', actual));
    individual.append(node('h4', '배운 기술'));
    const known = node('ul', undefined, 'detail-move-list known-moves');
    const isCurrent=current.species.at(-1)?.number===details.speciesID;
    const knownNames=(current.hasCustomMoves || current.moves?.length?(current.moves ?? []):window.pokemonLoadout.levelUpMoves(payload.baseMoves ?? details.moves,current.level ?? 5).slice(-4).map(move=>move.name)).slice(0,4);
    const editable=current.releasedAt===undefined && isCurrent && Boolean(onMove);
    const options=window.pokemonLoadout.moveOptions(details,current.level ?? 5).sort((a,b)=>(labels.moves[a.name]?.name ?? a.name).localeCompare(labels.moves[b.name]?.name ?? b.name,window.i18n.language));
    const feedback=node('p',undefined,'move-feedback');feedback.setAttribute('role','status');feedback.hidden=true;
    if(editable){
      for(let slot=0;slot<Math.min(4,knownNames.length+1);slot++){
        const row=node('li',undefined,'detail-move-slot');
        const label=node('label',String(slot+1)+'.');label.htmlFor='pokemon-move-'+slot;
        const selected=knownNames[slot];
        const choices=options.map(option=>({value:option.name,title:moveTitle(option.name,labels),tooltip:tooltipFor(option.name,labels),
          disabled:knownNames.some((name,index)=>index!==slot && name===option.name),disabledReason:'다른 슬롯에서 사용 중인 기술입니다.'}));
        if(selected && !options.some(option=>option.name===selected))choices.push({value:selected,title:moveTitle(selected,labels),tooltip:tooltipFor(selected,labels),disabled:true});
        const picker=window.moveUI.picker({id:label.htmlFor,slot,selected,options:choices,placeholder:window.i18n.t('기술 선택'),accessibleLabel:window.i18n.t('기술 {slot}',{slot:slot+1})});
        picker.addEventListener('change',async()=>{
          for(const input of known.querySelectorAll('.move-picker'))input.disabled=true;
          feedback.hidden=true;
          try{await onMove({id:current.id,speciesID:details.speciesID,form:current.form,slot,name:picker.value,expectedMoves:knownNames});}
          catch(error){picker.value=selected ?? '';window.moveUI.refresh(picker);feedback.hidden=false;feedback.textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
          finally{for(const input of known.querySelectorAll('.move-picker'))input.disabled=!options.length;}
        });
        row.append(label,picker);known.append(row);
      }
      individual.append(known,node('p','BW2 기술과 습득 가능한 6세대 페어리 기술 중 최대 4개를 선택합니다. 레벨 제한을 적용하며 선택은 즉시 저장됩니다.','loadout-hint'),feedback);
    }else{
      for(const move of knownNames)known.append(moveRow(move,labels));
      individual.append(known);
      if(!knownNames.length)individual.append(node('p','현재 레벨에서 배운 기술이 없어요.'));
      if(current.releasedAt===undefined && !isCurrent)individual.append(node('p','현재 모습에서 기술을 교체할 수 있어요.','loadout-hint'));
    }
    content.append(individual);
    const species = card('종 정보', 'species-data');
    const values = node('dl', undefined, 'detail-value-pairs');
    for (const [name, value] of [['타입', details.types.map(type => labels.types[type] ?? type).join(' / ')], ['키', (details.height / 10).toFixed(1) + ' m'], ['몸무게', (details.weight / 10).toFixed(1) + ' kg']]) values.append(node('dt', name), node('dd', value));
    species.append(values, node('h4', '가능한 특성'));
    const abilities = node('ul', undefined, 'detail-abilities');
    for (const ability of details.abilities) {
      const text = labels.abilities[ability.name];
      const item = node('li');
      item.append(node('strong', text?.name ?? ability.name));
      if (ability.isHidden) item.append(node('span', '숨겨진 특성', 'ability-badge'));
      if (text?.description) item.append(node('p', text.description));
      abilities.append(item);
    }
    species.append(abilities); content.append(species);
    const moves = card(window.i18n.t('전체 기술 목록 {count}개', { count: details.moves.length }), 'complete-moves');
    const list = node('ul', undefined, 'detail-move-list');
    for (const move of details.moves) list.append(moveRow(move.name, labels, methods(move)));
    moves.append(list); content.append(moves);
    return content;
  };
})();
