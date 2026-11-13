import assert from 'node:assert/strict';
export async function checkHeldItemPicker(window,preferences,widths=[360,490,660]){
 const js=code=>window.webContents.executeJavaScript(code);
 for(const language of ['ko','en','ja','es','fr','pt','de','ru']){
  await preferences.change({language});
  for(let i=0;i<100&&await js('document.documentElement.lang')!==language;i++)await new Promise(r=>setTimeout(r,20));
  for(const width of widths){
   window.setContentSize(width,665);await new Promise(r=>setTimeout(r,60));
   const result=await js(`(()=>{
    const U=window.battleUI,fail=message=>{throw Error(message)},p={id:'picker-test',speciesID:6};
    const before=localStorage.getItem('battlePokemonHeldItems.v1');window.pickerApplied=[];
    U.pickItem(p,{'picker-test':'mysticwater',other:'leftovers'},[p.id,'other'],id=>window.pickerApplied.push(id));
    const popup=document.querySelector('.battle-item-popup[open]'),list=popup.querySelector('[role=listbox]'),apply=popup.querySelector('#battle-item-apply');
    if(!apply.disabled)fail('same item must disable Apply');
    const used=popup.querySelector('[data-item=leftovers]');if(used.disabled)fail('used item must remain previewable');used.click();
    if(!apply.disabled||!popup.querySelector('.battle-item-preview').innerText.includes(U.t('다른 포켓몬이 사용 중')))fail('used preview/Apply');
    const key=key=>list.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));key('Home');
    if(list.querySelector('[aria-selected=true]').dataset.item!=='')fail('Home');
    if(list.firstElementChild.textContent!==U.t('없음'))fail('localized None');key('ArrowDown');
    if(list.querySelector('[aria-selected=true]')!==list.children[1])fail('ArrowDown');key('ArrowUp');key('End');
    if(list.querySelector('[aria-selected=true]')!==list.lastElementChild)fail('End');key('PageUp');
    const r=popup.getBoundingClientRect(),overflow=[...popup.querySelectorAll('.battle-item-columns,.battle-item-list,.battle-item-preview,.battle-confirm-actions button')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.left<r.left-1||b.right>r.right+1)});
    const bounded=r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&!overflow.length;
    popup.querySelector('.battle-confirm-actions button').click();
    if(window.pickerApplied.length||localStorage.getItem('battlePokemonHeldItems.v1')!==before)fail('cancel changed preferences');
    if(U.disabledReason({pp:0,disabled:true})!==U.t('PP 부족'))fail('PP reason');
    if(!U.disabledReason({pp:5,disabled:true,disableReason:'choicescarf'}).includes(U.localized(U.item('choicescarf').names)))fail('item reason');
    return {bounded,rect:[r.left,r.top,r.right,r.bottom,innerWidth,innerHeight],overflow:overflow.map(e=>[e.className,e.textContent,e.getBoundingClientRect().toJSON()]),none:U.t('없음')};
   })()`);
   assert.equal(result.bounded,true,`${language} / ${width}px item popup bounds ${JSON.stringify(result)}`);
  }
 }
 // Enter commits once; collection editing must not overwrite the separate remembered battle item.
 await js(`(async()=>{const U=window.battleUI,p={id:'picker-test',speciesID:6},before=localStorage.getItem('battlePokemonHeldItems.v1');window.pickerApplied=[];U.pickItem(p,{[p.id]:''},[],id=>window.pickerApplied.push(id),{collectionDefault:true});document.querySelector('.battle-item-popup[open] [data-item=leftovers]').click();document.querySelector('.battle-item-popup[open] [role=listbox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));if(document.querySelector('.battle-item-popup[open]')||window.pickerApplied.join()!=='leftovers'||localStorage.getItem('battlePokemonHeldItems.v1')!==before)throw Error('Enter/collection preference isolation '+JSON.stringify({open:!!document.querySelector('.battle-item-popup[open]'),applied:window.pickerApplied,before,after:localStorage.getItem('battlePokemonHeldItems.v1'),text:document.querySelector('.battle-item-popup')?.innerText}));})()`);
 for(let i=0;i<100&&await js("Boolean(document.querySelector('.battle-item-popup'))");i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(await js("document.querySelector('.battle-item-popup')===null"),true,'closed item dialogs removed');
 await preferences.change({language:'ko'});window.setContentSize(widths.at(-1),665);
 console.log('PASS: held-item previews, same/used Apply guards, cancel, keyboard commit, translated None/restrictions and eight-language popup bounds.');
}
