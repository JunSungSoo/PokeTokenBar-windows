// Full application with real IPC and a persistent, isolated sample save for manual testing.
import { app } from 'electron';
import { mkdir, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionStore } from '../dist/main/companion/store.js';
import { speciesFor } from '../dist/main/companion/catalog.js';

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function run() {
  const directory = join(tmpdir(), 'poketokenbar-full-app-test');
  await mkdir(directory, { recursive: true });
  app.setPath('userData', directory);
  const path = join(directory, 'companion-v1.json');
  if (!(await exists(path))) {
    const now = Date.now();
    const ivs = { hp:31, attack:25, defense:28, specialAttack:31, specialDefense:30, speed:27 };
    const names = { 1:'이상해씨',2:'이상해풀',3:'이상해꽃',4:'파이리',5:'리자드',6:'리자몽',172:'피츄',25:'피카츄',26:'라이츄' };
    function individual(id, route, stage, nature, ability, moves, shiny = false, level = 50) {
      return { id, family:-1, stage, route:route.map(number => speciesFor(number,names[number])), rarity:'common',
        hatchedAt:now-3*86400000, nature, shiny, repeat:false, level,
        macProfile:{ instanceID:id, seed:'123456789', ivs, level, growthTokens:100000000, gender:'female',
          abilitySlot:1, abilityName:ability, abilityIsHidden:false, moves:moves.map(name=>({name,learnedAtLevel:1})) } };
    }
    await new CompanionStore(path, () => false).replaceImport({ raised:12000000000, progress:10000000,
      inventory:{mint:3,redMaple:2,rareCandy:4,shinyCharm:0},
      active:individual('test-pikachu',[172,25,26],1,'명랑','static',['thunderbolt','quick-attack','iron-tail'],false,35),
      graduated:[
        {...individual('test-venusaur',[1,2,3],2,'조심','overgrow',['vine-whip','razor-leaf','solar-beam']),graduatedAt:now-86400000},
        {...individual('test-charizard',[4,5,6],2,'겁쟁이','blaze',['flamethrower','air-slash','dragon-claw'],true),graduatedAt:now-3600000},
      ] },now);
  }
  const settingsPath = join(directory,'settings-v1.json');
  if (!(await exists(settingsPath))) await writeFile(settingsPath, JSON.stringify({ language:'ko', petEnabled:true,
    companionNotifications:false, limitNotifications:false, updateNotifications:false }));
  console.log('Full application test save: '+directory);
  await import('../dist/main/index.js');
}
void run().catch(error=>{console.error(error);app.exit(1);});
