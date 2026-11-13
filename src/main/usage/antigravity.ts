import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { tokens, type Entry } from './entries.js';
import { query } from './sqlite-providers.js';

type Field = number | Uint8Array;
function fields(value: unknown): Map<number, Field> {
  const result = new Map<number, Field>();
  if (!(value instanceof Uint8Array)) return result;
  const buffer = value;
  let offset = 0;
  function integer(): number | undefined {
    let sum = 0;
    for (let shift = 0; shift < 70 && offset < buffer.length; shift += 7) {
      const byte = buffer[offset++];
      sum += (byte & 127) * 2 ** shift;
      if (byte < 128) return sum;
    }
  }
  while (offset < value.length) {
    const tag = integer();
    if (!tag || !Number.isSafeInteger(tag)) break;
    const number = Math.floor(tag / 8);
    const wire = tag % 8;
    if (wire === 0) {
      const raw = integer();
      if (raw === undefined) break;
      if (!result.has(number)) result.set(number, raw);
    } else if (wire === 2) {
      const length = integer();
      if (length === undefined || length > value.length - offset) break;
      if (!result.has(number)) result.set(number, value.subarray(offset, offset + length));
      offset += length;
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
    } else break;
  }
  return result;
}
const text = (value: Field | undefined) => value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : undefined;
const count = (value: Field | undefined) => typeof value === 'number' && value <= 1e9 ? value : 0;
function date(value: Field | undefined) {
  const stamp = fields(value);
  const seconds = stamp.get(1);
  const nanos = stamp.get(2);
  if (typeof seconds === 'number' && seconds >= 1e9 && seconds <= 4102444800) {
    return seconds * 1000 + (typeof nanos === 'number' && nanos < 1e9 ? nanos / 1e6 : 0);
  }
}

export async function readAntigravity(db: DatabaseSync, path: string): Promise<Entry[]> {
  const modified = (await stat(path)).mtimeMs;
  const responses = new Map<string, number>();
  const executions = new Map<string, number[]>();
  const ordinals = new Map<string, number>();
  for (const row of query(db, 'SELECT metadata FROM steps WHERE metadata IS NOT NULL ORDER BY idx')) {
    const step = fields(row.metadata);
    const time = date(step.get(8)) ?? date(step.get(1));
    if (time === undefined) continue;
    const response = text(fields(step.get(9)).get(11));
    const execution = text(step.get(12));
    if (response) responses.set(response, time);
    if (execution) {
      const dates = executions.get(execution) ?? [];
      dates.push(time);
      executions.set(execution, dates);
    }
  }
  const entries: Entry[] = [];
  for (const row of query(db, 'SELECT idx, data FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx')) {
    const record = fields(row.data);
    const model = fields(record.get(1));
    const usage = fields(model.get(4));
    const response = text(usage.get(11));
    const stamp = fields(model.get(9)).get(4);
    let time = date(stamp);
    if (stamp !== undefined && time === undefined) continue;
    if (time === undefined) {
      const execution = text(record.get(4));
      time = response ? responses.get(response) : undefined;
      const dates = execution ? executions.get(execution) : undefined;
      if (time === undefined && execution && dates?.length) {
        const index = ordinals.get(execution) ?? 0;
        time = dates[Math.min(index, dates.length - 1)];
        ordinals.set(execution, index + 1);
      }
    }
    const counts = tokens(count(usage.get(2)), count(usage.get(3)), count(usage.get(4)), count(usage.get(5)));
    if (counts.total) entries.push({ id: 'antigravity|' + (response ?? basename(path, '.db') + '|' + row.idx),
      time: time ?? modified, model: 'antigravity/' + (text(model.get(19)) ?? 'unknown'), tokens: counts, costUnavailable: true });
  }
  return entries;
}
