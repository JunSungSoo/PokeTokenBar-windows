// Builds the PokéRogue arena scene: background, player/opponent ground platforms and Pokémon stages in the original 320×132 field.
(() => {
  const fieldWidth = 320, fieldHeight = 132, frameRate = 12;
  // Pinned pokerogue-assets ships only these platforms as frame atlases; the rest are single PNGs.
  const animatedArenas = new Set(['end']);
  // ArenaBase positions after the original encounter slide: player base at x 0, opponent base at x 20.
  const baseOffset = { own: 0, foe: 20 };
  // Original battler feet (PlayerPokemon 106,148 / EnemyPokemon 236,84) and double-battle field offsets (LEFT -32,-8 / RIGHT +32,0).
  const feet = { own: [106, 148], foe: [236, 84] };
  const doubleOffsets = [[-32, -8], [32, 0]];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function layer(className) {
    const element = document.createElement('img');
    element.className = className;
    element.alt = '';
    element.draggable = false;
    return element;
  }

  // Plays a trimmed frame atlas on a full-field canvas at the original 12 fps; reduced motion keeps the first frame.
  function animatedPlatform(url, className) {
    const canvas = document.createElement('canvas');
    canvas.className = className;
    canvas.width = fieldWidth;
    canvas.height = fieldHeight;
    const context = canvas.getContext('2d');
    const image = new Image();
    image.src = url + '.png';
    void Promise.all([fetch(url + '.json').then(response => response.json()), image.decode()]).then(([atlas]) => {
      const frames = atlas.textures[0].frames;
      let index = 0;
      const draw = () => {
        const { frame, spriteSourceSize: target } = frames[index];
        context.clearRect(0, 0, fieldWidth, fieldHeight);
        context.drawImage(image, frame.x, frame.y, frame.w, frame.h, target.x, target.y, target.w, target.h);
      };
      draw();
      if (frames.length < 2 || reducedMotion.matches || !canvas.isConnected) return;
      const timer = setInterval(() => {
        if (!canvas.isConnected) { clearInterval(timer); return; }
        index = (index + 1) % frames.length;
        draw();
      }, 1000 / frameRate);
    }).catch(error => console.error('Arena platform unavailable:', url, error));
    return canvas;
  }

  function platform(base, arena, side) {
    const className = 'battle-arena-base ' + side;
    const url = base + 'player/images/arenas/' + arena + '_' + (side === 'own' ? 'a' : 'b');
    if (animatedArenas.has(arena)) return animatedPlatform(url, className);
    const image = layer(className);
    image.src = url + '.png';
    return image;
  }

  // Returns the scaled field holding the background, both platforms and (later) the Pokémon stages.
  function scene(base, arena) {
    const root = document.createElement('div');
    root.className = 'battle-scene';
    root.style.setProperty('--foe-base-offset', baseOffset.foe / fieldWidth * 100 + '%');
    const background = layer('battle-arena-background');
    background.src = base + 'player/images/arenas/' + arena + '_bg.png';
    root.append(background, platform(base, arena, 'own'), platform(base, arena, 'foe'));
    return root;
  }

  // Puts a zero-width stage's feet on the original battler position; later (front, RIGHT) slots draw on top.
  function place(stage, own, slot, count) {
    const side = own ? 'own' : 'foe';
    const [offsetX, offsetY] = count > 1 ? doubleOffsets[slot] ?? [0, 0] : [0, 0];
    const x = feet[side][0] + offsetX, y = feet[side][1] + offsetY;
    stage.classList.add(side);
    stage.style.left = x / fieldWidth * 100 + '%';
    stage.style.top = y / fieldHeight * 100 + '%';
  }

  function measureStage(field, own, slot, count) {
    const anchor = document.createElement('div');
    anchor.className = 'battle-stage';
    place(anchor, own, slot, count);
    field.querySelector('.battle-scene').append(anchor);
    const bounds = anchor.getBoundingClientRect();
    anchor.remove();
    return bounds;
  }

  // Keeps only this side's current stages in the scene in slot order, reusing elements that are already mounted.
  function replaceStages(root, own, stages) {
    const side = own ? 'own' : 'foe';
    for (const stage of root.querySelectorAll('.battle-stage.' + side)) if (!stages.includes(stage)) stage.remove();
    root.append(...stages);
  }

  window.battleArena = { scene, place, measureStage, replaceStages };
})();
