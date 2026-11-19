import{app,shell}from'electron';import{readdir}from'node:fs/promises';import{dirname,join}from'node:path';
import{instanceNative}from'./instance-native.js';import{executableIdentity,sameExecutable}from'./instance-identity.js';import{newerVersion}from'../shared/release-version.js';import{windowsAppID}from'../shared/windows.js';
export async function migrateLaunchAssociations(exe:string,version:string,previous:string[],options:{registryBase?:string;folders?:string[];protocol?:()=>boolean;native?:typeof instanceNative}={}){
 const native=options.native??instanceNative,old=new Set(previous),rows=await native<{name:string;exe?:string}[]>({action:'run',registryBase:options.registryBase},app.isPackaged);
 for(const row of rows??[]){if(!row.exe)continue;const identity=await executableIdentity(row.exe);if(identity&&!newerVersion(identity.version,version))old.add(identity.exe);}
 const folders=options.folders??[app.getPath('desktop'),join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs'),...['TaskBar','StartMenu'].map(folder=>join(app.getPath('appData'),'Microsoft','Internet Explorer','Quick Launch','User Pinned',folder))],shortcuts:string[]=[];
 async function walk(folder:string,depth=0):Promise<void>{if(depth>5||shortcuts.length>=2000)return;try{for(const entry of await readdir(folder,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const path=join(folder,entry.name);if(entry.isDirectory())await walk(path,depth+1);else if(entry.isFile()&&entry.name.toLowerCase().endsWith('.lnk'))shortcuts.push(path);}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 for(const folder of folders)await walk(folder);
 let links=0;
 for(const path of shortcuts){let link:Electron.ShortcutDetails;try{link=shell.readShortcutLink(path);}catch{continue;}const identity=await executableIdentity(link.target);if(!identity||newerVersion(identity.version,version)||sameExecutable(link.target,exe))continue;old.add(identity.exe);const options:Electron.ShortcutDetails={...link,target:exe,appUserModelId:windowsAppID};if(!link.icon||sameExecutable(link.icon,link.target))options.icon=exe;if(!link.cwd||sameExecutable(link.cwd,dirname(link.target)))options.cwd=dirname(exe);if(!shell.writeShortcutLink(path,'update',options))throw Error('앱 바로가기를 새 버전으로 갱신하지 못했습니다.');links++;}
 const run=await native<{changed:string[]}>({action:'migrate-run',exe,oldExecutables:[...old],registryBase:options.registryBase},app.isPackaged);
 if(!(options.protocol??(()=>app.setAsDefaultProtocolClient('poketokenbar')))())throw Error('앱 프로토콜을 새 버전에 연결하지 못했습니다.');
 return{shortcuts:links,runEntries:run.changed.length};
}
