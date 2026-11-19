import{app,BrowserWindow}from'electron';import{readFile,readdir,mkdir,copyFile}from'node:fs/promises';import{join}from'node:path';import{randomUUID}from'node:crypto';import{spawn}from'node:child_process';
import{newerVersion,releaseVersion}from'../shared/release-version.js';import{executableIdentity,sameExecutable,type ExecutableIdentity}from'./instance-identity.js';import{instanceNative,type NativeOwner}from'./instance-native.js';import{writeSaveAtomically}from'./companion/store.js';
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
export class InstanceHandoff {
 readonly nonce=randomUUID();private prepare?:()=>Promise<void>;private prepared:Promise<void>;private ready!:()=>void;private busy=false;
 private previous:ExecutableIdentity[]=[];
 private legacyPetEnabled?:boolean;
 constructor(private profile:string,private normal:(argv:string[])=>void,private log:(...values:unknown[])=>void=console.error){this.prepared=new Promise(r=>this.ready=r);}
 setReady(prepare:()=>Promise<void>){this.prepare=prepare;this.ready();}
 private payload(){return{ptbInstance:1,version:app.getVersion(),exe:process.execPath,pid:process.pid,nonce:this.nonce};}
 private receipt(nonce:string){return join(this.profile,'handoff-'+nonce+'.json');}
 private async owner(){return instanceNative<NativeOwner|null>({action:'owner',profile:this.profile},app.isPackaged);}
 private async gained(){
  // The original 1.0.0 treats closing its pet window as disabling it, including on shutdown.
  // Restore that preference only after the previous process has stopped writing the profile.
  if(this.legacyPetEnabled!==undefined){const path=join(this.profile,'settings-v1.json');try{const settings=JSON.parse(await readFile(path,'utf8'));settings.petEnabled=this.legacyPetEnabled;await writeSaveAtomically(path,JSON.stringify(settings));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  return true;
 }
 async acquire():Promise<boolean>{
  let owner=await this.owner();
  const record=join(this.profile,'active-app-v1.json');
  let registered:ExecutableIdentity|undefined;
  try{const active=JSON.parse(await readFile(record,'utf8'));registered=await executableIdentity(active.exe);}catch{}
  if(registered&&newerVersion(registered.version,app.getVersion())){
   if(owner&&sameExecutable(owner.exe,registered.exe)){
    if(!app.requestSingleInstanceLock(this.payload()))return false;
    app.releaseSingleInstanceLock();
   }
   await new Promise<void>((resolve,reject)=>{const next=spawn(registered!.exe,process.argv.slice(1),{detached:true,stdio:'ignore',windowsHide:true});next.once('spawn',()=>{next.unref();resolve();});next.once('error',reject);});
   return false;
  }
  if(registered)this.previous.push(registered);
  app.on('second-instance',(_event,argv,_cwd,data)=>{void this.receive(argv,data).catch(error=>this.log('Version handoff failed:',error));});
  // Avoid sending repeated requests to the old app: keep the successor alive until the owner exits.
  const initial=owner?await executableIdentity(owner.exe):undefined;
  if(initial&&!initial.cooperative&&newerVersion(app.getVersion(),initial.version))app.commandLine.removeSwitch('login-start');
  if(app.requestSingleInstanceLock(this.payload()))return this.gained();
  if(!owner)owner=await this.owner();
  const identity=initial??(owner?await executableIdentity(owner.exe):undefined);
  if(!owner||!identity||!newerVersion(app.getVersion(),identity.version))return false;
  this.previous.push(identity);
  if(!identity.cooperative){
   try{const settings=JSON.parse(await readFile(join(this.profile,'settings-v1.json'),'utf8'));if(typeof settings.petEnabled==='boolean')this.legacyPetEnabled=settings.petEnabled;}catch{}
   const directory=join(this.profile,'upgrade-backups',Date.now()+'-'+identity.version+'-'+this.nonce);await mkdir(directory,{recursive:true});
   for(const name of await readdir(this.profile))if(/^[a-z0-9][a-z0-9.-]*\.json$/i.test(name)){try{await copyFile(join(this.profile,name),join(directory,name));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
   this.log('Requesting legacy app shutdown',identity.version,owner.pid);await instanceNative({action:'close',profile:this.profile,...owner},app.isPackaged);
  }
  const until=Date.now()+120000;
  while(Date.now()<until){
   try{const response=JSON.parse(await readFile(this.receipt(this.nonce),'utf8'));if(response.error)throw Error(response.error);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(!alive(owner.pid)){
    if(app.requestSingleInstanceLock(this.payload()))return this.gained();
    const next=await this.owner();if(!next)return false;const other=await executableIdentity(next.exe);if(!other||!newerVersion(app.getVersion(),other.version))return false;owner=next;
   }
   await delay(150);
  }
  throw Error('기존 앱이 저장을 마치고 종료하지 못했습니다. 잠시 후 다시 실행해 주세요.');
 }
 private async receive(argv:string[],raw:unknown){
  const data=raw as Partial<ReturnType<InstanceHandoff['payload']>>;
  if(data?.ptbInstance!==1){this.normal(argv);return;}
  if(!Number.isInteger(data.pid)||!data.pid||typeof data.nonce!=='string'||!/^[0-9a-f-]{36}$/i.test(data.nonce)||typeof data.version!=='string'||!releaseVersion(data.version)){return;}
  if(!newerVersion(data.version,app.getVersion())){this.normal(argv);return;}
  const candidate=await executableIdentity(data.exe),native=await instanceNative<NativeOwner|null>({action:'process',pid:data.pid},app.isPackaged);
  if(!candidate||candidate.version!==data.version||!native||!sameExecutable(candidate.exe,native.exe))return;
  if(this.busy)return;this.busy=true;await this.prepared;
  const windows=BrowserWindow.getAllWindows().filter(w=>w.isEnabled());windows.forEach(w=>w.setEnabled(false));
  try{await this.prepare!();if(!alive(data.pid)){this.log('Successor exited during save; restoring current app');app.relaunch();app.quit();return;}await writeSaveAtomically(this.receipt(data.nonce),JSON.stringify({accepted:true,version:data.version}));this.log('Version handoff prepared',app.getVersion(),data.version);app.quit();}
  catch(error){this.busy=false;for(const window of windows)if(!window.isDestroyed())window.setEnabled(true);await writeSaveAtomically(this.receipt(data.nonce),JSON.stringify({error:error instanceof Error?error.message:String(error)}));}
 }
 previousExecutables(){return this.previous.map(identity=>identity.exe);}
 async activate(){await writeSaveAtomically(join(this.profile,'active-app-v1.json'),JSON.stringify({exe:process.execPath,version:app.getVersion(),pid:process.pid,protocol:1}));}
}
