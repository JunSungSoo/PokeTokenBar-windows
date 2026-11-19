import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyManifest } from '../dist/main/update/manifest.js';
import {
  assertDraftRelease,
  assertSigningKeyTrusted,
  assertSourceMatchesTag,
  assertVersionRule,
  generateKey,
  loadKey,
  publicKeyOf,
  randomPassphrase,
  sign,
} from '../scripts/release/signing.mjs';
import { assertPassphraseInput } from '../scripts/release/passphrase-input.mjs';

const passphrase = 'correct horse battery staple';

test('sign and verify round trip matches the app verifier', () => {
  const { pem, publicKey } = generateKey(passphrase);
  const privateKey = loadKey(pem, passphrase);
  assert.equal(publicKeyOf(privateKey), publicKey);
  const bytes = Buffer.from('version: 1.0.3\r\npath: x\n');
  assert.equal(verifyManifest(bytes, sign(bytes, privateKey), [publicKey]), true);
  assert.equal(verifyManifest(Buffer.from('tampered'), sign(bytes, privateKey), [publicKey]), false);
});

test('private key pem is encrypted and the public key is raw 32 bytes', () => {
  const { pem, publicKey } = generateKey(passphrase);
  assert.match(pem, /ENCRYPTED PRIVATE KEY/);
  assert.equal(Buffer.from(publicKey, 'base64').length, 32);
});

test('wrong passphrase is rejected with a Korean message', () => {
  const { pem } = generateKey(passphrase);
  assert.throws(() => loadKey(pem, 'wrong'), /비밀번호/);
});

test('random passphrase is grouped base32 with 128 bits of entropy', () => {
  const value = randomPassphrase();
  assert.match(value, /^([A-Z2-7]{4}-){6}[A-Z2-7]{2}$/);
  assert.equal(value.replaceAll('-', '').length, 26);
  assert.notEqual(value, randomPassphrase());
});

test('version rule requires x.y.z and package.json match', () => {
  assert.doesNotThrow(() => assertVersionRule('1.0.3', '1.0.3'));
  assert.throws(() => assertVersionRule('v1.0.3', '1.0.3'), /형식/);
  assert.throws(() => assertVersionRule('1.0', '1.0.3'), /형식/);
  assert.throws(() => assertVersionRule('1.0.4', '1.0.3'), /package\.json/);
});

test('signing key must be listed in the app public keys', () => {
  const { publicKey } = generateKey(passphrase);
  const other = generateKey(passphrase).publicKey;
  assert.doesNotThrow(() => assertSigningKeyTrusted(publicKey, [other, publicKey]));
  assert.throws(() => assertSigningKeyTrusted(publicKey, [other, 'REPLACE_WITH_RELEASE_KEY']), /updatePublicKeys/);
});

test('release must be a draft with both assets', () => {
  const assets = [{ name: 'PokeTokenBar-Windows-1.0.3-x64-Setup.exe' }, { name: 'latest.yml' }];
  assert.doesNotThrow(() => assertDraftRelease({ isDraft: true, assets }, '1.0.3'));
  assert.throws(() => assertDraftRelease({ isDraft: false, assets }, '1.0.3'), /초안/);
  assert.throws(() => assertDraftRelease({ isDraft: true, assets: [assets[1]] }, '1.0.3'), /Setup\.exe/);
  assert.throws(() => assertDraftRelease({ isDraft: true, assets: [assets[0]] }, '1.0.3'), /latest\.yml/);
});

test('signing requires HEAD at the tag commit with an unmodified key list', () => {
  const commit = 'a'.repeat(40);
  assert.doesNotThrow(() => assertSourceMatchesTag({ tag: 'v1.0.3', headCommit: commit, tagCommit: commit, keysStatus: '' }));
  assert.throws(() => assertSourceMatchesTag({ tag: 'v1.0.3', headCommit: commit, tagCommit: '', keysStatus: '' }), /v1\.0\.3 태그/);
  assert.throws(() => assertSourceMatchesTag({ tag: 'v1.0.3', headCommit: commit, tagCommit: 'b'.repeat(40), keysStatus: '' }), /HEAD/);
  assert.throws(() => assertSourceMatchesTag({ tag: 'v1.0.3', headCommit: commit, tagCommit: commit, keysStatus: ' M src/main/update/public-keys.ts\n' }), /public-keys\.ts/);
});

test('piped passphrase input needs an explicit opt-in', () => {
  assert.doesNotThrow(() => assertPassphraseInput({ interactive: true, allowStdin: false }));
  assert.doesNotThrow(() => assertPassphraseInput({ interactive: false, allowStdin: true }));
  assert.throws(() => assertPassphraseInput({ interactive: false, allowStdin: false }), /PTB_PASSPHRASE_STDIN=1/);
});
