import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CompanionStore } from '../dist/main/companion/store.js';
import { decodeMacSave, readMacSave } from '../dist/main/companion/mac-save.js';

const fixture = new URL('./fixtures/poketokenbar-macos-v2.json', import.meta.url);
const now = Date.parse('2026-11-10T03:00:00Z');
const empty = new Map();
const event = (id, time, total) => ({ id, time, tokens: { total } });

async function windowsSave(t) {
  const dir = await mkdtemp(join(tmpdir(), 'poketokenbar-import-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'companion-v1.json');
  const store = new CompanionStore(path);
  await store.update(empty, now - 10000);
  await store.update(new Map([['codex', [event('windows-grown', now - 5000, 6000000)]]]), now - 5000);
  return { dir, path, store, original: await readFile(path) };
}

test('previews a real macOS v2 export, backs up Windows bytes and restores growth and collection after restart', async t => {
  const { dir, path, store, original } = await windowsSave(t);
  const { progress, appVersion, sourceDevice } = decodeMacSave(await readFile(fixture));
  assert.equal(appVersion, '3.1.2');
  assert.equal(sourceDevice, 'Fixture Mac');
  const prior = await store.read();
  const incoming = CompanionStore.previewImport(progress);
  assert.equal(incoming.raised, 911000000);
  assert.equal(incoming.progress, 42000000);
  assert.equal(incoming.current.number, 17);
  assert.equal(incoming.next.number, 18);
  assert.equal(incoming.threshold, 625000000);
  assert.deepEqual(incoming.collection.map(entry => entry.number), [16, 17, 133, 197, 201]);
  assert.equal(incoming.active.id, 'fixture-active');
  assert.equal(incoming.active.level, 21);
  assert.equal(incoming.active.shiny, true);
  assert.equal(incoming.captures[1].form, 'b');
  assert.ok(incoming.captures[1].releasedAt);
  assert.deepEqual(await readFile(path), original);
  assert.equal((await readdir(dir)).length, 1);

  const imported = await store.replaceImport(progress, now, prior);
  assert.deepEqual(imported.companion, incoming);
  assert.deepEqual(await readFile(imported.backupPath), original);
  const restarted = new CompanionStore(path);
  assert.deepEqual(await restarted.read(), incoming);
  const oldLocal = event('windows-grown', now - 5000, 6000000);
  assert.deepEqual(await restarted.update(new Map([['codex', [oldLocal]]]), now + 1000), incoming);
  const newLocal = event('new', now + 1000, 583000000);
  const evolved = await restarted.update(new Map([['codex', [oldLocal, newLocal]]]), now + 1000);
  assert.equal(evolved.current.number, 18);
  assert.equal(evolved.progress, 0);
  assert.equal(evolved.collection.length, 6);
  assert.deepEqual(await restarted.update(new Map([['codex', [oldLocal, newLocal]]]), now + 1000), evolved);
  const second = await restarted.replaceImport(progress, now + 2000, evolved);
  assert.notEqual(imported.backupPath, second.backupPath);
  assert.deepEqual(await readFile(imported.backupPath), original);
});

test('truncated, wrong-version, invalid-state, and oversized files leave the Windows save byte-for-byte intact', async t => {
  const { dir, path, store, original } = await windowsSave(t);
  const current = await store.read();
  const data = await readFile(fixture);
  const invalidState = JSON.parse(data);
  invalidState.state.dex[0].chainOrder = [133, 133];
  const future = JSON.parse(data);
  future.schema = 3;
  const wrongShape = JSON.parse(data);
  wrongShape.state = {};
  for (const bytes of [data.subarray(0, 200), JSON.stringify(invalidState), JSON.stringify(future),
    JSON.stringify(wrongShape), Buffer.alloc(8 * 1024 * 1024 + 1)]) {
    const file = join(dir, 'broken.save');
    await writeFile(file, bytes);
    await assert.rejects(async () => {
      const { progress } = await readMacSave(file);
      await store.replaceImport(progress, now, current);
    });
    assert.deepEqual(await readFile(path), original);
    assert.deepEqual(await store.read(), current);
    assert.equal((await readdir(dir)).includes('companion-backups'), false);
  }
});

test('a stale preview or failed backup prevents overwriting the Windows save', async t => {
  const { dir, path, store } = await windowsSave(t);
  const stale = await store.read();
  const { progress } = decodeMacSave(await readFile(fixture));
  await store.update(new Map([['codex', [event('new-progress', now, 1000)]]]), now);
  const original = await readFile(path);
  await assert.rejects(store.replaceImport(progress, now, stale), /상태가 변경/);
  assert.deepEqual(await readFile(path), original);

  await writeFile(join(dir, 'companion-backups'), 'blocks backup directory creation');
  await assert.rejects(store.replaceImport(progress, now, await store.read()), /백업하지 못했습니다/);
  assert.deepEqual(await readFile(path), original);
});

test('an egg export restores its incubation tokens and retains the previously caught species', async t => {
  const { store } = await windowsSave(t);
  const data = JSON.parse(await readFile(fixture, 'utf8'));
  delete data.state.active;
  data.state.eggUsage = 2_400_000;
  const { progress } = decodeMacSave(Buffer.from(JSON.stringify(data)));
  const { companion } = await store.replaceImport(progress, now, await store.read());
  assert.equal(companion.current, null);
  assert.equal(companion.progress, 2_400_000);
  assert.equal(companion.threshold, 5_000_000);
  assert.deepEqual(companion.collection.map(entry => entry.number), [133, 197, 201]);
});

test('restores the Mac wallet and bag, and saves purchases, candy and representative selection atomically', async t => {
  const { path, store } = await windowsSave(t);
  const envelope = JSON.parse(await readFile(fixture, 'utf8'));
  Object.assign(envelope.state, {
    usedSinceInstall: 9_000_000_000, spentTokens: 1_000_000_000,
    inventory: { rareCandy: 2, mint: 1 }, representativeSpeciesID: 201, representativeForm: 'b',
  });
  const { progress } = decodeMacSave(Buffer.from(JSON.stringify(envelope)));
  const { companion: imported } = await store.replaceImport(progress, now);
  assert.equal(imported.economy.wallet, 8_000_000_000);
  assert.deepEqual(imported.economy.inventory, { rareCandy: 2, mint: 1 });
  assert.equal(imported.pet.species.number, 201);
  assert.equal(imported.pet.species.form, 'b');
  const buy = { kind: 'buy', product: 'shinyCharm', quantity: 1 };
  const purchases = await Promise.allSettled([store.change(buy), store.change(buy)]);
  assert.deepEqual(purchases.map(result => result.status), ['fulfilled', 'rejected']);
  const candy = await store.change({ kind: 'use', item: 'rareCandy', quantity: 1, id: imported.active.id }, now);
  assert.equal(candy.progress, imported.progress + 100_000_000);
  assert.equal(candy.raised, imported.raised);
  assert.equal(candy.economy.wallet, 5_000_000_000);
  assert.equal(candy.economy.inventory.rareCandy, 1);
  const minted = await store.change({ kind: 'use', item: 'mint', quantity: 1, id: imported.active.id }, now);
  assert.notEqual(minted.active.nature, candy.active.nature);
  const egg = await store.change({ kind: 'buy', product: 'eggRare', quantity: 1, activeID: imported.active.id }, now);
  assert.equal(egg.active, null);
  assert.equal(egg.economy.eggTier, 'rare');
  assert.ok(egg.captures.find(capture => capture.id === imported.active.id)?.releasedAt);
  const reloaded = new CompanionStore(path);
  assert.deepEqual(await reloaded.read(), egg);
  const hatched = await reloaded.update(new Map([['codex', [event('egg-after-import', now + 1, 5_000_000)]]]), now + 1);
  assert.ok(['rare', 'legendary'].includes(hatched.active.rarity));
  assert.equal(hatched.economy.eggTier, undefined);
  assert.equal(hatched.economy.inventory.shinyCharm, 1);
});

test('import merges Mac and Windows candy receipts without paying the same window twice', async t => {
  const { store, path } = await windowsSave(t);
  const local = { key: 'codex.codex.primary', used: 0, weekly: false };
  await store.grantCandies([local]);
  await store.grantCandies([{ ...local, used: 100 }]);
  const envelope = JSON.parse(await readFile(fixture, 'utf8'));
  const epoch = '2026-11-10T08:00:00Z';
  Object.assign(envelope.state, {
    candyFeatureSeeded: true, candyGrantTier: { 'claude.fiveHour': 1 },
    candyWindowEpoch: { 'claude.fiveHour': epoch }, inventory: { rareCandy: 4 },
  });
  const { progress } = decodeMacSave(Buffer.from(JSON.stringify(envelope)));
  await store.replaceImport(progress, now);
  const reopened = new CompanionStore(path);
  assert.equal(await reopened.grantCandies([{ ...local, used: 100 },
    { key: 'claude.fiveHour', weekly: false, used: 100, epoch }]), null);
  assert.equal((await reopened.read()).economy.inventory.rareCandy, 4);
});
