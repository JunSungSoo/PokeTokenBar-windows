(() => {
 const banner=document.querySelector('#update-banner');if(!banner)return;let state;const t=(s,args)=>window.i18n.t(s,args);
 function button(text,className,action){const element=document.createElement('button');element.type='button';element.textContent=t(text);if(className)element.className=className;element.onclick=async()=>{element.disabled=true;try{await action();}catch(error){label.textContent=t(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}finally{element.disabled=false;}};return element;}
 let label;
 function render(value){
  state=value;
  banner.hidden=!['available','downloading','failed'].includes(value.state);
  banner.replaceChildren();
  if(banner.hidden)return;
  const heading=document.createElement('div');
  heading.className='update-banner-heading';
  label=document.createElement('p');
  if(value.state==='failed'){
   label.textContent=t(value.error??'업데이트하지 못했습니다. 다운로드 페이지 열기');
  }else{
   const emphasis=document.createElement('strong');
   emphasis.textContent=t('{version} 버전',{version:value.version});
   const [before,after]=t('{release}을 사용할 수 있습니다.').split('{release}');
   label.dataset.noTranslate='';
   label.append(before,emphasis,after);
  }
  heading.append(label);
  banner.append(heading);
  if(value.state==='downloading'){
   const progress=button('업데이트 받는 중…','primary',async()=>{});
   progress.disabled=true;
   heading.append(progress);
   return;
  }
  heading.append(button('이 버전 건너뛰기','update-banner-skip',async()=>render(await window.desktop.skipUpdate())));
  heading.append(button('업데이트','primary',async()=>{
   const result=await window.desktop.installUpdate();
   if(result.opened)label.textContent=t('다운로드 페이지를 열었습니다. 설치 파일을 실행해 주세요.');
   else render(result);
  }));
  if(value.state==='failed'){
   const actions=document.createElement('div');
   actions.className='update-banner-actions';
   actions.append(button('업데이트하지 못했습니다. 다운로드 페이지 열기','',()=>window.desktop.openUpdatePage()));
   banner.append(actions);
  }
 }
 window.desktop.onUpdate?.(render);window.desktop.updateState?.().then(render).catch(()=>{});window.addEventListener('language-changed',()=>{if(state)render(state);});
})();
