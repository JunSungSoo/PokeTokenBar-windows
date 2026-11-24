import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectUsage } from '../dist/main/usage/scan.js';
import { createLogs, referenceTime, writeLog } from './usage-fixtures.mjs';

process.env.TZ = 'Asia/Seoul';

const counters = ({ cost, daily, dailyCost, todayModels, ...usage }) => usage;

const tally = (input, output, cacheWrite, cacheRead) =>
  ({ input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead });

test('reads Codex and Claude JSONL with local dates, duplicates and broken lines', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'poketokenbar-usage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const roots = await createLogs(dir);
  const now = new Date(referenceTime);
  const codex = await collectUsage('codex', roots.codex, now, [roots.codex]);
  assert.deepEqual(counters(codex), {
    today: tally(30, 5, 0, 10), week: tally(90, 15, 0, 50), month: tally(95, 16, 0, 50),
    lastHour: 0, lastFiveHours: 45, extraRoot: roots.codex, unreadable: 0,
  });

  assert.deepEqual(Object.values(codex.daily).sort((a, b) => a - b), [6, 45, 110]);

  const claude = await collectUsage('claude', roots.claude, now, []);
  assert.deepEqual(counters(claude), {
    today: tally(2, 8, 0, 0), week: tally(7, 23, 10, 20), month: tally(12, 23, 10, 20),
    lastHour: 0, lastFiveHours: 10, extraRoot: roots.claude, unreadable: 0,
  });

  for (const provider of ['codex', 'claude']) {
    const empty = await collectUsage(provider, roots.empty, now, []);
    assert.deepEqual(counters(empty), {
      today: tally(0, 0, 0, 0), week: tally(0, 0, 0, 0), month: tally(0, 0, 0, 0),
      lastHour: 0, lastFiveHours: 0, extraRoot: roots.empty, unreadable: 0,
    });
    assert.equal((await collectUsage(provider, join(dir, 'missing'), now, [])).unreadable, 1);
  }
});

test('last-hour totals span midnight, deduplicate entries and exclude future timestamps', async t => {
  const root = await mkdtemp(join(tmpdir(), 'poketokenbar-hour-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = new Date('2026-06-17T15:30:00Z');
  const entry = (id, offset, tokens) => ({
    type: 'assistant', timestamp: new Date(+now + offset).toISOString(),
    message: { id, usage: { input_tokens: tokens } },
  });
  const hour = 60 * 60 * 1000;
  const recent = entry('recent', -hour + 1, 40);
  await writeLog(root, 'chat.jsonl', [
    entry('older', -hour - 1, 50), entry('boundary', -hour, 7), recent,
    entry('now', 0, 20), entry('future', 1, 100),
  ], now);
  await writeLog(root, 'copy.jsonl', [recent], now);
  const usage = await collectUsage('claude', root, now, []);
  assert.equal(usage.lastHour, 67);
  const later = await collectUsage('claude', root, new Date(+now + 2), []);
  assert.equal(later.lastHour, 120);
});

test('Gemini uses CLI session counts from GEMINI_CLI_HOME', async t => {
  const home = await mkdtemp(join(tmpdir(), 'poketokenbar-gemini-cli-'));
  const previousHome = process.env.GEMINI_CLI_HOME;
  process.env.GEMINI_CLI_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.GEMINI_CLI_HOME;
    else process.env.GEMINI_CLI_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });
  const { defaultRoots } = await import('../dist/main/usage/scan.js');
  const root = join(home, '.gemini', 'tmp');
  assert.ok(defaultRoots('gemini').includes(root));
  const now = new Date(referenceTime);
  await writeLog(root, 'project/chats/session-1.jsonl', [{
    id: 'turn', timestamp: now.toISOString(), tokens: { input: 10, output: 5, cached: 3, tool: 2, thoughts: 2 },
  }], now);
  await writeLog(root, 'MyActivity.json', [JSON.stringify([{
    title: 'Prompted an unrelated record', time: now.toISOString(),
  }])], now);
  assert.deepEqual((await collectUsage('gemini', null, now, [root])).today, tally(9, 7, 0, 3));
});

