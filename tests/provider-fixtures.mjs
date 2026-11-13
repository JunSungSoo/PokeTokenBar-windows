import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLogs, referenceTime } from './usage-fixtures.mjs';

export async function providerFixtures(base) {
  const roots = await createLogs(base);
  const iso = '2026-06-17T01:00:00Z';
  const ms = Date.parse(iso);
  const seconds = ms / 1000;

  async function log(provider, path, rows) {
    roots[provider] ??= join(base, provider);
    const full = join(roots[provider], path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, rows.map(row => JSON.stringify(row)).join('\n'));
    await utimes(full, new Date(referenceTime), new Date(referenceTime));
  }

  async function database(provider, path, schema, insert, ...params) {
    roots[provider] ??= join(base, provider);
    const full = join(roots[provider], path);
    await mkdir(dirname(full), { recursive: true });
    const db = new DatabaseSync(full);
    try {
      db.exec(schema);
      db.prepare(insert).run(...params);
    } finally { db.close(); }
    await utimes(full, new Date(referenceTime), new Date(referenceTime));
  }

  await log('claude', 'priced/session.jsonl', [
    { type: 'assistant', timestamp: iso, requestId: 'priced', message: {
      id: 'priced', model: 'claude-opus-5', usage: { input_tokens: 13, output_tokens: 2 },
    } },
    { type: 'cost-state', modelUsage: { 'claude-opus-5[1m]': { costUSD: 0.125 } } },
  ]);
  await log('codex', 'sessions/priced.jsonl', [
    { type: 'turn_context', payload: { model: 'gpt-5.4' } },
    { timestamp: iso, type: 'event_msg', payload: { type: 'token_count', info: {
      last_token_usage: { input_tokens: 280000, cached_input_tokens: 1000, output_tokens: 50 },
    } } },
  ]);
  await log('gemini', 'hash/chats/session-x.jsonl', [
    { id: 'turn', timestamp: iso, model: 'gemini-2.5-pro', tokens: { input: 100, output: 8, cached: 10 } },
    { id: 'turn', model: 'gemini-2.5-pro', tokens: { input: 100, output: 11, cached: 10, thoughts: 4, tool: 2 } },
  ]);
  const grok = { timestamp: seconds, params: { update: { sessionUpdate: 'turn_completed', prompt_id: 'g-1',
    usage: { inputTokens: 28, cachedReadTokens: 8, outputTokens: 9, totalTokens: 40, costUsdTicks: 1750000000 } } } };
  await log('grok', 'turn/updates.jsonl', [grok]);
  await log('grok', 'fork/updates.jsonl', [grok]);
  await log('grok', 'child/updates.jsonl', [{ ...grok, params: { update: { ...grok.params.update, prompt_id: 'child' } } }]);
  await log('grok', 'child/summary.json', [{ session_kind: 'subagent' }]);

  for (const provider of ['pi', 'omp', 'omo']) {
    await log(provider, 'agent/sample.jsonl', [
      { type: 'message', id: 'turn', timestamp: iso, message: { role: 'assistant', model: 'gpt-5',
        usage: { input: 23, output: 5, cacheRead: 6, cacheWrite1h: 4, cost: { total: 0.05 } } } },
    ]);
  }
  await log('kimi', 'repo/session/agents/main/wire.jsonl', [{ type: 'usage.record', time: ms,
    usageScope: 'turn', model: 'kimi-code', usage: { inputOther: 4, output: 5, inputCacheRead: 6, inputCacheCreation: 7 } }]);

  await database('opencode', 'opencode.db',
    'CREATE TABLE session_message (id TEXT, time_created INTEGER, type TEXT, data TEXT)',
    'INSERT INTO session_message VALUES (?, ?, ?, ?)', 'o1', ms, 'assistant',
    JSON.stringify({ model: { id: 'gpt-5', providerID: 'openai' },
      tokens: { input: 30, output: 5, reasoning: 3, cache: { read: 10 } }, cost: 0.03 }));
  await database('hermes', 'state.db',
    `CREATE TABLE sessions (id TEXT, model TEXT, billing_provider TEXT, started_at INTEGER, message_count INTEGER,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
    reasoning_tokens INTEGER, estimated_cost_usd REAL, actual_cost_usd REAL)`,
    'INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'h1', 'gpt-5', 'openai', seconds, 2, 31, 5, 6, 7, 8, 0.07, 0);
  await database('copilot', 'session-store.db',
    `CREATE TABLE assistant_usage_events (id INTEGER, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
    cache_read_tokens INTEGER, cache_write_tokens INTEGER, created_at TEXT)`,
    'INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?, ?)', 1, 'gpt-5', 28, 9, 3, 0, iso);
  await database('devin', 'cli/sessions.db',
    `CREATE TABLE sessions (id TEXT, model TEXT); INSERT INTO sessions VALUES ('session','gpt-5');
    CREATE TABLE message_nodes (row_id INTEGER, chat_message TEXT, session_id TEXT, created_at INTEGER)`,
    'INSERT INTO message_nodes VALUES (?, ?, ?, ?)', 1,
    JSON.stringify({ message_id: 'd1', metadata: { metrics: { input_tokens: 11, output_tokens: 6,
      cache_creation_tokens: 7, cache_read_tokens: 10 } } }), 'session', seconds);
  await database('aside', 'profile/state.db',
    `CREATE TABLE sessions (id TEXT, model TEXT); INSERT INTO sessions VALUES ('session','{"modelId":"gpt-5"}');
    CREATE TABLE session_turns (id INTEGER, token_usage TEXT, finished_at INTEGER, last_message_timestamp INTEGER, session_id TEXT)`,
    'INSERT INTO session_turns VALUES (?, ?, ?, ?, ?)', 1,
    JSON.stringify({ input: 12, output: 9, cacheRead: 3, cacheWrite: 1, cost: { total: 0.06 } }), seconds, null, 'session');
  await database('cursor', 'state.vscdb', 'CREATE TABLE cursorDiskKV (key TEXT UNIQUE, value TEXT)',
    'INSERT INTO cursorDiskKV VALUES (?, ?)', 'bubbleId:fixture',
    JSON.stringify({ createdAt: iso, modelType: 'gpt-5', tokenCount: { inputTokens: 22, outputTokens: 9 } }));
  await log('kiro', 'session/messages.jsonl', [
    { timestamp: iso, payload: { type: 'user', content: 'abcdefgh' } },
    { timestamp: iso, payload: { type: 'assistant', content: 'abcdefghijkl' } },
  ]);

  function varint(value) {
    const bytes = [];
    while (value > 127) { bytes.push((value % 128) | 128); value = Math.floor(value / 128); }
    return Buffer.from([...bytes, value]);
  }
  const int = (id, n) => Buffer.concat([varint(id * 8), varint(n)]);
  const msg = (id, ...parts) => {
    const value = Buffer.concat(parts);
    return Buffer.concat([varint(id * 8 + 2), varint(value.length), value]);
  };
  await database('antigravity', 'conversation.db', 'CREATE TABLE gen_metadata (idx INTEGER, data BLOB)',
    'INSERT INTO gen_metadata VALUES (?, ?)', 1, msg(1,
      msg(4, int(2, 21), int(3, 8), int(4, 2), int(5, 7), msg(11, Buffer.from('response'))),
      msg(9, msg(4, int(1, seconds))), msg(19, Buffer.from('gemini-2.5-pro'))));
  return roots;
}

const reset = '2026-06-19T00:00:00Z';
const resetMs = Date.parse(reset);
export const limitFixtures = {
  codex: { rateLimits: { limitId: 'codex', primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: resetMs / 1000 } },
    rateLimitsByLimitId: { codex: { limitId: 'codex' }, codex_other: {
      limitId: 'codex_other', secondary: { usedPercent: 63, windowDurationMins: 10080 },
    } } },
  claude: { five_hour: { utilization: 11, resets_at: reset },
    limits: [{ kind: 'session', percent: 99 }, { kind: 'weekly_scoped', percent: 75, resets_at: reset,
      scope: { model: { display_name: 'Sonnet' } } }] },
  antigravity: { groups: [{ displayName: 'Gemini', buckets: [
    { bucketId: '5h', displayName: '5시간', remainingFraction: 0.75, resetTime: reset },
    { bucketId: 'weekly', displayName: '주간' },
  ] }] },
  opencode: { usage: { rolling: { percent: 18, resetsAt: reset },
    weekly: { percent: 91, resetsAt: '2026-06-01T00:00:00Z' }, monthly: { percent: 22 } } },
  grok: { config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: reset }, creditUsagePercent: 8.5 } },
  cursor: { billingCycleEnd: String(resetMs), planUsage: { includedSpend: 30, limit: 60 } },
};
