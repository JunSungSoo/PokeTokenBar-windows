(() => {
  const get = id => document.getElementById(id);
  const status = get('settings-saved');
  let current;
  let companion;
  let reading = false;

  function showError(error) {
    status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  }

  function render(settings) {
    current = settings;
    for (const control of document.querySelectorAll('[data-setting]')) {
      if (control.type === 'text' && document.activeElement === control) continue;
      const value = settings[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = value;
      else control.value = String(value);
    }
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

  function representative(state) {
    companion = state;
    get('difficulty-growth').value = state.economy.growthDifficulty;
    get('difficulty-shop').value = state.economy.shopDifficulty;
    get('difficulty-growth-value').textContent = state.economy.growthDifficulty + '×';
    get('difficulty-shop-value').textContent = state.economy.shopDifficulty + '×';
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
  get('difficulty-save').addEventListener('click', async () => {
    try {
      representative(await window.usage.changeCompanion({ kind: 'difficulty',
        growth: Number(get('difficulty-growth').value), shop: Number(get('difficulty-shop').value) }));
      status.textContent = '저장됨';
    } catch (error) { showError(error); }
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
      get('root-path').textContent = root ?? '미설정';
      get('choose-root').disabled = false;
      get('reset-root').disabled = !root;
    } catch (error) { showError(error); }
    finally { reading = false; }
  }

  get('provider').addEventListener('change', refresh);
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
  window.preferences.onChange(render);
  window.usage.onCompanion(state => { if (state) representative(state); });
  window.addEventListener('settings-companion', event => representative(event.detail));
  void window.preferences.read().then(settings => { render(settings); status.textContent = ''; }).catch(showError);
  void window.desktop.settings().then(settings => {
    get('settings-version').textContent = settings.version;
    get('desktop-development').hidden = settings.supported;
  }).catch(showError);
  void refresh();
})();
