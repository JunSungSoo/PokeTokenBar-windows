export interface HeldItemPokemon {id:string;speciesID:number;form?:string|null;battleDefaultItem?:string}
export interface HeldItemRecord {id:string;mega?:{baseID:number}}
export function allowsHeldItem(pokemon:HeldItemPokemon,item:HeldItemRecord,forms:Record<number,string[]>):boolean {
  const variants=forms[pokemon.speciesID]??[],resolved=variants.includes(pokemon.form??'')?pokemon.form:variants[0];
  return !item.mega || item.mega.baseID===pokemon.speciesID&&!pokemon.form?.startsWith('mega')&&pokemon.form!=='primal'&&resolved===variants[0];
}
/** A duplicate fallback never changes the individual's saved preference. */
export function assignHeldItems(ids:string[],candidates:HeldItemPokemon[],remembered:Record<string,string>,overrides:Record<string,string>,items:HeldItemRecord[],forms:Record<number,string[]>):Record<string,string>{
  const result:Record<string,string>=Object.create(null),used=new Set<string>();
  for(const id of ids){const p=candidates.find(p=>p.id===id);if(!p){result[id]='';continue;}
    const preferred=items.find(item=>item.id===p.battleDefaultItem&&allowsHeldItem(p,item,forms));
    const value=overrides[id]??preferred?.id??remembered[id]??'',item=items.find(item=>item.id===value);
    result[id]=item&&allowsHeldItem(p,item,forms)&&!used.has(value)?value:'';
    if(result[id])used.add(result[id]);
  }return result;
}
