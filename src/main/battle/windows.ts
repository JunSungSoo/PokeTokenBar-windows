import {app,BrowserWindow,screen} from 'electron';
import {fileURLToPath} from 'node:url';
import type {ChallengeView} from '../../shared/battle.js';
export class BattleWindows {
  canClose?:()=>Promise<boolean>;
  changed?:()=>void;
  allowClose=false;
  kind:'challenge'|'lan'='challenge';
  main?:BrowserWindow;private extra=new Map<string,BrowserWindow>();
  constructor(private reveal=(window:BrowserWindow,focus=true)=>{window.show();if(focus)window.focus();}){}
  owns(frame:Electron.WebFrameMain|null):boolean{return this.all().some(window=>frame===window.webContents.mainFrame);}
  all():BrowserWindow[]{return [this.main,...this.extra.values()].filter((window):window is BrowserWindow=>!!window && !window.isDestroyed());}
  isMain(frame:Electron.WebFrameMain|null){return !!this.main && frame===this.main.webContents.mainFrame;}
  async open(kind:'challenge'|'lan'='challenge'){
    if(this.main && !this.main.isDestroyed()){if(this.kind!==kind)throw new Error('열려 있는 배틀 창을 먼저 닫아 주세요.');this.reveal(this.main);return;}
    this.kind=kind;
    const work=screen.getPrimaryDisplay().workArea;
    const window=new BrowserWindow({width:Math.min(660,work.width),height:Math.min(840,work.height-20),useContentSize:true,minWidth:Math.min(660,work.width),minHeight:440,show:false,autoHideMenuBar:true,title:'PokeTokenBar · '+(kind==='lan'?'배틀':'챌린지')+' · 싱글',
      webPreferences:{preload:fileURLToPath(new URL('../usage-preload.cjs',import.meta.url)),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
    this.main=window;this.changed?.();let checking=false,allowed=false;window.on('close',event=>{if(!allowed&&!this.allowClose&&this.canClose){event.preventDefault();if(checking)return;checking=true;void this.canClose().then(ok=>{allowed=ok;if(ok&&!window.isDestroyed())window.close();}).catch(error=>console.error('Battle close failed:',error)).finally(()=>{checking=false;});}});this.protect(window);window.on('closed',()=>{this.main=undefined;for(const extra of this.extra.values())extra.destroy();this.extra.clear();this.changed?.();});
    try{await window.loadFile(fileURLToPath(new URL('../../renderer/battle.html',import.meta.url)),{query:{kind}});this.reveal(window);}catch(error){window.destroy();throw error;}
  }
  async auxiliary(kind:'field'|'stats',visible=true){
    if(!visible){const window=this.extra.get(kind);this.extra.delete(kind);window?.destroy();return;}
    const existing=this.extra.get(kind);if(existing && !existing.isDestroyed()){this.reveal(existing);return;}
    if(!this.main || this.main.isDestroyed())throw new Error('배틀 창을 먼저 열어 주세요.');
    const anchor=this.main.getBounds(),work=screen.getDisplayMatching(anchor).workArea,width=Math.min(250,Math.max(200,(work.width-anchor.width-20)/2));
    const x=kind==='field'?anchor.x-width-10:anchor.x+anchor.width+10,height=Math.min(kind==='field'?400:640,work.height);
    const window=new BrowserWindow({x:Math.max(work.x,Math.min(x,work.x+work.width-width)),y:Math.max(work.y,Math.min(anchor.y,work.y+work.height-height)),width,height,minWidth:180,minHeight:240,useContentSize:true,show:false,autoHideMenuBar:true,title:kind==='field'?'배틀 필드':'배틀 능력치',
      webPreferences:{preload:fileURLToPath(new URL('../usage-preload.cjs',import.meta.url)),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    this.extra.set(kind,window);this.protect(window);window.on('closed',()=>{if(this.extra.get(kind)===window)this.extra.delete(kind);});
    try{await window.loadFile(fileURLToPath(new URL('../../renderer/battle.html',import.meta.url)),{query:{panel:kind,kind:this.kind}});if(!window.isDestroyed()&&this.extra.get(kind)===window)this.reveal(window,false);}catch(error){if(window.isDestroyed()||this.extra.get(kind)!==window)return;window.destroy();throw error;}
  }
  private protect(window:BrowserWindow){window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());}
  broadcast(value:ChallengeView){for(const window of this.all())window.webContents.send('battle:state-changed',value);}
  lan(value:unknown){for(const window of this.all())window.webContents.send('battle:lan-changed',value);}
  context(value:unknown){for(const window of this.all())window.webContents.send('battle:context-changed',value);}
  close(){this.main?.close();}
}
