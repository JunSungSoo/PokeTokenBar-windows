import{readFileSync}from'node:fs';
import{formCatalog}from'./forms.js';
import{allowsHeldItem,type HeldItemRecord}from'../../shared/held-items.js';
export const heldItems:HeldItemRecord[]=JSON.parse(readFileSync(new URL('../../battle-assets/data/held-items.json',import.meta.url),'utf8')).items;
export function validBattleDefaultItem(speciesID:number,form:string|undefined,value:unknown):value is string{
  if(typeof value!=='string')return false;
  if(value==='')return true;
  const item=heldItems.find(item=>item.id===value);
  return !!item&&allowsHeldItem({id:'',speciesID,form},item,formCatalog);
}
