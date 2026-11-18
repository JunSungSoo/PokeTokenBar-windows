import{readdir,stat,realpath}from'node:fs/promises';import{homedir}from'node:os';import{isAbsolute,join,parse,resolve,sep}from'node:path';
export async function expandScanRoots(raw:string,home=homedir()):Promise<string[]>{
 const result:string[]=[],seen=new Set<string>();
 for(const text of raw.split(/[,\r\n]/).map(s=>s.trim()).filter(Boolean)){
  const value=text==='~'?home:text.startsWith('~/')||text.startsWith('~\\')?join(home,text.slice(2)):text;if(!isAbsolute(value))continue;
  const absolute=resolve(value),root=parse(absolute).root,parts=absolute.slice(root.length).split(sep);let paths=[root];
  for(const part of parts){const next:string[]=[];for(const path of paths){if(!/[?*]/.test(part)){next.push(join(path,part));continue;}const expression=new RegExp('^'+part.split('').map(c=>c==='*'?'.*':c==='?'?'.':c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$',process.platform==='win32'?'i':'');for(const entry of await readdir(path,{withFileTypes:true}).catch(()=>[]))if(entry.isDirectory()&&expression.test(entry.name))next.push(join(path,entry.name));}paths=next;}
  for(const path of paths)try{if(!(await stat(path)).isDirectory())continue;const canonical=await realpath(path),key=process.platform==='win32'?canonical.toLowerCase():canonical;if(!seen.has(key)){seen.add(key);result.push(canonical);}}catch{}
 }return result;
}
