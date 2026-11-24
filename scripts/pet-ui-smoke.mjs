import{inspectWindowRegion}from'./windows-pet-region.mjs';
import{app,BrowserWindow,screen,session}from'electron';import assert from'node:assert/strict';import{mkdtemp,readFile,writeFile,mkdir,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{SettingsStore,registerSettingsIPC}from'../dist/main/settings.js';import{registerUsageIPC}from'../dist/main/usage/ipc.js';import{PetAgentController}from'../dist/main/pet/controller.js';import{CompanionStore}from'../dist/main/companion/store.js';import{speciesFor}from'../dist/main/companion/catalog.js';
import { petOrigin } from '../dist/shared/pet-presentation.js';
async function run(){const dir=await mkdtemp(join(tmpdir(),'ptb-pet-ui-'));app.setPath('userData',dir);process.env.USERPROFILE=dir;process.env.CLAUDE_CONFIG_DIR='';app.on('window-all-closed',()=>{});await app.whenReady();let pet,main,finish;const errors=[],shots=resolve('output/pet-visual-audit');await mkdir(shots,{recursive:true});let opened=0;
 try{const gif=await readFile('src/battle-assets/player/base-sprites/6.gif'),png=await readFile('src/battle-assets/player/base-sprites/source/images/pokemon/6.png');await session.defaultSession.protocol.handle('https',request=>new Response(request.url.endsWith('.gif')?gif:png,{headers:{'content-type':request.url.endsWith('.gif')?'image/gif':'image/png'}}));
 const prefs=new SettingsStore(join(dir,'settings-v1.json'));await prefs.load();await prefs.change({language:'ko',providers:[],statusChecks:false,refreshSeconds:0,petEnabled:true,petSize:96,animated:true,updateNotifications:false});const controller=new PetAgentController(()=>pet,prefs);finish=registerUsageIPC(()=>main,()=>pet,async()=>{opened++;},()=>undefined,prefs,()=>{},()=>{},()=>controller.dismiss());registerSettingsIPC(prefs,()=>[main,pet],async()=>{await finish();await prefs.finishWrites();});
 main=new BrowserWindow({show:false,webPreferences:{preload:resolve('dist/main/usage-preload.cjs'),sandbox:true}});await main.loadURL('data:text/html,<title>Pet fixture owner</title>');await main.webContents.executeJavaScript('window.usage.refresh()');
 pet=new BrowserWindow({show:false,width:96,height:96,useContentSize:true,frame:false,transparent:true,webPreferences:{preload:resolve('dist/main/pet-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});pet.webContents.on('console-message',event=>{if(/Uncaught|TypeError|not defined/.test(event.message??''))errors.push(event.message);});await pet.loadFile(resolve('dist/renderer/pet.html'));controller.sync();const js=code=>pet.webContents.executeJavaScript(code);async function until(code){for(let i=0;i<150;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out '+code+' / '+await js('document.body.innerText'));}async function snap(name){await new Promise(r=>setTimeout(r,80));await writeFile(join(shots,name+'.png'),(await pet.webContents.capturePage()).toPNG());}
 let boundsWrites=0,repaints=0;const nativeBounds=pet.setBounds.bind(pet),invalidate=pet.webContents.invalidate.bind(pet.webContents);pet.setBounds=(...args)=>{boundsWrites++;return nativeBounds(...args);};pet.webContents.invalidate=()=>{repaints++;invalidate();};for(let i=0;i<5;i++)controller.sync();assert.equal(boundsWrites,0,'unchanged pet state must not reposition the transparent window');
 await until("document.querySelector('.egg-canvas')?.width>1");assert.equal(await js("document.querySelector('.handle')===null"),true);assert.ok(Math.abs(await js("document.querySelector('.egg').getBoundingClientRect().width")-96)<.01);await snap('egg-idle');if(process.platform==='win32'){const region=await inspectWindowRegion(pet);assert.ok(region.Kind>0);assert.equal(region.Top,false);assert.equal(region.Gutter,false);assert.equal(region.Pet,true);}
 await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerenter'))");await until("document.querySelector('output').dataset.kind==='hover'");if(process.platform==='win32'){assert.equal((await inspectWindowRegion(pet)).Top,true);}await js("document.querySelector('.egg').click()");await until("document.querySelector('output').textContent.includes('기도 1회')");assert.equal(await js("document.querySelectorAll('.prayer-particle').length"),1);await snap('egg-prayer');
 await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerleave'));document.querySelector('output').dispatchEvent(new PointerEvent('pointerenter'))");
 await new Promise(resolve=>setTimeout(resolve,220));
 assert.equal(await js("document.querySelector('output').dataset.kind==='hover'"),true,'a hover notice stays open while the pointer enters the bubble');
 await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerenter'))");
 for(let i=0;i<4;i++){controller.sync();pet.webContents.send('pet:updated',{species:null,shiny:false});}await prefs.change({theme:'dark'});await new Promise(r=>setTimeout(r,1400));assert.equal(await js("!document.querySelector('output').hidden&&document.querySelector('output').textContent.includes('기도 1회')"),true);assert.equal(await js("document.querySelectorAll('.prayer-particle').length"),0);await snap('egg-hover-dark');
 await js("document.querySelector('.egg').click();document.querySelector('.egg').click();document.querySelector('.egg').click()");await until("document.querySelector('output').textContent.includes('기도 4회')");await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerleave'))");await until("document.querySelector('output').hidden");assert.ok(Math.abs(pet.getBounds().height-(process.platform==='win32'?168:96))<=1);await prefs.change({theme:'light'});
 const store=new CompanionStore(join(dir,'companion-v1.json'),()=>false);await store.replaceImport({raised:1,progress:0,active:{id:'pet-charizard',family:-1,stage:0,route:[speciesFor(6)],hatchedAt:Date.now(),nature:'성실',shiny:false,repeat:false,level:50},graduated:[]},Date.now());pet.webContents.send('pet:updated',(await store.read()).pet);await until("document.querySelector('.egg.pokemon .sprite-canvas')?.width>1");await snap('pokemon-idle');
 await prefs.change({animated:false});await until("document.querySelector('.egg.pokemon .egg-canvas')?.width>1");await new Promise(r=>setTimeout(r,100));let mismatches=0;const traces=[];
 for(const size of [48,96,192]){await prefs.change({petSize:size});await until("Math.abs(document.querySelector('.egg').getBoundingClientRect().width-"+size+")<.01");await new Promise(r=>setTimeout(r,100));await pet.webContents.capturePage();const baseline=await pet.webContents.capturePage();for(let cycle=0;cycle<4;cycle++){const bounds=pet.getBounds(),writes=boundsWrites;await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerenter'))");await until("document.querySelector('output').dataset.kind==='hover'");await new Promise(r=>setTimeout(r,50));if(process.platform==='win32'){assert.deepEqual(pet.getBounds(),bounds,'hover must never move or resize the HWND');assert.equal(boundsWrites,writes,'no native bounds changes on hover');}await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerleave'))");await until("document.querySelector('output').hidden");if(process.platform==='win32')assert.equal(boundsWrites,writes,'no native bounds changes on leave');const frame=await pet.webContents.capturePage();const same=frame.toBitmap().equals(baseline.toBitmap());traces.push({size,cycle,same,bounds:pet.getBounds(),image:frame.getSize()});if(!same){mismatches++;await writeFile(join(shots,'ghost-mismatch-'+size+'-'+cycle+'.png'),frame.toPNG());}assert.deepEqual(pet.getBounds(),bounds,'hover must preserve screen position');}}
 assert.equal(mismatches,0,'hover leave must restore the exact static RGBA frame');console.log('PASS: 12 hover cycles at 48/96/192px restore the exact static frame and position.');await prefs.change({petSize:96,animated:true});
 await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerenter'));for(const x of [10,50,10,50,10])document.querySelector('.egg').dispatchEvent(new PointerEvent('pointermove',{clientX:x}));");await until("document.querySelector('output').dataset.kind==='heart'");assert.equal(await js("document.querySelector('output canvas').width"),34);await snap('pokemon-heart');await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointerleave'));document.querySelector('output').click()");
 if(process.platform==='win32'){const region=await inspectWindowRegion(pet);assert.equal(region.Top,false);assert.equal(region.Gutter,false);assert.equal(region.Pet,true);}
 await prefs.change({animated:false});
 await until("document.querySelector('.egg.pokemon .egg-canvas')?.width>1 && document.querySelector('output').hidden");
 const area=screen.getPrimaryDisplay().workArea;
 pet.setPosition(area.x+100,area.y+220);
 const idleHeight=pet.getBounds().height;
 const expandedOrigin=petOrigin(pet.getBounds(),96);
 const label='Long agent label that wraps across more than one line';
 const message='The floating pet should show every part of this notification, including words that used to be cut off by the old display limit. Message complete.';
 controller.accept('poketokenbar://agent?state=waiting&label='+encodeURIComponent(label)+'&message='+encodeURIComponent(message));
 await until(`(() => {
  const bubble=document.querySelector('output'),title=bubble.querySelector('strong'),body=bubble.querySelector('.pet-bubble-copy > span');
  return title?.textContent.startsWith(${JSON.stringify(label)}) && body?.textContent===${JSON.stringify(message)}
   && title.getBoundingClientRect().height>14 && body.getBoundingClientRect().height>42
   && bubble.getBoundingClientRect().top>=0 && bubble.scrollHeight<=bubble.clientHeight;
 })()`);
 assert.ok(pet.getBounds().height>idleHeight+12,'a long notice must grow past the ordinary surface');
 assert.ok(Math.abs(petOrigin(pet.getBounds(),96).y-expandedOrigin.y)<=1,'the sprite must stay anchored as the notice grows');
 controller.dismiss();
 await until("document.querySelector('output').hidden");
 for(let i=0;i<50&&Math.abs(pet.getBounds().height-idleHeight)>2;i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(Math.abs(pet.getBounds().height-idleHeight)<=2,`closing a long notice must restore the native surface (${idleHeight}px → ${pet.getBounds().height}px)`);

 pet.setPosition(area.x+100,area.y);
 const edgeMessage=message.repeat(12);
 controller.accept('poketokenbar://agent?state=waiting&message='+encodeURIComponent(edgeMessage));
 await until(`document.querySelector('.pet-bubble-copy > span')?.textContent===${JSON.stringify(edgeMessage)}`);
 assert.equal(await js(`(() => {
  const bubble=document.querySelector('output');
  bubble.scrollTop=bubble.scrollHeight;
  return bubble.scrollTop>0 && Math.abs(bubble.scrollHeight-bubble.clientHeight-bubble.scrollTop)<=1;
 })()`),true,'screen-edge notices must let the user scroll to the final line');
 controller.dismiss();
 await until("document.querySelector('output').hidden");
 console.log('PASS: long pet titles and messages wrap without truncation, expand with an anchored sprite, and scroll at the screen edge.');

 pet.setPosition(area.x+100,area.y+100);
 await new Promise(resolve=>setTimeout(resolve,250));
 const start=pet.getBounds();
 const point=await js("(()=>{const r=document.querySelector('.egg').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
 function visiblePixels(frame) {
   const pixels=frame.toBitmap();
   let count=0;
   for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16)count++;
   return count;
 }
 const beforeDrag=visiblePixels(await pet.webContents.capturePage());
 assert.ok(beforeDrag>0,'the static sprite must be visible before the drag');
 const beforeRepaint=repaints;
 pet.webContents.debugger.attach();
 const mouse=(type,x,y,buttons)=>pet.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 try {
   await mouse('mousePressed',point.x,point.y,1);
   await mouse('mouseMoved',point.x+24,point.y+16,1);
   await until("document.querySelector('.egg').classList.contains('dragging')");
   for(let i=0;i<50&&pet.getBounds().x===start.x;i++)await new Promise(resolve=>setTimeout(resolve,20));
   assert.ok(Math.abs(pet.getBounds().x-start.x-24)<=1,'pointer movement must move the window');
   assert.ok(Math.abs(pet.getBounds().y-start.y-16)<=1);
   if(process.platform==='win32')assert.ok(repaints>beforeRepaint,'moving a transparent pet must repaint during the drag');
   const duringDrag=visiblePixels(await pet.webContents.capturePage());
   assert.ok(duringDrag>=beforeDrag*.9,`the moving window must still render the static sprite (${duringDrag}/${beforeDrag} pixels)`);

   const moved=pet.getBounds();
   await js("document.querySelector('.egg').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))");
   await until("!document.querySelector('.egg').classList.contains('dragging')");
   await mouse('mouseReleased',point.x,point.y,0);
   assert.deepEqual(pet.getBounds(),moved,'a cancelled drag must keep its last pointer position');
   const saved=petOrigin(moved,prefs.get().petSize);
   for(let i=0;i<50&&prefs.get().petPosition?.x!==saved.x;i++)await new Promise(resolve=>setTimeout(resolve,20));
   assert.deepEqual(prefs.get().petPosition,saved);

   await mouse('mousePressed',point.x,point.y,1);
   await mouse('mouseMoved',point.x+12,point.y+8,1);
   await until("document.querySelector('.egg').classList.contains('dragging')");
   const beforeRelease=pet.getBounds();
   await mouse('mouseReleased',point.x+20-(beforeRelease.x-moved.x),point.y+12-(beforeRelease.y-moved.y),0);
   await until("!document.querySelector('.egg').classList.contains('dragging')");
   for(let i=0;i<50&&Math.abs(pet.getBounds().x-moved.x-20)>1;i++)await new Promise(resolve=>setTimeout(resolve,20));
   assert.ok(Math.abs(pet.getBounds().x-moved.x-20)<=1,'release must apply the final pointer position');
   assert.ok(Math.abs(pet.getBounds().y-moved.y-12)<=1);
   assert.equal(opened,0,'dragging must not open the main window');
   await mouse('mousePressed',point.x,point.y,1);
   await mouse('mouseReleased',point.x,point.y,0);

   await prefs.change({animated:true,animationQuality:'smooth'});
   await until("document.querySelector('.egg.pokemon .sprite-decoded') !== null");
   await mouse('mousePressed',point.x,point.y,1);
   await mouse('mouseMoved',point.x+12,point.y,1);
   await until("document.querySelector('.egg').classList.contains('dragging')");
   const gifFrame="document.querySelector('.pet-sprite .sprite-canvas').toDataURL()";
   const heldFrame=await js(gifFrame);
   await new Promise(resolve=>setTimeout(resolve,500));
   assert.equal(await js(gifFrame),heldFrame,'dragging must preserve the last rendered GIF frame');
   await mouse('mouseReleased',point.x,point.y,0);
   await until(`${gifFrame} !== ${JSON.stringify(heldFrame)}`);
 } finally { pet.webContents.debugger.detach(); }
 await prefs.finishWrites();
 for(let i=0;i<100&&opened===0;i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(opened,1);
 assert.ok(repaints>0,'layout transitions must schedule a full native repaint');assert.deepEqual(errors,[]);console.log('PASS: exact-size original egg, no dot handle, persistent prayer hover through IPC/settings updates, rapid prayer count, particle expiry, pixel hearts, drag persistence and Pokémon click.');
 await finish();await prefs.finishWrites();
 }finally{for(const w of BrowserWindow.getAllWindows())w.destroy();try{await rm(dir,{recursive:true,force:true,maxRetries:0});}catch{}}
}
setTimeout(()=>{console.error('Pet UI deadline');app.exit(1);},45000).unref();void run().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
