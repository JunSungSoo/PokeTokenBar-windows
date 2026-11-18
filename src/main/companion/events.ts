import{readFileSync}from'node:fs';import{translate,type Language}from'../../shared/localization.js';
import type {CompanionView} from '../../shared/companion.js';
import {readFile} from 'node:fs/promises';
import {writeSaveAtomically} from './store.js';
export interface CompanionNotice {title:string;body:string;args:Record<string,string|number>;species?:Record<string,number>}
export function completionBadges(view:CompanionView):Map<string,CompanionNotice>{
 const result=new Map<string,CompanionNotice>(),owned=new Set(view.collection.map(p=>p.number)),shiny=new Set([...view.captures,...(view.active?[view.active]:[])].filter(p=>p.shiny).flatMap(p=>p.species.map(s=>s.number)));
 for(const [region,first,last]of [['관동',1,151],['성도',152,251],['호연',252,386],['신오',387,493],['하나',494,649]] as const){for(const [kind,ids]of [['normal',owned],['shiny',shiny]]as const)if(Array.from({length:last-first+1},(_,i)=>first+i).every(id=>ids.has(id)))result.set(region+kind,{title:kind==='shiny'?'✨ {region} 이로치 도감 완성!':'🏅 {region} 도감 완성!',body:'{region}',args:{region}});}
 for(const [kind,ids]of [['normal',owned],['shiny',shiny]]as const)if(Array.from({length:649},(_,i)=>i+1).every(id=>ids.has(id)))result.set('national'+kind,{title:kind==='shiny'?'✨ 전국 이로치 도감 완성!':'🌍 전국도감 완성!',body:'649 / 649',args:{}});
 const forms=new Set([...view.captures,...(view.active?[view.active]:[])].flatMap(p=>p.species.filter(s=>s.number===201).map(s=>s.form??'a')));if(forms.size===28)result.set('unown',{title:'🔤 안농 도감 완성!',body:'28 / 28',args:{}});return result;
}
export function companionChanges(before:CompanionView,after:CompanionView):CompanionNotice[]{
 const notices:CompanionNotice[]=[],previous=before.active,current=after.active;
 if(current&&current.id!==previous?.id&&!before.captures.some(p=>p.id===current.id))notices.push({title:current.shiny?'✨ 이로치 부화!':'🥚 부화!',body:'{name}',args:{name:after.current?.name??''}});
 if(previous&&current?.id===previous.id&&before.current?.number!==after.current?.number&&!after.dittoReveal)notices.push({title:'✨ 진화!',body:'{from} → {to}',args:{from:before.current?.name??'',to:after.current?.name??''}});
 if(after.dittoReveal&&after.dittoReveal.id!==before.dittoReveal?.id)notices.push({title:after.dittoReveal.shiny?'🎭✨ 어라? 이로치 메타몽!':'🎭 어라? 메타몽!',body:'{disguise}인 줄 알았는데 — 사실은 메타몽이었어요!',args:{disguise:after.dittoReveal.disguise}});
 for(const mon of after.captures)if(mon.graduatedAt!==undefined&&mon.releasedAt===undefined&&mon.id===previous?.id&&!before.captures.some(p=>p.id===mon.id))notices.push({title:'🎓 졸업!',body:'{name} 졸업 → 도감에 보존. 새 Token Egg가 도착했어요!',args:{name:mon.species.at(-1)?.name??''}});
 return notices;
}
export class CompanionEvents{
 private queue:Promise<unknown>=Promise.resolve();private previous?:CompanionView;private keys?:Set<string>;
 constructor(private path:string){}
 observe(view:CompanionView,announce=true,lifeChanges=true):Promise<CompanionNotice[]>{const snapshot=structuredClone(view);const next=this.queue.then(async()=>{
  if(!this.keys){try{this.keys=new Set(JSON.parse(await readFile(this.path,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;this.keys=new Set();}}
  const badges=completionBadges(snapshot),events=announce&&lifeChanges&&this.previous?companionChanges(this.previous,snapshot):[];
  for(const [key,notice]of badges){if(announce&&this.previous&&!this.keys.has(key))events.push(notice);this.keys.add(key);}
  await writeSaveAtomically(this.path,JSON.stringify([...this.keys]));this.previous=snapshot;return events;
 });this.queue=next.catch(()=>{});return next;}
 finishWrites(){return this.queue;}
}

const speciesCatalog=JSON.parse(readFileSync(new URL('../../companion-data/catalog.json',import.meta.url),'utf8')).species;
export function localizedNotice(notice:CompanionNotice,language:Language){const args={...notice.args};for(const[key,id]of Object.entries(notice.species??{}))args[key]=speciesCatalog[id]?.[language]??args[key];if(typeof args.region==='string')args.region=translate(args.region,language);return{title:translate(notice.title,language,args),body:translate(notice.body,language,args)};}
