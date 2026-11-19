import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { parseUpdateManifest, verifyManifest } from '../dist/main/update/manifest.js';
import { placeholderKey, updatePublicKeys } from '../dist/main/update/public-keys.js';

const createKeyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPublicKeyBase64 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  return { privateKey, rawPublicKeyBase64 };
};
const signBase64 = (bytes, privateKey) => sign(null, bytes, privateKey).toString('base64');

const sha512Base64 = Buffer.alloc(64, 7).toString('base64');
const buildYml = ({ version = '1.0.3', path = `PokeTokenBar-Windows-${version}-x64-Setup.exe`, sha512 = sha512Base64 } = {}) => `version: ${version}
files:
  - url: ${path}
    sha512: ${sha512}
    size: 123
path: ${path}
sha512: ${sha512}
releaseDate: '2026-11-19T00:00:00.000Z'
`;

test('valid signature verifies', () => {
  const { privateKey, rawPublicKeyBase64 } = createKeyPair();
  const bytes = Buffer.from(buildYml());
  assert.equal(verifyManifest(bytes, signBase64(bytes, privateKey), [rawPublicKeyBase64]), true);
});

test('one tampered byte fails', () => {
  const { privateKey, rawPublicKeyBase64 } = createKeyPair();
  const bytes = Buffer.from(buildYml());
  const signature = signBase64(bytes, privateKey);
  const tampered = Buffer.from(bytes);
  tampered[0] ^= 1;
  assert.equal(verifyManifest(tampered, signature, [rawPublicKeyBase64]), false);
});

test('different key fails', () => {
  const signer = createKeyPair();
  const other = createKeyPair();
  const bytes = Buffer.from(buildYml());
  assert.equal(verifyManifest(bytes, signBase64(bytes, signer.privateKey), [other.rawPublicKeyBase64]), false);
});

test('second key in list verifies', () => {
  const signer = createKeyPair();
  const other = createKeyPair();
  const bytes = Buffer.from(buildYml());
  assert.equal(verifyManifest(bytes, signBase64(bytes, signer.privateKey), [other.rawPublicKeyBase64, signer.rawPublicKeyBase64]), true);
});

test('invalid base64, placeholder and garbage keys return false without throwing', () => {
  const { privateKey, rawPublicKeyBase64 } = createKeyPair();
  const bytes = Buffer.from(buildYml());
  const signature = signBase64(bytes, privateKey);
  assert.equal(verifyManifest(bytes, '!!!not base64!!!', [rawPublicKeyBase64]), false);
  assert.equal(verifyManifest(bytes, '', [rawPublicKeyBase64]), false);
  assert.equal(verifyManifest(bytes, signature, [placeholderKey]), false);
  assert.equal(verifyManifest(bytes, signature, ['AAAA', '']), false);
  assert.equal(verifyManifest(bytes, signature, []), false);
  assert.deepEqual(updatePublicKeys, ['6n80fGDl0EtlP6yaJIl4PLqdcN+sV2YsMEHzARLdRqs=']);
  assert.equal(placeholderKey, 'REPLACE_WITH_RELEASE_KEY');
});

test('parses electron-builder latest.yml', () => {
  assert.deepEqual(parseUpdateManifest(buildYml()), {
    version: '1.0.3',
    path: 'PokeTokenBar-Windows-1.0.3-x64-Setup.exe',
    sha512: sha512Base64,
  });
});

test('parses quoted values and CRLF', () => {
  const yml = buildYml().replace('version: 1.0.3', "version: '1.0.3'").replace(/\n/g, '\r\n');
  assert.equal(parseUpdateManifest(yml)?.version, '1.0.3');
});

test('rejects bad path, arch, prefix, version and sha512', () => {
  assert.equal(parseUpdateManifest(buildYml({ path: '../x.exe' })), undefined);
  assert.equal(parseUpdateManifest(buildYml({ path: 'PokeTokenBar-Windows-1.0.3-arm64-Setup.exe' })), undefined);
  assert.equal(parseUpdateManifest(buildYml({ path: 'Other-Windows-1.0.3-x64-Setup.exe' })), undefined);
  assert.equal(parseUpdateManifest(buildYml({ version: '1.0', path: 'PokeTokenBar-Windows-1.0-x64-Setup.exe' })), undefined);
  assert.equal(parseUpdateManifest(buildYml({ sha512: Buffer.alloc(10).toString('base64') })), undefined);
  assert.equal(parseUpdateManifest(buildYml({ sha512: 'not base64!' })), undefined);
  assert.equal(parseUpdateManifest('files:\n  - url: a\n'), undefined);
});

test('ignores indented keys when top-level key is missing', () => {
  const yml = `version: 1.0.3
files:
  - url: PokeTokenBar-Windows-1.0.3-x64-Setup.exe
    sha512: ${sha512Base64}
path: PokeTokenBar-Windows-1.0.3-x64-Setup.exe
`;
  assert.equal(parseUpdateManifest(yml), undefined);
});
