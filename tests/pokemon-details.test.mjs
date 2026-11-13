import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PokemonDetailsClient, parsePokemonDetails, normalizedMoves, mergedMoves, presentPokemonDetails } from '../dist/main/companion/pokemon-details.js';
import { computedStats } from '../dist/shared/pokemon-details.js';
import { CompanionStore } from '../dist/main/companion/store.js';
import { detailFixture } from './pokemon-details-fixtures.mjs';
const fixture = detailFixture();
const details = parsePokemonDetails(fixture.pokemon, fixture.species, 1);

test('Mac BW2 move filtering, stat order and ability slots are preserved', () => {
  assert.deepEqual(details.types, ['grass','poison']);
  assert.equal(Object.values(details.baseStats).reduce((sum, value) => sum + value, 0), 318);
  assert.deepEqual(details.abilities.map(row => [row.slot, row.isHidden]), [[1,false],[3,true]]);
  assert.deepEqual(details.moves, [
    { name:'tackle', learnMethods:[{ method:'level-up', level:1 }] },
    { name:'toxic', learnMethods:[{ method:'machine', level:0 }, { method:'tutor', level:0 }] },
    { name:'vine-whip', learnMethods:[{ method:'level-up', level:7 }] },
  ]);
  assert.throws(() => parsePokemonDetails({ ...fixture.pokemon, stats: [] }, fixture.species, 1));
  assert.throws(() => parsePokemonDetails(fixture.pokemon, { id: 2, gender_rate: 1 }, 1));
});
test('reference Fairy supplement merges without mutating BW2 cache or save data', () => {
  const raw = detailFixture(25); const original = parsePokemonDetails(raw.pokemon, raw.species, 25);
  const before = JSON.stringify(original);
  const merged = mergedMoves(original);
  assert.equal(merged.find(row => row.name === 'moonblast').learnMethods[0].method, 'pokerogue-egg');
  assert.equal(merged.find(row => row.name === 'play-rough').learnMethods[0].method, 'machine');
  assert.equal(JSON.stringify(original), before);
  const twice = mergedMoves({ ...original, moves: merged });
  assert.deepEqual(twice, merged);
});
test('metadata names and descriptions use the original eight-language catalog', () => {
  const expected = { ko:'몸통박치기', en:'Tackle', ja:'たいあたり', es:'Placaje', fr:'Charge', pt:'Tackle', de:'Tackle', ru:'Улаживать' };
  for (const [language, name] of Object.entries(expected)) {
    const result = presentPokemonDetails(details, language);
    assert.equal(result.labels.moves.tackle.name, name);
    assert.ok(result.labels.moves.tackle.description.length);
    assert.ok(result.labels.abilities.overgrow.name.length);
  }
  const korean = presentPokemonDetails(details, 'ko');
  assert.equal(korean.labels.species[1], '이상해씨');
  assert.equal(korean.labels.abilities.overgrow.name, '심록');
  assert.equal(korean.labels.types.grass, '풀');
});
test('computed stats apply nature, IVs, flooring and Shedinja HP like Mac', () => {
  const ivs = { hp:31, attack:31, defense:31, specialAttack:31, specialDefense:31, speed:31 };
  const neutral = computedStats(1, details.baseStats, 50, ivs, '노력');
  assert.deepEqual(neutral.map(row => row.value), [120,69,69,85,85,65]);
  assert.deepEqual(computedStats(1, details.baseStats, 50, ivs, '고집').map(row => row.value), [120,75,69,76,85,65]);
  assert.equal(computedStats(292, details.baseStats, 100, ivs, '노력')[0].value, 1);
  assert.equal(computedStats(1, details.baseStats, undefined, ivs, '노력').length, 0);
  assert.equal(computedStats(1, details.baseStats, 50, {}, '노력').length, 0);
});
test('requests deduplicate, reload from disk, preserve stale offline data and retry failed first loads', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ptb-details-')); t.after(() => rm(dir, { recursive:true, force:true }));
  let calls = 0, offline = false, now = 100000;
  const request = async url => { calls++; if (offline) throw new Error('offline'); return new Response(JSON.stringify(url.includes('pokemon-species') ? fixture.species : fixture.pokemon)); };
  const client = new PokemonDetailsClient(dir, request, () => now);
  const [ko, en] = await Promise.all([client.get(1,'ko'), client.get(1,'en')]);
  assert.equal(calls, 2); assert.equal(ko.labels.species[1], '이상해씨'); assert.equal(en.labels.species[1], 'Bulbasaur');
  const bytes = await readFile(join(dir,'1.json'),'utf8');
  offline = true;
  assert.equal((await new PokemonDetailsClient(dir, request, () => now).get(1,'ko')).stale, false); assert.equal(calls, 2);
  now += 31 * 86400000;
  assert.equal((await new PokemonDetailsClient(dir, request, () => now).get(1,'ko')).stale, true);
  assert.equal(await readFile(join(dir,'1.json'),'utf8'), bytes);
  const empty = new PokemonDetailsClient(join(dir,'empty'), request);
  await assert.rejects(empty.get(1,'ko')); offline = false;
  assert.equal((await empty.get(1,'ko')).details.speciesID, 1);
  await assert.rejects(client.get(650,'ko')); await assert.rejects(client.get(1.1,'ko'));
});
test('corrupt caches recover, invalid network data never replaces a good cache', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ptb-corrupt-details-')); t.after(() => rm(dir, { recursive:true, force:true }));
  await writeFile(join(dir,'1.json'), '{broken');
  const valid = new PokemonDetailsClient(dir, async url => new Response(JSON.stringify(url.includes('pokemon-species') ? fixture.species : fixture.pokemon)), () => 0);
  await valid.get(1,'ko'); const before = await readFile(join(dir,'1.json'),'utf8');
  const invalid = new PokemonDetailsClient(dir, async () => new Response('{}'), () => 31 * 86400000);
  assert.equal((await invalid.get(1,'ko')).stale, true);
  assert.equal(await readFile(join(dir,'1.json'),'utf8'), before);
});
test('capture evolution order, IVs and saved loadout survive reopening without metadata changing the save', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ptb-capture-chain-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir,'companion-v1.json');
  const { speciesFor } = await import('../dist/main/companion/catalog.js');
  const store = new CompanionStore(path, () => false);
  await store.replaceImport({ raised: 100000000, progress: 0, active: null,
    graduated: [{ id:'chain', family:-1, stage:2, route:[1,2,3].map(id => speciesFor(id)), rarity:'common', nature:'고집', shiny:true, repeat:false, hatchedAt:1, graduatedAt:2, level:50,
      macProfile: { seed:'123', instanceID:'chain', level:50, growthTokens:0, gender:'female', abilityIsHidden:false, abilityName:'overgrow', ivs:{ hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31 }, moves:[{ name:'tackle', learnedAtLevel:1 }] } }] }, Date.now());
  const before = await readFile(path,'utf8');
  const reopened = await new CompanionStore(path, () => false).read();
  assert.deepEqual(reopened.captures[0].species.map(row => row.number), [1,2,3]);
  assert.equal(reopened.captures[0].gender,'female'); assert.deepEqual(reopened.captures[0].moves,['tackle']);
  await new PokemonDetailsClient(join(dir,'metadata'), async url => new Response(JSON.stringify(url.includes('pokemon-species') ? fixture.species : fixture.pokemon))).get(1,'ko');
  assert.equal(await readFile(path,'utf8'),before);
});
test('same fixture matches the original Mac normalizedMoves implementation', { skip: !process.env.POKE_MAC_DETAILS_ORACLE }, () => {
  const natures = 'hardy lonely brave adamant naughty bold docile relaxed impish lax timid hasty serious jolly naive modest mild quiet bashful rash calm gentle sassy careful quirky'.split(' ');
  const cases = natures.flatMap(nature => [1,50,100].flatMap(level => [1,292].map(speciesID => ({ speciesID, baseStats: details.baseStats, level, nature, ivs: { hp:31, attack:0, defense:17, specialAttack:29, specialDefense:7, speed:3 } }))));
  const actual = JSON.parse(execFileSync(process.env.POKE_MAC_DETAILS_ORACLE, { input: JSON.stringify({ moves: fixture.pokemon.moves, stats: cases }), encoding:'utf8' }));
  assert.deepEqual(normalizedMoves(fixture.pokemon.moves), actual.moves);
  assert.deepEqual(cases.map(row => computedStats(row.speciesID, row.baseStats, row.level, row.ivs, row.nature)), actual.stats);
});

