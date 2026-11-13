import type{Member,Resource}from'./engine.js';
export type BuffKind='attack'|'specialAttack'|'speed'|'defense'|'specialDefense';
export interface TeamBuff{id:string;kind:BuffKind;remaining:number}
export type ShopItem='fullRecovery'|'ppRecovery'|'heal20'|'heal40'|'statusCure'|'teamHeal30'|'ppMoveRecovery';
export const shopOrder:ShopItem[]=['fullRecovery','ppRecovery','heal20','heal40','statusCure','teamHeal30','ppMoveRecovery'];
export const shopBase:Record<ShopItem,number>={fullRecovery:100,ppRecovery:30,heal20:10,heal40:20,statusCure:10,teamHeal30:50,ppMoveRecovery:10};
export const buffs:BuffKind[]=['attack','specialAttack','speed','defense','specialDefense'];
export function boosts(values:TeamBuff[]){const keys={attack:'atk',specialAttack:'spa',speed:'spe',defense:'def',specialDefense:'spd'};return values.filter(b=>b.remaining>0).reduce<Record<string,number>>((result,buff)=>{result[keys[buff.kind]]=(result[keys[buff.kind]]??0)+1;return result;},{});}
export function needs(item:ShopItem,r:Resource,maxHP:number,move?:number){switch(item){case'fullRecovery':return r.hp<maxHP||!!r.status||r.moves.some(m=>m.pp<m.maxPP);case'ppRecovery':return r.moves.some(m=>m.pp<m.maxPP);case'ppMoveRecovery':return move===undefined?r.moves.some(m=>m.pp<m.maxPP):!!r.moves[move]&&r.moves[move].pp<r.moves[move].maxPP;case'statusCure':return r.hp>0&&!!r.status;default:return r.hp<maxHP;}}
export function applyShop(item:ShopItem,r:Resource,maxHP:number,move?:number){if(!needs(item,r,maxHP,move))return;const fainted=r.hp===0;if(item==='fullRecovery')r.hp=maxHP;else if(['heal20','heal40','teamHeal30'].includes(item))r.hp=Math.min(maxHP,r.hp+Math.max(1,Math.floor(maxHP*(item==='heal20'?.2:item==='heal40'?.4:.5))));else if(item==='ppMoveRecovery'&&move!==undefined)r.moves[move].pp=r.moves[move].maxPP;
 if(item==='fullRecovery'||item==='statusCure'||fainted&&r.hp>0){r.status='';delete r.sleepStart;delete r.sleepRemaining;}if(item==='fullRecovery'||item==='ppRecovery')for(const m of r.moves)m.pp=m.maxPP;
}
export function victoryCash(index:number,mode='singles'){return mode==='singles'?(index<16?10:index<24?30:index<26?50:0):(index<8?10:index<12?30:index===12?50:0);}
export interface ChallengeProgress{stage:'preparation'|'battling'|'reward'|'intermission'|'lost'|'cleared';points:number;purchases:Partial<Record<ShopItem,number>>;team:Member[];resources:Resource[];buffs:TeamBuff[];initialBuffs:TeamBuff[];roll?:BuffKind;retired:string[];victories:number[];champion?:{recipientID?:string;claimed:boolean}}
