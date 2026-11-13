import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { tokens, type Entry } from './entries.js';
import { jsonl, object, parseRow, timestamp, token, type Row } from './jsonl.js';

export const localProviders = ['gemini', 'grok', 'pi', 'omp', 'omo', 'kimi', 'opencode', 'hermes', 'copilot', 'devin', 'aside', 'antigravity', 'cursor', 'kiro'] as const;
export type LocalProvider = typeof localProviders[number];

const layouts: Record<LocalProvider, string[]> = {
  gemini: ['.gemini/tmp'], grok: ['.grok/sessions'], pi: ['.pi/agent/sessions'],
  omp: ['.omp/agent/sessions'], omo: ['.omo/agent/sessions', '.senpi/agent/sessions'],
  kimi: ['.kimi-code/sessions'], opencode: ['.local/share/opencode'], hermes: ['.hermes'],
  copilot: ['.copilot'], devin: ['.local/share/devin'], aside: ['.aside/u'],
  antigravity: ['.gemini/antigravity/conversations', '.gemini/antigravity-cli/conversations', '.gemini/antigravity-ide/conversations'],
  cursor: [process.platform === 'darwin' ? 'Library/Application Support/Cursor/User/globalStorage' : '.config/Cursor/User/globalStorage'],
  kiro: ['.kiro/sessions', ...(process.platform === 'darwin' ? ['Library/Application Support/kiro-cli'] : [])],
};

export function localRoots(provider: LocalProvider): string[] {
  const env = process.env;
  const extra: Partial<Record<LocalProvider, (string | undefined)[]>> = {
    pi: [env.PI_CODING_AGENT_SESSION_DIR, env.PI_CODING_AGENT_DIR && join(env.PI_CODING_AGENT_DIR, 'sessions')],
    omp: [env.OMP_CODING_AGENT_DIR && join(env.OMP_CODING_AGENT_DIR, 'sessions')],
    omo: [env.OMO_CODING_AGENT_DIR && join(env.OMO_CODING_AGENT_DIR, 'sessions'),
      env.SENPI_CODING_AGENT_DIR && join(env.SENPI_CODING_AGENT_DIR, 'sessions')],
    kimi: [env.KIMI_CODE_HOME && join(env.KIMI_CODE_HOME, 'sessions')],
    grok: [env.GROK_HOME && join(env.GROK_HOME, 'sessions')],
    opencode: [env.OPENCODE_DATA_DIR, env.XDG_DATA_HOME && join(env.XDG_DATA_HOME, 'opencode')],
    hermes: [env.HERMES_HOME], copilot: [env.COPILOT_HOME], devin: [env.DEVIN_HOME, env.XDG_DATA_HOME && join(env.XDG_DATA_HOME, 'devin')],
    cursor: [env.APPDATA && join(env.APPDATA, 'Cursor', 'User', 'globalStorage')],
    kiro: [env.KIRO_HOME && join(env.KIRO_HOME, 'sessions'), env.KIRO_CLI_HOME, env.APPDATA && join(env.APPDATA, 'kiro-cli')],
  };
  return [...layouts[provider].map(relative => join(homedir(), relative)),
    ...(extra[provider] ?? []).filter((path): path is string => Boolean(path))];
}

export function accepts(provider: LocalProvider, path: string): boolean {
  const name = basename(path);
  switch (provider) {
    case 'gemini': return /\.jsonl?$/.test(name);
    case 'grok': return name === 'updates.jsonl';
    case 'kimi': return name === 'wire.jsonl';
    case 'opencode': return /^opencode.*\.db$/.test(name) || /[/\\]storage[/\\]message[/\\].*\.json$/.test(path);
    case 'hermes':
    case 'aside': return name === 'state.db';
    case 'copilot': return name === 'session-store.db';
    case 'cursor': return name === 'state.vscdb';
    case 'antigravity': return name.endsWith('.db');
    case 'omp': return name.endsWith('.jsonl') && !path.split(/[/\\]/).includes('bridge');
    case 'kiro': return name === 'data.sqlite3' || name === 'messages.jsonl' || (name.endsWith('.jsonl') && basename(dirname(path)) === 'cli');
    case 'devin': return name === 'sessions.db' && basename(dirname(path)) === 'cli';
    default: return name.endsWith('.jsonl');
  }
}

const str = (value: unknown) => typeof value === 'string' ? value : undefined;
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const amount = (value: unknown) => { const n = numeric(value); return n !== undefined && n >= 0 ? n : undefined; };
const when = (value: unknown) => {
  const n = numeric(value);
  return n !== undefined && n > 0 ? (n >= 1e12 ? n : n * 1000) : timestamp(value);
};

function piEntry(provider: 'pi' | 'omp' | 'omo', path: string, row: Row): Entry | undefined {
  const message = object(row.message);
  const direct = row.type === 'message';
  if (direct && (message?.stopReason === 'aborted' || message?.stopReason === 'error')) return;
  if (direct && provider !== 'pi' && message?.role !== 'assistant' &&
      !(provider === 'omo' && message?.role === 'toolResult')) return;
  if (!direct && row.type !== 'compaction' && row.type !== 'branch_summary') return;
  const usage = object(direct ? message?.usage : row.usage);
  const time = (direct ? numeric(message?.timestamp) : undefined) || timestamp(row.timestamp);
  const id = str(row.id);
  if (!usage || time === undefined || (provider === 'pi' && !id)) return;
  const keys = ['input', 'output', 'cacheWrite', 'cacheRead'];
  if (provider === 'omo') keys.push('cacheWrite1h');
  const granular = keys.some(key => numeric(usage[key]) !== undefined || typeof usage[key] === 'boolean');
  if (!granular && numeric(usage.totalTokens) === undefined) return;
  return {
    id: provider === 'pi' ? id! : provider + '|' + (provider === 'omo' ? basename(dirname(path)) + '/' : '') + basename(path) + '|' + (id ?? randomUUID()),
    time, growthIdentity: Boolean(id), model: (provider === 'pi' ? str(row.model) : undefined) ?? str(message?.model) ?? provider,
    tokens: granular ? tokens(token(usage.input), token(usage.output),
      token(usage.cacheWrite) + (provider === 'omo' ? token(usage.cacheWrite1h) : 0),
      token(usage.cacheRead)) : tokens(token(usage.totalTokens)),
    explicitCost: amount(object(usage.cost)?.total), costIsEstimate: true, costUnavailable: !granular,
  };
}

