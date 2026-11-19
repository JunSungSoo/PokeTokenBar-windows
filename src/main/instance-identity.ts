import{readFile,stat}from'node:fs/promises';import{basename,dirname,isAbsolute,join,resolve}from'node:path';
import{releaseVersion}from'../shared/release-version.js';
export interface ExecutableIdentity {exe:string;version:string;cooperative:boolean}
export const sameExecutable=(a:string,b:string)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
export async function executableIdentity(exe:unknown):Promise<ExecutableIdentity|undefined>{
 if(typeof exe!=='string'||exe.length>32768||!isAbsolute(exe)||basename(exe).toLowerCase()!=='poketokenbar.exe')return;
 try{if(!(await stat(exe)).isFile())return;const bytes=await readFile(join(dirname(exe),'resources','app.asar','package.json'));if(bytes.length>65536)return;const metadata=JSON.parse(bytes.toString('utf8')),version=typeof metadata.version==='string'?releaseVersion(metadata.version):undefined;if(metadata.name!=='poketokenbar-windows'||metadata.main!=='dist/main/index.js'||!version)return;return{exe:resolve(exe),version,cooperative:metadata.instanceHandoff===1};}catch{return;}
}
