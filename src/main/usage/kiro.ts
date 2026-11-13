import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tokens, type Entry } from './entries.js';
import { jsonl, object, parseRow, token, type Row } from './jsonl.js';
import { epoch } from './sqlite-providers.js';

function bytes(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + bytes(item), 0);
  const row = object(value);
  if (!row) return 0;
  switch (row.kind) {
    case 'text': return bytes(row.data);
    case 'toolUse': return jsonBytes(object(row.data)?.input);
    case 'toolResult': return bytes(object(row.data)?.content);
    case 'thinking': return bytes(object(row.data)?.text);
    case 'json': return jsonBytes(row.data);
    case undefined: return bytes(row.content ?? row.text ?? row.data);
    default: return 0;
  }
}
function jsonBytes(value: unknown): number {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return Buffer.byteLength(typeof value === 'boolean' ? String(Number(value)) : String(value));
  }
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + jsonBytes(item), 0);
  return Object.values(object(value) ?? {}).reduce<number>((sum, item) => sum + jsonBytes(item), 0);
}

export async function readKiro(path: string): Promise<Entry[]> {
  const v3 = basename(path) === 'messages.jsonl';
  const meta = await readFile(v3 ? join(dirname(path), 'session.json') : path.replace(/\.jsonl$/, '.json'), 'utf8')
    .then(parseRow, () => undefined);
  const session = (v3 ? meta?.id : meta?.session_id) ?? (v3 ? basename(dirname(path)) : basename(path, '.jsonl'));
  const model = v3 ? meta?.modelId : object(object(object(meta?.session_state)?.rts_model_state)?.model_info)?.model_id;
  const fallback = v3 ? epoch(meta?.createdAt) ?? epoch(meta?.lastModifiedAt) : undefined;
  const entries: Entry[] = [];
  let history = 0, prompt = 0, output = 0, tools = 0, index = 0;
  let active = false;
  let time: number | undefined;

  function flush() {
    const date = time ?? fallback;
    if (active && (!v3 || prompt + output > 0)) {
      const counts = tokens(Math.floor((history + prompt + tools) / 4), Math.floor(output / 4));
      if (date !== undefined && counts.total) {
        entries.push({ id: ['kiro', v3 ? 'v3' : 'cli', session, v3 ? index : Math.trunc(date)].join('|'),
          time: date, model: typeof model === 'string' ? model : 'unknown', tokens: counts, costUnavailable: true });
      }
      index++;
    }
    history += prompt + output + tools;
    prompt = output = tools = 0;
    time = undefined;
  }

  for await (const row of jsonl(path, () => true)) {
    const payload = object(row.payload);
    const data = v3 ? payload ?? row : object(row.data);
    const kind = v3 ? payload?.type ?? row.role : row.kind;
    const stamp = v3 ? epoch(row.timestamp) : epoch(object(data?.meta)?.timestamp);
    const content = bytes(data?.content);
    if (kind === 'Prompt' || kind === 'user' || kind === 'human' || kind === 'prompt') {
      if (active) flush();
      active = true;
      prompt = content;
      time = stamp;
    } else if (kind === 'AssistantMessage' || kind === 'assistant' || kind === 'bot') {
      output += content;
      if (v3) {
        active ||= output > 0;
        time ??= stamp;
      }
    } else if (kind === 'ToolResults') tools += content;
    else if (kind === 'tool_result') prompt += content;
    else if (kind === 'tool_call') {
      output += jsonBytes(data?.args);
      active ||= output > 0;
    } else if (kind === 'Clear' || kind === 'turn_end') {
      if (v3) time ??= stamp;
      flush();
      active = false;
      if (!v3) history = 0;
    }
  }
  flush();
  return entries;
}

export function kiroHistory(root: Row, id: string, since: number): Entry[] {
  if (!Array.isArray(root.history)) return [];
  function field(value: unknown): number {
    if (typeof value === 'string') return Buffer.byteLength(value);
    return Object.entries(object(value) ?? {}).reduce((sum, [key, item]) =>
      sum + (key === 'images' ? 0 : jsonBytes(item)), 0);
  }
  let history = jsonBytes(root.latest_summary ?? 0);
  const entries: Entry[] = [];
  for (const raw of root.history) {
    const row = object(raw);
    if (!row) continue;
    const user = field(row.user);
    const meta = object(row.request_metadata);
    const time = typeof meta?.request_start_timestamp_ms === 'number' ? epoch(meta.request_start_timestamp_ms) : undefined;
    const counts = tokens(Math.floor((history + user) / 4), Math.floor(token(meta?.response_size) / 4));
    history += user + field(row.assistant);
    if (time === undefined || time < since || !counts.total) continue;
    entries.push({ id: ['kiro', id, Math.trunc(meta!.request_start_timestamp_ms as number)].join('|'),
      time, model: typeof meta?.model_id === 'string' ? meta.model_id : 'unknown', tokens: counts, costUnavailable: true });
  }
  return entries;
}
