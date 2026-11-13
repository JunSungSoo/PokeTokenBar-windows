const egg = document.querySelector('.egg');
const bubble = document.querySelector('output');
let reactionTimer;
let subject;

function renderPet(updated) {
  subject = updated;
  const { species, shiny } = updated;
  egg.replaceChildren();
  egg.classList.toggle('pokemon', Boolean(species));
  egg.title = species?.name ?? '알에게 기도하기';
  egg.setAttribute('aria-label', egg.title);
  if (!species) return;
  const sprite = document.createElement('img');
  sprite.alt = species.name;
  const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  const variant = (window.appPreferences?.back ? 'back/' : '') + (shiny ? 'shiny/' : '');
  const staticImage = base + variant + (species.spriteID ?? species.number) + '.png';
  sprite.addEventListener('error', () => { sprite.src = staticImage; }, { once: true });
  sprite.dataset.staticSrc = staticImage;
  sprite.src = window.appPreferences?.animated === false || matchMedia('(prefers-reduced-motion: reduce)').matches ? staticImage :
    base + 'versions/generation-v/black-white/animated/' + variant + (species.animated ?? species.number) + '.gif';
  egg.append(sprite);
}

window.addEventListener('preferences-changed', () => { if (subject) renderPet(subject); });
window.pet.onUpdate(renderPet);
void window.pet.read().then(renderPet).catch(() => {});
egg.addEventListener('click', async () => {
  const prayers = await window.pet.activate().catch(() => null);
  if (prayers === null) return;
  if (agent.done || agent.waiting) return;
  bubble.hidden = false;
  bubble.textContent = window.i18n.t('기도를 전했어요!') + ' · ' + prayers;
  egg.classList.add('react');
  clearTimeout(reactionTimer);
  reactionTimer = setTimeout(() => {
    renderAgent();
    egg.classList.remove('react');
  }, 900);
});

let agent = { working: false, otherWaitingCount: 0 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function renderAgent() {
  const enabled = window.appPreferences?.petAgentActivity !== false;
  egg.classList.toggle('working', enabled && agent.working && window.appPreferences?.animated !== false && !reducedMotion.matches);
  const note = enabled && (agent.done ?? agent.waiting);
  bubble.replaceChildren();
  bubble.hidden = !note;
  if (!note) return;
  const done = Boolean(agent.done);
  const title = document.createElement('strong');
  if (note.label) {
    const label = document.createElement('span'); label.dataset.noTranslate = ''; label.textContent = note.label;
    title.append(label, ' · ', window.i18n.t(done ? '완료' : '대기 중'));
  } else title.textContent = window.i18n.t(done ? '완료!' : '에이전트가 기다려요');
  const body = document.createElement('span');
  if (note.message) { body.dataset.noTranslate = ''; body.textContent = note.message; }
  else body.textContent = window.i18n.t(done ? '에이전트가 작업을 마쳤어요.' : '입력을 기다리고 있어요.');
  bubble.append(title, body);
  if (!done && agent.otherWaitingCount) bubble.append(' +' + agent.otherWaitingCount);
}
function syncAgentMotion() {
  void window.pet.motion(reducedMotion.matches || window.appPreferences?.animated === false).catch(() => {});
  renderAgent();
}
window.pet.onAgent(value => { agent = value; renderAgent(); });
void window.pet.agent().then(value => { agent = value; renderAgent(); }).catch(() => {});
window.addEventListener('preferences-changed', syncAgentMotion);
window.addEventListener('language-changed', renderAgent);
reducedMotion.addEventListener('change', syncAgentMotion);
bubble.addEventListener('click', () => { void window.pet.dismissAgent(); });
syncAgentMotion();
