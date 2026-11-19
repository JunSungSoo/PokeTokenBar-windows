import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CompanionStore } from '../dist/main/companion/store.js';
import { collectUsage } from '../dist/main/usage/scan.js';

const baseline = Date.parse('2026-06-17T02:00:00Z');
const time = baseline + 10000;
const start = new Date(baseline - 1000).toISOString();
const after = new Date(time).toISOString();

test('Red Maple matches feature/battle: 100M purchase, graduated-only six-IV reroll and exact consumption',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ptb-red-maple-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'save.json'),store=new CompanionStore(path,()=>false);
  const {speciesFor}=await import('../dist/main/companion/catalog.js');
  const stats=['hp','attack','defense','specialAttack','specialDefense','speed'];
  const profile={instanceID:'target',seed:'123456789',ivs:Object.fromEntries(stats.map(stat=>[stat,31])),level:50,gender:'female',abilityName:'overgrow',moves:[{name:'tackle',learnedAtLevel:1}],hasCustomMoves:true};
  const mon={id:'target',family:-1,stage:0,hatchedAt:baseline,nature:'조심',shiny:true,repeat:false,route:[speciesFor(1)],macProfile:profile};
  await store.replaceImport({raised:1000000000,progress:12345,active:{...mon,id:'active'},inventory:{redMaple:2,mint:1},graduated:[{...mon,graduatedAt:time},{...mon,id:'released',releasedAt:time,graduatedAt:time},{...mon,id:'no-profile',macProfile:undefined,graduatedAt:time}]},time);
  const before=JSON.parse(await readFile(path,'utf8'));
  for(const id of ['active','released','no-profile','missing']){
    await assert.rejects(()=>store.change({kind:'use',item:'redMaple',quantity:1,id}),/졸업 개체/);
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),before);
  }
  await store.change({kind:'use',item:'redMaple',quantity:1,id:'target'});
  const after=JSON.parse(await readFile(path,'utf8')),ivs=after.graduated[0].macProfile.ivs;
  assert.deepEqual(Object.keys(ivs),stats);
  for(const value of Object.values(ivs))assert.ok(Number.isInteger(value)&&value>=0&&value<=31);
  const expected=structuredClone(before);expected.inventory.redMaple=1;expected.graduated[0].macProfile.ivs=ivs;
  assert.deepEqual(after,expected,'reroll changes only selected IVs and one inventory item');
  const purchased=await store.change({kind:'buy',product:'redMaple',quantity:2});
  assert.equal(purchased.economy.wallet,800000000);assert.equal(purchased.economy.inventory.redMaple,3);
  assert.deepEqual((await new CompanionStore(path).read()).economy,purchased.economy);
});

function codexRow(id, timestamp, input) {
  return JSON.stringify({ timestamp, type: 'event_msg', payload: {
    type: 'token_count', info: { last_token_usage: { input_tokens: input } },
  } });
}

test('deduplicates growth across scan retries and restores the same individual and Pokédex', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-growth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logs = join(dir, '테스트 로그');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(logs);
  const log = join(logs, 'rollout.jsonl');
  const historical = codexRow('old', start, 6_000_000);
  const hatch = codexRow('hatch', after, 6_000_000);
  const evolve = codexRow('evolve', after, 125_000_000);
  const save = join(dir, 'companion-v1.json');
  let store = new CompanionStore(save, () => false);

  async function refresh(now = time) {
    let observed;
    await collectUsage('codex', logs, new Date(now), [], false, entries => { observed = entries; });
    return store.update(new Map([['codex', observed]]), now);
  }
  async function setLog(...rows) { await writeFile(log, rows.join('\n') + '\n'); }

  await setLog(historical);
  const egg = await refresh(baseline);
  assert.equal(egg.current, null);
  assert.equal(egg.raised, 0);

  const incubation = JSON.parse(await readFile(save, 'utf8'));
  await writeFile(save, JSON.stringify({ ...incubation, pendingHatchID: 16 }));
  await setLog(historical, hatch);
  const [first, duplicate] = await Promise.all([refresh(), refresh()]);
  assert.ok(first.current);
  assert.equal(first.progress, 1_000_000);
  assert.equal(first.collection.length, 1);
  assert.deepEqual(duplicate, first);

  await setLog(historical, hatch, evolve);
  const evolved = await refresh();
  assert.equal(evolved.active.id, first.active.id);
  assert.notEqual(evolved.current.number, first.current.number);
  assert.equal(evolved.progress, 1_000_000);
  assert.equal(evolved.threshold, 250_000_000);
  assert.equal(evolved.collection.length, 2);
  const persisted = await readFile(save, 'utf8');
  assert.equal(JSON.parse(persisted).version, 1);

  store = new CompanionStore(save);
  assert.deepEqual(await store.read(), evolved);
  assert.deepEqual(await refresh(), evolved);
  assert.equal(await readFile(save, 'utf8'), persisted);

  await setLog(historical);
  assert.deepEqual(await refresh(), evolved);
  await setLog(historical, hatch, evolve);
  assert.deepEqual(await refresh(), evolved);

  await setLog(historical, hatch, evolve, codexRow('graduate', after, 625_000_000));
  const graduated = await refresh();
  assert.equal(graduated.current, null);
  assert.equal(graduated.collection.length, 3);
  assert.equal(graduated.captures.length, 1);
  assert.equal(graduated.captures[0].id, first.active.id);
  assert.deepEqual(await new CompanionStore(save).read(), graduated);
  assert.deepEqual(await refresh(), graduated);
});

