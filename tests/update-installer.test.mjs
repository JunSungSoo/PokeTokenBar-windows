import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { UpdateInstaller, sha512File } from '../dist/main/update/installer.js';

const release = { version: '1.0.3', path: 'PokeTokenBar-Windows-1.0.3-x64-Setup.exe', sha512: Buffer.alloc(64, 7).toString('base64') };
const blockedMessage = '배틀·챌린지·교환 중에는 업데이트할 수 없습니다.';
const verifyMessage = '업데이트 파일을 검증하지 못했습니다.';
const installFailedMessage = '업데이트 설치를 시작하지 못했습니다. 앱을 다시 실행합니다.';
const waitFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const createHarness = (overrides = {}) => {
  const calls = [];
  const state = { blocked: false, updateInfo: { ...release }, downloaded: ['C:\\tmp\\setup.exe'], fileHash: release.sha512, ...overrides };
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: async () => {
      calls.push('check');
      return state.updateInfo === null ? null : { updateInfo: state.updateInfo };
    },
    downloadUpdate: async () => {
      calls.push('download');
      if (state.downloadError) throw state.downloadError;
      return state.downloaded;
    },
    quitAndInstall(isSilent, isForceRunAfter) {
      calls.push(`install:${isSilent}:${isForceRunAfter}`);
      if (state.installError) this.emit('error', state.installError);
    },
  });
  const installer = new UpdateInstaller({
    updater,
    blocked: () => {
      calls.push('blocked');
      return typeof state.blocked === 'function' ? state.blocked() : state.blocked;
    },
    prepare: async () => {
      calls.push('prepare');
      if (state.prepareError) throw state.prepareError;
    },
    hashFile: async () => { calls.push('hash'); return state.fileHash; },
    recover: () => calls.push('recover'),
    quitTimeoutMs: state.quitTimeoutMs ?? 60_000,
  });
  return { calls, state, installer, updater };
};

test('정상 순서로 설치한다', async () => {
  const { calls, installer } = createHarness();
  await installer.install(release);
  assert.deepEqual(calls, ['blocked', 'check', 'download', 'hash', 'blocked', 'prepare', 'install:true:true']);
});

test('시작 시 blocked 이면 거부하고 업데이터를 호출하지 않는다', async () => {
  const { calls, installer } = createHarness({ blocked: true });
  await assert.rejects(installer.install(release), { message: blockedMessage });
  assert.deepEqual(calls, ['blocked']);
});

for (const [name, patch] of [['version', { version: '1.0.4' }], ['path', { path: 'other.exe' }], ['sha512', { sha512: 'AAAA' }]]) {
  test(`updateInfo ${name} 불일치면 거부한다`, async () => {
    const { calls, installer } = createHarness({ updateInfo: { ...release, ...patch } });
    await assert.rejects(installer.install(release), { message: verifyMessage });
    assert.ok(!calls.includes('download'));
  });
}

test('checkForUpdates 가 null 이면 거부한다', async () => {
  const { calls, installer } = createHarness({ updateInfo: null });
  await assert.rejects(installer.install(release), { message: verifyMessage });
  assert.ok(!calls.includes('download'));
});

test('다운로드 파일 경로가 없으면 거부한다', async () => {
  const { calls, installer } = createHarness({ downloaded: [] });
  await assert.rejects(installer.install(release), { message: verifyMessage });
  assert.ok(!calls.some((call) => call.startsWith('install')));
});

test('해시 불일치면 quitAndInstall 을 호출하지 않는다', async () => {
  const { calls, installer } = createHarness({ fileHash: 'AAAA' });
  await assert.rejects(installer.install(release), { message: verifyMessage });
  assert.ok(!calls.includes('prepare'));
  assert.ok(!calls.some((call) => call.startsWith('install')));
});

test('다운로드 reject 는 그대로 전파되고 이후 재시도할 수 있다', async () => {
  const { calls, state, installer } = createHarness({ downloadError: new Error('network down') });
  await assert.rejects(installer.install(release), { message: 'network down' });
  assert.ok(!calls.some((call) => call.startsWith('install')));
  state.downloadError = undefined;
  await installer.install(release);
  assert.equal(calls.at(-1), 'install:true:true');
});

test('다운로드 후 blocked 이면 거부하고 설치하지 않는다', async () => {
  let blockedChecks = 0;
  const { calls, installer } = createHarness({ blocked: () => ++blockedChecks > 1 });
  await assert.rejects(installer.install(release), { message: blockedMessage });
  assert.ok(!calls.includes('prepare'));
  assert.ok(!calls.some((call) => call.startsWith('install')));
});

test('동시 install 2회는 다운로드 1회로 합쳐진다', async () => {
  const { calls, installer } = createHarness();
  const first = installer.install(release);
  const second = installer.install(release);
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(calls.filter((call) => call === 'download').length, 1);
  assert.equal(calls.filter((call) => call.startsWith('install')).length, 1);
});

test('quitAndInstall 이 error 를 내보내면 거부하고 recover 를 호출한다', async () => {
  const { calls, installer } = createHarness({ installError: new Error('spawn EACCES') });
  await assert.rejects(installer.install(release), { message: installFailedMessage });
  assert.deepEqual(calls.slice(-2), ['install:true:true', 'recover']);
});

test('quitAndInstall 뒤 error 리스너를 남기지 않는다', async () => {
  const { installer, updater } = createHarness();
  await installer.install(release);
  assert.equal(updater.listenerCount('error'), 0);
});

test('quitAndInstall 뒤 제한 시간 안에 종료되지 않으면 recover 를 호출한다', async () => {
  const { calls, installer } = createHarness({ quitTimeoutMs: 20 });
  await installer.install(release);
  assert.ok(!calls.includes('recover'));
  await waitFor(60);
  assert.equal(calls.filter((call) => call === 'recover').length, 1);
});

test('설치 오류 뒤에는 제한 시간 recover 가 다시 불리지 않는다', async () => {
  const { calls, installer } = createHarness({ installError: new Error('spawn EACCES'), quitTimeoutMs: 20 });
  await assert.rejects(installer.install(release), { message: installFailedMessage });
  await waitFor(60);
  assert.equal(calls.filter((call) => call === 'recover').length, 1);
});

test('prepare 가 실패하면 저장 안 된 데이터를 지키도록 recover 없이 거부한다', async () => {
  const { calls, installer } = createHarness({ prepareError: new Error('save failed') });
  await assert.rejects(installer.install(release), { message: 'save failed' });
  assert.ok(!calls.includes('recover'));
  assert.ok(!calls.some((call) => call.startsWith('install')));
});

test('검증 실패는 prepare 전이므로 recover 를 호출하지 않는다', async () => {
  const { calls, installer } = createHarness({ fileHash: 'AAAA' });
  await assert.rejects(installer.install(release), { message: verifyMessage });
  assert.ok(!calls.includes('recover'));
});

test('sha512File 은 파일 내용의 base64 sha512 를 반환한다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'update-installer-'));
  try {
    const bytes = Buffer.from([0, 1, 2, 3, 250, 251, 252]);
    const filePath = join(directory, 'file.bin');
    writeFileSync(filePath, bytes);
    assert.equal(await sha512File(filePath), createHash('sha512').update(bytes).digest('base64'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