test('default moves and replacement options match Mac level, order, append and duplicate rules',async()=>{
  const {levelUpMoves,moveOptions,replacingMove}=await import('../dist/shared/pokemon-loadout.js');
  const moves=[{name:'future',learnMethods:[{method:'level-up',level:60}]},
    {name:'tackle',learnMethods:[{method:'level-up',level:1},{method:'level-up',level:5}]},
    {name:'growl',learnMethods:[{method:'level-up',level:1}]},
    {name:'vine-whip',learnMethods:[{method:'level-up',level:7}]},
    {name:'poison-powder',learnMethods:[{method:'level-up',level:13}]},
    {name:'razor-leaf',learnMethods:[{method:'level-up',level:20}]},
    {name:'toxic',learnMethods:[{method:'machine',level:0}]},
    {name:'charm',learnMethods:[{method:'egg',level:0}]}];
  const learned=levelUpMoves(moves,20).slice(-4);
  assert.deepEqual(learned.map(move=>move.name),['tackle','vine-whip','poison-powder','razor-leaf']);
  const options=moveOptions({...details,moves},20);
  assert.equal(options.some(move=>move.name==='future'),false);assert.equal(options.some(move=>move.name==='toxic'),true);assert.equal(options.some(move=>move.name==='charm'),true);
  assert.equal(replacingMove(learned,0,'vine-whip',options),null);assert.equal(replacingMove(learned,4,'toxic',options),null);
  assert.equal(replacingMove(learned,0,'future',options),null);
  assert.deepEqual(replacingMove(learned.slice(0,2),2,'toxic',options).map(move=>move.name),['tackle','vine-whip','toxic']);
});

