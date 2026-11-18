import {readFile,rm,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SessionOrganization,SessionKeyState} from '../../shared/usage.js';
interface Credential {key:string;organizationID?:string}
interface Cipher {encrypt(value:string):Buffer;decrypt(value:Buffer):string}
export class LimitsError extends Error {constructor(public kind:'oauthExpired'|'sessionKeyExpired'|'rateLimited'|'network'|'unavailable',public status?:number){super({oauthExpired:'Claude Code 로그인 정보가 만료됐습니다.',sessionKeyExpired:'세션 키가 만료됐습니다. 브라우저에서 다시 복사해 붙여넣으세요.',rateLimited:'요청이 너무 많습니다. 잠시 후 다시 시도하세요.',network:'조회 실패',unavailable:'사용 가능한 한도 없음'}[kind]);}}
export function normalizeSessionKey(raw:string):string{
 const value=raw.trim();if(!value.startsWith('sk-ant-')||value.length<40||value.length>2048||/[\u0000-\u001f\u007f]/.test(value))throw new Error('세션 키 형식이 아닙니다. sessionKey 쿠키 값 전체를 붙여넣었는지 확인하세요(sk-ant- 로 시작).');return value;
}
export class SessionKeys {
 private queue:Promise<unknown>=Promise.resolve();private organizationsByAccount=new Map<string,SessionOrganization[]>();
 constructor(private directory:string,private cipher:Cipher,private request:typeof fetch=fetch){}
 private path(account:string){if(!/^claude-[a-z0-9-]{1,80}$/.test(account))throw new Error('Invalid account');return join(this.directory,account+'.bin');}
 private async credential(account:string):Promise<Credential|undefined>{try{return JSON.parse(this.cipher.decrypt(await readFile(this.path(account))));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw new Error('저장된 세션 키를 읽을 수 없습니다.');}}
 async state(account:string):Promise<SessionKeyState>{await this.queue;const saved=await this.credential(account);return{configured:!!saved,organizationID:saved?.organizationID,organizations:this.organizationsByAccount.get(account)??[]};}
 private async persist(account:string,value:Credential){await mkdir(this.directory,{recursive:true});const path=this.path(account),temporary=path+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,this.cipher.encrypt(JSON.stringify(value)),{flag:'wx',mode:0o600});await rename(temporary,path);}finally{await rm(temporary,{force:true});}}
 async save(account:string,key:string,organizationID?:string){const value={key:normalizeSessionKey(key),organizationID};const next=this.queue.then(()=>this.persist(account,value));this.queue=next.catch(()=>{});await next;}
 async clear(account:string){const next=this.queue.then(async()=>{await rm(this.path(account),{force:true});this.organizationsByAccount.delete(account);});this.queue=next.catch(()=>{});await next;}
 private async remember(account:string,saved:Credential,organizationID:string|undefined,organizations:SessionOrganization[],select=true){
  const next=this.queue.then(async()=>{const current=await this.credential(account);if(current?.key!==saved.key||current?.organizationID!==saved.organizationID)return;
   if(select)await this.persist(account,{...saved,organizationID});this.organizationsByAccount.set(account,organizations);
  });this.queue=next.catch(()=>{});await next;
 }
 private async get(path:string,key:string){const response=await this.request('https://claude.ai/api/'+path,{headers:{Cookie:'sessionKey='+key,Accept:'application/json',Origin:'https://claude.ai',Referer:'https://claude.ai/', 'User-Agent':'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new LimitsError(response.status===401||response.status===403&&path==='organizations'?'sessionKeyExpired':response.status===429?'rateLimited':'network',response.status);}return response.json();}
 private async discover(account:string,saved:Credential,select=true){
  const rows=await this.get('organizations',saved.key) as {uuid:string;name?:string;capabilities?:string[]}[];
  if(!Array.isArray(rows))throw new LimitsError('network');const candidates=rows.filter(row=>row.capabilities?.includes('chat')??true),pool=candidates.length?candidates:rows;
  const results=await Promise.all(pool.map(async row=>{if(typeof row.uuid!=='string'||row.uuid.length>256)return;try{return{row,data:await this.get('organizations/'+encodeURIComponent(row.uuid)+'/usage',saved.key)};}catch(error){if(error instanceof LimitsError&&error.status!==401&&error.status!==429)return;throw error;}}));
  const usable=results.filter(row=>row!==undefined),organizations=usable.map(({row})=>({id:row.uuid,name:row.name??row.uuid}));
  if(!select){await this.remember(account,saved,saved.organizationID,organizations,false);return;}
  const hasUsage=(data:unknown)=>{if(!data||typeof data!=='object')return false;return Object.values(data).some(value=>value&&typeof value==='object'&&(Number((value as {utilization?:number}).utilization)>0||!!(value as {resets_at?:string}).resets_at));};
  const picked=usable.find(({data})=>hasUsage(data))??usable[0];if(!picked)throw new LimitsError(rows.length?'sessionKeyExpired':'unavailable');await this.remember(account,saved,picked.row.uuid,organizations);return picked.data;
 }
 async usage(account:string):Promise<unknown|undefined>{await this.queue;const saved=await this.credential(account);if(!saved)return;
  if(saved.organizationID)try{return await this.get('organizations/'+encodeURIComponent(saved.organizationID)+'/usage',saved.key);}catch(error){if(!(error instanceof LimitsError&&error.status===403))throw error;}
  return this.discover(account,saved);
 }
 async organizations(account:string):Promise<SessionKeyState>{await this.queue;const saved=await this.credential(account);if(saved)await this.discover(account,saved,false);return this.state(account);}
 async select(account:string,id:string){await this.queue;const saved=await this.credential(account);if(!saved||!(this.organizationsByAccount.get(account)??[]).some(row=>row.id===id))throw new Error('조직을 선택해 주세요.');await this.save(account,saved.key,id);}
}
