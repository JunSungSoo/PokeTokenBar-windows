import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { CompanionStore } from '../dist/main/companion/store.js';
import { LanTrade } from '../dist/main/trade/session.js';

async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await sleep(20);
  }
  throw new Error('Timed out waiting for trade');
}

async function fixture(t, id, number, active = false) {
  const dir = await mkdtemp(join(tmpdir(), 'pocket-trade-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'companion-v1.json');
  const item = { id, family: -1, route: [{ number, name: 'Fixture ' + number, type: '' }],
    stage: 0, hatchedAt: 42, nature: '명랑', shiny: true, repeat: false };
  const original = JSON.stringify({ version: 1, baseline: 1, ledger: {}, raised: 999,
    progress: active ? 21000000 : 0, active: active ? item : null,
    graduated: active ? [] : [{ ...item, graduatedAt: 1750000000000 }] });
  await writeFile(path, original);
  const store = new CompanionStore(path);
  const trade = new LanTrade(store, () => {}, () => {});
  t.after(() => trade.close());
  return { trade, store, dir, path, original };
}

async function connect(host, guest) {
  await host.host('Host');
  guest.connect('127.0.0.1:' + host.state().codes[0].split(':')[1], 'Guest');
  await until(() => host.state().phase === 'connected' && guest.state().phase === 'connected');
}

test('two LAN peers swap only after both approve and preserve their exact pre-trade backups', async t => {
  const left = await fixture(t, 'left', 1);
  const right = await fixture(t, 'right', 25);
  await connect(left.trade, right.trade);
  await left.trade.offer('left');
  await right.trade.offer('right');
  await until(() => left.trade.state().canAccept && right.trade.state().canAccept);

  await left.trade.accept();
  assert.equal(await readFile(left.path, 'utf8'), left.original);
  assert.equal(await readFile(right.path, 'utf8'), right.original);
  await right.trade.accept();
  await until(() => left.trade.state().phase === 'complete' && right.trade.state().phase === 'complete');
  const received = (await new CompanionStore(left.path).read()).captures[0];
  assert.equal(received.id, 'right');
  assert.equal(received.shiny, true);
  assert.equal(received.graduatedAt, 1750000000000);
  assert.equal((await new CompanionStore(right.path).read()).captures[0].id, 'left');
  for (const peer of [left, right]) {
    assert.equal(await readFile(peer.trade.state().backupPath, 'utf8'), peer.original);
    assert.equal((await readdir(join(peer.dir, 'companion-backups'))).length, 1);
  }
});

test('active partners retain progress, and disconnect before both approvals leaves saves untouched', async t => {
  const left = await fixture(t, 'active-a', 133, true);
  const right = await fixture(t, 'active-b', 4, true);
  await connect(left.trade, right.trade);
  await left.trade.offer('active-a');
  await right.trade.offer('active-b');
  await until(() => left.trade.state().canAccept && right.trade.state().canAccept);
  await left.trade.accept();
  right.trade.close();
  await until(() => left.trade.state().phase === 'closed');
  assert.equal(await readFile(left.path, 'utf8'), left.original);
  assert.equal(await readFile(right.path, 'utf8'), right.original);

  await connect(left.trade, right.trade);
  await left.trade.offer('active-a');
  await right.trade.offer('active-b');
  await until(() => left.trade.state().canAccept && right.trade.state().canAccept);
  await Promise.all([left.trade.accept(), right.trade.accept()]);
  await until(() => left.trade.state().phase === 'complete' && right.trade.state().phase === 'complete');
  const received = await left.store.read();
  assert.equal(received.current.number, 4);
  assert.equal(received.active.id, 'active-b');
  assert.equal(received.progress, 21000000);
  assert.equal(received.raised, 999);
});

test('rejects oversized frames and refuses approval if the pre-trade backup cannot be written', async t => {
  const left = await fixture(t, 'left', 1);
  const right = await fixture(t, 'right', 25);
  await left.trade.host('Host');
  const socket = createConnection(+left.trade.state().codes[0].split(':')[1], '127.0.0.1');
  socket.on('error', () => {});
  socket.write(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  await until(() => left.trade.state().phase === 'closed');
  socket.destroy();

  await connect(left.trade, right.trade);
  await left.trade.offer('left');
  await right.trade.offer('right');
  await until(() => left.trade.state().canAccept && right.trade.state().canAccept);
  await writeFile(join(left.dir, 'companion-backups'), 'block creation');
  await assert.rejects(left.trade.accept());
  assert.equal(left.trade.state().accepted, false);
  assert.equal(await readFile(left.path, 'utf8'), left.original);
  assert.equal(await readFile(right.path, 'utf8'), right.original);
});

test('Swift macOS TradeSession and Windows LAN session exchange using the original protocol', {
  skip: !process.env.POKE_MAC_TRADE_PEER,
}, async t => {
  const left = await fixture(t, 'windows-fixture', 1);
  await left.trade.host('Windows Fixture');
  const port = left.trade.state().codes[0].split(':')[1];
  const macPath = join(left.dir, 'mac-companion.json');
  const mac = promisify(execFile)(process.env.POKE_MAC_TRADE_PEER, ['127.0.0.1:' + port, macPath], {
    timeout: 12000, env: { ...process.env, LLVM_PROFILE_FILE: join(left.dir, 'mac.profraw') },
  });
  void mac.catch(() => {});
  await until(() => left.trade.state().phase === 'connected');
  await left.trade.offer('windows-fixture');
  await until(() => left.trade.state().canAccept);
  await left.trade.accept();
  await until(() => left.trade.state().phase === 'complete');
  await mac;
  assert.equal((await left.store.read()).captures[0].id, 'mac-fixture');
  const saved = JSON.parse(await readFile(macPath, 'utf8'));
  assert.deepEqual(saved.dex.map(item => item.id), ['windows-fixture']);
  assert.equal(saved.dex[0].finalID, 1);
  assert.ok((await readdir(left.dir)).some(name => name.startsWith('companion-state.pre-trade-')));
});

test('Windows joins a Swift host and retains an active partner’s exact Mac profile seed', {
  skip: !process.env.POKE_MAC_TRADE_PEER,
}, async t => {
  const windows = await fixture(t, 'windows-active', 7, true);
  const macPath = join(windows.dir, 'mac-companion.json');
  const peer = spawn(process.env.POKE_MAC_TRADE_PEER, ['', macPath, 'host-active'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LLVM_PROFILE_FILE: join(windows.dir, 'mac.profraw') },
  });
  t.after(() => { if (peer.exitCode === null) peer.kill(); });
  let output = '';
  let errors = '';
  peer.stdout.on('data', bytes => { output += bytes; });
  peer.stderr.on('data', bytes => { errors += bytes; });
  await until(() => /CODE [\d.]+:\d+/.test(output));
  windows.trade.connect(output.match(/CODE ([\d.]+:\d+)/)[1], 'Windows Fixture');
  await until(() => windows.trade.state().phase === 'connected');
  await windows.trade.offer('windows-active');
  await until(() => windows.trade.state().canAccept);
  await windows.trade.accept();
  await until(() => windows.trade.state().phase === 'complete');
  await until(() => peer.exitCode !== null);
  assert.equal(peer.exitCode, 0, errors);
  const view = await new CompanionStore(windows.path).read();
  assert.equal(view.active.id, 'mac-active');
  assert.equal(view.progress, 33000000);
  assert.equal(view.next.number, 196);
  const local = JSON.parse(await readFile(windows.path, 'utf8'));
  assert.equal(local.active.macProfile.seed, '18446744073709551615');
  const { wireItem } = await import('../dist/main/trade/item.js');
  const outgoing = wireItem(await windows.store.tradeOffer('mac-active'));
  assert.match(JSON.stringify(outgoing), /"seed":18446744073709551615[,}]/);
  const saved = JSON.parse(await readFile(macPath, 'utf8'));
  assert.equal(saved.active.baseID, 7);
  assert.equal(saved.active.usedAtStage, 21000000);
});

test('withdrawal clears both approvals and allows selecting a new offer without touching saves',async t=>{
  const left=await fixture(t,'left',1),right=await fixture(t,'right',25);
  await connect(left.trade,right.trade);await left.trade.offer('left');await right.trade.offer('right');
  await until(()=>left.trade.state().canAccept && right.trade.state().canAccept);
  assert.equal(left.trade.state().theirItem.species.number,25);
  assert.equal(left.trade.state().mineItem.species.number,1);
  await left.trade.accept();assert.equal(left.trade.state().accepted,true);
  right.trade.withdraw();
  await until(()=>!left.trade.state().theirItem && !left.trade.state().accepted);
  assert.equal(left.trade.state().canAccept,false);
  assert.equal(right.trade.state().mineItem,undefined);
  assert.equal(await readFile(left.path,'utf8'),left.original);
  await right.trade.offer('right');await until(()=>left.trade.state().canAccept && right.trade.state().canAccept);
  right.trade.reject();await until(()=>left.trade.state().phase==='closed');
  assert.equal(await readFile(left.path,'utf8'),left.original);
  assert.equal(await readFile(right.path,'utf8'),right.original);
});

test('receiving an active partner over a paid egg requires explicit replacement and clears the old guarantee',async t=>{
  const left=await fixture(t,'left',1),right=await fixture(t,'right',25,true);
  const save=JSON.parse(left.original);save.progress=123;save.eggTier='rare';save.pendingHatchID=1;save.pendingForm='normal';
  await writeFile(left.path,JSON.stringify(save));const before=await readFile(left.path,'utf8');
  await connect(left.trade,right.trade);await left.trade.offer('left');await right.trade.offer('right');
  await until(()=>left.trade.state().canAccept && right.trade.state().canAccept);
  await assert.rejects(left.trade.accept(),/진행을 보존/);assert.equal(await readFile(left.path,'utf8'),before);
  await left.trade.accept(true);await right.trade.accept();
  await until(()=>left.trade.state().phase==='complete' && right.trade.state().phase==='complete');
  const saved=JSON.parse(await readFile(left.path,'utf8'));
  assert.equal(saved.active.id,'right');assert.equal(saved.progress,21000000);assert.equal(saved.eggTier,undefined);
  assert.equal(saved.pendingHatchID,undefined);assert.equal(saved.pendingForm,undefined);assert.equal(saved.raised,999);
  assert.equal(await readFile(left.trade.state().backupPath,'utf8'),before);
  const restored=await new CompanionStore(left.path).read();assert.equal(restored.active.id,'right');
});
