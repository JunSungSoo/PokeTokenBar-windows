import test from 'node:test';
import assert from 'node:assert/strict';
import { productionUpdateSource, resolveUpdateSource } from '../dist/main/update/update-source.js';
import { windowsReleaseBase } from '../dist/shared/github-release.js';
import { updatePublicKeys } from '../dist/main/update/public-keys.js';

const qaPublicKey = Buffer.alloc(32, 9).toString('base64');

test('production package metadata uses the GitHub feed and the embedded key list', () => {
  assert.deepEqual(productionUpdateSource, { feed: windowsReleaseBase, keys: updatePublicKeys });
  assert.equal(resolveUpdateSource({ version: '1.0.3', portableBuild: false }), productionUpdateSource);
});

test('QA package metadata replaces both the feed and the key list', () => {
  const source = resolveUpdateSource({ version: '1.0.3', updateQA: { feed: 'http://127.0.0.1:4173/', publicKey: qaPublicKey } });
  assert.deepEqual(source, { feed: 'http://127.0.0.1:4173/', keys: [qaPublicKey] });
});

test('malformed QA metadata falls back to the production source', () => {
  for (const updateQA of [null, 'http://127.0.0.1:4173/', { feed: 'http://127.0.0.1:4173/' }, { publicKey: qaPublicKey },
    { feed: 'http://127.0.0.1:4173', publicKey: qaPublicKey }, { feed: 'file:///C:/feed/', publicKey: qaPublicKey },
    { feed: 'http://127.0.0.1:4173/', publicKey: '' }, { feed: 'http://127.0.0.1:4173/', publicKey: 7 }]) {
    assert.equal(resolveUpdateSource({ updateQA }), productionUpdateSource, JSON.stringify(updateQA));
  }
  for (const metadata of [undefined, null, 'text', 3]) assert.equal(resolveUpdateSource(metadata), productionUpdateSource);
});