test('a streaming revision pays only its new tokens and old folders do not pay retroactively', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-growth-ledger-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const save = join(dir, 'companion-v1.json');
  const store = new CompanionStore(save);
  const observation = (id, total, stamp = time) => ({ id, time: stamp, tokens: { total } });
  const update = (rows, now = time) => store.update(new Map([['claude', rows]]), now);
  await update([observation('stream', 100, baseline - 500)], baseline);
  assert.equal((await update([observation('stream', 150, baseline - 500), observation('old-copy', 500, baseline - 500)])).raised, 50);
  assert.equal((await update([observation('stream', 120, baseline - 500)])).raised, 50);
  assert.equal((await update([observation('stream', 150, baseline - 500)], time + 86400000)).raised, 50);
  await writeFile(save, '{"version":99}');
  await assert.rejects(update([observation('new', 42)]), /unsupported/);
  assert.equal(await readFile(save, 'utf8'), '{"version":99}');
});

test('beginner usage multiplier scales growth and wallet but not shop prices', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-growth-beginner-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new CompanionStore(join(dir, 'companion-v1.json'), () => false);
  const observation = (id, total) => ({ id, time, tokens: { total } });
  const update = (rows, multiplier) => store.update(new Map([['claude', rows]]), time, multiplier);
  const initial = await store.update(new Map(), baseline);
  const beginner = await update([observation('first', 100)], 10);
  assert.equal(beginner.raised, 1000);
  assert.equal(beginner.economy.wallet, 1000);
  assert.equal(beginner.progress, 1000);
  assert.deepEqual(beginner.economy.prices, initial.economy.prices);
  const normal = await update([observation('second', 100)], 1);
  assert.equal(normal.raised, 1100);
  assert.equal(normal.progress, 1100);
});

test('limit candy grants survive restart, ignore reset jitter and rearm on the correct edge', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-candy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'companion-v1.json');
  let store = new CompanionStore(path);
  const session = { key: 'codex.codex.primary', used: 100, weekly: false };
  const weekly = { key: 'claude.sevenDay', used: 90, weekly: true, epoch: '2026-11-10T00:00:00Z' };
  assert.equal((await store.grantCandies([session, weekly])).count, 0);
  const reached = { ...weekly, used: 100 };
  const [first, duplicate] = await Promise.all([store.grantCandies([reached]), store.grantCandies([reached])]);
  assert.equal(first.count, 5);
  assert.equal(duplicate, null);
  store = new CompanionStore(path);
  assert.equal(await store.grantCandies([session, reached, { ...reached, epoch: '2026-11-10T00:00:01Z' }]), null);
  assert.equal((await store.read()).economy.inventory.rareCandy, 5);
  assert.equal((await store.grantCandies([{ ...reached, epoch: '2026-11-17T00:00:00Z' }])).count, 5);
  await store.grantCandies([{ ...session, used: 99 }]);
  assert.equal((await store.grantCandies([session])).count, 1);
  assert.equal((await new CompanionStore(path).read()).economy.inventory.rareCandy, 11);
});

