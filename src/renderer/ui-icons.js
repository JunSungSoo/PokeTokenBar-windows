(() => {
  const paths={refresh:'M18 7a7 7 0 1 0 1 8M18 3v5h-5',gear:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0',power:'M12 2v9M6 5a9 9 0 1 0 12 0',chart:'M3 21h19M5 17V9h3v8m4 0V4h3v13m4 0V7h3v10',minimize:'M5 12h14',close:'M6 6l12 12M18 6 6 18'};
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.7');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;}
  for(const[id,name]of [['refresh','refresh'],['open-settings','gear'],['footer-pet','eye'],['footer-quit','power'],['window-minimize','minimize'],['window-close','close']])document.getElementById(id)?.replaceChildren(icon(name));
  const details=document.querySelector('#usage-details');
  if(details){for(const child of [...details.childNodes])if(child.nodeType===Node.TEXT_NODE)child.remove();details.append(icon('chart'),document.createTextNode('상세'));}
  document.querySelector('#footer-pet')?.addEventListener('click',()=>{void window.desktop.togglePet().catch(error=>console.error(error));});
  document.querySelector('#window-minimize')?.addEventListener('click',()=>{void window.desktop.minimizeWindow().catch(error=>console.error(error));});
  document.querySelector('#window-close')?.addEventListener('click',()=>{void window.desktop.closeWindow().catch(error=>console.error(error));});
  document.querySelector('#footer-quit')?.addEventListener('click',()=>{void window.desktop.quit().catch(error=>console.error(error));});
  window.addEventListener('preferences-changed',event=>{
    const toggle=document.querySelector('#footer-pet');
    if(!toggle)return;
    toggle.setAttribute('aria-pressed',String(event.detail.petEnabled));
    const eye=icon('eye');
    if(!event.detail.petEnabled){const slash=document.createElementNS(eye.namespaceURI,'path');slash.setAttribute('d','M3 3l18 18');slash.setAttribute('fill','none');slash.setAttribute('stroke','currentColor');slash.setAttribute('stroke-width','1.7');slash.setAttribute('stroke-linecap','round');eye.append(slash);}
    toggle.replaceChildren(eye);
  });
})();
