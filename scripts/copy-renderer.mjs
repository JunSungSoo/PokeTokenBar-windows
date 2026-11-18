import { cp, writeFile, readFile,readdir } from 'node:fs/promises';

await cp(
  new URL('../src/renderer/', import.meta.url),
  new URL('../dist/renderer/', import.meta.url),
  { recursive: true },
);

await cp(
  new URL('../src/battle-engine/', import.meta.url),
  new URL('../dist/battle-engine/', import.meta.url),
  { recursive: true },
);

const { languages, messages } = await import('../dist/shared/localization.js');
await writeFile(new URL('../dist/renderer/locale-data.js', import.meta.url), 'window.localeCatalog = ' + JSON.stringify({ languages, messages:[...messages,...JSON.parse(await readFile(new URL('../src/battle-assets/data/messages.json',import.meta.url),'utf8'))] }) + ';\n');

await cp(new URL('../src/companion-data/', import.meta.url), new URL('../dist/companion-data/', import.meta.url), { recursive: true });
await cp(new URL('../src/battle-assets/',import.meta.url),new URL('../dist/battle-assets/',import.meta.url),{recursive:true});

const { computedStats,projectDetailView } = await import('../dist/shared/pokemon-details.js');
await writeFile(new URL('../dist/renderer/pokemon-math.js', import.meta.url), 'window.pokemonMath = {projectDetailView:'+projectDetailView.toString()+', computedStats: ' + computedStats.toString() + ' };\n');
const {moveOptions,levelUpMoves}=await import('../dist/shared/pokemon-loadout.js');
await writeFile(new URL('../dist/renderer/pokemon-loadout.js',import.meta.url),'window.pokemonLoadout = {moveOptions:'+moveOptions.toString()+',levelUpMoves:'+levelUpMoves.toString()+'};\n');
const {moveTarget,moveTooltip}=await import('../dist/shared/move-tooltip.js');
await writeFile(new URL('../dist/renderer/move-tooltip-format.js',import.meta.url),'(()=>{const moveTarget='+moveTarget.toString()+';window.moveText={moveTarget,moveTooltip:'+moveTooltip.toString()+'};})();\n');

const { species, types } = JSON.parse(await readFile(new URL('../src/companion-data/catalog.json', import.meta.url), 'utf8'));
await writeFile(new URL('../dist/renderer/species-names.js', import.meta.url), 'window.speciesNames = ' + JSON.stringify(species) + ';\n');

const ui = await import('../dist/shared/companion-presentation.js');
await writeFile(new URL('../dist/renderer/companion-presentation.js', import.meta.url), 'window.companionUI = ' + JSON.stringify({ itemOrder:ui.itemOrder,productOrder:ui.productOrder,typeColors:ui.typeColors }) + ';window.companionUI.candyPreview='+ui.candyPreview.toString()+';\n');
await writeFile(new URL('../dist/renderer/type-names.js', import.meta.url), 'window.typeNames = ' + JSON.stringify(types) + ';\n');
const { formCatalog } = await import('../dist/main/companion/forms.js');
await writeFile(new URL('../dist/renderer/form-catalog.js', import.meta.url), 'window.formCatalog = ' + JSON.stringify(formCatalog) + ';\n');
await writeFile(new URL('../dist/renderer/form-names.js',import.meta.url),'window.formNames='+await readFile(new URL('../src/companion-data/form-names.json',import.meta.url),'utf8')+';\n');

const catalog=JSON.parse(await readFile(new URL('../src/companion-data/catalog.json',import.meta.url),'utf8'));
const fairy=JSON.parse(await readFile(new URL('../src/companion-data/gen6-fairy.json',import.meta.url),'utf8'));
const battleData={...catalog,moves:{...catalog.moves,...fairy.moves},types:{...catalog.types,...fairy.types}};
battleData.formCatalog=formCatalog;
battleData.megaSprites=await readdir(new URL('../src/battle-assets/player/mega-sprites/',import.meta.url));
const {appearance}=await import('../dist/main/companion/forms.js');
battleData.forms=Object.fromEntries(Object.entries(formCatalog).map(([id,forms])=>[id,Object.fromEntries(forms.map(form=>[form,appearance(Number(id),form)]))]));
for(const [key,file]of Object.entries({trainers:'trainers/names.json',playerManifest:'player/manifest.json',musicBattle:'music/wild-battle-source.json',musicVictory:'music/trainer-victory-source.json'}))battleData[key]=JSON.parse(await readFile(new URL('../src/battle-assets/'+file,import.meta.url),'utf8'));
for(const [key,file]of Object.entries({shopText:'data/shop-text.json',items:'data/held-items.json',mega:'data/mega-text.json',speciesTypes:'data/species-types.json',sizes:'player/pokemon-sizes.json',heights:'player/pokemon-heights.json'}))battleData[key]=JSON.parse(await readFile(new URL('../src/battle-assets/'+file,import.meta.url),'utf8'));
await writeFile(new URL('../dist/renderer/battle-catalog.js',import.meta.url),'window.battleCatalog='+JSON.stringify(battleData)+';\n');

const {presentationEvents}=await import('../dist/shared/battle-presentation.js');
await writeFile(new URL('../dist/renderer/battle-presentation.js',import.meta.url),'window.battlePresentation={events:'+presentationEvents.toString()+'};\n');

const {allowsHeldItem,assignHeldItems}=await import('../dist/shared/held-items.js');
await writeFile(new URL('../dist/renderer/held-items.js',import.meta.url),'(()=>{const allowsHeldItem='+allowsHeldItem.toString()+';window.heldItemRules={allowsHeldItem,assignHeldItems:'+assignHeldItems.toString()+'};})();\n');

const recap=await import('../dist/shared/usage-recap.js');
await writeFile(new URL('../dist/renderer/usage-recap-data.js',import.meta.url),'(()=>{'+Object.entries(recap).map(([name,fn])=>'const '+name+'='+fn.toString()+';').join('')+'window.usageHistory={'+Object.keys(recap).join(',')+'};})();');

const quota=await import('../dist/shared/quota-presentation.js');
await writeFile(new URL('../dist/renderer/quota-presentation.js',import.meta.url),'(()=>{'+Object.entries(quota).map(([name,fn])=>'const '+name+'='+fn.toString()+';').join('')+'window.quotaPresentation={'+Object.keys(quota).join(',')+'};})();');

await cp('src/main/power-monitor.ps1','dist/main/power-monitor.ps1');
await cp('src/main/instance-bridge.ps1','dist/main/instance-bridge.ps1');

const petPresentation=await import('../dist/shared/pet-presentation.js');
await writeFile('dist/renderer/pet-presentation.js','(()=>{'+Object.entries(petPresentation).map(([name,value])=>'const '+name+'='+(typeof value==='function'?value.toString():JSON.stringify(value))+';').join('')+'window.petPresentation={'+Object.keys(petPresentation).join(',')+'};})();');
