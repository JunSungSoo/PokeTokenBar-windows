import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { tokens, type Entry } from './entries.js';
import { object, parseRow, timestamp, token, type Row } from './jsonl.js';
import type { LocalProvider } from './local-providers.js';

function json(value: unknown) {
  return typeof value === 'string' || value instanceof Uint8Array
    ? parseRow(typeof value === 'string' ? value : Buffer.from(value).toString()) : undefined;
}

export function epoch(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  return timestamp(value);
}

export function query(db: DatabaseSync, sql: string, ...params: (number | string)[]): Row[] {
  try { return db.prepare(sql).all(...params); }
  catch (error) {
    if (/no such (table|column):/.test(String(error))) return [];
    throw error;
  }
}

function entry(id: string, time: number | undefined, model: unknown, counts: ReturnType<typeof tokens>,
  cost?: unknown, costUnavailable = false, costIsEstimate = false): Entry | undefined {
  if (time === undefined || !counts.total) return;
  return { id, time, model: typeof model === 'string' ? model : 'unknown', tokens: counts,
    explicitCost: typeof cost === 'number' && cost >= 0 && Number.isFinite(cost) ? cost : undefined,
    costUnavailable, costIsEstimate };
}

function openCode(data: Row | undefined, key: unknown, created?: unknown): Entry | undefined {
  const t = object(data?.tokens);
  const model = object(data?.model);
  if (!t || !(created === undefined ? data?.providerID : model?.providerID)) return;
  const cache = object(t.cache);
  const input = token(t.input);
  const write = token(cache?.write);
  const read = token(cache?.read);
  const output = token(t.output) + (created === undefined ? 0 : token(t.reasoning));
  const extra = created === undefined ? Math.max(0, token(t.total) - input - write - read - output) : 0;
  return entry('opencode|' + (created === undefined ? data?.id ?? key : key),
    epoch(created ?? object(data?.time)?.created), model?.id ?? data?.modelID,
    tokens(input, output + extra, write, read), data?.cost, extra > 0);
}

export async function readDatabaseProvider(provider: LocalProvider, path: string, since: number): Promise<Entry[]> {
  if (provider === 'opencode' && path.endsWith('.json')) {
    const value = openCode(json(await readFile(path)), basename(path, extname(path)));
    return value && value.time >= since ? [value] : [];
  }

  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    db.exec('PRAGMA busy_timeout = 1000');
    let entries: (Entry | undefined)[];
    switch (provider) {
      case 'opencode': {
        const columns = query(db, 'PRAGMA table_info(message)');
        const legacy = columns.some(column => column.name === 'time_created')
          ? query(db, 'SELECT id, data FROM message WHERE time_created >= ?', since)
          : query(db, 'SELECT id, data FROM message');
        entries = [
          ...query(db, "SELECT id, time_created, data FROM session_message WHERE type = 'assistant' AND time_created >= ?", since)
            .map(row => openCode(json(row.data), row.id, row.time_created)),
          ...legacy.map(row => openCode(json(row.data), row.id)),
        ];
        break;
      }
      case 'hermes':
        entries = query(db, "SELECT * FROM sessions WHERE model IS NOT NULL AND TRIM(model) != '' AND started_at >= ?", since / 1000)
          .filter(row => typeof row.id === 'string' && row.id.trim())
          .map(row => entry('hermes|' + row.id, epoch(row.started_at), row.model,
            tokens(token(row.input_tokens), token(row.output_tokens) + token(row.reasoning_tokens),
              token(row.cache_write_tokens), token(row.cache_read_tokens)),
            row.actual_cost_usd ?? row.estimated_cost_usd, true, row.actual_cost_usd == null));
        break;
      case 'copilot':
        entries = query(db, 'SELECT * FROM assistant_usage_events WHERE created_at >= ?',
          new Date(since - 86400000).toISOString().slice(0, 10))
          .map(row => {
            const date = typeof row.created_at === 'string' ? row.created_at.trim().replace(' ', 'T') : '';
            const read = token(row.cache_read_tokens);
            const write = token(row.cache_write_tokens);
            return entry('copilot|' + path + '|' + row.id,
              timestamp(/Z|[+-]/.test(date.slice(11)) ? date : date + 'Z'), row.model,
              tokens(Math.max(0, token(row.input_tokens) - read - write), token(row.output_tokens), write, read));
          });
        break;
      case 'devin':
        entries = query(db, 'SELECT m.*, s.model FROM message_nodes m LEFT JOIN sessions s ON s.id = m.session_id WHERE m.created_at >= ?', since / 1000 - 86400)
          .map(row => {
            const message = json(row.chat_message);
            const metrics = object(object(message?.metadata)?.metrics);
            return entry(['devin', path, row.session_id ?? 'nosession', message?.message_id ?? 'row' + row.row_id].join('|'),
              epoch(row.created_at), row.model, tokens(token(metrics?.input_tokens), token(metrics?.output_tokens),
                token(metrics?.cache_creation_tokens), token(metrics?.cache_read_tokens)), undefined, true);
          });
        break;
      case 'aside':
        entries = query(db, `SELECT t.id, t.token_usage, COALESCE(t.finished_at, t.last_message_timestamp) AS activity, s.model
          FROM session_turns t LEFT JOIN sessions s ON s.id = t.session_id
          WHERE COALESCE(t.finished_at, t.last_message_timestamp) >= ?`, since / 1000)
          .map(row => {
            const usage = json(row.token_usage);
            if (!usage) return;
            const hasBuckets = ['input', 'output', 'cacheWrite', 'cacheRead'].some(key => typeof usage[key] === 'number');
            return entry('aside|' + path + '|' + row.id, epoch(row.activity), json(row.model)?.modelId,
              tokens(token(hasBuckets ? usage.input : usage.totalTokens), token(usage.output),
                token(usage.cacheWrite), token(usage.cacheRead)), object(usage.cost)?.total, true);
          });
        break;
      case 'cursor':
        entries = query(db, "SELECT key, value FROM cursorDiskKV WHERE key GLOB 'bubbleId:*'")
          .map(row => {
            const bubble = json(row.value);
            const usage = object(bubble?.tokenCount);
            return entry('cursor|' + row.key, epoch(bubble?.createdAt), bubble?.modelType,
              tokens(token(usage?.inputTokens), token(usage?.outputTokens)), undefined, true);
          });
        break;
      case 'kiro': {
        const { kiroHistory } = await import('./kiro.js');
        return [
          ...query(db, 'SELECT conversation_id, value FROM conversations_v2').flatMap(row => {
            const conversation = json(row.value);
            return conversation ? kiroHistory(conversation, String(row.conversation_id ?? conversation.conversation_id ?? path), since) : [];
          }),
          ...query(db, 'SELECT value FROM conversations').flatMap(row => {
            const conversation = json(row.value);
            return conversation && typeof conversation.conversation_id === 'string'
              ? kiroHistory(conversation, conversation.conversation_id, since) : [];
          }),
        ];
      }
      case 'antigravity': {
        const { readAntigravity } = await import('./antigravity.js');
        return (await readAntigravity(db, path)).filter(entry => entry.time >= since);
      }
      default: return [];
    }
    return entries.filter((row): row is Entry => row !== undefined && row.time >= since);
  } finally {
    db.close();
  }
}
