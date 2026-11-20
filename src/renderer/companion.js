(() => {
  const get = id => document.getElementById(id);
  const tabs = [...document.querySelectorAll('.app-tabs button')];
  let activityGate={trade:false,battle:false};
  function setActivity(value){activityGate=value;const trade=document.querySelector('#tab-trade'),battle=document.querySelector('#tab-battle');if(trade)trade.disabled=value.battle;if(battle)battle.disabled=value.trade;}
  window.usage.onActivity?.(setActivity);
  window.addEventListener('activity-gate',event=>setActivity(event.detail));
  const format = new Intl.NumberFormat('ko-KR');
  const rarityLabels = { common: '일반', uncommon: '고급', rare: '희귀', legendary: '전설' };
  const regions = [
    ['관동', 1, 151], ['성도', 152, 251], ['호연', 252, 386], ['신오', 387, 493], ['하나', 494, 649],
  ];
  const spriteBase = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  let state;
  let products;
  let currentTab = 'home';
  let log = false;
  let page = 0;
  let detail;
  let detailsFocus;
  const detailData = new Map();
  const detailErrors = new Set();
  const detailLoading = new Set();
  let busy = false;
  let lastReveal;
  let revealTimer;
  let effectTimer;
  let homeMetadata;
  let homeMetadataKey;
  let homeActivity = 'sleep';
  let collectionScroll = 0;
  let dexScroll = 0;
  let logScroll = 0;
  let selectedDex;
  const savedSort={dex:'number',log:'recent'};


  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(label, click, className) {
    const node = element('button', label, className);
    node.type = 'button';
    node.addEventListener('click', click);
    return node;
  }

  function notice(text, error = false) {
    const output = get('companion-message');
    output.hidden = !text;
    output.textContent = text;
    output.classList.toggle('error', error);
  }

  function openTab(id, focus = false) {
    if(id==='trade'&&activityGate.battle||id==='battle'&&activityGate.trade)return;
    if (currentTab !== id) window.dispatchEvent(new CustomEvent('app-tab-changed',{detail:{previous:currentTab,current:id}}));
    if (currentTab === 'collection' && id !== currentTab) detail = undefined;
    if (currentTab !== id) window.scrollTo(0, 0);
    currentTab = id;
    document.body.dataset.tab=id;
    notice('');
    for (const tab of tabs) {
      const selected = tab.id === 'tab-' + id;
      tab.tabIndex = selected ? 0 : -1;
      tab.setAttribute('aria-selected', selected);
      const panel = get(tab.getAttribute('aria-controls'));
      panel.hidden = !selected;
      if (selected) {
        const disclosure = panel.querySelector(':scope > details');
        if (disclosure) disclosure.open = true;
        if (focus) tab.focus();
      }
    }
    renderSelected();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => openTab(tab.id.slice(4)));
    tab.addEventListener('keydown', event => {
      const next = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length,
        Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      openTab(tabs[next].id.slice(4), true);
    });
  });

  function sprite(species, appearance = {}, animated = false) {
    const box = element('span', undefined, 'pokemon-art');
    const image = element('img');
    const fallback = element('span', '🥚');
    fallback.setAttribute('aria-hidden', 'true');
    image.alt = '';
    image.hidden = true;
    const id = species?.number;
    const form = /^[a-z0-9-]+$/i.test(appearance.form ?? '') ? appearance.form : '';
    const animate = animated && window.appPreferences?.animated !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const facing = appearance.back ? 'back/' : '';
    const color = facing + (appearance.shiny ? 'shiny/' : '');
    const staticPath = id ? color + (appearance.spriteID ?? species.spriteID ?? id) + '.png' : 'egg.png';
    const moving = 'versions/generation-v/black-white/animated/' + color;
    const stem = appearance.animated ?? species?.animated ?? (form ? id + '-' + form : id);
    const frontColor = appearance.shiny ? 'shiny/' : '';
    const paths = id ? [...(animate ? [moving + stem + '.gif'] : []), staticPath, frontColor + (appearance.spriteID ?? species.spriteID ?? id) + '.png', frontColor + id + '.png', id + '.png'] : [];
    if (!id) box.classList.add('egg-art');
    image.addEventListener('load', () => { image.hidden = false; fallback.hidden = true; box.classList.toggle('static-fallback', !image.src.endsWith('.gif')); });
    image.addEventListener('error', () => {
      const next = paths.shift();
      if (next) image.src = spriteBase + next;
    });
    image.dataset.staticSrc = spriteBase + staticPath;
    image.src = id ? spriteBase + paths.shift() : 'assets/items/egg.png';
    box.append(image, fallback);
    return box;
  }

  function renderHome() {
    const { active, current, next, progress, threshold, economy } = state;
    const title = current ? speciesName(current) : '알';
    get('companion-title').textContent = title;
    const artBox = get('partner-art');
    const key = JSON.stringify([active?.id, current?.number, current?.animated, active?.shiny, window.appPreferences?.animated, window.appPreferences?.back, homeActivity === 'sulk']);
    let art = artBox.querySelector('.pokemon-art');
    if (artBox.dataset.subject !== key) {
      art = sprite(current, { ...active, back: window.appPreferences?.back || homeActivity === 'sulk' }, true);
      art.classList.add('home-sprite');
      if (current) {
        const link = button('', () => showDetail(current.number, active.id), 'sprite-link');
        link.setAttribute('aria-label', '도감에서 ' + title + ' 보기');
        link.append(art);
        artBox.replaceChildren(link);
      } else artBox.replaceChildren(art);
      artBox.dataset.subject = key;
    }
    const rarity = get('home-rarity');
    rarity.hidden = !active;
    rarity.textContent = active ? rarityLabels[active.rarity ?? 'common'] : '';
    rarity.dataset.rarity = active?.rarity ?? 'common';
    get('companion-title').textContent = title + (active?.shiny ? ' ✨' : '');
    get('partner-level').textContent = (active?.level ? 'Lv.' + active.level + ' · ' : '') + window.i18n.t('파트너');
    const profile = get('profile');
    profile.hidden = false;
    profile.replaceChildren();
    if (active) {
      const stage = state.evolutionPathMissing ? window.i18n.t('알 수 없는 다음 진화') : next ? window.i18n.t('진화 단계 {i} / {k}', { i: active.species.length, k: active.totalForms ?? state.planned.length }) : window.i18n.t('최종 진화체');
      profile.append(stage + ' · ' + window.i18n.t(active.nature));
      if (active.repeatGrowth) profile.append(element('span', window.i18n.t('{multiplier}× 성장', { multiplier:2 }), 'growth-boost'));
    } else {
      profile.append(progress / threshold >= .9 ? '곧 부화해요!' : '🥚 부화 준비 중');
      if (economy.eggTier) { const badge=element('span',window.i18n.t('{r} 이상 확정',{r:window.i18n.t(rarityLabels[economy.eggTier])}),'rarity-badge egg-guarantee');badge.dataset.rarity=economy.eggTier;profile.append(badge); }
    }
    const types = get('home-types');
    types.replaceChildren();
    const metadataKey = window.i18n.language + ':' + current?.number;
    const metadata = homeMetadataKey === metadataKey&&homeMetadata ? window.pokemonMath.projectDetailView(homeMetadata,active?.form) : undefined;
    const typeIDs = metadata?.details.types ?? Object.entries(window.typeNames).filter(([,names]) => Object.values(names).includes(current?.type)).map(([key]) => key);
    for (const type of current ? typeIDs : []) {
      const badge = element('span', metadata?.labels.types[type] ?? window.typeNames[type]?.[window.i18n.language] ?? type, 'type-badge');
      badge.style.setProperty('--type-color', window.companionUI.typeColors[type] ?? '#888888');
      types.append(badge);
    }
    if (current && homeMetadataKey !== metadataKey) {
      homeMetadataKey = metadataKey; homeMetadata = undefined;
      void window.usage.pokemonDetails(current.number).then(payload => {
        if (homeMetadataKey !== metadataKey) return;
        homeMetadata = payload;
        if (state.current?.number === current.number) renderHome();
      }).catch(() => {});
    }
    const moods = { egg:'곧 깨어나요.', sleep:'지금은 자고 있어요.', idle:'오늘은 조용히 자리를 지켜요.', working:'오늘의 작업 흔적이 쌓이고 있어요.', focus:'지금은 집중 모드예요.', tired:'한도에 가까워요. 잠깐 쉬어도 괜찮아요.', sulk:'삐져서 등을 돌리고 있어요.' };
    get('companion-mood').textContent = current ? moods[homeActivity] ?? moods.idle : moods.egg;
    art.classList.toggle('egg-imminent', !current && progress / threshold >= .9);
    const status = get('companion-status');
    const label = next ? window.i18n.t('{name} 진화', { name: speciesName(next) }) : state.evolutionPathMissing ? '진화 경로 확인 필요' : current ? window.i18n.t('졸업') : window.i18n.t('부화');
    status.textContent = window.i18n.t('{target}까지 {tokens} 토큰', { target: label, tokens: compactTokens(Math.max(0, threshold - progress)) });
    const used = Math.min(progress, threshold);
    const exact = groupedTokens.format(used) + ' / ' + groupedTokens.format(threshold);
    const growth = get('growth');
    growth.hidden = false;
    growth.max = threshold;
    growth.value = progress;
    growth.title = compactTokens(used) + ' / ' + compactTokens(threshold) + ' · ' + Math.floor(used / threshold * 100) + '%';
    growth.setAttribute('aria-valuetext', exact);
    if (state.dittoReveal && state.dittoReveal.id !== lastReveal) {
      const reveal = state.dittoReveal;
      lastReveal = reveal.id;
      const banner = get('ditto-reveal');
      banner.hidden = false;
      banner.textContent = reveal.disguise + '의 정체는 ' + (reveal.shiny ? '이로치 ' : '') + '메타몽이었어요!';
      const mask = element('span', '🎭', 'ditto-burst');
      mask.setAttribute('aria-hidden', 'true');
      art.append(mask);
      if (reveal.shiny) {
        const sparkle = element('span', '✨', 'ditto-burst ditto-sparkle');
        sparkle.setAttribute('aria-hidden', 'true');
        art.append(sparkle);
      }
      artBox.classList.remove('ditto-reveal');
      void artBox.offsetWidth;
      artBox.classList.add('ditto-reveal');
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        banner.hidden = true;
        art.querySelectorAll('.ditto-burst').forEach(burst => burst.remove());
        artBox.classList.remove('ditto-reveal');
      }, 5000);
    }
    const line = get('evolution-line');
    const preview = state.evolutionPreview ?? state.planned.map((species,index) => ({ species, reached:index < (active?.species.length ?? 0), current:index === (active?.species.length ?? 0)-1 }));
    line.replaceChildren();
    preview.forEach((node,index) => {
      if (index) line.append(element('span', '→', 'evolution-arrow'));
      const { species, reached, current:isCurrent } = node;
      const owned = species && state.collection.some(entry => entry.number === species.number);
      const cell = owned ? button('', () => showDetail(species.number, active.id), 'evolution-cell') : element('span', undefined, 'evolution-cell');
      cell.classList.toggle('future', !reached); cell.classList.toggle('current-stage', isCurrent);
      cell.title = species ? speciesName(species) : window.i18n.t('알 수 없는 다음 진화');
      cell.setAttribute('aria-label', cell.title);
      cell.append(species ? sprite(species, { ...species, shiny:active?.shiny }) : element('span', '?', 'evolution-mystery'));
      if (isCurrent) cell.append(element('span', '', 'current-stage-dot'));
      line.append(cell);
    });
    requestAnimationFrame(syncEvolutionNavigation);
  }

  function syncEvolutionNavigation(){
    const line=get('evolution-line'),wrapper=line.parentElement,overflow=line.scrollWidth>wrapper.clientWidth+1;
    for(const id of ['evolution-back','evolution-forward'])get(id).hidden=!overflow;
    get('evolution-back').disabled=line.scrollLeft<=1;
    get('evolution-forward').disabled=line.scrollLeft+line.clientWidth>=line.scrollWidth-1;
  }
  for(const [id,direction]of [['evolution-back',-1],['evolution-forward',1]])get(id).addEventListener('click',()=>{
    const line=get('evolution-line');line.scrollBy({left:direction*Math.max(40,line.clientWidth*.7),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
  get('evolution-line').addEventListener('scroll',syncEvolutionNavigation);
  new ResizeObserver(syncEvolutionNavigation).observe(get('evolution-line').parentElement);

  function showHomeEffect(kind, text = '') {
    const box = get('partner-art');
    box.querySelectorAll('.home-feedback').forEach(node => node.remove());
    if (text) box.append(element('span', text, 'home-feedback ' + kind));
    if (kind !== 'candy') box.classList.remove('celebrate','mint-feedback');
    void box.offsetWidth;
    if (kind === 'celebrate' || kind === 'mint') box.classList.add(kind === 'mint' ? 'mint-feedback' : 'celebrate');
    clearTimeout(effectTimer);
    effectTimer = setTimeout(() => { box.classList.remove('celebrate','mint-feedback'); box.querySelectorAll('.home-feedback').forEach(node => node.remove()); }, kind === 'candy' ? 1700 : 2600);
  }

  async function change(action, success) {
    if (busy) return;
    busy = true;
    const panel = get('pane-' + currentTab);
    const before = state;
    panel.inert = true;
    try {
      const updated = await window.usage.changeCompanion(action);
      window.renderCompanionTabs(updated);
      const toHome = action.kind === 'use' && action.item !== 'redMaple' || action.kind === 'buy' && action.product.startsWith('egg');
      if (toHome) openTab('home', true);
      renderSelected();
      if (action.kind === 'use' && action.item === 'rareCandy') { const used = (before.economy.inventory.rareCandy ?? 0) - (updated.economy.inventory.rareCandy ?? 0); showHomeEffect('candy', '+' + compactTokens(used * 100000000) + ' XP'); }
      if (action.kind === 'use' && action.item === 'mint') showHomeEffect('mint', '✨');
      notice(success);
    } catch (error) {
      notice(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true);
    } finally {
      busy = false;
      panel.inert = false;
    }
  }

  function itemIcon(item) {
    const box = element('span', undefined, 'item-icon');
    const fallback = element('span', item.icon); fallback.setAttribute('aria-hidden','true'); box.append(fallback);
    if (item.sprite) {
      const image = element('img'); image.alt = ''; image.src = 'assets/items/' + item.sprite + '.png';
      image.addEventListener('load', () => { fallback.hidden = true; image.hidden = false; });
      image.addEventListener('error', () => { image.remove(); fallback.hidden = false; });
      image.hidden = true; if (item.sprite === 'egg') box.classList.add('egg-art'); box.append(image);
    }
    return box;
  }
  function coinIcon() {
    const image = element('img'); image.src = 'assets/ui/coin.svg'; image.alt = '';
    return image;
  }
  function card(item, owned = '') {
    const article = element('article', undefined, 'item-card dex-row');
    const top = element('div', undefined, 'item-heading');
    const titles = element('div');
    const name = element('div', undefined, 'item-title-row');
    name.append(element('h3', item.name));
    if (owned && item.sprite !== 'shiny-charm') name.append(element('span', owned, 'item-owned'));
    titles.append(name, element('p', item.description, 'item-desc'));
    top.append(itemIcon(item), titles); article.append(top);
    return article;
  }
  function controls(article, actionLabel, max, hint, explain, submit, requiredChoice) {
    const row = element('div', undefined, 'item-actions');
    const picker = element('div', undefined, 'quantity-stepper');
    const quantity = element('input'); quantity.type = 'number'; quantity.min = '1'; quantity.max = String(max); quantity.step = '1'; quantity.value = '1'; quantity.setAttribute('aria-label', '수량');
    const minus = button('−', () => adjust(-1)); minus.setAttribute('aria-label', '수량 줄이기');
    const plus = button('+', () => adjust(1)); plus.setAttribute('aria-label', '수량 늘리기');
    picker.append(element('span','×'),quantity,minus,plus);
    article.append(picker);
    const summary = element('p', hint, 'item-hint');
    const preview = element('p', undefined, 'item-preview');
    let confirming = false;
    const primary = button(actionLabel, () => {
      if (!confirming) { confirming = true; draw(); cancel.focus(); return; }
      if (explain.precious && confirming === true) { confirming = 'precious'; draw(); cancel.focus(); return; }
      void submit(Number(quantity.value));
    });
    const cancel = button('취소', () => { confirming = false; draw(); primary.focus(); }, 'neutral');
    function adjust(delta) { quantity.value = String(Math.max(1,Math.min(max,Number(quantity.value)+delta))); confirming=false; draw(); }
    function draw() {
      primary.disabled = !max || !quantity.validity.valid || !Number(quantity.value) || (requiredChoice && !requiredChoice.value);
      primary.hidden = !max && !explain.keepDisabled;
      picker.hidden = max < 2;
      minus.disabled = Number(quantity.value) <= 1; plus.disabled = Number(quantity.value) >= max;
      cancel.hidden = !confirming;
      article.dataset.confirming = String(Boolean(confirming));
      primary.classList.toggle('primary',Boolean(confirming));
      primary.classList.toggle('secondary',!confirming);
      if (confirming) {
        primary.removeAttribute('aria-label');
        primary.textContent = confirming === 'precious' ? '놓아주고 구매 확정' : actionLabel + (Number(quantity.value)>1 ? ' ×'+quantity.value : '');
      } else if (explain.unitPrice) {
        const priceText = compactTokens((Number(quantity.value) || 1)*explain.unitPrice);
        primary.replaceChildren(coinIcon(), priceText);
        primary.setAttribute('aria-label', window.i18n.t(actionLabel) + ' · ' + priceText);
      } else primary.textContent = actionLabel;
      const message = max ? explain(Number(quantity.value) || 1, confirming) : '';
      preview.textContent = message; preview.hidden = !message || (explain.unitPrice && !confirming);
      summary.hidden = !hint;
    }
    quantity.addEventListener('input', () => { confirming=false; draw(); });
    requiredChoice?.addEventListener('change', () => { confirming=false; draw(); });
    row.append(preview,primary,cancel); article.append(summary,row); draw();
  }

  function renderShop() {
    const { economy, active } = state;
    const wallet = get('shop-wallet');
    const amount = element('div', undefined, 'wallet-amount');
    amount.append(coinIcon(), element('strong', compactTokens(economy.wallet), 'wallet-total'));
    const balance = element('div', undefined, 'wallet-balance');
    balance.append(element('p', '내 토큰 포인트', 'eyebrow'), amount);
    const bagLink = button('가방 보기', () => openTab('bag', true), 'neutral');
    bagLink.id = 'shop-open-bag';
    wallet.replaceChildren(balance, bagLink);
    if (!products) return;
    const bought = key => key === 'shinyCharm' && Boolean(economy.inventory[key]);
    const priced = Object.fromEntries(Object.entries(products).map(([key, product]) =>
      [key, { ...product, price: economy.prices[key] }]));
    const list = window.companionUI.productOrder.map(key => [key,priced[key]]).sort(([a,first],[b,second]) => Number(bought(a))-Number(bought(b)) || first.price-second.price);
    get('shop-products').replaceChildren(...list.map(([key, item]) => {
      const egg = key.startsWith('egg');
      const owned = economy.inventory[key] ?? 0;
      const affordable = Math.floor(economy.wallet / item.price);
      const max = bought(key) || (egg && !active) ? 0 : egg || key === 'shinyCharm' ? Math.min(1, affordable) : affordable;
      const article = card(item);
      article.dataset.product = key;
      if (owned && !egg && key !== 'shinyCharm') article.querySelector('.item-title-row h3').after(element('span', window.i18n.t('보유 ×{n}', {n:owned}), 'item-owned'));
      if (egg && key !== 'egg') { const badge=element('span',rarityLabels[key==='eggRare'?'rare':'uncommon'],'rarity-badge'); badge.dataset.rarity=key==='eggRare'?'rare':'uncommon'; article.querySelector('.item-title-row h3').after(badge); }
      if (egg && active) article.querySelector('.item-heading').after(element('p','놓아준 포켓몬도 도감에 남고, 같은 확률로 다시 만날 수 있어요. 키운 진행도만 사라져요.','egg-release-note'));
      if (bought(key)) { article.append(element('p','✓ '+window.i18n.t('보유 중'),'passive-owned')); return article; }
      const hint = egg && !active ? '지금 품고 있는 알이 부화하면 살 수 있어요.' : '';
      if (!affordable) {
        const shortage = article.querySelector('.item-desc');
        shortage.textContent = window.i18n.t('{count}포인트 더 필요해요', { count: compactTokens(item.price - economy.wallet) });
        shortage.classList.add('item-shortage');
      }
      const explain = (count, confirming) => {
        const total = compactTokens(count * item.price);
        if (confirming === 'precious') return window.i18n.t(active?.shiny?'⚠️ 이로치 포켓몬이에요! 정말 놓아줄까요?':'⚠️ 전설 포켓몬이에요! 정말 놓아줄까요?');
        if (confirming && egg) return '현재 파트너를 놓아주고 성장을 처음부터 시작합니다. ' + total;
        return confirming ? window.i18n.t('{name} 구매할까요?',{name:window.i18n.t(item.name) + (count>1 ? ' ×'+count : '')}) : '가격 '+total;
      };
      explain.precious = egg && (active?.shiny || active?.rarity === 'legendary');
      explain.keepDisabled = true;
      explain.unitPrice = item.price;
      controls(article, '구매', max, hint, explain, quantity =>
        change({ kind: 'buy', product: key, quantity, activeID: active?.id }, item.name + ' 구매 완료'));
      return article;
    }));
  }

  function renderBag() {
    if (!products) return;
    const { economy, active, captures } = state;
    const owned = window.companionUI.itemOrder.map(key => [key,economy.inventory[key] ?? 0]).filter(([, count]) => count > 0);
    const list = get('bag-items');
    if (!owned.length) {
      const empty = element('div', undefined, 'surface empty-state');
      empty.append(sprite({ number: 143 }, {}, true), element('h2', '아직 가방이 비어있어요!'),
        button('상점으로 이동', () => openTab('shop', true), 'primary'));
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...owned.map(([key, count]) => {
      const item = products[key];
      const article = card(item, '×' + format.format(count));
      article.dataset.item = key;
      if (key === 'shinyCharm') {
        article.append(element('p', '이로치 확률 ↑ · 적용 중','passive-owned'));
        return article;
      }
      let targets;
      const max = key === 'rareCandy' ? economy.maxCandy : active ? 1 : 0;
      if (key === 'redMaple') {
        const available = captures.filter(row => row.releasedAt === undefined && row.ivs);
        const row = element('div',undefined,'item-actions');
        article.append(element('p',available.length?'각 스탯의 별을 1~32로 랜덤 재설정':'사용 가능한 졸업 개체가 없습니다.','item-hint'));
        const open=button('사용',()=>{void window.usage.openMaple().catch(error=>notice(error.message,true));},'secondary');open.disabled=!available.length;row.append(open);article.append(row);return article;
      }
      const hint = max ? '' : key === 'redMaple' ? '사용 가능한 졸업 개체가 없습니다.'
        : '현재 파트너에게 사용할 수 없습니다.';
      const explain = (quantity, confirming) => {
        if (key !== 'rareCandy') return confirming ? window.i18n.t('{name}에게 사용할까요?', {name:active ? speciesName(active.species.at(-1)) : ''}) : key === 'mint' ? '성격 랜덤 변경' : '각 스탯의 별을 1~32로 랜덤 재설정';
        let xp = state.progress + quantity * 100_000_000;
        let result = '';
        for (const stage of economy.candyStages) {
          if (xp < stage.threshold) break;
          xp -= stage.threshold;
          result = stage.species ? stage.species.name + '로 진화' : '졸업';
        }
        const preview=window.companionUI.candyPreview(state.progress,economy.candyStages,quantity),notes=[];
        if(preview.graduates)notes.push(window.i18n.t('이 포켓몬은 졸업할 것으로 예상돼요.'));
        if(preview.discardedXP>0)notes.push(window.i18n.t('졸업 시 남는 {xp} XP는 사라져요.',{xp:compactTokens(preview.discardedXP)}));
        else if(preview.carryoverXP>0)notes.push(window.i18n.t('예상 진화 후 이월 경험치: {xp} XP.',{xp:compactTokens(preview.carryoverXP)}));
        return '+' + compactTokens(quantity * 100_000_000) + ' XP' + (result ? ' · ' + result : ' · 성장 진행')+(notes.length?' · '+notes.join(' '):'');
      };
      controls(article, '사용', max, hint, explain, quantity =>
        change({ kind: 'use', item: key, quantity, id: targets?.value ?? active?.id }, item.name + ' 사용 완료'), targets);
      return article;
    }));
  }

  const regionOf = number => regions.find(([, first, last]) => number >= first && number <= last)?.[0];
  const allRows = () => state.active ? [...state.captures, state.active] : state.captures;
  const speciesName = species => window.speciesNames?.[species.number]?.[window.i18n.language] ?? species.name;
  const formLabel=(form,number)=>number===201 ? ({exclamation:'!',question:'?'}[form] ?? form.toUpperCase()) : number===493 ? window.typeNames?.[form]?.[window.i18n.language]??form : window.formNames?.[number]?.[form]?.[window.i18n.language]??window.formNames?.[number]?.[form]?.en??(!form||form==='normal'?window.i18n.t('기본 폼'):form.replaceAll('-', ' ').replace(/\b[a-z]/g,char=>char.toUpperCase()));
  const pokemonNumber = number => '#' + String(number).padStart(3, '0');
  const dexCellNumber = number => 'No.' + String(number).padStart(3, '0');
  const date = timestamp => timestamp ? new Date(timestamp).toLocaleDateString(window.i18n.language) : '';
  const appearanceOf = (row, number) => {
    const { spriteID, animated } = row.species.find(entry => entry.number === number);
    const form=row.species.find(entry=>entry.number===number).form??window.formCatalog?.[number]?.[0];
    return { shiny: row.shiny, form, spriteID, animated };
  };

  function showDetail(number, rowID) {
    detailsFocus = document.activeElement;
    collectionScroll = get('captures').scrollTop; dexScroll = get('collection-list').scrollTop;
    openTab('collection');
    detail = { number, rowID };
    renderCollection();
    get('dex-detail').querySelector('button').focus();
  }

  function renderDetail() {
    const content = get('dex-detail');
    const { number } = detail;
    const species = state.collection.find(entry => entry.number === number);
    if (!species) { detail = undefined; return renderCollection(); }
    const allIndividuals = allRows().filter(row => row.species.some(entry => entry.number === number));
    const initial=allIndividuals.find(row=>row.id===detail.rowID) ?? allIndividuals.at(-1);
    const forms=[...new Set(allIndividuals.map(row=>appearanceOf(row,number).form ?? ''))];
    const selectedForm=detail.form ?? appearanceOf(initial,number).form ?? '';
    const formRows=allIndividuals.filter(row=>(appearanceOf(row,number).form ?? '')===selectedForm);
    const selectedShiny=detail.shiny ?? initial.shiny;
    const rows=formRows.filter(row=>row.shiny===selectedShiny);
    const current = rows.find(row => row.id === detail.rowID) ?? rows.at(-1) ?? initial;
    const appearance = appearanceOf(current, number);
    const back = button('‹ 목록으로', () => {
      detail = undefined;
      renderCollection();
      get('captures').scrollTop=collectionScroll; get('collection-list').scrollTop=dexScroll;
      if (detailsFocus?.isConnected) detailsFocus.focus();
      else get(log ? 'log-mode' : 'dex-mode').focus();
    });
    const options = element('select');
    options.setAttribute('aria-label', '포획 개체와 형태');
    for (const row of rows) {
      const look = appearanceOf(row, number);
      options.append(new Option([formLabel(look.form,number), look.shiny ? '이로치' : '일반색', row.nature,
        row.releasedAt ? '놓아줌' : row.graduatedAt !== undefined ? '졸업' : '육성 중', date(row.hatchedAt)].filter(Boolean).join(' · '), row.id));
    }
    options.value = current.id;
    options.addEventListener('change', () => { detail.rowID = options.value; renderDetail(); get('dex-detail').querySelector('select').focus(); });
    const identity = element('div', undefined, 'partner detail-identity');
    const title = element('div');
    title.append(element('p', pokemonNumber(number) + ' · ' + (regionOf(number) ?? ''), 'eyebrow'),
      element('h2', speciesName(species)), element('p', [species.type, rarityLabels[current.rarity ?? 'common'],
        current.level ? 'Lv. ' + current.level : '', current.nature].filter(Boolean).join(' · ')));
    if(current.championAchievedAt!==undefined)title.append(element('span',window.i18n.t('챌린지 챔피언'),'champion-badge'));identity.append(sprite(species, appearance, true), title);
    const line = element('div', undefined, 'evolution-line');
    for (const entry of current.species) line.append(button(speciesName(entry), () => showDetail(entry.number, current.id)));
    const representative = state.economy.representative;
    const pinned = representative?.speciesID === number && representative.form === appearance.form;
    const pin = button(pinned ? '현재 파트너 따라가기' : '대표 포켓몬 지정', () =>
      change({ kind: 'representative', speciesID: pinned ? null : number, form: appearance.form },
        pinned ? '현재 파트너를 따라갑니다.' : '대표 포켓몬으로 지정했습니다.'), 'primary');
    const key = window.i18n.language + ':' + number;
    const payload = detailData.get(key);
    content.replaceChildren(back);
    const allForms=window.formCatalog?.[number]??[];
    if(allForms.length>1){
      content.append(element('p',window.i18n.t('수집한 폼 {count}/{total}',{count:forms.length,total:allForms.length})));
      const grid=element('div',undefined,'detail-form-grid');grid.setAttribute('aria-label',window.i18n.t('폼 선택'));
      for(const form of allForms){const owned=forms.includes(form),pick=button('',()=>{detail.form=form;detail.shiny=undefined;detail.rowID=allIndividuals.find(row=>(appearanceOf(row,number).form??'')===form)?.id;renderDetail();},'detail-form');pick.disabled=!owned;pick.dataset.form=form;pick.setAttribute('aria-pressed',String(form===selectedForm));pick.append(sprite({...species,number,form,...(window.battleCatalog.forms?.[number]?.[form]??{})},{form,shiny:selectedShiny},true),element('span',formLabel(form,number)));if(!owned)pick.title=window.i18n.t('미수집');grid.append(pick);}content.append(grid);
    }
    if(formRows.some(row=>row.shiny) && formRows.some(row=>!row.shiny)){
      const appearances=element('div',undefined,'appearance-picker');
      for(const [shiny,label]of [[false,'일반'],[true,'이로치']]){const toggle=button(label,()=>{detail.shiny=shiny;detail.rowID=undefined;renderDetail();});toggle.setAttribute('aria-pressed',String(selectedShiny===shiny));appearances.append(toggle);}content.append(appearances);
    }
    content.append(identity);if(rows.length>1)content.append(options);content.append(line,pin);
    if (payload) {
      title.querySelector('h2').textContent = payload.labels.species[number] ?? speciesName(species);
      const projected=window.pokemonMath.projectDetailView(payload,current.form);
      title.querySelector('p:last-child').textContent = [projected.details.types.map(type => payload.labels.types[type] ?? type).join(' / '), window.i18n.t(rarityLabels[current.rarity ?? 'common']), current.level ? 'Lv. ' + current.level : '', window.i18n.t(current.nature)].filter(Boolean).join(' · ');
      content.append(window.renderPokemonDetails(payload, current, async action=>{
        const scroll=content.scrollTop;
        const updated=await window.usage.setPokemonMove(action);
        window.renderCompanionTabs(updated);
        if(detail?.number===number && detail.rowID===current.id){
          content.scrollTop=scroll;content.querySelector('[data-slot="'+action.slot+'"]')?.focus({preventScroll:true});
        }
      },async item=>{
        const scroll=content.scrollTop,updated=await window.usage.changeCompanion({kind:'battle-default-item',id:current.id,item});window.renderCompanionTabs(updated);
        if(detail?.number===number&&detail.rowID===current.id)content.scrollTop=scroll;
      },async name=>{
        const scroll=content.scrollTop,updated=await window.usage.changeCompanion({kind:'ability',id:current.id,name});window.renderCompanionTabs(updated);
        if(detail?.number===number&&detail.rowID===current.id)content.scrollTop=scroll;
      }));
    } else {
      const message = element('p', detailErrors.has(key) ? '포켓몬 정보를 불러오지 못했어요.' : '포켓몬 정보를 불러오는 중…', 'detail-loading');
      message.setAttribute('role', 'status');
      content.append(message);
      if (detailErrors.has(key)) content.append(button('다시 시도', () => { detailErrors.delete(key); renderDetail(); }));
      else if (!detailLoading.has(key)) {
        detailLoading.add(key);
        void window.usage.pokemonDetails(number).then(payload => { detailData.set(key, payload); })
          .catch(() => { detailErrors.add(key); })
          .finally(() => {
            detailLoading.delete(key);
            if (detail?.number === number && window.i18n.language + ':' + number === key) renderDetail();
          });
      }
    }
  }

  const searchKey=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  const matchesName=(species,query)=>[species.name,...Object.values(window.speciesNames?.[species.number]??{}),pokemonNumber(species.number)].some(value=>searchKey(value).includes(query));
  function renderCollection() {
    get('collection-list').hidden = Boolean(detail);
    get('dex-detail').hidden = !detail;
    if (detail) return renderDetail();
    const all = allRows();
    const query = searchKey(get('dex-search').value.trim()).replace(/^#/, '');
    const rarity = get('dex-rarity').value;
    const region = get('dex-region').value;
    const shiny = get('dex-shiny').checked;
    const sort = get('dex-sort').value;
    // Marks the filter button while a filter hidden in the closed panel is narrowing the list.
    get('dex-filter-toggle').classList.toggle('has-filter', Boolean(rarity || region || shiny));
    const match = species => (!region || regionOf(species.number) === region) &&
      (!query || matchesName(species,query));
    const matches = all.filter(row => (!rarity || (row.rarity ?? 'common') === rarity) && (!shiny || row.shiny));
    const allSpecies = state.collection;
    const cards = allSpecies.flatMap(species => {
      const matching = matches.filter(row => row.species.some(entry => entry.number === species.number));
      return matching.length && match(species) ? [{ species, row: matching.find(row => row.shiny) ?? matching.at(-1) }] : [];
    });
    if (sort === 'numberDesc') cards.reverse();
    if (sort === 'name') cards.sort((a, b) => speciesName(a.species).localeCompare(speciesName(b.species), window.i18n.language));
    if (sort === 'rarity') cards.sort((a, b) => Object.keys(rarityLabels).indexOf(b.row.rarity ?? 'common') -
      Object.keys(rarityLabels).indexOf(a.row.rarity ?? 'common'));
    const logs = matches.filter(row => row.species.some(species => !query || speciesName(species).toLowerCase().includes(query) || species.name.toLowerCase().includes(query) || pokemonNumber(species.number).includes(query))).sort((a, b) => {
      const time = row => row.releasedAt ?? row.graduatedAt ?? row.hatchedAt;
      return sort === 'oldest' ? time(a) - time(b) : sort === 'number' ? a.species.at(-1).number - b.species.at(-1).number : time(b) - time(a);
    });
    const summary = get('dex-summary');
    const progress = element('div', undefined, 'dex-progress');
    const discovered = element('p', undefined, 'dex-progress-main');
    discovered.append(element('span', '발견한 포켓몬', 'dex-progress-label'), element('strong', String(allSpecies.length), 'dex-progress-count'), element('span', ' / 649', 'dex-progress-total'));
    const caught = element('p', undefined, 'dex-progress-sub');
    caught.append(element('span', '잡은 포켓몬', 'dex-progress-label'), element('strong', String(all.length), 'dex-progress-caught'));
    progress.append(discovered, caught);
    const rarityCounts = element('div',undefined,'rarity-tallies');
    for (const key of ['legendary','rare','uncommon','common']) {
      const count = log ? all.filter(row=>(row.rarity ?? 'common')===key).length : allSpecies.filter(species=>all.some(row=>(row.rarity ?? 'common')===key && row.species.some(entry=>entry.number===species.number))).length;
      const chip=button(window.i18n.t(rarityLabels[key])+' '+count,()=>{get('dex-rarity').value=rarity===key?'':key;page=0;renderCollection();});
      chip.dataset.rarity=key;chip.disabled=count===0;chip.setAttribute('aria-pressed',rarity===key);rarityCounts.append(chip);
    }
    const badges = element('div', undefined, 'region-badges');
    badges.hidden=log;
    for (const [name, first, last] of regions) {
      const total = allSpecies.filter(entry => regionOf(entry.number) === name).length;
      const badge = button((total === last - first + 1 ? '🏅 ' : '') + name + ' ' + total + '/' + (last - first + 1), () => {
        get('dex-region').value = region === name ? '' : name;
        page = 0;
        renderCollection();
      });
      badge.setAttribute('aria-pressed', region === name);
      badges.append(badge);
    }
    const shinySpecies = new Set(all.filter(row => row.shiny).flatMap(row => row.species.map(species => species.number)));
    const medals = [];
    for (const [name, first, last] of regions) {
      if (allSpecies.filter(species => regionOf(species.number) === name).length === last - first + 1) medals.push(name + ' 완성');
      if ([...shinySpecies].filter(id => regionOf(id) === name).length === last - first + 1) medals.push(name + ' 이로치 완성');
    }
    const unown = new Set(all.flatMap(row => row.species.filter(species => species.number === 201).map(species => species.form)));
    if (unown.size === 28) medals.push('안농 28종');
    if (allSpecies.filter(species => species.number <= 649).length === 649) medals.push('전국 도감 완성');
    if ([...shinySpecies].filter(id => id <= 649).length === 649) medals.push('전국 이로치 완성');
    summary.replaceChildren(progress);
    if (medals.length) summary.append(element('p', '🏅 ' + medals.join(' · '), 'dex-medals'));
    get('dex-filter-chips').replaceChildren(rarityCounts,badges);
    const dex = get('dex');
    const history = get('captures');
    dex.hidden = log;
    history.hidden = !log;
    const pages = Math.max(1, Math.ceil(cards.length / 16));
    page = Math.max(0, Math.min(page, pages - 1));
    get('dex-pages').hidden = log || !cards.length;
    get('dex-prev').disabled = page === 0;
    get('dex-next').disabled = page + 1 >= pages;
    get('dex-page').textContent = (page + 1) + ' / ' + pages;
    dex.replaceChildren(...(!log ? cards.slice(page * 16, page * 16 + 16).map(({ species, row }) => {
      const cell = element('li');
      const entry = button('', () => {selectedDex=species.number;showDetail(species.number,row.id);}, 'dex-card');
      entry.dataset.rarity=row.rarity ?? 'common';
      const representative=state.economy.representative;
      const pinned=representative?.speciesID===species.number;
      entry.classList.toggle('representative',pinned);entry.classList.toggle('dex-selected',selectedDex===species.number);
      entry.title=[pokemonNumber(species.number)+' '+speciesName(species),window.i18n.t(rarityLabels[row.rarity ?? 'common']),pinned?window.i18n.t('대표'):''].filter(Boolean).join(' · ');
      const forms=window.formCatalog[species.number];
      const formCount=forms?new Set(all.flatMap(capture=>capture.species.filter(stage=>stage.number===species.number).map(stage=>stage.form ?? forms[0]))).size:undefined;
      const iconAppearance=forms?{...appearanceOf(row,species.number),...{form:forms[0],spriteID:undefined,animated:undefined,shiny:false}}:appearanceOf(row,species.number);
      const name = element('strong', speciesName(species)+(forms?' '+formCount+'/'+forms.length:''));
      if (all.some(capture=>capture.shiny && capture.species.some(stage=>stage.number===species.number))) name.append(element('span','','dex-shiny-marker dex-sparkle'));
      entry.append(element('span', dexCellNumber(species.number)+(state.economy.representative?.speciesID===species.number?' ★':''), 'eyebrow px'), sprite(species,iconAppearance), name);
      if(all.some(capture=>capture.championAchievedAt!==undefined&&capture.species.at(-1)?.number===species.number))entry.append(element('span',window.i18n.t('챌린지 챔피언'),'champion-badge'));
      if (state.current?.number===species.number) entry.append(element('span','육성 중','dex-raising'));
      cell.append(entry);
      return cell;
    }) : []));
    history.replaceChildren(...(log ? logs.map(row => {
      const entry = element('li');
      const species = row.species.at(-1);
      const label = row.releasedAt !== undefined ? '놓아줌' : row.graduatedAt !== undefined ? '졸업' : '육성 중';
      entry.className = 'capture-card';
      const header = element('div', undefined, 'capture-card-header');
      header.append(element('span', rarityLabels[row.rarity ?? 'common'], 'capture-rarity'), element('span', label, 'capture-state'));
      if (row.shiny) header.append(element('span', '✨', 'capture-shiny'));if(row.championAchievedAt!==undefined)header.append(element('span',window.i18n.t('챌린지 챔피언'),'champion-badge'));
      header.append(element('span', row.nature, 'capture-nature'));
      const chain = element('ol', undefined, 'capture-evolution');
      chain.setAttribute('aria-label', window.i18n.t('진화 과정'));
      for (const [index, stage] of row.species.entries()) {
        const step = element('li');
        if (index) step.append(element('span', '→', 'evolution-arrow'));
        const link = button('', () => showDetail(stage.number, row.id), 'capture-stage');
        link.setAttribute('aria-label', window.i18n.t('도감에서 {name} 보기', { name: speciesName(stage) }));
        link.append(sprite(stage, appearanceOf(row, stage.number)), element('span', speciesName(stage)));
        step.append(link); chain.append(step);
      }
      entry.append(header, chain, element('small', date(row.releasedAt ?? row.graduatedAt ?? row.hatchedAt)));
      return entry;
    }) : []));
    const empty=get('dex-empty');empty.replaceChildren();
    const noResults=!(log?logs.length:cards.length);
    empty.hidden=!noResults;
    if (noResults) {
      empty.className='empty-state';
      if (!all.length) empty.append(sprite({number:25,name:'Pikachu'}, {}, true),element('h2','아직 잡은 포켓몬이 없어요!'),element('p','토큰을 써서 첫 포켓몬을 부화시켜 보세요.'));
      else empty.append(element('span','⌕','search-empty-icon'),element('p','검색 조건에 맞는 포켓몬이 없습니다.'),button('필터 초기화',()=>get('dex-reset').click()));
    }
    get('dex-summary').hidden=!all.length;get('collection-list').classList.toggle('collection-empty',!all.length);
    get('dex-shiny-toggle').setAttribute('aria-pressed',shiny);

  }

  function collectionMode(value) {
    const previousSort=get('dex-sort').value; if(previousSort)savedSort[log?'log':'dex']=previousSort;
    log = value;
    page = 0;
    get('dex-mode').setAttribute('aria-pressed', !log);
    get('log-mode').setAttribute('aria-pressed', log);
    const options = log ? [['recent', '최근순'], ['oldest', '오래된 순'], ['number', '번호순']]
      : [['number', '번호 오름차순'], ['numberDesc', '번호 내림차순'], ['name', '이름순'], ['rarity', '희귀도순']];
    get('dex-sort').replaceChildren(...options.map(([id, name]) => new Option(name, id)));
    get('dex-sort').value=savedSort[log?'log':'dex'];
    if (state) renderCollection();
  }

  for (const [name] of regions) get('dex-region').append(new Option(name, name));
  get('dex-shiny-toggle').addEventListener('click',()=>{get('dex-shiny').checked=!get('dex-shiny').checked;get('dex-shiny').dispatchEvent(new Event('input'));});
  get('dex-mode').addEventListener('click', () => collectionMode(false));
  get('log-mode').addEventListener('click', () => collectionMode(true));
  let wheelDistance=0,wheelTimer,wheelBlocked=false;
  get('collection-list').addEventListener('wheel',event=>{if(log||detail||get('dex-pages').hidden)return;event.preventDefault();clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelDistance=0;wheelBlocked=false;},180);if(wheelBlocked)return;wheelDistance+=event.deltaMode?event.deltaY*24:event.deltaY;if(Math.abs(wheelDistance)<24)return;const control=get(wheelDistance>0?'dex-next':'dex-prev');if(!control.disabled){wheelBlocked=true;control.click();}wheelDistance=0;},{passive:false});
  window.desktop.onOpenDex?.(()=>openTab('collection'));
  get('dex-prev').addEventListener('click', () => { page--; renderCollection(); });
  get('dex-next').addEventListener('click', () => { page++; renderCollection(); });
  for (const id of ['dex-search', 'dex-rarity', 'dex-region', 'dex-sort', 'dex-shiny']) {
    get(id).addEventListener('input', () => { page = 0; if (state) renderCollection(); });
  }
  get('dex-reset').addEventListener('click', () => {
    for (const id of ['dex-search', 'dex-rarity', 'dex-region']) get(id).value = '';
    get('dex-shiny').checked = false;
    collectionMode(log);
  });
  const filterToggle = get('dex-filter-toggle'), filterPanel = get('dex-filter-panel');
  const setFilterPanel = open => { filterPanel.hidden = !open; filterToggle.setAttribute('aria-expanded', open); };
  filterToggle.addEventListener('click', () => setFilterPanel(filterPanel.hidden));
  get('collection-list').addEventListener('keydown', event => {
    if (event.key !== 'Escape' || filterPanel.hidden) return;
    event.stopPropagation();setFilterPanel(false);filterToggle.focus();
  });
  collectionMode(false);
  document.body.dataset.tab='home';

  function renderSelected() {
    if (!state) return;
    if (currentTab === 'shop') renderShop();
    if (currentTab === 'bag') renderBag();
    if (currentTab === 'collection') renderCollection();
  }

  window.renderCompanionTabs = updated => {
    if (!updated) {
      get('companion-status').textContent = '육성 기록을 불러오지 못했습니다.';
      return;
    }
    const previous = state;
    state = updated;
    renderHome();
    if (previous && (previous.active?.id !== state.active?.id || previous.current?.number !== state.current?.number)) showHomeEffect('celebrate',state.active?.shiny ? '✨' : '');
    if (!busy) renderSelected();
  };

  window.addEventListener('usage-activity', event => { const changed=homeActivity !== event.detail; homeActivity=event.detail; if (changed && state) renderHome(); });
  window.addEventListener('preferences-changed', () => {
    if (state) { renderHome(); renderSelected(); }
  });

  void window.shopCatalog().then(catalog => { products = catalog; renderSelected(); })
    .catch(() => notice('상품 목록을 읽지 못했습니다.', true));
})();