test('owned move changes persist without altering IVs, seed, wallet, nature or other individuals',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ptb-loadout-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'companion.json'),store=new CompanionStore(path,()=>false);
  const profile={seed:'18446744073709551615',instanceID:'owned',ivs:{hp:31,attack:2,defense:3,specialAttack:4,specialDefense:5,speed:6},level:50,growthTokens:10,abilityIsHidden:false,moves:[]};
  const owned={id:'owned',family:-1,route:[{number:1,name:'이상해씨',type:'풀'}],stage:0,hatchedAt:42,nature:'고집',shiny:false,repeat:false,level:50,macProfile:profile};
  await store.replaceImport({raised:123,progress:42,active:owned,graduated:[{...owned,id:'other',graduatedAt:5,macProfile:{...profile,instanceID:'other'}},{...owned,id:'released',graduatedAt:5,releasedAt:6,macProfile:{...profile,instanceID:'released'}}]},Date.now());
  const first=await store.enrichMoves(details);assert.deepEqual(first.active.moves,['tackle','vine-whip']);
  assert.equal(await store.enrichMoves(details),null);
  const before=JSON.parse(await readFile(path,'utf8'));
  const payload=presentPokemonDetails(details,'ko');
  const action={id:'owned',speciesID:1,slot:0,name:'toxic',expectedMoves:['tackle','vine-whip']};
  const changed=await store.replaceMove(action,payload);assert.deepEqual(changed.active.moves,['toxic','vine-whip']);assert.equal(changed.active.hasCustomMoves,true);
  await store.enrichMoves({...details,moves:[...details.moves,{name:'growl',learnMethods:[{method:'level-up',level:2}]}]});
  assert.deepEqual((await store.read()).active.moves,['toxic','vine-whip']);
  const after=JSON.parse(await readFile(path,'utf8'));
  for(const field of ['seed','ivs','abilityIsHidden','growthTokens'])assert.deepEqual(after.active.macProfile[field],before.active.macProfile[field]);
  assert.equal(after.active.nature,before.active.nature);assert.equal(after.raised,before.raised);assert.equal(after.progress,before.progress);
  assert.deepEqual(after.graduated.map(row=>row.macProfile.moves),before.graduated.map(row=>row.macProfile.moves));
  assert.deepEqual((await new CompanionStore(path).read()).active.moves,['toxic','vine-whip']);
  const bytes=await readFile(path,'utf8');
  for(const invalid of [{...action,expectedMoves:['tackle','vine-whip']},{...action,expectedMoves:['toxic','vine-whip'],name:'vine-whip'},
    {...action,expectedMoves:['toxic','vine-whip'],slot:4},{...action,id:'released'},{...action,id:'missing'},
    {...action,speciesID:2},{...action,expectedMoves:['toxic','vine-whip'],name:'hyper-beam'}])await assert.rejects(store.replaceMove(invalid,payload));
  assert.equal(await readFile(path,'utf8'),bytes);
});

