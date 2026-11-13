/** Local calendar keys are independent of the machine's UTC offset. */
export interface UsageHistory {version:1;tokensByDay:Record<string,number>;coveredSince?:string}
export type RecapScope='week'|'month'|'year';
export function dayKey(date:Date):string{return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
export function dayDate(key:string):Date {const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d);}
export function validDay(key:string):boolean{return /^\d{4}-\d{2}-\d{2}$/.test(key)&&dayKey(dayDate(key))===key;}
export function stepDay(date:Date,count:number):Date{const result=new Date(date);result.setDate(result.getDate()+count);return result;}
export function cleanHistory(raw:unknown):UsageHistory{
 const row=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 const tokensByDay=Object.fromEntries(Object.entries(row.tokensByDay&&typeof row.tokensByDay==='object'?row.tokensByDay:{}).filter(([key,n])=>validDay(key)&&typeof n==='number'&&Number.isSafeInteger(n)&&n>0));
 return {version:1,tokensByDay, ...(typeof row.coveredSince==='string'&&validDay(row.coveredSince)?{coveredSince:row.coveredSince}:{})};
}
export function mergeHistory(previous:UsageHistory,daily:Record<string,number>,now:Date):UsageHistory{
 const next=cleanHistory(previous),cutoff=String(now.getFullYear()-1)+'-01-01',first=dayKey(new Date(now.getFullYear(),now.getMonth(),1)),today=dayKey(now);
 for(const [raw,n]of Object.entries(daily)){const key=/^\d+$/.test(raw)?new Date(Number(raw)).toISOString().slice(0,10):raw;
  if(validDay(key)&&key>=first&&key<=today&&Number.isSafeInteger(n)&&n>0)next.tokensByDay[key]=Math.max(next.tokensByDay[key]??0,n);
 }
 next.coveredSince=next.coveredSince&&next.coveredSince<first?next.coveredSince:first;
 if(next.coveredSince<cutoff)next.coveredSince=cutoff;
 next.tokensByDay=Object.fromEntries(Object.entries(next.tokensByDay).filter(([key])=>key>=cutoff&&key<=today));return next;
}
export function currentStreak(history:UsageHistory,now:Date){let cursor=new Date(now.getFullYear(),now.getMonth(),now.getDate()),days=0;const includesToday=(history.tokensByDay[dayKey(cursor)]??0)>0;if(!includesToday)cursor=stepDay(cursor,-1);while((history.tokensByDay[dayKey(cursor)]??0)>0){days++;cursor=stepDay(cursor,-1);}return{days,includesToday};}
export function recapPeriod(scope:RecapScope,now:Date,offset=0,firstWeekday=1){
 let start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 if(scope==='week'){start=stepDay(start,-((start.getDay()-firstWeekday+7)%7)+offset*7);return{start,end:stepDay(start,7)};}
 if(scope==='month'){start=new Date(start.getFullYear(),start.getMonth()+offset,1);return{start,end:new Date(start.getFullYear(),start.getMonth()+1,1)};}
 start=new Date(start.getFullYear()+offset,0,1);return{start,end:new Date(start.getFullYear()+1,0,1)};
}
export function makeRecap(history:UsageHistory,scope:RecapScope,now:Date,offset=0,firstWeekday=1){
 const period=recapPeriod(scope,now,offset,firstWeekday),previous=recapPeriod(scope,now,offset-1,firstWeekday),today=dayKey(now);
 const dates=(start:Date,end:Date)=>{const days:string[]=[];for(let d=start;d<end;d=stepDay(d,1))days.push(dayKey(d));return days;};
 const keys=dates(period.start,period.end),elapsed=keys.filter(key=>key<=today),known=(key:string)=>(history.tokensByDay[key]??0)>0||!!history.coveredSince&&key>=history.coveredSince;
 const sum=(keys:string[])=>keys.reduce((sum,key)=>sum+(history.tokensByDay[key]??0),0),inProgress=dayKey(period.start)<=today&&today<dayKey(period.end);
 const previousKeys=dates(previous.start,previous.end),compared=inProgress?previousKeys.slice(0,elapsed.length):previousKeys;
 const previousTotal=history.coveredSince&&compared[0]>=history.coveredSince?sum(compared):null;
 let bestStreak=0,run=0;for(const key of elapsed){run=history.tokensByDay[key]>0?run+1:0;bestStreak=Math.max(run,bestStreak);}
 const active=elapsed.filter(key=>history.tokensByDay[key]>0),bestKey=active.reduce<string|undefined>((best,key)=>!best||history.tokensByDay[key]>history.tokensByDay[best]?key:best,undefined);
 const buckets=scope==='year'?Array.from({length:12},(_,month)=>{const start=new Date(period.start.getFullYear(),month,1),end=new Date(start.getFullYear(),month+1,1),days=dates(start,end).filter(key=>key<=today);return{key:dayKey(start),tokens:sum(days),isCurrent:dayKey(start)<=today&&today<dayKey(end),hasData:days.some(known)};}):keys.map(key=>({key,tokens:history.tokensByDay[key]??0,isCurrent:key===today,hasData:key<=today&&known(key)}));
 const total=sum(elapsed);return{scope,start:dayKey(period.start),end:dayKey(period.end),buckets,total,inProgress,previousTotal,delta:previousTotal!==null&&previousTotal>0?(total-previousTotal)/previousTotal:null,bestDay:bestKey?{key:bestKey,tokens:history.tokensByDay[bestKey]}:null,activeDays:active.length,countedDays:elapsed.filter(known).length,bestStreak,canGoBack:!!history.coveredSince&&previousKeys.at(-1)!>=history.coveredSince};
}
