(() => {
  const players = new Map(),retries=new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const floor = () => window.systemPowerSaver?window.spriteTiming.floors.powerSaver:window.spriteTiming.floors[window.appPreferences?.animationQuality ?? 'powerSaver'];
  async function attach(img) {
    const url = img.src;if(!url.endsWith('.gif')&&retries.has(img))return;
    if (!url.endsWith('.gif') || players.has(img)) return;
    const state = { url, abort: new AbortController(), timer: undefined, decoder: undefined, canvas: undefined };
    players.set(img, state);
    const staticImage = () => {if(!img.isConnected)return;const previous=retries.get(img),delay=Math.min((previous?.delay??1000)*2,30000);clearTimeout(previous?.timer);if(img.dataset.staticSrc&&img.src===url)img.src=img.dataset.staticSrc;const timer=setTimeout(()=>{if(!img.isConnected){retries.delete(img);return;}retries.set(img,{delay,timer:undefined});img.src=url;},delay);retries.set(img,{delay,timer});};
    try {
      if (!('ImageDecoder' in window)) { staticImage(); return; }
      const response = await fetch(url, { signal: state.abort.signal });
      if (!response.ok) throw new Error('Sprite unavailable');
      const data = await response.arrayBuffer();
      if (data.byteLength > 5_000_000) throw new Error('Sprite too large');
      const decoder = new ImageDecoder({ data, type: 'image/gif' });
      state.decoder = decoder;
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack.frameCount;
      if (count > 512) throw new Error('Too many frames');
      const durations = [],petBox=img.closest('.pet-sprite'),tops=[];let petWidth,petHeight;
      for (let index = 0; index < count; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        durations.push((image.duration ?? 100000) / 1e6);
        if(petBox&&window.petPresentation){const scan=document.createElement('canvas');scan.width=petWidth=image.displayWidth;scan.height=petHeight=image.displayHeight;const ctx=scan.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);tops.push(window.petPresentation.spriteOpaqueTop(ctx.getImageData(0,0,scan.width,scan.height).data,scan.width,scan.height));}
        image.close();
      }
      if (!img.isConnected || state.abort.signal.aborted || img.src !== url) return;
      if(petBox&&tops.length)document.documentElement.style.setProperty('--sprite-visible-top',window.petPresentation.spriteVisibleTop(window.appPreferences?.petSize??96,petWidth,petHeight,tops)+'px');
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.className = 'sprite-canvas';
      state.canvas = canvas;
      img.after(canvas);
      clearTimeout(retries.get(img)?.timer);retries.delete(img);
      const began = performance.now();
      let previous = -1;
      const paused = () => previous !== -1 && petBox?.closest('.egg.dragging');
      async function tick() {
        if (!img.isConnected || img.src !== url || state.abort.signal.aborted) return;
        if (!paused() && !document.hidden && img.getClientRects().length && window.appPreferences?.animated !== false && !reduced.matches) {
          const frames = window.spriteTiming.capFrameRate(durations, floor());
          const index = window.spriteTiming.frameAt(frames, (performance.now() - began) / 1000);
          if (index !== previous) {
            const { image } = await decoder.decode({ frameIndex: index });
            if (state.abort.signal.aborted) { image.close(); return; }
            if (!paused()) {
              if (canvas.width !== image.displayWidth || canvas.height !== image.displayHeight) {
                canvas.width = image.displayWidth; canvas.height = image.displayHeight;
              }
              const context = canvas.getContext('2d');
              context.clearRect(0, 0, canvas.width, canvas.height);
              context.drawImage(image, 0, 0);
              previous = index;
              img.classList.add('sprite-decoded');
            }
            image.close();
          }
        }
        state.timer = setTimeout(() => { void tick().catch(fail); }, floor() * 1000);
      }
      function fail() { staticImage(); dispose(img); }
      await tick();
    } catch { if (!state.abort.signal.aborted) staticImage(); dispose(img); }
  }
  function dispose(img) {
    const state = players.get(img);
    if (!state) return;
    state.abort.abort(); clearTimeout(state.timer); state.canvas?.remove(); state.decoder?.close();
    img.classList.remove('sprite-decoded'); players.delete(img);
  }
  function scan() {
    for(const [img,retry]of retries)if(!img.isConnected){clearTimeout(retry.timer);retries.delete(img);}
    for (const [img, state] of players) if (!img.isConnected || state.url !== img.src) dispose(img);
    for (const img of document.querySelectorAll('.pokemon-art img, .egg.pokemon img')) void attach(img);
  }
  new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  window.addEventListener('pagehide', () => {for(const retry of retries.values())clearTimeout(retry.timer);retries.clear(); for (const img of players.keys()) dispose(img); });
  scan();
})();
