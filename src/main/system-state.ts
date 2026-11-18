import {app,powerMonitor}from'electron';import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';
let saver=false;export const systemPowerSaver=()=>saver;
export function observeSystemState(notify:(kind:'display'|'saver'|'network',enabled:boolean)=>void){
 const callback=(kind:'display'|'saver'|'network',enabled:boolean)=>{if(kind==='saver')saver=enabled;notify(kind,enabled);};
 powerMonitor.on('suspend',()=>callback('display',false));powerMonitor.on('resume',()=>callback('display',true));powerMonitor.on('lock-screen',()=>callback('display',false));powerMonitor.on('unlock-screen',()=>callback('display',true));
 if(process.platform!=='win32')return;
 const bundled=fileURLToPath(new URL('./power-monitor.ps1',import.meta.url)),script=app.isPackaged?bundled.replace(/\.asar([\\/])/i,'.asar.unpacked$1'):bundled;
 const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-ParentProcessId',String(process.pid)],{windowsHide:true,stdio:['ignore','pipe','pipe']});let pending='';
 child.stdout.on('data',chunk=>{pending+=chunk.toString();const lines=pending.split(/\r?\n/);pending=lines.pop()??'';for(const line of lines){const match=/^(display|saver|network):(on|off)$/.exec(line.trim());if(match)callback(match[1] as 'display'|'saver'|'network',match[2]==='on');}});
 child.on('error',error=>console.error('Power event bridge:',error));child.stderr.on('data',chunk=>console.error('Power event bridge:',chunk.toString().slice(0,1000)));app.once('will-quit',()=>child.kill());
}
