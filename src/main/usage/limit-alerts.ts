import type {LimitResult} from '../../shared/usage.js';
export interface AlertLedger {[key:string]:{tier:number;reset?:number}}
export interface LimitAlertDetail {provider:LimitResult['provider'];account?:string;label:string;percent:number;tier:number}
export function limitAlertDetails(results:LimitResult[],ledger:AlertLedger,warn:number,critical:number):LimitAlertDetail[]{
 const notices:LimitAlertDetail[]=[];
 for(const result of results){if(result.status!=='available')continue;const occurrences=new Map<string,number>();
  for(const window of result.windows){const occurrence=occurrences.get(window.label)??0;occurrences.set(window.label,occurrence+1);
   const key=result.provider+':'+(result.accountID??result.account??'')+':'+window.label+(occurrence?':'+occurrence:''),old=ledger[key];
   const tier=window.usedPercent>=critical?2:window.usedPercent>=warn?1:0,weekly=/주간|weekly/i.test(window.label);
   const newWindow=old?.reset!==undefined&&window.resetsAt!==undefined&&window.resetsAt-old.reset>=(weekly?86400000:1800000);
   if(tier>(newWindow?0:old?.tier??0))notices.push({provider:result.provider,account:result.account,label:window.label,percent:window.usedPercent,tier});
   ledger[key]={tier,reset:window.resetsAt??old?.reset};
  }
 }return notices;
}
export function limitAlerts(results:LimitResult[],ledger:AlertLedger,warn:number,critical:number):string[]{
 return limitAlertDetails(results,ledger,warn,critical).map(row=>row.provider+(row.account?' '+row.account:'')+' · '+row.label+' · '+row.percent.toFixed(0)+'% 사용');
}
