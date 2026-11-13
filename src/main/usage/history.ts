import {readFile}from'node:fs/promises';
import{cleanHistory,mergeHistory,type UsageHistory}from'../../shared/usage-recap.js';
import{writeSaveAtomically}from'../companion/store.js';
/** A derived, monotonic cache. Never used as growth input or exported as companion state. */
export class UsageHistoryStore {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private path:string){}
 async read():Promise<UsageHistory>{try{return cleanHistory(JSON.parse(await readFile(this.path,'utf8')));}catch(error){if(error instanceof SyntaxError||(error as NodeJS.ErrnoException).code==='ENOENT')return cleanHistory(null);throw error;}}
 merge(daily:Record<string,number>,now:Date):Promise<UsageHistory>{const result=this.queue.then(async()=>{const previous=await this.read(),next=mergeHistory(previous,daily,now);if(JSON.stringify(previous)!==JSON.stringify(next))await writeSaveAtomically(this.path,JSON.stringify(next));return next;});this.queue=result.catch(()=>{});return result;}
 finishWrites(){return this.queue;}
}
