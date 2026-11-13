import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { AgentTracker, parseAgentURL, sanitizeAgentText } from '../dist/main/pet/agent-activity.js';
import { parseComponent, ProviderStatusChecker } from '../dist/main/usage/provider-status.js';
import { languages, messages, resolveLanguage, translate } from '../dist/shared/localization.js';
const context = { window: {} }; vm.runInNewContext(await readFile(new URL('../src/renderer/sprite-timing.js', import.meta.url), 'utf8'), context);
const timing = context.window.spriteTiming;
const plain = value => JSON.parse(JSON.stringify(value));
const urls = [
  'poketokenbar://agent?state=working&label=Codex',
  'POKETOKENBAR://AGENT?state=WAITING&label=foo+bar&message=a+b%0Aready%20%20now%20%E2%80%AE',
  'poketokenbar://agent?state=done&state=idle&message=' + encodeURIComponent('👩‍💻'.repeat(90)),
  'poketokenbar://agent?state=waiting&label=' + 'a'.repeat(50) + '&message=' + encodeURIComponent('a' + '\u0301'.repeat(500)),
  'https://agent?state=done', 'poketokenbar://other?state=working', 'poketokenbar://agent?state=unknown',
  'poketokenbar://agent?state=waiting&message=%00%09%20',
];
const operations = [
  { now: 0, url: urls[0] },
  { now: 100, url: 'poketokenbar://agent?state=waiting&label=A&message=Input' },
  { now: 200, url: 'poketokenbar://agent?state=waiting&label=B' },
  { now: 300, url: 'poketokenbar://agent?state=done&label=C' },
  { now: 6299, expire: true }, { now: 6300, expire: true },
  { now: 7000, dismiss: true }, { now: 600000, expire: true },
  ...Array.from({ length: 9 }, (_, index) => ({ now: 601000 + index, url: 'poketokenbar://agent?state=waiting&label=' + index })),
  { now: 601100, url: 'poketokenbar://agent?state=idle&label=8' }, { now: 601200, reset: true },
];
function runOperations() {
  const tracker = new AgentTracker();
  return operations.map(op => {
    if (op.url) tracker.apply(parseAgentURL(op.url), op.now);
    if (op.expire) tracker.expire(op.now);
    if (op.dismiss) tracker.dismiss();
    if (op.reset) tracker.reset();
    return plain(tracker.summary());
  });
}
const statuses = ['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance', 'future'].map(status => ({ name: 'Codex API', raw: { status: { indicator: 'critical' }, components: [{ name: 'ChatGPT', status: 'major_outage' }, { name: 'cOdEx aPi', status }] } }));
statuses.push({ name: 'Claude Code', raw: { components: [{ name: 'Claude Chat', status: 'operational' }] } }, { name: 'Codex API', raw: {} });
const frames = [0.4, 0.2, 0.1].flatMap(floor => [[0.05, 0.05], Array(55).fill(0.05), [0.01, 0.12, 0.03, 0.06, 0.25, 0.07]].map(durations => ({ floor, durations })));

