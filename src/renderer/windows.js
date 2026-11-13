(() => {
  const login = document.querySelector('#desktop-login');
  const loginStatus = document.querySelector('#desktop-login-status');
  const update = document.querySelector('#desktop-update');
  const updateStatus = document.querySelector('#desktop-update-status');
  const pet = document.querySelector('#desktop-pet');
  let next = 'check';

  window.desktop.settings().then(settings => {
    if (!settings.supported) return;
    document.querySelector('#desktop-version').textContent = settings.version;
    login.checked = settings.openAtLogin;
    document.querySelector('#desktop-settings').hidden = false;
  }).catch(() => {});

  login.addEventListener('change', async () => {
    const requested = login.checked;
    login.disabled = true;
    try {
      const settings = await window.desktop.login(requested);
      login.checked = settings.openAtLogin;
      loginStatus.textContent = settings.openAtLogin === requested
        ? '' : 'Windows 시작 앱 설정에서 권한을 확인해 주세요.';
    } catch {
      login.checked = !requested;
      loginStatus.textContent = '자동 실행 설정을 변경하지 못했습니다.';
    } finally { login.disabled = false; }
  });

  pet.addEventListener('click', async () => {
    pet.disabled = true;
    try { await window.desktop.togglePet(); }
    catch { loginStatus.textContent = '플로팅 펫을 열지 못했습니다.'; }
    finally { pet.disabled = false; }
  });

  update.addEventListener('click', async () => {
    update.disabled = true;
    const installing = next === 'install';
    let startedInstall = false;
    try {
      if (installing) {
        updateStatus.textContent = '앱을 닫고 업데이트를 설치하는 중입니다…';
        await window.desktop.installUpdate();
        startedInstall = true;
        setTimeout(() => {
          update.disabled = false;
          updateStatus.textContent = '설치 창이 열렸는지 확인해 주세요. 앱이 닫히지 않으면 다시 시도할 수 있습니다.';
        }, 10000);
        return;
      }
      const download = next === 'download';
      updateStatus.textContent = download ? '업데이트를 다운로드하는 중입니다…' : '업데이트를 확인하는 중입니다…';
      const result = await (download ? window.desktop.downloadUpdate() : window.desktop.checkUpdate());
      if (result.state === 'downloaded') {
        next = 'install';
        update.textContent = '설치하고 다시 시작';
        updateStatus.textContent = result.version + ' 버전 설치 준비 완료';
      } else if (result.state === 'available') {
        next = 'download';
        update.textContent = '업데이트 다운로드';
        updateStatus.textContent = result.version + ' 버전을 사용할 수 있습니다.';
      } else {
        updateStatus.textContent = '최신 버전입니다.';
      }
    } catch {
      updateStatus.textContent = '업데이트를 완료하지 못했습니다. 다시 시도해 주세요.';
    } finally {
      if (!startedInstall) update.disabled = false;
    }
  });
})();
