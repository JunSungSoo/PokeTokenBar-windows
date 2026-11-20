// Run the actual settings renderer with isolated temporary settings and save data.
import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { SettingsStore, registerSettingsIPC } from '../dist/main/settings.js';
import { CompanionStore } from '../dist/main/companion/store.js';
app.on('window-all-closed', () => {});
async function run() {
  const temporary = await mkdtemp(join(tmpdir(), 'ptb-settings-capture-'));
  app.setPath('userData', temporary);
  let window;
  try {
    await app.whenReady();
    const settings = new SettingsStore(join(temporary, 'settings.json'));
    await settings.load();
    await settings.change({language:'ko'});
    const companion = new CompanionStore(join(temporary,'companion.json'),()=>false);
    const state = await companion.update(new Map(),Date.now());
    registerSettingsIPC(settings,()=>[window].filter(Boolean),()=>settings.finishWrites());
    ipcMain.handle('settings:snapshots',()=>[]);
    ipcMain.handle('windows:settings',()=>({supported:false,version:'1.0.0'}));
    ipcMain.handle('usage:refresh',()=>({companion:state,labels:{codex:'Codex',claude:'Claude Code'},usage:{codex:{},claude:{}}}));
    ipcMain.handle('companion:change',(_event,action)=>companion.change(action));
    window = new BrowserWindow({width:600,height:740,show:false,title:'PokeTokenBar 설정',webPreferences:{preload:resolve('dist/main/usage-preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
    const errors=[];
    window.webContents.on('console-message',event=>{if(/Uncaught|TypeError/.test(event.message))errors.push(event.message);});
    await window.loadFile(resolve('dist/renderer/settings.html'));
    window.show();
    const evaluate=code=>window.webContents.executeJavaScript(code);
    for(let i=0;i<100;i++) {
      if(await evaluate("document.querySelector('#settings-version').textContent==='1.0.0' && document.querySelector('#settings-snapshots').textContent.length>0"))break;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    await mkdir(resolve('output/design-preview'),{recursive:true});
    for(const width of [600,400]) {
      window.setContentSize(width,740);
      await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');
      await new Promise(resolve=>setTimeout(resolve,180));
      const bounds=await evaluate(`(() => {
        const button=document.querySelector('#settings-current-version'),footer=button.closest('footer'),about=document.querySelector('[aria-labelledby="about-settings"]');
        const b=button.getBoundingClientRect(),a=about.getBoundingClientRect();
        return {last:footer===document.querySelector('main').lastElementChild,belowAbout:b.top>=a.bottom,visible:b.top>=0&&b.bottom<=innerHeight,noOverflow:document.documentElement.scrollWidth<=innerWidth,bottomMargin:Math.round(innerHeight-b.bottom)};
      })()`);
      assert.equal(bounds.last,true);assert.equal(bounds.belowAbout,true);assert.equal(bounds.visible,true);assert.equal(bounds.noOverflow,true);
      await writeFile(resolve('output/design-preview/settings-bottom-'+width+'.png'),(await window.webContents.capturePage()).toPNG());
      console.log('PASS '+width+'px: '+JSON.stringify(bounds));
    }
    assert.deepEqual(errors,[]);
  } catch(error) { console.error(error); process.exitCode=1; }
  finally {
    window?.destroy();
    try {await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
    finally {app.quit();}
  }
}
void run();