test('Ditto conceals shiny, reveals at first evolution and carries excess XP without spending extra candies', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-ditto-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'companion-v1.json');
  const store = new CompanionStore(path);
  const { speciesFor } = await import('../dist/main/companion/catalog.js');
  const imported = await store.replaceImport({
    raised: 750_000_000, progress: 50_000_000, graduated: [], inventory: { rareCandy: 4 },
    active: { id: 'disguised', family: -1, stage: 0, hatchedAt: time, nature: '노력', repeat: false,
      shiny: true, dittoDisguise: 16, route: [16, 17, 18].map(id => speciesFor(id)), rarity: 'common' },
  }, baseline);
  assert.equal(imported.companion.active.shiny, false);
  assert.equal(imported.companion.current.number, 16);
  await store.change({ kind: 'representative', speciesID: 16 });
  const result = await store.change({ kind: 'use', item: 'rareCandy', quantity: 3, id: 'disguised' }, time);
  assert.equal(result.dittoReveal.shiny, true);
  assert.equal(result.current.number, 132);
  assert.equal(result.active.id, 'disguised');
  assert.equal(result.active.shiny, true);
  assert.equal(result.progress, 25_000_000);
  assert.equal(result.economy.inventory.rareCandy, 3);
  assert.equal(result.economy.representative, null);
  assert.deepEqual(result.collection.map(species => species.number), [132]);
  const reopened = await new CompanionStore(path).read();
  assert.equal(reopened.current.number, 132);
  assert.equal(reopened.dittoReveal, undefined);
});

test('difficulty changes preserve earned growth fraction and apply prices without spending wallet tokens', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-difficulty-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'companion-v1.json');
  const store = new CompanionStore(path);
  const before = (await store.replaceImport({ raised: 1_000_000_000, progress: 50_000_000, graduated: [],
    active: { id: 'difficulty', family: 0, stage: 0, hatchedAt: time, nature: '노력',
      shiny: false, repeat: false } }, time)).companion;
  const changed = await store.change({ kind: 'difficulty', growth: .5, shop: 2 });
  assert.equal(changed.progress / changed.threshold, before.progress / before.threshold);
  assert.equal(changed.economy.prices.rareCandy, 1_000_000_000);
  assert.equal(changed.economy.wallet, before.economy.wallet);
  const bought = await store.change({ kind: 'buy', product: 'mint', quantity: 1 });
  assert.equal(bought.economy.wallet, before.economy.wallet - 200_000_000);
  assert.deepEqual(await new CompanionStore(path).read(), bought);
});

test('Windows snapshots preview and restore through the import transaction and retain the previous save backup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-snapshots-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'companion-v1.json');
  const store = new CompanionStore(path);
  await store.replaceImport({ raised: 1_000_000_000, progress: 25_000_000, graduated: [],
    active: { id: 'snapshot-partner', family: 0, stage: 0, hatchedAt: time, nature: '노력', shiny: false, repeat: false } }, time);
  const before = await store.read();
  await store.createSnapshot();
  const snapshots = await store.snapshots();
  assert.equal(snapshots.length, 1);
  await store.change({ kind: 'buy', product: 'mint', quantity: 2 });
  const spent = await readFile(path, 'utf8');
  const incoming = await new CompanionStore(path).snapshotProgress(snapshots[0].id);
  assert.deepEqual(CompanionStore.previewImport(incoming), before);
  const result = await store.replaceImport(incoming, time + 1, await store.read());
  assert.deepEqual(result.companion, before);
  assert.equal(await readFile(result.backupPath, 'utf8'), spent);
  await assert.rejects(store.snapshotProgress('../companion-v1.json'), /스냅샷/);
  assert.throws(() => CompanionStore.decodeWindowsBackup({ format: 'poketokenbar.windows.backup', version: 1,
    files: { 'companion-v1.json': { version: 99 } } }), /unsupported/);
});

test('late Claude accounts arm below the limit before candy can be granted', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-account-candy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'companion-v1.json');
  let store = new CompanionStore(path);
  const extra = { key: 'claude.extra-account.fiveHour', used: 100, weekly: false, requiresArming: true };
  await store.grantCandies([{ key: 'claude.fiveHour', used: 0, weekly: false }]);
  assert.equal(await store.grantCandies([extra]), null);
  await store.grantCandies([{ ...extra, used: 90 }]);
  store = new CompanionStore(path);
  assert.equal((await store.grantCandies([extra])).count, 1);
  assert.equal(await new CompanionStore(path).grantCandies([extra]), null);
});
