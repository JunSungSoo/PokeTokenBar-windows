import { basename } from 'node:path';
import { type Entry, tokens } from './entries.js';
import { jsonl, logLines, object, parseRow, type Row, timestamp, token } from './jsonl.js';

const vectorFields = [
  'input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
  'output_tokens', 'reasoning_output_tokens', 'total_tokens',
] as const;

function vector(value: Row) {
  return vectorFields.map(field => token(value[field]));
}

function breakdown([input, cached, , output]: number[]) {
  return tokens(Math.max(0, input - cached), output, 0, cached);
}

function id(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function metadata(row: Row) {
  const payload = object(row.payload);
  if (row.type !== 'session_meta' || !payload) return;
  return {
    session: id(payload.id) ?? id(payload.session_id),
    parent: id(payload.forked_from_id) ?? id(payload.parent_thread_id),
    subagent: payload.thread_source === 'subagent' || object(payload.source)?.subagent !== undefined,
  };
}

interface State {
  cumulative: number[];
  lastTotal: number;
  fingerprint: string;
}
interface Event {
  entry: Entry;
  session?: string;
  state?: State;
}
export interface Rollout {
  path: string;
  session?: string;
  parent?: string;
  subagent: boolean;
  events: Event[];
}

export async function probeCodexSession(path: string): Promise<string | undefined> {
  for await (const line of logLines(path, 1024 * 1024)) {
    if (line.includes('session_meta')) {
      const row = parseRow(line);
      const meta = row && metadata(row);
      if (meta) return meta.session;
    }
    if (line.includes('token_count')) return;
  }
}

export async function readCodexFile(path: string): Promise<Rollout> {
  const rollout: Rollout = { path, subagent: false, events: [] };
  let session: string | undefined;
  let previousState: string | undefined;
  let turn = 0;
  let model = "codex";
  for await (const row of jsonl(path, line => line.includes('token_count') || line.includes('session_meta') || line.includes('"model"'))) {
    const meta = metadata(row);
    if (meta) {
      if (!rollout.session) Object.assign(rollout, meta);
      if (meta.session && meta.session !== session) {
        session = meta.session;
        previousState = undefined;
      }
    }

    const payload = object(row.payload);
    const candidate = payload?.model ?? object(payload?.turn_context)?.model;
    if (typeof candidate === 'string') model = candidate;
    if (payload?.type !== 'token_count') continue;
    const info = object(payload.info);
    const last = object(info?.last_token_usage);
    const time = timestamp(row.timestamp);
    if (!last || time === undefined) continue;

    const lastVector = vector(last);
    const lastTotal = lastVector[5];
    const rawCumulative = object(info?.total_token_usage);
    const cumulative = rawCumulative && vector(rawCumulative);
    const state = cumulative && { cumulative, lastTotal, fingerprint: cumulative.join(',') + '|' + lastVector.join(',') };
    let counts = breakdown(lastVector);
    if (counts.total === 0 && lastTotal > 0 &&
        (!cumulative || cumulative[5] === lastTotal ||
          (breakdown(cumulative).total === 0 && cumulative[5] > 0))) {
      counts = tokens(lastTotal);
    }

    const entry = { id: 'codex|' + basename(path) + '|' + turn++, time, model, tokens: counts, costUnavailable: breakdown(lastVector).total === 0 && lastTotal > 0 };
    if (session && state && state.fingerprint === previousState) continue;
    previousState = session ? state?.fingerprint : undefined;
    rollout.events.push({ entry, state, session });
  }
  return rollout;
}

function replayPrefix(child: Event[], parent: Event[]): number {
  let count = 0;
  while (count < child.length && count < parent.length) {
    const a = child[count].state;
    const b = parent[count].state;
    if (!a || !b) return 0;
    if (a.fingerprint !== b.fingerprint) break;
    count++;
  }
  return count;
}

function replayByTime(rollout: Rollout): number {
  if (!rollout.parent || rollout.subagent || rollout.events.length === 0) return 0;
  let count = 1;
  while (count < rollout.events.length &&
      rollout.events[count].entry.time - rollout.events[count - 1].entry.time < 1000) count++;
  return count;
}

function resolveOwned(rollout: Rollout, replayCount: number, inherited: Event[]) {
  const owned: Event[] = [];
  let epoch = 0;
  let previousOwner: string | undefined;
  let previous: number[] | undefined;
  for (const event of rollout.events.slice(replayCount)) {
    const owner = rollout.parent ? rollout.session : event.session ?? rollout.session;
    if (owner !== previousOwner) {
      epoch = 0;
      previous = undefined;
      previousOwner = owner;
    }

    const state = event.state;
    const prior = previous;
    if (prior && state?.cumulative.some((value, i) => value < prior[i])) epoch++;
    previous = state?.cumulative;
    let entry = event.entry;
    if (owner && state) {
      const counts = entry.tokens.total === 0 && state.lastTotal > 0 && prior && state.cumulative[5] > prior[5]
        ? tokens(state.lastTotal) : entry.tokens;
      entry = { ...entry, tokens: counts, id: 'codex|' + owner + '|' + epoch + '|' + state.fingerprint };
    }
    owned.push({ ...event, entry });
  }
  return { owned, history: inherited.concat(owned) };
}

export function resolveCodex(rollouts: Rollout[], included: Set<string>): Entry[] {
  const bySession = new Map<string, Rollout[]>();
  const memo = new Map<string, ReturnType<typeof resolveOwned>>();
  rollouts.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const rollout of rollouts) {
    if (!rollout.session) continue;
    const peers = bySession.get(rollout.session) ?? [];
    peers.push(rollout);
    bySession.set(rollout.session, peers);
  }

  function resolve(rollout: Rollout, visiting: Set<string>): ReturnType<typeof resolveOwned> {
    const cached = memo.get(rollout.path);
    if (cached) return cached;
    if (visiting.has(rollout.path)) return resolveOwned(rollout, replayByTime(rollout), []);
    visiting.add(rollout.path);
    let inherited: Event[] = [];
    for (const parent of bySession.get(rollout.parent ?? '') ?? []) {
      if (parent.path === rollout.path) continue;
      const history = resolve(parent, visiting).history;
      const count = replayPrefix(rollout.events, history);
      if (count > inherited.length) inherited = history.slice(0, count);
    }
    visiting.delete(rollout.path);
    const resolved = resolveOwned(rollout, inherited.length || replayByTime(rollout), inherited);
    memo.set(rollout.path, resolved);
    return resolved;
  }

  const entries = new Map<string, Entry>();
  for (const rollout of rollouts) {
    if (!included.has(rollout.path)) continue;
    for (const { entry } of resolve(rollout, new Set()).owned) {
      const prior = entries.get(entry.id);
      if (!prior || entry.time < prior.time) entries.set(entry.id, entry);
    }
  }
  return [...entries.values()];
}
