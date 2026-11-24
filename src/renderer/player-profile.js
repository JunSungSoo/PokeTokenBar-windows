(() => {
  const { defaultProfileNickname, profileIconCount } = window.profileConfig;

  function fromSettings(settings) {
    return {
      nickname: settings?.tradeNickname?.trim() || defaultProfileNickname,
      icon: settings?.profileIcon,
    };
  }

  function avatar(icon) {
    const image = document.createElement('img');
    image.className = 'profile-avatar';
    image.alt = '';
    image.src = Number.isInteger(icon) && icon >= 1 && icon <= profileIconCount
      ? 'assets/profile/' + icon + '.png'
      : 'assets/ui/ball.svg';
    return image;
  }

  function badge(profile, label) {
    const card = document.createElement('div');
    card.className = 'profile-badge';
    const details = document.createElement('div');
    const caption = document.createElement('small');
    caption.textContent = label;
    const name = document.createElement('strong');
    name.dataset.noTranslate = '';
    name.textContent = profile.nickname || defaultProfileNickname;
    name.title = name.textContent;
    details.append(caption, name);
    card.append(avatar(profile.icon), details);
    return card;
  }

  function participants(local, peer) {
    const row = document.createElement('div');
    row.className = 'profile-participants';
    row.append(badge(local, window.i18n.t('내 프로필')));
    if (peer) row.append(badge(peer, window.i18n.t('상대 프로필')));
    return row;
  }

  window.playerProfile = { fromSettings, avatar, participants };

  const homeAvatar = document.getElementById('home-profile-avatar');
  if (homeAvatar) {
    const homeNickname = document.getElementById('home-profile-nickname');
    function renderHomeProfile(settings) {
      const { nickname, icon } = fromSettings(settings);
      const iconKey = String(icon || 0);
      if (homeAvatar.dataset.icon !== iconKey) {
        homeAvatar.replaceChildren(avatar(icon));
        homeAvatar.dataset.icon = iconKey;
      }
      homeNickname.textContent = nickname;
      homeNickname.title = nickname;
    }
    renderHomeProfile(window.appPreferences);
    window.addEventListener('preferences-changed', event => renderHomeProfile(event.detail));
  }
})();
