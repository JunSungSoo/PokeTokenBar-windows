import type {LimitResult} from './usage.js';
import {forecast} from './quota-presentation.js';

export function trackedClaudeAccount(results:readonly LimitResult[],mode='automatic'):LimitResult|undefined{
 const loaded=results.filter(row=>row.provider==='claude'&&row.windows.length>0);
 const automatic=()=>loaded.reduce<LimitResult|undefined>((best,row)=>!best||(row.lastActivityAt??-Infinity)>(best.lastActivityAt??-Infinity)?row:best,undefined);
 if(mode==='highest')return loaded.reduce<LimitResult|undefined>((best,row)=>!best||Math.max(...row.windows.map(w=>w.usedPercent))>Math.max(...best.windows.map(w=>w.usedPercent))?row:best,undefined);
 if(mode==='defaultAccount')return loaded.find(row=>row.accountID==='claude-default')??automatic();
 return loaded.find(row=>row.accountID===mode)??automatic();
}
export function trackedLimits(results:readonly LimitResult[],mode='automatic'):LimitResult[]{
 const claude=trackedClaudeAccount(results,mode);return results.filter(row=>row.provider!=='claude'||row===claude);
}
export function limitWarning(results:readonly LimitResult[],critical:number,mode='automatic',now=Date.now()):boolean{
 const claude=trackedClaudeAccount(results,mode);
 for(const row of trackedLimits(results,mode))if(['claude','codex','antigravity'].includes(row.provider)&&row.status==='available'&&row.windows.some(w=>w.usedPercent>=critical))return true;
 const window=claude?.windows.find(w=>w.forecastEligible);
 return !!window&&forecast(claude?.block,window.usedPercent,window.resetsAt,now)?.beforeReset===true;
}
export function preserveLimits(previous:readonly LimitResult[],next:readonly LimitResult[]):LimitResult[]{
 return next.map(row=>{const old=previous.find(old=>old.provider===row.provider&&old.accountID===row.accountID);
  return row.status==='failed'&&old?.windows.length?{...old,...row,status:'available',windows:old.windows,checkedAt:old.checkedAt,stale:true}:row;});
}