test('regular Claude and ChatGPT chat exports contribute separate estimated usage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'poketokenbar-chat-exports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = new Date('2026-06-18T02:00:00Z');
  const modified = new Date('2025-06-18T02:00:00Z');
  const time = '2026-06-18T01:45:00Z';
  const human = { uuid: 'human', sender: 'human', created_at: time, text: '12345678' };
  const assistant = {
    uuid: 'answer', sender: 'assistant', created_at: time, text: 'abcdefgh',
    content: [{ type: 'text', text: 'abcdefgh' }, { type: 'thinking', text: 'ignored' }],
  };
  const node = (id, role, parts, options = {}) => ({
    id,
    message: {
      id, author: { role }, create_time: Date.parse(time) / 1000,
      content: { content_type: 'multimodal_text', parts },
      ...options,
    },
  });
  const mapping = {
    question: node('question', 'user', ['1234', { asset_pointer: 'image' }]),
    first: node('first', 'assistant', ['abcdefgh'], { metadata: { model_slug: 'gpt-5' }, recipient: 'all' }),
    retried: node('retried', 'assistant', ['ijkl'], { recipient: 'all' }),
    hidden: node('hidden', 'assistant', ['ignored'], { metadata: { is_visually_hidden_from_conversation: true } }),
    tool: node('tool', 'assistant', ['ignored'], { recipient: 'tool' }),
    future: node('future', 'assistant', ['ignored'], { create_time: +now / 1000 + 60 }),
  };
  await writeLog(root, 'claude/conversations.json', [JSON.stringify([{ chat_messages: [human, assistant] }])], modified);
  await writeLog(root, 'claude-copy/conversations-001.json', [JSON.stringify([{ chat_messages: [human] }])], now);
  await writeLog(root, 'chatgpt/conversations-000.json', [JSON.stringify([{ mapping, current_node: 'retried' }])], modified);
  await writeLog(root, 'chatgpt-copy/conversations-002.json', [JSON.stringify([{ mapping: { first: mapping.first } }])], now);

  const claude = await collectUsage('claude-chat', root, now);
  assert.deepEqual(claude.today, tally(2, 2, 0, 0));
  assert.equal(claude.lastHour, 4);
  assert.equal(claude.cost.today.unknown, true);
  const chatgpt = await collectUsage('chatgpt-chat', root, now);
  assert.deepEqual(chatgpt.today, tally(1, 3, 0, 0));
  assert.deepEqual(chatgpt.month, chatgpt.today);
  assert.equal(chatgpt.todayModels['gpt-5'], 2);
  assert.equal(chatgpt.unreadable + claude.unreadable, 0);
});