test('empty owned slots can be filled to four, while future level-up-only moves stay unavailable',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ptb-loadout-slots-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'companion.json'),store=new CompanionStore(path);
  const moves=['tackle','growl','toxic','charm'].map(name=>({name,learnMethods:[{method:'machine',level:0}]}));
  const data={...details,moves:[...moves,{name:'hyper-beam',learnMethods:[{method:'level-up',level:80}]}]};
  const profile={seed:'1',instanceID:'owned',ivs:{hp:1,attack:2,defense:3,specialAttack:4,specialDefense:5,speed:6},level:5,growthTokens:0,abilityIsHidden:false,moves:[]};
  await store.replaceImport({raised:0,progress:0,graduated:[],active:{id:'owned',family:-1,route:[{number:1,name:'이상해씨',type:'풀'}],stage:0,hatchedAt:42,nature:'명랑',shiny:false,repeat:false,level:5,macProfile:profile}},Date.now());
  await store.enrichMoves(data);let known=[];
  const payload=presentPokemonDetails(data,'ko');
  await assert.rejects(store.replaceMove({id:'owned',speciesID:1,slot:0,name:'hyper-beam',expectedMoves:[]},payload));
  for(const [slot,name] of ['tackle','growl','toxic','charm'].entries()){
    const result=await store.replaceMove({id:'owned',speciesID:1,slot,name,expectedMoves:known},payload);known=result.active.moves;
  }
  assert.deepEqual((await new CompanionStore(path).read()).active.moves,['tackle','growl','toxic','charm']);
});

test('move defaults and replacements match the original Mac functions', {skip:!process.env.POKE_MAC_LOADOUT_ORACLE},async()=>{
  const {levelUpMoves,moveOptions,replacingMove}=await import('../dist/shared/pokemon-loadout.js');
  const data={moves:mergedMoves(details)};
  const cases=[1,5,50,100].flatMap(level=>[-1,0,1,2,3,4].flatMap(slot=>['tackle','vine-whip','toxic','unknown'].map(name=>({details:data,level,slot,name,moves:[{name:'tackle',learnedAtLevel:1},{name:'vine-whip',learnedAtLevel:7}]}))));
  const results=JSON.parse(execFileSync(process.env.POKE_MAC_LOADOUT_ORACLE,{input:JSON.stringify(cases),encoding:'utf8'}));
  const actual=cases.map(row=>{const options=moveOptions(row.details,row.level);return{automatic:levelUpMoves(row.details.moves,row.level).slice(-4),options,replacement:replacingMove(row.moves,row.slot,row.name,options)};});
  assert.deepEqual(actual,results);
});