test('eight languages use complete Mac catalogs and retain template arguments', () => {
  assert.equal(languages.length, 8);
  for (const row of messages) { assert.equal(row.length, 8); assert.ok(row.every(value => typeof value === 'string' && value.length)); }
  assert.equal(resolveLanguage('system', 'pt-BR'), 'pt'); assert.equal(resolveLanguage('system', 'zh-CN'), 'en');
  assert.equal(translate('홈', 'en'), 'Home'); assert.equal(translate('홈', 'ja'), 'ホーム');
  assert.equal(translate('최대 {tokens}', 'de', { tokens: '13.3M' }), 'Maximum 13.3M');
});
test('agent parsing protects messages, preserves emoji and literal plus like Foundation', () => {
  assert.equal(parseAgentURL(urls[1]).message, 'a+b ready now');
  assert.equal(parseAgentURL(urls[1]).label, 'foo+bar');
  assert.equal(parseAgentURL(urls[2]).state, 'done');
  assert.equal([...new Intl.Segmenter().segment(parseAgentURL(urls[2]).message)].length, 80);
  assert.ok([...parseAgentURL(urls[3]).message].length <= 320);
  assert.equal(sanitizeAgentText('\n\u200b\t', 80), undefined);
  assert.equal(parseAgentURL(urls[4]), undefined);
});
test('agent precedence, exact timeout boundaries, eviction and dismissal match Mac rules', () => {
  const result = runOperations();
  assert.equal(result[3].done.label, 'C'); assert.equal(result[3].waiting.label, 'B'); assert.equal(result[3].otherWaitingCount, 1);
  assert.equal(result[4].done.label, 'C'); assert.equal(result[5].done, undefined);
  assert.equal(result[6].working, true); assert.equal(result[6].waiting, undefined); assert.equal(result[7].working, false);
  assert.equal(result.at(-3).otherWaitingCount, 7); assert.equal(result.at(-2).otherWaitingCount, 6);
  assert.deepEqual(result.at(-1), { working: false, otherWaitingCount: 0 });
});
test('animation presets decimate without slowing the loop and merge the final short bucket', () => {
  for (const row of frames) {
    const capped = plain(timing.capFrameRate(row.durations, row.floor));
    const total = row.durations.reduce((sum, value) => sum + (value < 0.02 ? 0.1 : value), 0);
    assert.ok(Math.abs(capped.reduce((sum, frame) => sum + frame.duration, 0) - total) < 1e-8);
    assert.equal(capped[0].index, 0);
    assert.equal(timing.frameAt(capped, total + 1e-6), 0);
    if (capped.length > 1) assert.ok(capped.every(frame => frame.duration + 1e-9 >= row.floor));
  }
  assert.equal(timing.capFrameRate(Array(55).fill(0.05), 0.4).length, 6);
});
test('status parser ignores unrelated global outages and maps all component states', () => {
  assert.deepEqual(statuses.map(row => parseComponent(row.raw, row.name)), ['none','minor','major','critical','maintenance','unknown',undefined,undefined]);
});
test('status requests deduplicate, preserve on failure, and clear when disabled', async () => {
  let calls = 0, fail = false;
  const checker = new ProviderStatusChecker(async url => {
    calls++; if (fail) throw new Error('offline');
    return new Response(JSON.stringify({ components: [{ name: url.includes('openai') ? 'Codex API' : 'Claude Code', status: 'partial_outage' }] }));
  });
  const [first, second] = await Promise.all([checker.refresh(true, ['claude','codex']), checker.refresh(true, ['claude','codex'])]);
  assert.equal(calls, 2); assert.deepEqual(first, second); assert.equal(first.length, 2);
  fail = true; assert.deepEqual(await checker.refresh(true, ['codex']), first.filter(row => row.provider === 'codex'));
  assert.deepEqual(await checker.refresh(false, ['codex']), []);
});
test('disabled or untracked providers cannot be restored by late HTTP results', async () => {
  const releases = [];
  const checker = new ProviderStatusChecker(() => new Promise(resolve => releases.push(resolve)));
  const old = checker.refresh(true, ['codex']); await checker.refresh(false, ['codex']);
  releases.shift()(new Response(JSON.stringify({ components: [{ name: 'Codex API', status: 'major_outage' }] })));
  await old; assert.deepEqual(checker.current(), []);
  const pending = checker.refresh(true, ['codex']); await checker.refresh(true, []);
  releases.shift()(new Response(JSON.stringify({ components: [{ name: 'Codex API', status: 'major_outage' }] })));
  await pending; assert.deepEqual(checker.current(), []);
});
test('same inputs match compiled original Mac agent, status and GIF code', { skip: !process.env.POKE_MAC_RUNTIME_ORACLE }, () => {
  const actual = JSON.parse(execFileSync(process.env.POKE_MAC_RUNTIME_ORACLE, { input: JSON.stringify({ urls, operations, statuses, frames }), encoding: 'utf8' }));
  assert.deepEqual(plain(urls.map(url => parseAgentURL(url) ?? null)), actual.events);
  assert.deepEqual(runOperations(), actual.summaries);
  assert.deepEqual(statuses.map(row => parseComponent(row.raw, row.name) ?? null), actual.statuses);
  const capped = frames.map(row => plain(timing.capFrameRate(row.durations, row.floor)));
  capped.forEach((rows, i) => rows.forEach((row, j) => {
    assert.equal(row.index, actual.frames[i][j].index); assert.ok(Math.abs(row.duration - actual.frames[i][j].duration) < 1e-8);
  }));
});
