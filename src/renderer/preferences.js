(() => {
  function apply(settings) {
    document.documentElement.dataset.animation = settings.animated ? 'on' : 'off';
    document.documentElement.dataset.facing = settings.back ? 'back' : 'front';
    document.documentElement.style.setProperty('--pet-size', settings.petSize + 'px');
    window.appPreferences = settings;
    window.dispatchEvent(new CustomEvent('preferences-changed', { detail: settings }));
  }

  window.preferences.onChange(apply);
  void window.preferences.read().then(apply).catch(error => console.error('설정을 읽지 못했습니다.', error));
  document.getElementById('open-settings')?.addEventListener('click', () => {
    void window.desktop.openSettings().catch(error => console.error('설정 창을 열지 못했습니다.', error));
  });
})();
