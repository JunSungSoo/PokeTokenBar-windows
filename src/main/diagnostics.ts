import{appendFileSync,mkdirSync,renameSync,statSync,existsSync,unlinkSync,writeFileSync}from'node:fs';import{join}from'node:path';
export function installDiagnostics(directory:string){
 mkdirSync(directory,{recursive:true});const log=join(directory,'PokeTokenBar.log'),marker=join(directory,'running');
 const write=(...values:unknown[])=>{try{if(existsSync(log)&&statSync(log).size>2*1024*1024){try{unlinkSync(log+'.1');}catch{}renameSync(log,log+'.1');}appendFileSync(log,new Date().toISOString()+' '+values.map(v=>v instanceof Error?v.stack:typeof v==='string'?v:JSON.stringify(v)).join(' ')+'\n');}catch{}};
 if(existsSync(marker))write('Previous session did not exit cleanly.');writeFileSync(marker,String(process.pid));write('Application started.');
 const original=console.error;console.error=(...values)=>{write(...values);original(...values);};process.on('uncaughtExceptionMonitor',error=>write('Uncaught exception',error));
 return{log,write,clean:()=>{write('Clean shutdown.');try{unlinkSync(marker);}catch{}}};
}
