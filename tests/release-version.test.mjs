import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseVersion, newerVersion } from '../dist/shared/release-version.js';

test('versions compare three numeric components, starting at 1.0.0', () => {
  assert.equal(newerVersion('1.0.10', '1.0.9'), true);
  assert.equal(newerVersion('1.0.0', '1.0.0'), false);
  assert.equal(newerVersion('0.9.9', '1.0.0'), false);
  assert.equal(newerVersion('2.0.0', '1.99.99'), true);
  assert.equal(releaseVersion(' V001.02.0003 '), '1.2.3');
  for (const tag of ['1.0', '1.0.0-beta.1', '1.0.0+build', '1.0.0.1', '1.0.-1', '1000000000.0.0']) assert.equal(releaseVersion(tag), undefined);
});
