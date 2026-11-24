import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkBattleSwitch(window,prefs,snap){
 const js=code=>window.webContents.executeJavaScript(code);
 async function until(code){for(let i=0;i<1800;i++){if(await js(code))return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('Switch audit timeout: '+code);}
 await prefs.change({animated:true});
 await until("window.appPreferences?.animated && document.querySelector('[data-position=own-0]') && document.querySelector('#battle-party-open')");
 await js(`(()=>{
  const old=document.querySelector('[data-position="own-0"]').dataset.sprite;
  window.switchAudit={old,prepared:false,finished:false};
  const proto=window.battleEffects.OriginalLayers.prototype,both=proto.both;
  proto.both=async function(method,...args){
   const audit=window.switchAudit;
   if(method==='ptbPrepare'&&args[0]?.transition&&args[0].source==='own-0')audit.active=true;
   const result=await both.call(this,method,...args);
   if(audit.active&&method==='ptbPrepare'){audit.before=document.querySelector('[data-position="own-0"]').dataset.sprite;audit.preVisible=this.field.classList.contains('effect-playing');audit.prepared=true;await new Promise(resolve=>audit.release=resolve);}
   if(audit.active&&method==='ptbFinish'){audit.after=document.querySelector('[data-position="own-0"]').dataset.sprite;audit.postVisible=this.field.classList.contains('effect-playing');audit.finished=true;audit.active=false;}
   return result;
  };
  document.querySelector('#battle-party-open').click();
  document.querySelector('#battle-switch-0 .battle-party-cell[data-value="2"]:enabled').click();
  document.querySelector('#battle-confirm').click();
 })()`);
 await until('window.switchAudit.prepared');
 const before=await js('({old:window.switchAudit.old,before:window.switchAudit.before,visible:window.switchAudit.preVisible})');
 assert.equal(before.before,before.old,'incoming sprite must not appear while native entry assets prepare');assert.equal(before.visible,false,'native layer must stay hidden until its first frame');
 await snap('switch-before-entry');await js('window.switchAudit.release()');await until('window.switchAudit.finished');
 const after=await js('({old:window.switchAudit.old,after:window.switchAudit.after,visible:window.switchAudit.postVisible})');
 assert.notEqual(after.after,after.old,'DOM must contain the incoming sprite before native layers clear');assert.equal(after.visible,false);
 await until('document.querySelector("#battle-confirm:not(:disabled),#battle-move-0-1:not(:disabled)")');
 await snap('switch-after-entry');await prefs.change({animated:false});
 console.log('PASS: real switch keeps outgoing Pokémon during preparation, renders native entry before reveal, and atomically settles the incoming sprite.');
 if(process.env.POKE_UI_REAL_SPRITES==='1'){
  const report=await js(`(async()=>{
   const examples=[[595,'파쪼옥'],[25,'피카츄'],[9,'거북왕'],[149,'망나뇽'],[208,'강철톤'],[321,'고래왕']],canvas=document.createElement('canvas');canvas.width=1320;canvas.height=420;const ctx=canvas.getContext('2d');ctx.fillStyle='#edf0e8';ctx.fillRect(0,0,1320,420);ctx.imageSmoothingEnabled=false;const sizes=[];
   for(const [index,[speciesID,name]]of examples.entries())for(const back of [false,true]){
    const actor=await window.battleSprites.actor({speciesID,hp:100,maxHP:100},back,(back?'own':'foe')+'-0',{x:0,y:0,width:282,height:151});const image=new Image();image.src=actor.sprite.frames[0];await image.decode();const x=index*220+110,y=back?370:170;
    ctx.strokeStyle='#758170';ctx.beginPath();ctx.moveTo(x-100,y);ctx.lineTo(x+100,y);ctx.stroke();ctx.drawImage(image,x-image.width/2,y-image.height);ctx.fillStyle='#15251a';ctx.font='16px sans-serif';ctx.textAlign='center';ctx.fillText(name+' · '+(back?'뒤':'앞'),x,y+24);sizes.push({speciesID,back,width:image.width,height:image.height});
   }return{png:canvas.toDataURL('image/png').split(',')[1],sizes};
  })()`);
  for(const back of [false,true]){const small=report.sizes.find(p=>p.speciesID===595&&p.back===back),large=report.sizes.find(p=>p.speciesID===321&&p.back===back);assert.ok(large.width*large.height>small.width*small.height*4,'original-ratio Wailord must stay visibly larger than Joltik');}
  if(process.env.POKE_UI_SCREENSHOTS){await mkdir(process.env.POKE_UI_SCREENSHOTS,{recursive:true});await writeFile(join(process.env.POKE_UI_SCREENSHOTS,'species-size-comparison.png'),Buffer.from(report.png,'base64'));}
  console.log('PASS: real decoded front/back sprites preserve small/giant size differences: '+JSON.stringify(report.sizes));
 }
}
