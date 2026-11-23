(() => {
  const get = id => document.getElementById(id);
  const status = get('settings-saved');
  let current;
  let companion;
  let reading = false;
  let accounts=[];
  let loadedSessionAccount;
  const tr=text=>window.i18n.t(text);
  const segmentedSettings=['theme','limitMode','animationQuality'];
  const thumbSize=20;
  // Fill ends under the thumb centre, so the track is inset by half a thumb on both sides.
  function paintRange(input){
    const ratio=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min));
    input.style.setProperty('--p','calc('+thumbSize/2+'px + (100% - '+thumbSize+'px) * '+(Number.isFinite(ratio)?ratio:0)+')');
  }
  // Buttons are updated in place so keyboard focus survives a selection.
  function syncSegmented(select){
    const group=select.nextElementSibling;
    group.setAttribute('aria-label',select.closest('label').firstChild.textContent.trim());
    [...select.options].forEach((option,index)=>{
      group.children[index].textContent=option.textContent;
      group.children[index].setAttribute('aria-pressed',String(option.value===select.value));
    });
  }
  function buildSegmented(select){
    const group=document.createElement('div');
    group.className='segmented';group.setAttribute('role','group');group.dataset.noTranslate='';
    group.replaceChildren(...[...select.options].map(option=>{
      const button=document.createElement('button');
      button.type='button';
      button.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change'));});
      return button;
    }));
    select.after(group);
    select.addEventListener('change',()=>syncSegmented(select));
    syncSegmented(select);
  }
  function renderAccounts(){
    const tracked=get('settings-tracked-account'),session=get('session-account'),selected=session.value||'claude-default';
    tracked.replaceChildren(...[['automatic','자동 (마지막 사용)'],['highest','사용률 최고'],['defaultAccount','기본 계정'],...accounts.map(row=>[row.accountID,row.account??tr('기본 계정')])].map(([value,title])=>new Option(tr(title),value)));
    tracked.value=current?.claudeTrackedAccount??'automatic';
    session.replaceChildren(...(accounts.length?accounts:[{accountID:'claude-default'}]).map(row=>new Option(row.account??tr('기본 계정'),row.accountID)));session.value=selected;if(!session.value)session.selectedIndex=0;
    if(accounts.length&&loadedSessionAccount!==session.value){loadedSessionAccount=session.value;void sessionAction('read');}
  }
  async function sessionAction(action){
    const controls=[...document.querySelectorAll('#session-save,#session-clear,#session-organizations,#session-account,#session-organization')];controls.forEach(node=>node.disabled=true);
    try{const value=action==='save'?get('session-key').value:action==='select'?get('session-organization').value:undefined;
      const state=await window.usage.manageSessionKey(get('session-account').value,action,value);
      if(action==='save')get('session-key').value='';
      get('session-status').textContent=tr(state.configured?'저장됨':'사용 가능한 한도 없음');
      get('session-organization').replaceChildren(...state.organizations.map(org=>new Option(org.name,org.id)));get('session-organization').value=state.organizationID??'';
    }catch(error){get('session-status').textContent=tr(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
    finally{controls.forEach(node=>node.disabled=false);}
  }
  for(const action of ['save','clear','organizations'])get('session-'+action).addEventListener('click',()=>void sessionAction(action));
  get('session-account').addEventListener('change',()=>void sessionAction('read'));
  get('session-organization').addEventListener('change',()=>void sessionAction('select'));
  get('settings-tracked-account').addEventListener('change',()=>void update({claudeTrackedAccount:get('settings-tracked-account').value}));
  window.usage.onLimits(results=>{accounts=results.filter(row=>row.provider==='claude');renderAccounts();});

  function showError(error) {
    status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  }

  function render(settings) {
    current = settings;
    renderAccounts();
    for (const control of document.querySelectorAll('[data-setting]')) {
      if (control.type === 'text' && document.activeElement === control) continue;
      const value = settings[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = value;
      else control.value = String(value);
    }
    for (const input of document.querySelectorAll('input[type=range]')) paintRange(input);
    for (const name of segmentedSettings) syncSegmented(document.querySelector('[data-setting=' + name + ']'));
    get('pet-size-label').textContent = settings.petSize + 'px';
    for (const key of ['warnThreshold', 'criticalThreshold']) get(key + '-label').textContent = settings[key] + '%';
    for (const key of ['warnThreshold', 'criticalThreshold']) {
      document.querySelector('[data-setting=' + key + ']').disabled = !settings.limitNotifications;
    }
    get('settings-accounts').replaceChildren(...settings.claudeRoots.map(root => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = root;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'neutral';
      remove.textContent = '제거';
      remove.addEventListener('click', () => update({ claudeRoots: current.claudeRoots.filter(value => value !== root) }));
      item.append(name, remove);
      return item;
    }));
    for (const input of document.querySelectorAll('[data-provider]')) input.checked = settings.providers.includes(input.dataset.provider);
  }

  async function update(patch) {
    status.textContent = '저장 중…';
    try {
      render(await window.preferences.change(patch));
      status.textContent = '저장됨';
    } catch (error) {
      if (current) render(current);
      showError(error);
    }
  }

  for (const control of document.querySelectorAll('[data-setting]')) {
    control.addEventListener(control.type === 'text' ? 'input' : 'change', () => {
      const value = control.type === 'checkbox' ? control.checked
        : control.type === 'range' || control.dataset.setting === 'refreshSeconds' ? Number(control.value) : control.value;
      void update({ [control.dataset.setting]: value });
    });
    if (control.dataset.setting === 'petSize') control.addEventListener('input', () => {
      get('pet-size-label').textContent = control.value + 'px';
    });
  }
  for (const input of document.querySelectorAll('input[type=range]')) input.addEventListener('input', () => paintRange(input));
  for (const name of segmentedSettings) buildSegmented(document.querySelector('[data-setting=' + name + ']'));
  window.addEventListener('language-changed', () => { for (const name of segmentedSettings) syncSegmented(document.querySelector('[data-setting=' + name + ']')); });

  let pendingDifficultySaves = 0, difficultyTimer = 0;
  // Shows the saved difficulty on both sliders and their labels.
  function paintDifficulty(economy) {
    get('difficulty-growth').value = economy.growthDifficulty;
    get('difficulty-shop').value = economy.shopDifficulty;
    get('difficulty-growth-value').textContent = economy.growthDifficulty + '×';
    get('difficulty-shop-value').textContent = economy.shopDifficulty + '×';
    paintRange(get('difficulty-growth'));
    paintRange(get('difficulty-shop'));
  }
  function representative(state) {
    companion = state;
    // Saved state must not rewind sliders the user is still changing.
    const editingDifficulty = difficultyTimer || pendingDifficultySaves > 0 || ['difficulty-growth', 'difficulty-shop'].includes(document.activeElement?.id);
    if (!editingDifficulty) paintDifficulty(state.economy);
    const select = get('settings-representative');
    const selected = state.economy.representative;
    const options = [new Option('현재 파트너 따라가기', '')];
    const all = [...state.captures, ...(state.active ? [state.active] : [])];
    const seen = new Set();
    for (const row of all) {
      for (const species of row.species) {
        const key = JSON.stringify({ speciesID: species.number, form: species.form });
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(new Option(species.name + (species.form ? ' · ' + species.form : ''), key));
      }
    }
    select.replaceChildren(...options);
    select.value = selected ? JSON.stringify({ speciesID: selected.speciesID, form: selected.form }) : '';
  }

  for (const kind of ['growth', 'shop']) {
    get('difficulty-' + kind).addEventListener('input', event => {
      get('difficulty-' + kind + '-value').textContent = event.target.value + '×';
    });
  }
  // Saves the current values of both difficulty sliders, one save at a time.
  let difficultySaving = Promise.resolve();
  async function saveDifficulty() {
    const growth = Number(get('difficulty-growth').value), shop = Number(get('difficulty-shop').value);
    try {
      representative(await window.usage.changeCompanion({ kind: 'difficulty', growth, shop }));
      status.textContent = tr('저장됨');
    } catch (error) {
      showError(error);
      // A failed save puts the sliders back on the saved values unless a newer save is coming.
      if (!difficultyTimer && pendingDifficultySaves === 1 && companion) paintDifficulty(companion.economy);
    }
  }
  for (const kind of ['growth', 'shop']) get('difficulty-' + kind).addEventListener('change', () => {
    clearTimeout(difficultyTimer);
    // Waits until the slider settles so several arrow-key steps become one save.
    difficultyTimer = setTimeout(() => {
      difficultyTimer = 0;
      pendingDifficultySaves++;
      difficultySaving = difficultySaving.then(saveDifficulty).finally(() => { pendingDifficultySaves--; });
    }, 400);
  });

  get('settings-representative').addEventListener('change', async event => {
    try {
      const selection = event.target.value ? JSON.parse(event.target.value) : { speciesID: null };
      representative(await window.usage.changeCompanion({ kind: 'representative', ...selection }));
      status.textContent = '저장됨';
    } catch (error) { if (companion) representative(companion); showError(error); }
  });

  async function refresh() {
    if (reading) return;
    reading = true;
    try {
      const snapshot = await window.usage.refresh();
      representative(snapshot.companion);
      if (!get('provider').options.length) {
        const list = get('settings-providers');
        for (const [id, name] of Object.entries(snapshot.labels)) {
          get('provider').append(new Option(name, id));
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.className = 'toggle';
          input.dataset.provider = id;
          input.checked = current?.providers.includes(id) ?? true;
          input.addEventListener('change', () => {
            const providers = [...document.querySelectorAll('[data-provider]:checked')].map(input => input.dataset.provider);
            void update({ providers });
          });
          label.append(name, input);
          list.append(label);
        }
      }
      const provider = get('provider').value;
      const root = snapshot.usage[provider]?.extraRoot;
      get('root-path').textContent = root ?? '미설정';if(document.activeElement!==get('scan-roots'))get('scan-roots').value=root??'';
      get('choose-root').disabled = false;
      get('reset-root').disabled = !root;
    } catch (error) { showError(error); }
    finally { reading = false; }
  }

  let previewTimer,previewGeneration=0;
  get('scan-roots').addEventListener('input',()=>{clearTimeout(previewTimer);const generation=++previewGeneration;previewTimer=setTimeout(async()=>{try{const result=await window.usage.scanRoots(get('provider').value,get('scan-roots').value);if(generation===previewGeneration)get('scan-count').textContent=tr('일치 파일')+': '+result.count;}catch(error){showError(error);}},300);});
  get('scan-save').addEventListener('click',async()=>{try{await window.usage.scanRoots(get('provider').value,get('scan-roots').value,true);await refresh();status.textContent=tr('저장됨');}catch(error){showError(error);}});
  get('provider').addEventListener('change',()=>{previewGeneration++;get('scan-count').textContent='';void refresh();});
  for (const id of ['choose-root', 'reset-root']) get(id).addEventListener('click', async () => {
    get(id).disabled = true;
    try {
      await window.usage.configure(get('provider').value, id === 'reset-root');
      await refresh();
    } catch (error) { showError(error); }
    finally { get(id).disabled = false; }
  });
  async function showSnapshots() {
    const snapshots = await window.preferences.snapshots();
    const list = get('settings-snapshots');
    list.replaceChildren(...snapshots.map(snapshot => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = new Date(snapshot.createdAt).toLocaleString() + ' · ' + snapshot.label;
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'neutral';
      restore.textContent = '미리보기·복원';
      restore.addEventListener('click', async () => {
        try {
          const preview = await window.usage.previewSnapshot(snapshot.id);
          window.dispatchEvent(new CustomEvent('save-preview', { detail: preview }));
          get('import-preview').closest('details').open = true;
          get('import-preview').scrollIntoView({ block: 'center' });
        } catch (error) { showError(error); }
      });
      row.append(label, restore);
      return row;
    }));
    if (!snapshots.length) list.textContent = '저장된 스냅샷이 없습니다.';
  }

  get('settings-snapshot').addEventListener('click', async event => {
    event.target.disabled = true;
    try { await window.preferences.snapshot(); await showSnapshots(); status.textContent = '스냅샷 저장됨'; }
    catch (error) { showError(error); }
    finally { event.target.disabled = false; }
  });
  get('settings-data-folder').addEventListener('click', () => { void window.preferences.openDataFolder().catch(showError); });
  get('settings-add-account').addEventListener('click', async event => {
    event.target.disabled = true;
    try { const settings = await window.preferences.addClaudeRoot(); if (settings) render(settings); }
    catch (error) { showError(error); }
    finally { event.target.disabled = false; }
  });
  get('settings-refresh-login').addEventListener('click', async event => {
    event.target.disabled = true;
    get('settings-login-status').textContent = '로그인 파일을 다시 읽고 한도를 조회하는 중…';
    try {
      const results = await window.usage.limits();
      get('settings-login-status').textContent = results.map(result =>
        (result.account ? result.provider + ' ' + result.account : result.provider) + ' · ' +
        ({ available: '로그인 확인', unavailable: '로그인 또는 한도 없음', failed: '조회 실패' }[result.status])).join(' / ');
    } catch (error) { showError(error); }
    finally { event.target.disabled = false; }
  });
  void showSnapshots().catch(showError);

  get('settings-backup').addEventListener('click', async () => {
    const button = get('settings-backup');
    button.disabled = true;
    try {
      const path = await window.preferences.backup();
      get('backup-status').textContent = path ? '백업했습니다. ' + path : '';
    } catch (error) { get('backup-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
  get('settings-export-mac').addEventListener('click',async event=>{event.target.disabled=true;try{const path=await window.usage.exportMac();get('backup-status').textContent=path?window.i18n.t('저장됨')+' '+path:'';}catch(error){showError(error);}finally{event.target.disabled=false;}});
  window.preferences.onChange(render);
  window.usage.onCompanion(state => { if (state) representative(state); });
  window.addEventListener('settings-companion', event => representative(event.detail));
  void window.preferences.read().then(settings => { render(settings); status.textContent = ''; }).catch(showError);
  void window.desktop.settings().then(settings => {
    get('settings-version').textContent = settings.version;
    get('settings-current-version').textContent = 'v'+settings.version;
    get('desktop-development').hidden = settings.supported;
  }).catch(showError);
  void refresh();
})();

for(const button of document.querySelectorAll('[data-support]'))button.addEventListener('click',()=>window.desktop.support(button.dataset.support).catch(error=>{document.querySelector('#support-status').textContent=error.message;}));
