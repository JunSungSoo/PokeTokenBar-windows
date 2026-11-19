import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { GitHubUpdateFeed } from '../dist/main/update/github-feed.js';
import { windowsReleaseBase } from '../dist/shared/github-release.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPublicKeyBase64 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const sha512Base64 = Buffer.alloc(64, 7).toString('base64');
const manifestText = `version: 1.0.3
files:
  - url: PokeTokenBar-Windows-1.0.3-x64-Setup.exe
    sha512: ${sha512Base64}
    size: 123
path: PokeTokenBar-Windows-1.0.3-x64-Setup.exe
sha512: ${sha512Base64}
releaseDate: '2026-11-19T00:00:00.000Z'
`;
const signatureOf = (text) => sign(null, Buffer.from(text), privateKey).toString('base64');
const expectedRelease = { version: '1.0.3', path: 'PokeTokenBar-Windows-1.0.3-x64-Setup.exe', sha512: sha512Base64 };

const createFetch = (routes) => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    const route = routes[url.slice(windowsReleaseBase.length)];
    return typeof route === 'function' ? route() : route();
  };
  return { request, calls };
};
const okRoutes = (overrides = {}) => ({
  'latest.yml': () => new Response(manifestText, { status: 200 }),
  'latest.yml.sig': () => new Response(`${signatureOf(manifestText)}\n`, { status: 200 }),
  ...overrides,
});
const createFeed = (routes, clock = () => 0) => {
  const { request, calls } = createFetch(routes);
  return { feed: new GitHubUpdateFeed(request, clock, windowsReleaseBase, [rawPublicKeyBase64]), calls };
};

test('valid manifest and signature resolve the release', async () => {
  const { feed, calls } = createFeed(okRoutes());
  assert.deepEqual(await feed.check(), expectedRelease);
  assert.deepEqual(calls.map((call) => call.url), [windowsReleaseBase + 'latest.yml', windowsReleaseBase + 'latest.yml.sig']);
  assert.equal(calls[0].options.redirect, 'follow');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('a redirected response that finally returns 200 is accepted', async () => {
  const redirected = (body) => () => {
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, 'redirected', { value: true });
    Object.defineProperty(response, 'url', { value: 'https://release-assets.githubusercontent.com/x' });
    return response;
  };
  const { feed } = createFeed(okRoutes({ 'latest.yml': redirected(manifestText), 'latest.yml.sig': redirected(signatureOf(manifestText)) }));
  assert.deepEqual(await feed.check(), expectedRelease);
});

test('oversized yml body is rejected', async () => {
  const { feed } = createFeed(okRoutes({ 'latest.yml': () => new Response('a'.repeat(65537), { status: 200 }) }));
  await assert.rejects(feed.check());
});

test('oversized content-length header is rejected', async () => {
  const { feed } = createFeed(okRoutes({ 'latest.yml': () => new Response(manifestText, { status: 200, headers: { 'content-length': '65537' } }) }));
  await assert.rejects(feed.check());
});

test('oversized signature is rejected', async () => {
  const { feed } = createFeed(okRoutes({ 'latest.yml.sig': () => new Response('a'.repeat(1025), { status: 200 }) }));
  await assert.rejects(feed.check());
});

test('signature mismatch is rejected with a Korean message', async () => {
  const tampered = manifestText.replace('1.0.3', '9.9.9');
  const { feed } = createFeed(okRoutes({ 'latest.yml': () => new Response(tampered, { status: 200 }) }));
  await assert.rejects(feed.check(), /업데이트 서명을 확인할 수 없습니다/);
});

test('unparsable but correctly signed manifest is rejected', async () => {
  const garbage = 'not: a manifest\n';
  const { feed } = createFeed(okRoutes({
    'latest.yml': () => new Response(garbage, { status: 200 }),
    'latest.yml.sig': () => new Response(signatureOf(garbage), { status: 200 }),
  }));
  await assert.rejects(feed.check(), /업데이트/);
});

test('missing yml or missing signature resolves null', async () => {
  const missingYml = createFeed(okRoutes({ 'latest.yml': () => new Response('', { status: 404 }) }));
  assert.equal(await missingYml.feed.check(), null);
  const missingSignature = createFeed(okRoutes({ 'latest.yml.sig': () => new Response('', { status: 404 }) }));
  assert.equal(await missingSignature.feed.check(), null);
});

test('other non-200 status is rejected', async () => {
  const { feed } = createFeed(okRoutes({ 'latest.yml': () => new Response('', { status: 500 }) }));
  await assert.rejects(feed.check());
});

test('concurrent calls share one pair of requests', async () => {
  const { feed, calls } = createFeed(okRoutes());
  const [first, second] = await Promise.all([feed.check(), feed.check()]);
  assert.deepEqual(first, second);
  assert.equal(calls.length, 2);
});

test('result is cached within the interval and bypassed with minInterval 0', async () => {
  let now = 0;
  const { feed, calls } = createFeed(okRoutes(), () => now);
  await feed.check();
  now = 1_799_999;
  await feed.check();
  assert.equal(calls.length, 2);
  now = 1_800_000;
  await feed.check();
  assert.equal(calls.length, 4);
  await feed.check(0);
  assert.equal(calls.length, 6);
});

test('null result is cached too', async () => {
  const { feed, calls } = createFeed(okRoutes({ 'latest.yml': () => new Response('', { status: 404 }) }));
  assert.equal(await feed.check(), null);
  assert.equal(await feed.check(), null);
  assert.equal(calls.length, 1);
});

test('failures are not cached', async () => {
  let failing = true;
  const { feed } = createFeed(okRoutes({ 'latest.yml': () => (failing ? new Response('', { status: 500 }) : new Response(manifestText, { status: 200 })) }));
  await assert.rejects(feed.check());
  failing = false;
  assert.deepEqual(await feed.check(), expectedRelease);
});
