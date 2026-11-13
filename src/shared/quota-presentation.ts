export interface UsageBlock {totalTokens:number;tokensPerMinute:number;startTime:number;endTime:number}
export interface AttributionEntry {time:number;tokens:{total:number};claudeSessions?:string[]}
export interface PromptAccount {id:string;prompts:Record<string,number[]>}
export function paceFraction(reset:number|undefined,spanSeconds:number|undefined,now:number):number|null{
 if(reset===undefined||spanSeconds===undefined||spanSeconds<=0)return null;
 const value=(spanSeconds-(reset-now)/1000)/spanSeconds;return Number.isFinite(value)&&value>=0&&value<=1?value:null;
}
export function displayPercent(used:number,remaining:boolean):number{return remaining?Math.max(0,100-used):used;}
export function roundedPaceDelta(used:number,pace:number):number{const value=used-pace*100;return Math.sign(value)*Math.floor(Math.abs(value)+.5);}
export function paceTier(used:number,pace:number|null,critical:number):number|null{
 if(pace===null||pace<.1)return null;if(used>=critical)return 5;const delta=roundedPaceDelta(used,pace);return delta< -25?0:delta< -10?1:delta<5?2:delta<15?3:delta<30?4:5;
}
export function gaugeTier(used:number,pace:number|null,warn:number,critical:number):number{return paceTier(used,pace,critical)??(used>=critical?5:used>=warn?4:2);}
export function forecastDepletion(blockTokens:number,tokensPerMinute:number,used:number,now:number):number|null{
 if(!(used>=5&&used<100&&blockTokens>0&&tokensPerMinute>=10000))return null;
 const minutes=(100-used)*(blockTokens/used)/tokensPerMinute;return Number.isFinite(minutes)&&minutes<1440?now+minutes*60000:null;
}
export function forecast(block:UsageBlock|undefined,used:number,reset:number|undefined,now:number):{at:number;beforeReset:boolean}|null{
 if(reset===undefined)return null;if(used>=100)return{at:now,beforeReset:true};if(!block)return null;
 const at=forecastDepletion(block.totalTokens,block.tokensPerMinute,used,now);return at===null?null:{at,beforeReset:at<reset};
}
export function activeBlock(entries:readonly AttributionEntry[],now:number,reset?:number):UsageBlock|undefined{
 if(reset!==undefined&&reset<=now)return;
 const start=Math.max(now-18000000,reset===undefined?-Infinity:reset-18000000),recent=entries.filter(e=>e.time>=start&&e.tokens.total>0).sort((a,b)=>a.time-b.time);
 const first=recent[0];if(!first)return;const totalTokens=recent.reduce((sum,e)=>sum+e.tokens.total,0);
 return{totalTokens,tokensPerMinute:totalTokens/Math.max(1,(now-first.time)/60000),startTime:first.time,endTime:reset??first.time+18000000};
}
export function accountOwner(sessions:readonly string[],at:number,accounts:readonly PromptAccount[]):string|undefined{
 let latest:{id:string;time:number}|undefined,earliest:{id:string;time:number}|undefined;
 for(const account of accounts)for(const session of [...new Set(sessions)].sort()){
  const times=account.prompts[session];if(!times?.length)continue;const before=[...times].reverse().find(time=>time<=at);
  if(before!==undefined&&(!latest||before>latest.time))latest={id:account.id,time:before};
  if(!earliest||times[0]<earliest.time)earliest={id:account.id,time:times[0]};
 }return latest?.id??earliest?.id;
}
export function accountBlocks(entries:readonly AttributionEntry[],accounts:readonly PromptAccount[],windows:Record<string,{reset?:number;notStarted?:boolean}>,now:number):Record<string,UsageBlock>{
 const grouped:Record<string,AttributionEntry[]>={},out:Record<string,UsageBlock>={};
 for(const entry of entries){if(entry.time<now-18000000)continue;const id=accountOwner(entry.claudeSessions??[],entry.time,accounts);if(id)(grouped[id]??=[]).push(entry);}
 for(const [id,turns]of Object.entries(grouped)){const window=windows[id];if(window?.notStarted)continue;const block=activeBlock(turns,now,window?.reset);if(block)out[id]=block;}return out;
}