function grokEntry(row: Row): Entry | undefined {
  const notification = object(row.params) ?? row;
  const update = object(notification.update);
  const meta = object(notification._meta);
  const usage = object(update?.usage);
  const id = str(update?.prompt_id)?.trim();
  const time = numeric(meta?.agentTimestampMs) || when(row.timestamp);
  if (!usage || update?.sessionUpdate !== 'turn_completed' || meta?.isReplay || !id || time === undefined) return;
  const full = numeric(usage.inputTokens);
  const reported = token(usage.cachedReadTokens ?? usage.cached_read_tokens);
  const read = full === undefined ? reported : Math.min(reported, token(full));
  const input = full === undefined ? token(usage.input_tokens) : token(full) - read;
  const output = Math.max(token(usage.outputTokens ?? usage.output_tokens),
    token(usage.totalTokens ?? usage.total_tokens) - input - read);
  const counts = tokens(input, output, 0, read);
  if (!counts.total) return;
  const models = object(usage.modelUsage) ?? object(usage.model_usage);
  let model: string | undefined;
  let largest = -1;
  for (const [name, raw] of Object.entries(models ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const values = object(raw);
    const total = token(values?.totalTokens ?? values?.total_tokens);
    if (total > largest) { model = name.trim(); largest = total; }
  }
  const ticks = amount(usage.costUsdTicks ?? usage.cost_usd_ticks);
  const partial = usage.usageIsIncomplete || usage.usage_is_incomplete || usage.costIsPartial || usage.cost_is_partial;
  return { id: 'grok|' + id, time, model: model || 'grok', tokens: counts,
    explicitCost: ticks !== undefined && !partial ? ticks / 1e10 : undefined };
}

function kimiEntry(row: Row): Entry | undefined {
  const usage = object(row.usage);
  const time = numeric(row.time);
  const scope = str(row.usageScope);
  if (row.type !== 'usage.record' || !usage || !time || time < 0 ||
      (scope !== undefined && scope !== 'turn' && scope !== 'session')) return;
  const model = str(row.model) || 'kimi-code';
  const counts = tokens(token(usage.inputOther), token(usage.output),
    token(usage.inputCacheCreation), token(usage.inputCacheRead));
  return { id: ['kimi', Math.trunc(time), model, scope ?? '-', counts.input, counts.output,
    counts.cacheRead, counts.cacheWrite].join('|'), time, model, tokens: counts };
}

async function gemini(path: string): Promise<Entry[]> {
  const entries = new Map<string, Entry>();
  let previous: number | undefined;
  function add(row: Row) {
    previous = timestamp(row.timestamp) ?? previous;
    const usage = object(row.tokens);
    if (!usage || previous === undefined) return;
    const stableID = str(row.id);
    const id = stableID ?? randomUUID();
    const cached = token(usage.cached);
    entries.set(id, {
      id: 'gemini|' + basename(path) + '|' + id, time: previous, growthIdentity: Boolean(stableID), model: str(row.model) ?? 'gemini',
      tokens: tokens(Math.max(0, token(usage.input) - cached) + token(usage.tool),
        token(usage.output) + token(usage.thoughts), 0, cached),
    });
  }
  if (path.endsWith('.jsonl')) {
    for await (const row of jsonl(path, line => line.includes('"tokens"') || line.includes('"timestamp"'))) add(row);
  } else {
    const root = parseRow(await readFile(path, 'utf8'));
    const start = timestamp(root?.startTime);
    if (Array.isArray(root?.messages)) {
      for (const value of root.messages) {
        previous = start;
        const row = object(value);
        if (row) add(row);
      }
    }
  }
  return [...entries.values()];
}

export async function readLocalFile(provider: LocalProvider, path: string, since: number): Promise<Entry[]> {
  if (provider === 'gemini') return gemini(path);
  if (provider === 'kiro' && path.endsWith('.jsonl')) return (await import('./kiro.js')).readKiro(path);
  if (provider === 'grok') {
    const summary = await readFile(join(dirname(path), 'summary.json'), 'utf8').then(parseRow, () => undefined);
    if (str(summary?.session_kind)?.startsWith('subagent')) return [];
  }
  if (path.endsWith('.db') || path.endsWith('.vscdb') || path.endsWith('.sqlite3') || provider === 'opencode') {
    const { readDatabaseProvider } = await import('./sqlite-providers.js');
    return readDatabaseProvider(provider, path, since);
  }
  const entries: Entry[] = [];
  for await (const row of jsonl(path, line => line.includes('usage') || line.includes('Usage'))) {
    const entry = provider === 'grok' ? grokEntry(row) : provider === 'kimi' ? kimiEntry(row)
      : provider === 'pi' || provider === 'omp' || provider === 'omo' ? piEntry(provider, path, row) : undefined;
    if (entry) entries.push(entry);
  }
  return entries;
}
