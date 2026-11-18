import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import type {PokemonDetails} from '../../shared/pokemon-details.js';
import type {Row} from '../usage/jsonl.js';
import {nationalDex} from './national-dex.js';

interface EngineSpecies {exists:boolean;name:string;num:number;gender?:string;genderRatio?:{F:number;M:number}}
const {Dex}=createRequire(import.meta.url)('pokemon-showdown') as {Dex:{mod(name:string):{species:{get(name:string):EngineSpecies}}}};
const dex=Dex.mod('gen5');
const abilities:Record<string,PokemonDetails['abilities']>=JSON.parse(readFileSync(new URL('../../companion-data/ability-options.json',import.meta.url),'utf8'));
export const profileStats=['hp','attack','defense','specialAttack','specialDefense','speed'];
const key=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]/g,'');
export function profileRandom(seed:bigint){
 let state=seed===0n?0x9E3779B97F4A7C15n:BigInt.asUintN(64,seed);
 return()=>{state=BigInt.asUintN(64,state+0x9E3779B97F4A7C15n);let value=state;
  value=BigInt.asUintN(64,(value^(value>>30n))*0xBF58476D1CE4E5B9n);
  value=BigInt.asUintN(64,(value^(value>>27n))*0x94D049BB133111EBn);return value^(value>>31n);};
}
export function generateProfile(seed:bigint,id:string):Row{
 const next=profileRandom(seed);return{instanceID:id,seed:seed.toString(),ivs:Object.fromEntries(profileStats.map(stat=>[stat,Number(next()%32n)])),level:5,growthTokens:0,abilityIsHidden:false,moves:[]};
}
export function abilityOptions(speciesID:number,form?:string):PokemonDetails['abilities']{
 const base=dex.species.get(nationalDex.get(speciesID)?.[0]??'');
 const candidate=form?dex.species.get(base.name+'-'+form):undefined;
 const species=candidate?.exists&&candidate.num===speciesID?candidate:base;
 return abilities[key(species.name)]??[];
}
/** Offline metadata uses the same BW2 species/ability tables as the Mac loadout. */
export function profileMetadata(speciesID:number,form?:string):Pick<PokemonDetails,'speciesID'|'genderRate'|'abilities'>{
 const species=dex.species.get(nationalDex.get(speciesID)?.[0]??'');
 const genderRate=species.gender==='N'?-1:Math.round((species.genderRatio?.F??(species.gender==='F'?1:0))*8);
 return{speciesID,genderRate,abilities:abilityOptions(speciesID,form)};
}
export function enrichIdentity(profile:Row,details:Pick<PokemonDetails,'speciesID'|'genderRate'|'abilities'>,form?:string,changedSpecies=false){
 const next=profileRandom(BigInt(String(profile.seed??0))^0xA11B1E5D9EEDn);
 if(profile.gender==null)profile.gender=details.genderRate<0?'genderless':Number(next()%8n)<details.genderRate?'female':'male';
 const normal=details.abilities.filter(a=>!a.isHidden).sort((a,b)=>a.slot-b.slot),hidden=details.abilities.filter(a=>a.isHidden).sort((a,b)=>a.slot-b.slot);
 if(profile.abilitySlot==null){
  const picked=hidden.length&&next()%128n===0n?hidden[Number(next()%BigInt(hidden.length))]:normal.length?normal[Number(next()%BigInt(normal.length))]:hidden[0];
  if(picked){profile.abilitySlot=picked.slot;profile.abilityIsHidden=picked.isHidden;}
 }
 const legal=abilityOptions(details.speciesID,form),chosen=details.abilities.find(a=>a.slot===profile.abilitySlot&&a.isHidden===profile.abilityIsHidden)??details.abilities.find(a=>a.slot===profile.abilitySlot)??normal[0]??hidden[0];
 const replacement=legal.find(a=>a.slot===profile.abilitySlot&&a.isHidden===profile.abilityIsHidden)??legal.find(a=>!a.isHidden)??legal[0];
 const custom=profile.hasCustomAbility===true;
 let picked=custom?(!legal.some(a=>key(a.name)===key(String(profile.abilityName??'')))?replacement:undefined):profile.abilityName==null||changedSpecies?chosen:undefined;
 if(picked){profile.abilityName=picked.name;profile.abilitySlot=picked.slot;profile.abilityIsHidden=picked.isHidden;}
 if(details.abilities.some(a=>key(a.name)===key(String(profile.abilityName??'')))&&!legal.some(a=>key(a.name)===key(String(profile.abilityName??'')))&&replacement){picked=replacement;profile.abilityName=picked.name;profile.abilitySlot=picked.slot;profile.abilityIsHidden=picked.isHidden;}
}
