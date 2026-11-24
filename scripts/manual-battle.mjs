// Opens the production battle renderer/IPC/engine with an isolated six-member save.
// Close the battle window to end this manual test; the user's app profile is untouched.
import {app} from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {CompanionStore} from '../dist/main/companion/store.js';
import {speciesFor} from '../dist/main/companion/catalog.js';
import {SettingsStore} from '../dist/main/settings.js';
import {registerBattleIPC} from '../dist/main/battle/ipc.js';
import {practiceTeam} from '../dist/main/battle/team.js';

async function run(){
const root=resolve('output/manual-battle',new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid);
await mkdir(root,{recursive:true});
app.setPath('userData',root);
await app.whenReady();
const settings=new SettingsStore(join(root,'settings-v1.json'));
await settings.load();
await settings.change({language:'ko',animated:true,animationQuality:'smooth'});
const companion=new CompanionStore(join(root,'companion-v1.json'),()=>false);
const team=practiceTeam(),now=Date.now();
await companion.replaceImport({raised:1000000000,progress:0,active:null,graduated:team.map(member=>({
 id:member.id,family:-1,stage:0,route:[speciesFor(member.speciesID)],rarity:'common',
 hatchedAt:now-100000,graduatedAt:now,nature:'성실',shiny:false,repeat:false,level:100,
 macProfile:{instanceID:member.id,seed:'123456789',ivs:{hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31},level:100,growthTokens:100000000,gender:'male',abilitySlot:1,abilityName:member.ability,abilityIsHidden:false,moves:member.moves.map(name=>({name,learnedAtLevel:1}))}
}))},now);
await writeFile(join(root,'battle-presentation-v1.json'),JSON.stringify({music:.2,effects:.35,enabled:true}));
const controller=registerBattleIPC(companion,()=>undefined,settings,undefined,undefined,{rewardTest:process.argv.includes('--test-battle-rewards')});
await controller.store.start('singles',team,true,true);
await controller.store.prepare('singles',team.map(member=>member.id),{},true);
await controller.windows.open('challenge');
console.log(JSON.stringify({pid:process.pid,profile:root,team:team.map(member=>member.speciesID),ready:true}));
app.on('window-all-closed',()=>app.quit());
}
void run().catch(error=>{console.error(error);app.exit(1);});
