import{readFile,realpath}from'node:fs/promises';import{homedir}from'node:os';import{join,resolve}from'node:path';import{createHash}from'node:crypto';
import{object,jsonl,timestamp}from'./jsonl.js';import type{Entry}from'./entries.js';import type{LimitResult}from'../../shared/usage.js';
import{activeBlock,accountBlocks,type PromptAccount}from'../../shared/quota-presentation.js';
export interface ClaudeAccountSource{id:string;roots:string[];isDefault:boolean;identity?:string}
export function defaultClaudeRoots(){return [...new Set([...(process.env.CLAUDE_CONFIG_DIR??'').split(',').map(s=>s.trim()).filter(Boolean),join(homedir(),'.claude'),join(homedir(),'.config','claude')])];}
async function savedIdentity(root:string){try{const account=object(object(JSON.parse(await readFile(join(root,'.claude.json'),'utf8')))?.oauthAccount);if(typeof account?.emailAddress==='string'&&account.emailAddress)return account.emailAddress+'\n'+(typeof account.organizationName==='string'?account.organizationName:'');}catch{}return undefined;}
export async function claudeAccountSources(extra:string[]):Promise<ClaudeAccountSource[]>{
 const defaults=defaultClaudeRoots();let primary=defaults[0];for(const root of defaults){try{const oauth=object(object(JSON.parse(await readFile(join(root,'.credentials.json'),'utf8')))?.claudeAiOauth);if(typeof oauth?.accessToken==='string'&&oauth.accessToken&&(!(typeof oauth.expiresAt==='number')||oauth.expiresAt>Date.now())){primary=root;break;}}catch{}}
 const canonical=async(root:string)=>{const path=await realpath(root).catch(()=>resolve(root));return process.platform==='win32'?path.toLowerCase():path;};
 const mainIdentity=await savedIdentity(primary),sources:ClaudeAccountSource[]=[{id:'claude-default',roots:[primary],isDefault:true,identity:mainIdentity}],seen=new Set<string>([await canonical(primary)]);
 // Default-folder aliases share the primary account only when their identity agrees (or no identity is available).
 for(const root of defaults.filter(p=>p!==primary)){const key=await canonical(root);if(seen.has(key))continue;const identity=await savedIdentity(root);if(!identity||identity===mainIdentity){sources[0].roots.push(root);seen.add(key);}}
 for(const root of [...defaults,...extra]){const key=await canonical(root);if(seen.has(key))continue;seen.add(key);const identity=await savedIdentity(root),prior=identity?sources.find(row=>row.identity===identity):undefined;if(prior){prior.roots.push(root);continue;}sources.push({id:'claude-'+createHash('sha256').update(key).digest('hex').slice(0,16),roots:[root],isDefault:false,identity});}
 return sources;
}
export async function promptAccounts(sources:ClaudeAccountSource[]):Promise<PromptAccount[]>{return Promise.all(sources.map(async source=>{const prompts:Record<string,number[]>={};for(const root of source.roots){try{for await(const row of jsonl(join(root,'history.jsonl'),line=>line.includes('"sessionId"'))){const session=row.sessionId;const time=typeof row.timestamp==='number'&&row.timestamp>0?row.timestamp:typeof row.timestamp==='string'?timestamp(row.timestamp):undefined;if(typeof session==='string'&&session&&time!==undefined)(prompts[session]??=[]).push(time);}}catch{}}for(const times of Object.values(prompts))times.sort((a,b)=>a-b);return{id:source.id,prompts};}));}
export async function withAccountBlocks(results:LimitResult[],entries:readonly Entry[],sources:ClaudeAccountSource[],now=Date.now()):Promise<LimitResult[]>{
 const claude=results.filter(row=>row.provider==='claude'),windows:Record<string,{reset?:number;notStarted?:boolean}>={};
 for(const row of claude){const window=row.windows.find(window=>window.forecastEligible);if(row.status==='available'&&window&&row.accountID){if(window.resetsAt!==undefined)windows[row.accountID]={reset:window.resetsAt};else if(window.notStarted)windows[row.accountID]={notStarted:true};}}
 const blocks=claude.length>1?accountBlocks(entries,await promptAccounts(sources),windows,now):{};
 return results.map(row=>{const {block:old,...rest}=row;if(row.provider!=='claude'||row.status!=='available')return rest;const block=claude.length>1?blocks[row.accountID??'']:activeBlock(entries,now);return{...rest,...(block?{block}:{})};});
}