test('level growth refreshes automatic moves but never overwrites a custom moveset',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ptb-loadout-growth-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=new CompanionStore(join(directory,'save.json'),()=>false);
  const mon={id:'growth',family:-1,route:[{number:1,name:'이상해씨',type:'풀'}],stage:0,hatchedAt:1,nature:'명랑',shiny:false,repeat:false,level:5,
    macProfile:{instanceID:'growth',seed:'10',level:5,growthTokens:0,abilityIsHidden:false,ivs:{hp:1,attack:2,defense:3,specialAttack:4,specialDefense:5,speed:6},moves:[]}};
  await store.replaceImport({raised:0,progress:0,active:mon,graduated:[],inventory:{rareCandy:2}},Date.now());
  const data={...details,moves:[...details.moves,{name:'growl',learnMethods:[{method:'level-up',level:10}]}]};
  assert.deepEqual((await store.enrichMoves(data)).active.moves,['tackle']);
  const growth=await store.change({kind:'use',item:'rareCandy',quantity:1,id:'growth'});
  assert.ok(growth.active.level>=10);assert.deepEqual(growth.active.moves,['tackle','vine-whip','growl']);
  const custom=await store.replaceMove({id:'growth',speciesID:1,slot:0,name:'toxic',expectedMoves:growth.active.moves},presentPokemonDetails(data,'ko'));
  const next=await store.change({kind:'use',item:'rareCandy',quantity:1,id:'growth'});
  assert.deepEqual(next.active.moves,custom.active.moves);
});

test('tooltips carry Mac targeting, classification, power, PP and percentage/always-hit accuracy',async()=>{
  const {moveTooltip,moveTarget}=await import('../dist/shared/move-tooltip.js');
  const {translate}=await import('../dist/shared/localization.js');
  const toxic=presentPokemonDetails(details,'ko').labels.moves.toxic;
  assert.equal(toxic.targetScope,'normal');
  const text=moveTooltip(toxic,text=>translate(text,'ko'));
  assert.ok(text.startsWith('맹독\n'));assert.match(text,/독 · 변화 · 위력: — · PP: 10/);
  assert.match(text,/기본 명중률: 90%/);assert.match(text,/대상: 상대 또는 아군 단일/);
  const always=moveTooltip({...toxic,accuracy:true,targetScope:'self'},text=>translate(text,'ko'));
  assert.match(always,/기본 명중률: 필중/);assert.match(always,/대상: 자신/);
  const unknown=moveTooltip({...toxic,accuracy:null,targetScope:undefined},text=>translate(text,'ko'));
  assert.match(unknown,/기본 명중률: —/);assert.match(unknown,/대상: —/);assert.doesNotMatch(unknown,/undefined|null/);
  assert.equal(moveTarget('allAdjacentFoes'),'상대 모두');assert.equal(moveTarget('adjacentAllyOrSelf'),'자신 또는 아군 단일');
  assert.equal(moveTarget('allAdjacent'),'모두 (자신 제외)');assert.equal(moveTarget('allyTeam'),'아군 모두 (대기 포함)');
});

test('all bundled move tooltips match original Mac strings in all eight languages',{skip:!process.env.POKE_MAC_TOOLTIP_ORACLE},async()=>{
  const {moveTooltip}=await import('../dist/shared/move-tooltip.js');
  const {translate,languages}=await import('../dist/shared/localization.js');
  const catalog=JSON.parse(await readFile('src/companion-data/catalog.json','utf8'));
  const fairy=JSON.parse(await readFile('src/companion-data/gen6-fairy.json','utf8'));
  const names=[...new Set([...Object.keys(catalog.moves),...Object.keys(fairy.moves)])];
  const cases=languages.flatMap(language=>names.map(name=>({name,language})));
  const originalRoot=process.env.POKE_MAC_REFERENCE ?? '../PokeTokenBar';
  const resources=join(originalRoot,'Sources/PokeTokenBar/Resources/BattleText');
  const expected=JSON.parse(execFileSync(process.env.POKE_MAC_TOOLTIP_ORACLE,[join(resources,'catalog.json'),join(resources,'gen6-fairy.json'),join(resources,'move-targets.json')],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:16*1024*1024}));
  const metadata={...details,moves:names.map(name=>({name,learnMethods:[{method:'machine',level:0}]}))};
  const labels=Object.fromEntries(languages.map(language=>[language,presentPokemonDetails(metadata,language).labels.moves]));
  assert.deepEqual(cases.map(row=>moveTooltip(labels[row.language][row.name],text=>translate(text,row.language))),expected);
});