test('Gemini Apps estimates Takeout messages separately from Gemini CLI', async t => {
  const root = await mkdtemp(join(tmpdir(), 'poketokenbar-gemini-takeout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = new Date('2026-06-18T02:00:00Z');
  const oldFileDate = new Date('2025-06-17T02:00:00Z');
  const turn = {
    header: 'Gemini Apps', time: '2026-06-18T01:45:00Z', title: 'Prompted 안녕하세요',
    safeHtmlItem: [{ html: '<p>1234&amp;abcd</p><script>ignored</script><style>ignored</style>' }],
  };
  await writeLog(root, 'MyActivity.json', [JSON.stringify([
    turn,
    { ...turn, header: 'Search', time: '2026-06-18T01:40:00Z' },
    { ...turn, title: 'Visited Gemini', time: '2026-06-18T01:30:00Z' },
    { ...turn, time: '2026-06-18T03:00:00Z' },
  ])], oldFileDate);
  await writeLog(root, 'MyActivity-2.json', [JSON.stringify([{ ...turn, safeHtmlItem: [] }])], now);
  await writeLog(root, 'cli/chats/session-1.jsonl', [
    { id: 'cli-turn', timestamp: now.toISOString(), tokens: { input: 10, output: 5 } },
  ], now);
  const estimate = await collectUsage('gemini-takeout', root, now);
  const cli = await collectUsage('gemini', root, now, []);
  assert.deepEqual(estimate.today, tally(4, 3, 0, 0));
  assert.equal(estimate.lastHour, 7);
  assert.equal(estimate.cost.today.unknown, true);
  assert.equal(estimate.unreadable, 0);
  assert.deepEqual(cli.today, tally(10, 5, 0, 0));
});

test('the 16 shared providers aggregate fixtures and match the macOS reference when supplied', async t => {
  const { providerFixtures } = await import('./provider-fixtures.mjs');
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'poketokenbar-parity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const roots = await providerFixtures(dir);
  const totals = { codex: 280095, claude: 25, gemini: 117, grok: 40, pi: 34, omp: 34, omo: 38,
    kimi: 22, opencode: 48, hermes: 57, copilot: 37, devin: 34, aside: 25, cursor: 31, kiro: 5, antigravity: 38 };
  assert.equal(Object.keys(totals).length, 16);
  for (const [provider, total] of Object.entries(totals)) {
    const { extraRoot, unreadable, daily, dailyCost, todayModels, lastHour, ...actual } = await collectUsage(provider, roots[provider], new Date(referenceTime), []);
    assert.equal(actual.today.total, total, provider);
    assert.equal(unreadable, 0, provider);
    if (provider === 'hermes') assert.deepEqual(actual.cost.today, { amount: 0, reported: true, estimated: false, unknown: false });
    if (provider === 'codex') assert.ok(Math.abs(actual.cost.today.amount - 1.396625) < 1e-12);
    if (provider === 'claude') assert.ok(Math.abs(actual.cost.today.amount - 0.125126) < 1e-12);
    if (process.env.POKE_MAC_USAGE_ORACLE) {
      const expected = JSON.parse(execFileSync(process.env.POKE_MAC_USAGE_ORACLE, [provider, roots[provider], referenceTime], {
        encoding: 'utf8', env: { ...process.env, LLVM_PROFILE_FILE: join(dir, 'oracle.profraw') },
      }));
      for (const period of ['today', 'week', 'month']) {
        assert.ok(Math.abs(actual.cost[period].amount - expected.cost[period].amount) < 1e-12, provider + ' ' + period + ' cost: ' + actual.cost[period].amount + ' vs ' + expected.cost[period].amount);
        expected.cost[period].amount = actual.cost[period].amount;
      }
      assert.deepEqual(actual, expected, provider);
    }
  }
});

test('quota samples handle multiple buckets, scoped limits, and expired periods', async t => {
  const { limitFixtures } = await import('./provider-fixtures.mjs');
  const { parseLimits } = await import('../dist/main/usage/limits.js');
  const { writeFile } = await import('node:fs/promises');
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'poketokenbar-limits-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const percentages = { codex: [42, 63], claude: [11, 75], antigravity: [25], opencode: [18, 0, 22], grok: [8.5], cursor: [50] };
  for (const [provider, response] of Object.entries(limitFixtures)) {
    const candy = [];
    const windows = parseLimits(provider, response, Date.parse(referenceTime), candy);
    if (provider === 'codex') assert.deepEqual(candy.map(window => [window.weekly, window.epoch]), [[false, undefined], [true, undefined]]);
    if (provider === 'claude') assert.deepEqual(candy.map(window => window.key), ['claude.fiveHour']);
    if (['opencode', 'grok', 'cursor'].includes(provider)) assert.deepEqual(candy, []);
    assert.deepEqual(windows.map(window => window.usedPercent), percentages[provider]);
    if (process.env.POKE_MAC_USAGE_ORACLE) {
      const path = join(dir, provider + '.json');
      await writeFile(path, JSON.stringify(response));
      const expected = JSON.parse(execFileSync(process.env.POKE_MAC_USAGE_ORACLE, [provider, path, referenceTime, 'limits'], {
        encoding: 'utf8', env: { ...process.env, LLVM_PROFILE_FILE: join(dir, 'oracle.profraw') },
      }));
      const observed = windows.map(({ label, ...window }) => window);
      assert.deepEqual(JSON.parse(JSON.stringify(observed)), expected, provider);
    }
  }
});

test('Cursor dashboard follows pagination and never accepts an incomplete result', async t => {
  const { cursorDashboard } = await import('../dist/main/usage/cursor-dashboard.js');
  const before = process.env.CURSOR_SESSION_TOKEN;
  process.env.CURSOR_SESSION_TOKEN = 'fixture-user::fixture-token';
  t.after(() => {
    if (before === undefined) delete process.env.CURSOR_SESSION_TOKEN;
    else process.env.CURSOR_SESSION_TOKEN = before;
  });
  const now = Date.parse(referenceTime);
  const since = now - 86400000;
  let requestCount = 0;
  const result = await cursorDashboard(since, now, async (url, request) => {
    assert.equal(url, 'https://cursor.com/api/dashboard/get-filtered-usage-events');
    const { page, startDate, endDate } = JSON.parse(request.body);
    assert.equal(startDate, String(since));
    assert.equal(endDate, String(now));
    requestCount++;
    if (requestCount === 1) return new Response(null, { status: 401 });
    assert.equal(request.headers.Authorization, 'Bearer fixture-token');
    return Response.json({ usageEvents: [{ id: 'page-' + page, timestamp: String(now), model: 'gpt-5',
      tokenUsage: { inputTokens: 30, outputTokens: 8, cacheReadTokens: 12, totalCents: 8 } }],
    pagination: { hasNextPage: page === 1 } });
  });
  assert.equal(requestCount, 3);
  assert.deepEqual(result.map(row => [row.tokens.total, row.explicitCost]), [[50, 0.08], [50, 0.08]]);
  const incomplete = await cursorDashboard(since, now, async () =>
    Response.json({ usageEvents: [], pagination: { hasNextPage: true } }));
  assert.equal(incomplete, undefined);
});

test('compact token and shop prices follow the Mac K, M and B thresholds', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const code = await readFile(new URL('../src/renderer/token-format.js', import.meta.url), 'utf8');
  const compact = runInNewContext(code + '\ncompactTokens');
  const values = [987, 12_345, 999_949, 999_950, 190_612_940, 999_950_000, 100_000_000, 500_000_000, 1_240_000_000, 2_500_000_000];
  assert.deepEqual(values.map(compact), ['987', '12.3K', '999.9K', '1M', '190.6M', '1B', '100M', '500M', '1.24B', '2.5B']);
});

test('Windows limit warnings survive a saved ledger and ignore tiny reset changes', async () => {
  const { limitAlerts } = await import('../dist/main/usage/limit-alerts.js');
  let ledger = {};
  const observed = (used, reset = 1_800_000_000_000) =>
    [{ provider: 'claude', status: 'available', windows: [{ label: '5시간', usedPercent: used, resetsAt: reset }] }];
  assert.equal(limitAlerts(observed(81), ledger, 80, 95).length, 1);
  ledger = JSON.parse(JSON.stringify(ledger));
  assert.deepEqual(limitAlerts(observed(83, 1_800_000_001_000), ledger, 80, 95), []);
  assert.equal(limitAlerts(observed(96), ledger, 80, 95).length, 1);
  assert.deepEqual(limitAlerts(observed(100), ledger, 80, 95), []);
  assert.equal(limitAlerts(observed(96, 1_800_018_000_000), ledger, 80, 95).length, 1);
});

test('disabled providers make no quota requests and Windows Claude account folders retain distinct reward identities', async t => {
  const { fetchLimits } = await import('../dist/main/usage/limits.js');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'pocket-windows-accounts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const roots = [join(dir, 'default'), join(dir, 'work')];
  for (const root of roots) {
    await mkdir(root);
    await writeFile(join(root, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'fixture-' + root.split('/').at(-1), expiresAt: Date.now() + 60000 },
    }));
  }
  const previousRoot = process.env.CLAUDE_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  let requests = 0;
  process.env.CLAUDE_CONFIG_DIR = roots[0];
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ five_hour: { utilization: 90, resets_at: '2026-11-11T12:00:00Z' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousRoot;
  });
  assert.deepEqual(await fetchLimits([], roots.slice(1), []), []);
  assert.equal(requests, 0);
  const candy = [];
  const results = await fetchLimits(candy, roots.slice(1), ['claude']);
  assert.equal(requests, 2);
  assert.equal(results.length, 2);
  assert.equal(results[1].status, 'available');
  assert.ok(results[1].account);
  assert.equal(new Set(candy.map(window => window.key)).size, 2);
  assert.equal(candy.filter(window => window.requiresArming === true).length, 1);
  assert.equal(candy.find(window => window.requiresArming)?.key.startsWith('claude.'), true);
});
