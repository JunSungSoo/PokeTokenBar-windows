import{readFile,realpath,readdir}from'node:fs/promises';import{homedir}from'node:os';import{join,resolve}from'node:path';import{createHash}from'node:crypto';
import{object,jsonl,timestamp}from'./jsonl.js';import type{Entry}from'./entries.js';import type{LimitResult}from'../../shared/usage.js';
import{activeBlock,accountBlocks,accountOwner,type PromptAccount}from'../../shared/quota-presentation.js';
import {price} from './pricing.js';
export interface ClaudeAccountSource{id:string;roots:string[];isDefault:boolean;identity?:string}
export function defaultClaudeRoots(home=homedir()){return [...new Set([...(process.env.CLAUDE_CONFIG_DIR??'').split(/[,\r\n]/).map(s=>s.trim()).filter(Boolean),join(home,'.claude'),join(home,'.config','claude')])];}
export async function discoveredClaudeRoots(home=homedir(),config=process.env.CLAUDE_CONFIG_DIR??''){
 const roots=config.split(/[,\r\n]/).map(s=>s.trim()).filter(Boolean).map(p=>p.startsWith('~')?join(home,p.slice(1)):p);
 for(const name of (await readdir(home)).sort())if(/^\.claude[-_]/.test(name))try{const root=join(home,name),raw=JSON.parse(await readFile(join(root,'.claude.json'),'utf8'));if(object(raw.oauthAccount))roots.push(root);}catch{}
 return [...new Set(roots)];
}
async function savedIdentity(root:string,home=homedir()){try{const file=root===join(home,'.claude')?join(home,'.claude.json'):join(root,'.claude.json');const account=object(object(JSON.parse(await readFile(file,'utf8')))?.oauthAccount);if(typeof account?.emailAddress==='string'&&account.emailAddress)return account.emailAddress+'\n'+(typeof account.organizationName==='string'?account.organizationName:'');}catch{}return undefined;}
export async function claudeAccountSources(extra:string[],home=homedir()):Promise<ClaudeAccountSource[]>{
 const defaults=defaultClaudeRoots(home),discovered=await discoveredClaudeRoots(home);let primary=defaults[0];for(const root of defaults){try{const oauth=object(object(JSON.parse(await readFile(join(root,'.credentials.json'),'utf8')))?.claudeAiOauth);if(typeof oauth?.accessToken==='string'&&oauth.accessToken&&(!(typeof oauth.expiresAt==='number')||oauth.expiresAt>Date.now())){primary=root;break;}}catch{}}
 const canonical=async(root:string)=>{const path=await realpath(root).catch(()=>resolve(root));return process.platform==='win32'?path.toLowerCase():path;};
 const mainIdentity=await savedIdentity(primary,home),sources:ClaudeAccountSource[]=[{id:'claude-default',roots:[primary],isDefault:true,identity:mainIdentity}],seen=new Set<string>([await canonical(primary)]);
 // Default-folder aliases share the primary account only when their identity agrees (or no identity is available).
 for(const root of defaults.filter(p=>p!==primary)){const key=await canonical(root);if(seen.has(key))continue;const identity=await savedIdentity(root,home);if(!identity||identity===mainIdentity){sources[0].roots.push(root);seen.add(key);}}
 for(const root of [...defaults,...discovered,...extra]){const key=await canonical(root);if(seen.has(key))continue;seen.add(key);const identity=await savedIdentity(root,home),prior=identity?sources.find(row=>row.identity===identity):undefined;if(prior){prior.roots.push(root);continue;}sources.push({id:'claude-'+createHash('sha256').update(key).digest('hex').slice(0,16),roots:[root],isDefault:false,identity});}
 return sources;
}
export async function promptAccounts(sources:ClaudeAccountSource[]):Promise<PromptAccount[]>{return Promise.all(sources.map(async source=>{const prompts:Record<string,number[]>={};for(const root of source.roots){try{for await(const row of jsonl(join(root,'history.jsonl'),line=>line.includes('"sessionId"'))){const session=row.sessionId;const time=typeof row.timestamp==='number'&&row.timestamp>0?row.timestamp:typeof row.timestamp==='string'?timestamp(row.timestamp):undefined;if(typeof session==='string'&&session&&time!==undefined)(prompts[session]??=[]).push(time);}}catch{}}for(const times of Object.values(prompts))times.sort((a,b)=>a-b);return{id:source.id,prompts};}));}
export async function withAccountBlocks(results:LimitResult[],entries:readonly Entry[],sources:ClaudeAccountSource[],now=Date.now()):Promise<LimitResult[]>{
 const claude=results.filter(row=>row.provider==='claude'),windows:Record<string,{reset?:number;notStarted?:boolean}>={};
 for(const row of claude){const window=row.windows.find(window=>window.forecastEligible);if(row.status==='available'&&window&&row.accountID){if(window.resetsAt!==undefined)windows[row.accountID]={reset:window.resetsAt};else if(window.notStarted)windows[row.accountID]={notStarted:true};}}
 const accounts=await promptAccounts(sources),blocks=claude.length>1?accountBlocks(entries,accounts,windows,now):{};
 const summaries:Record<string,NonNullable<LimitResult['accountUsage']>>={},activity:Record<string,number>={};
 const date=new Date(now),today=+new Date(date.getFullYear(),date.getMonth(),date.getDate()),month=+new Date(date.getFullYear(),date.getMonth(),1);
 for(const account of accounts)for(const times of Object.values(account.prompts))for(const time of times)if(time<=now)activity[account.id]=Math.max(activity[account.id]??0,time);
 const cost=()=>({amount:0,reported:false,estimated:false,unknown:false});
 for(const entry of entries){if(entry.time<month||entry.time>now)continue;const id=accountOwner(entry.claudeSessions??[],entry.time,accounts);if(!id)continue;
  const summary=summaries[id]??={todayTokens:0,monthTokens:0,todayCost:cost(),monthCost:cost()},value=price(entry);
  for(const period of ['month','today']as const){if(period==='today'&&entry.time<today)continue;summary[period+'Tokens' as 'todayTokens'|'monthTokens']+=entry.tokens.total;const total=summary[period+'Cost' as 'todayCost'|'monthCost'];if(value){total.amount+=value.amount;total[value.kind==='source'?'reported':'estimated']=true;}else if(entry.tokens.total>0)total.unknown=true;}
 }
 return results.map(row=>{const {block:old,...rest}=row;if(row.provider!=='claude')return rest;const block=claude.length>1?blocks[row.accountID??'']:activeBlock(entries,now);return{...rest,lastActivityAt:activity[row.accountID??''],accountUsage:summaries[row.accountID??''],...(block?{block}:{})};});
}
