// Shared, viewport-contained tooltip and select-only combobox for move loadouts.
(() => {
  const records=new WeakMap();let menu,tip,list,description,owner,hoverOwner,active=-1,sequence=0,hoverTimer,hideTimer,search='',searchTime=0;
  function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
  function visible(element){return element?.isConnected && element.getClientRects().length && !element.closest('[hidden]');}
  function ensure(){
    if(menu)return;
    menu=node('div',undefined,'move-floating move-picker-menu');menu.popover='manual';menu.id='move-picker-menu';
    const heading=node('div',undefined,'move-menu-title');heading.textContent=window.i18n.t('기술 선택');
    list=node('div',undefined,'move-options');list.id='move-picker-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',window.i18n.t('기술 선택'));
    description=node('div',undefined,'move-menu-description');description.id='move-menu-description';description.setAttribute('role','tooltip');
    menu.append(heading,list,description);
    tip=node('div',undefined,'move-floating move-hover-tooltip');tip.id='pokemon-move-tooltip';tip.popover='manual';tip.setAttribute('role','tooltip');
    tip.addEventListener('pointerenter',()=>clearTimeout(hideTimer));tip.addEventListener('pointerleave',()=>hideTip());
    document.body.append(menu,tip);
  }
  function renderText(target,text){
    const [title='',body='',...metadata]=text.split('\n');
    target.replaceChildren(node('strong',title,'move-tooltip-title'),node('p',body,'move-tooltip-description'),...metadata.map(line=>node('p',line,'move-tooltip-meta')));
  }
  function position(popup,anchor){
    const margin=8;const rect=anchor.getBoundingClientRect();
    const box=popup.getBoundingClientRect();
    const below=innerHeight-rect.bottom-margin,above=rect.top-margin;
    const y=box.height<=below || below>=above ? rect.bottom+6 : rect.top-box.height-6;
    popup.style.left=Math.max(margin,Math.min(rect.left,innerWidth-box.width-margin))+'px';
    popup.style.top=Math.max(margin,Math.min(y,innerHeight-box.height-margin))+'px';
  }
  function reposition(){
    if(owner){const r=owner.getBoundingClientRect();if(!visible(owner) || r.bottom<=0 || r.top>=innerHeight)closeMenu();else position(menu,owner);}
    if(hoverOwner){const r=hoverOwner.getBoundingClientRect();if(!visible(hoverOwner) || r.bottom<=0 || r.top>=innerHeight)hideTip();else position(tip,hoverOwner);}
  }
  function hideTip(){clearTimeout(hoverTimer);clearTimeout(hideTimer);hoverOwner?.removeAttribute('aria-describedby');hoverOwner=undefined;if(tip?.matches(':popover-open'))tip.hidePopover();}
  function showTip(anchor,text){
    if(owner || !visible(anchor) || !text)return;ensure();hideTip();hoverOwner=anchor;
    renderText(tip,text);anchor.setAttribute('aria-describedby',tip.id);tip.showPopover();position(tip,anchor);
  }
  function bindTooltip(anchor,getText){
    const show=()=>{clearTimeout(hoverTimer);clearTimeout(hideTimer);hoverTimer=setTimeout(()=>showTip(anchor,getText()),220);};
    anchor.addEventListener('pointerenter',show);anchor.addEventListener('focus',show);
    anchor.addEventListener('pointerleave',()=>{clearTimeout(hoverTimer);hideTimer=setTimeout(hideTip,120);});
    anchor.addEventListener('blur',hideTip);
  }
  function closeMenu(focus=false){
    const previous=owner;owner=undefined;active=-1;search='';
    previous?.setAttribute('aria-expanded','false');previous?.removeAttribute('aria-activedescendant');previous?.removeAttribute('aria-describedby');
    if(menu?.matches(':popover-open'))menu.hidePopover();
    if(focus && visible(previous)){previous.focus({preventScroll:true});clearTimeout(hoverTimer);}
  }
  function highlight(index,scroll=false){
    if(!owner)return;const options=records.get(owner).options;if(!options[index])return;
    active=index;for(const row of list.children)row.classList.toggle('highlighted',Number(row.dataset.index)===index);
    const row=list.children[index];owner.setAttribute('aria-activedescendant',row.id);owner.setAttribute('aria-describedby',description.id);
    renderText(description,options[index].tooltip);
    if(options[index].disabled && options[index].disabledReason)description.append(node('p',window.i18n.t(options[index].disabledReason),'move-option-note'));
    if(scroll)row.scrollIntoView({block:'nearest'});
  }
  function openMenu(button){
    if(button.disabled)return;ensure();hideTip();closeMenu();owner=button;search='';
    const record=records.get(button);list.replaceChildren();
    const menuTitle=record.menuTitle??window.i18n.t('기술 선택');menu.querySelector('.move-menu-title').textContent=menuTitle;list.setAttribute('aria-label',menuTitle);
    button.setAttribute('aria-expanded','true');
    for(const [index,option]of record.options.entries()){
      const row=node('div',undefined,'move-option');row.id='move-option-'+sequence++;row.dataset.index=String(index);row.dataset.move=option.value;
      row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.value===button.value));row.setAttribute('aria-disabled',String(Boolean(option.disabled)));
      row.append(node('span',option.title),node('span',option.value===button.value?'✓':'','move-option-check'));
      row.addEventListener('pointerenter',()=>highlight(index));row.addEventListener('pointerdown',event=>event.preventDefault());
      row.addEventListener('click',()=>choose(index));list.append(row);
    }
    menu.showPopover();
    highlight(Math.max(0,record.options.findIndex(option=>option.value===button.value)),true);position(menu,button);
  }
  function choose(index){
    if(!owner)return;const button=owner,option=records.get(button).options[index];
    if(!option || option.disabled)return;
    closeMenu();button.value=option.value;refresh(button);button.dispatchEvent(new Event('change',{bubbles:true}));
    if(visible(button)){button.focus({preventScroll:true});clearTimeout(hoverTimer);}
  }
  function refresh(button){
    const record=records.get(button);if(!record)return;
    const option=record.options.find(option=>option.value===button.value);
    button.replaceChildren(node('span',option?.title ?? record.placeholder,'move-picker-label'));
  }
  function step(delta,edge){
    if(!owner)return;const options=records.get(owner).options;
    let index=edge==='first'?-1:edge==='last'?options.length:active;
    for(let attempt=0;attempt<options.length;attempt++){
      index=(index+delta+options.length)%options.length;
      if(!options[index].disabled){highlight(index,true);return;}
    }
  }
  function picker({id,slot,selected,options,placeholder,accessibleLabel,menuTitle}){
    ensure();const button=node('button',undefined,'move-picker');button.type='button';button.id=id;button.dataset.slot=String(slot);button.value=selected ?? '';
    button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','move-picker-options');button.setAttribute('aria-label',accessibleLabel);
    records.set(button,{options,placeholder,menuTitle});refresh(button);button.disabled=!options.some(option=>!option.disabled);
    bindTooltip(button,()=>records.get(button).options.find(option=>option.value===button.value)?.tooltip ?? '');
    button.addEventListener('change',()=>refresh(button));
    button.addEventListener('click',()=>owner===button?closeMenu():openMenu(button));
    button.addEventListener('keydown',event=>{
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();hideTip();
        if(owner!==button){openMenu(button);if(event.key==='ArrowDown' || event.key==='ArrowUp')return;}
        step(event.key==='ArrowUp' || event.key==='End'?-1:1,event.key==='Home'?'first':event.key==='End'?'last':undefined);
      } else if(event.key==='Escape'){event.preventDefault();closeMenu();hideTip();}
      else if(event.key==='Enter' || event.key===' '){event.preventDefault();if(owner===button)choose(active);else openMenu(button);}
      else if(event.key==='Tab'){closeMenu();hideTip();}
      else if(event.key.length===1 && !event.ctrlKey && !event.metaKey && !event.altKey){
        if(owner!==button)openMenu(button);const now=Date.now();search=(now-searchTime>700?'':search)+event.key.toLocaleLowerCase();searchTime=now;
        const index=options.findIndex(option=>!option.disabled && option.title.toLocaleLowerCase().startsWith(search));if(index>=0){event.preventDefault();highlight(index,true);}
      }
    });
    return button;
  }
  document.addEventListener('pointerdown',event=>{
    if(owner && !menu.contains(event.target) && event.target!==owner && !owner.contains(event.target))closeMenu();
    if(hoverOwner && !hoverOwner.contains(event.target) && !tip.contains(event.target))hideTip();
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMenu();hideTip();}},true);
  document.addEventListener('scroll',event=>{if(!menu?.contains(event.target) && !tip?.contains(event.target))reposition();},true);
  window.addEventListener('resize',reposition);
  for(const event of ['language-changed','app-tab-changed'])window.addEventListener(event,()=>{closeMenu();hideTip();});
  // The battle animation iframes grab focus when Phaser boots; that is not the user leaving the window.
  window.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement?.matches('iframe.battle-effect-frame'))return;closeMenu();hideTip();}));
  new MutationObserver(()=>{if(owner && !visible(owner))closeMenu();if(hoverOwner && !visible(hoverOwner))hideTip();}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','disabled']});
  window.moveUI={picker,bindTooltip,refresh,close:()=>{closeMenu();hideTip();}};
})();
