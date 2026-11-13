import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type Row = Record<string, unknown>;

export function object(value: unknown): Row | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Row : undefined;
}

export function token(value: unknown): number {
  if (typeof value === 'boolean') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1e15, Math.max(0, Math.trunc(value)));
}

export function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return;
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:?\d\d)$/.exec(value);
  if (!match) return;
  const whole = Date.parse(match[1] + match[3]);
  if (Number.isFinite(whole)) return whole + (match[2] ? Number('0.' + match[2]) * 1000 : 0);
}

export function parseRow(line: string): Row | undefined {
  try { return object(JSON.parse(line)); } catch { return undefined; }
}

export async function* logLines(path: string, bytes?: number) {
  const input = createReadStream(path, bytes === undefined ? {} : { end: bytes - 1 });
  // Iterator errors from the input must remain visible even before readline starts iterating.
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    yield* lines;
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function* jsonl(path: string, relevant: (line: string) => boolean) {
  for await (const line of logLines(path)) {
    if (!relevant(line)) continue;
    const row = parseRow(line);
    if (row) yield row;
  }
}
