import {expandScanRoots} from './scan-roots.js';
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Provider, ProviderUsage, UsageCost } from '../../shared/usage.js';
import { deduplicateClaude, readClaudeFile } from './claude.js';
import { probeCodexSession, readCodexFile, resolveCodex, type Rollout } from './codex.js';
import { accepts, localRoots, readLocalFile } from './local-providers.js';
import { price } from './pricing.js';
import { type Entry, tokens } from './entries.js';

interface LogFile {
  path: string;
  modified: number;
}

export function defaultRoots(provider: Provider): string[] {
  const home = homedir();
  if (provider === 'codex') {
    const codex = process.env.CODEX_HOME || join(home, '.codex');
    return [...new Set([codex, join(home, '.codex')])].flatMap(root =>
      [join(root, 'sessions'), join(root, 'archived_sessions')]);
  }

  if (provider !== 'claude') return localRoots(provider);
  const custom = (process.env.CLAUDE_CONFIG_DIR ?? '').split(',').map(path => path.trim()).filter(Boolean);
  return [...custom.map(path => join(path, 'projects')),
    join(home, '.config', 'claude', 'projects'), join(home, '.claude', 'projects')];
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function findFiles(roots: string[], optionalRoots: Set<string>, acceptsFile: (path: string) => boolean) {
  const visited = new Set<string>();
  const files: LogFile[] = [];
  let unreadable = 0;

  async function visit(path: string, optional = false): Promise<void> {
    let canonical: string;
    let children;
    try {
      canonical = await realpath(path);
      const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
      if (visited.has(key)) return;
      visited.add(key);
      const info = await stat(canonical);
      if (info.isFile() && acceptsFile(canonical)) {
        files.push({ path: canonical, modified: info.mtimeMs });
        return;
      }
      children = await readdir(canonical, { withFileTypes: true });
    } catch (error) {
      if (!optional || !isMissing(error)) unreadable++;
      return;
    }
    for (const child of children) {
      if (child.name.startsWith('.')) continue;
      const path = join(canonical, child.name);
      if (child.isDirectory()) await visit(path);
      else if (child.isFile() && acceptsFile(path)) {
        try {
          files.push({ path, modified: (await stat(path)).mtimeMs });
        } catch (error) {
          if (!isMissing(error)) unreadable++;
        }
      }
    }
  }

  for (const root of roots) await visit(root, optionalRoots.has(root));
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, unreadable };
}

function localDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function calendar(now: Date) {
  const locale = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale);
  const withWeekInfo = locale as Intl.Locale & {
    weekInfo?: { firstDay: number };
    getWeekInfo?: () => { firstDay: number };
  };
  const firstDay = (withWeekInfo.getWeekInfo?.() ?? withWeekInfo.weekInfo)?.firstDay ?? 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() - firstDay + 7) % 7));
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const recent = new Date(today);
  recent.setDate(today.getDate() - 29);
  return { today, week, month, scanStart: Math.min(+recent, +week, +month) };
}

async function scanCodex(
  files: LogFile[], since: number,
  loadFile: (path: string) => Promise<Rollout | undefined>,
  probe: (path: string) => Promise<string | undefined>,
): Promise<Entry[]> {
  const active = files.filter(file => file.modified >= since);
  const included = new Set(active.map(file => file.path));
  const loaded = new Map<string, Rollout>();
  async function load(path: string) {
    const rollout = await loadFile(path);
    if (rollout) loaded.set(path, rollout);
    return rollout;
  }

  const parents = new Set<string>();
  for (const { path } of active) {
    const rollout = await load(path);
    if (rollout?.parent) parents.add(rollout.parent);
  }

  // A parent can predate the reporting window. Its events are only used to match replay.
  for (const parent of parents) {
    if ([...loaded.values()].some(rollout => rollout.session === parent)) continue;
    const older = files.filter(file => !included.has(file.path) && !loaded.has(file.path));
    const hinted = older.filter(file => /[\p{L}\p{N}]/u.test(parent) && basename(file.path).includes(parent));
    let found = false;
    for (const { path } of hinted) {
      const rollout = await load(path);
      if (rollout?.session !== parent) {
        loaded.delete(path);
        continue;
      }
      found = true;
      if (rollout.parent) parents.add(rollout.parent);
    }
    if (found) continue;

    const hintedPaths = new Set(hinted.map(file => file.path));
    for (const { path } of older) {
      if (hintedPaths.has(path)) continue;
      if (await probe(path) !== parent) continue;
      const rollout = await load(path);
      if (rollout?.parent) parents.add(rollout.parent);
    }
  }
  return resolveCodex([...loaded.values()], included);
}

export async function matchingScanFiles(provider:Provider,raw:string){const roots=await expandScanRoots(raw);const found=await findFiles(roots,new Set(roots),path=>provider==='codex'||provider==='claude'?path.endsWith('.jsonl'):accepts(provider,path));return {roots,count:found.files.length};}
export async function collectUsage(
  provider: Provider, extraRoot: string | null, now = new Date(), roots = defaultRoots(provider), remoteCursor = false, observe?: (entries: readonly Entry[]) => void,
): Promise<ProviderUsage> {
  const ranges = calendar(now);
  const remote = provider === 'cursor' && remoteCursor
    ? await import('./cursor-dashboard.js').then(module => module.cursorDashboard(ranges.scanStart, +now)).catch(() => undefined)
    : undefined;
  const isTranscript = provider === 'codex' || provider === 'claude';
  const expanded=extraRoot?await expandScanRoots(extraRoot):[];
  const extras=extraRoot&&!expanded.length&&!/[?*,\r\n]/.test(extraRoot)?[extraRoot]:expanded;
  const found = remote ? { files: [], unreadable: 0 } : await findFiles(extraRoot ? [...roots, ...extras] : roots,
    new Set(roots.filter(root => root !== extraRoot)),
    path => isTranscript ? path.endsWith('.jsonl') : accepts(provider, path));
  const unreadableFiles = new Set<string>();
  function readOnce<T>(read: (path: string) => Promise<T>) {
    const cached = new Map<string, Promise<T | undefined>>();
    return (path: string) => {
      let result = cached.get(path);
      if (!result) {
        result = read(path).catch(error => {
          if (!isMissing(error)) unreadableFiles.add(path);
          return undefined;
        });
        cached.set(path, result);
      }
      return result;
    };
  }

  let entries: Entry[];
  let dailyEntries: Entry[];
  if (remote) {
    entries = deduplicateClaude(remote);
    dailyEntries = entries;
  } else if (provider === 'codex') {
    const load = readOnce(readCodexFile);
    const probe = readOnce(probeCodexSession);
    entries = await scanCodex(found.files, ranges.scanStart, load, probe);
    dailyEntries = await scanCodex(found.files, +ranges.today, load, probe);
  } else {
    const records: Entry[] = [];
    const dailyRecords: Entry[] = [];
    for (const { path, modified } of found.files) {
      const database = path.endsWith('.db') || path.endsWith('.vscdb') || path.endsWith('.sqlite3');
      if (!database && modified < ranges.scanStart) continue;
      try {
        const fileEntries = provider === 'claude' ? await readClaudeFile(path)
          : await readLocalFile(provider, path, ranges.scanStart);
        for (const entry of fileEntries) {
          records.push(entry);
          if (database || modified >= +ranges.today) dailyRecords.push(entry);
        }
      } catch (error) {
        if (!isMissing(error)) unreadableFiles.add(path);
      }
    }
    entries = deduplicateClaude(records);
    dailyEntries = deduplicateClaude(dailyRecords);
  }

  // Cursor's dashboard event IDs and IDE bubble IDs name different records. Growth always
  // uses the local source, so switching the dashboard on or off cannot pay for a turn twice.
  if (remote && observe) await collectUsage(provider, extraRoot, now, roots, false, observe);
  else observe?.(entries);
  const newCost = (): UsageCost => ({ amount: 0, reported: false, estimated: false, unknown: false });
  const cost = { today: newCost(), week: newCost(), month: newCost() };
  const todayModels:Record<string,number> = {};
  const today = tokens();
  const week = tokens();
  const month = tokens();
  const todayKey = localDay(now);
  const weekKey = localDay(ranges.week);
  const monthKey = localDay(ranges.month);
  const blockStart = +now - 5 * 60 * 60 * 1000;
  let lastFiveHours = 0;
  function addCost(costTotal: UsageCost, entry: Entry) {
    if (!entry.tokens.total) return;
    const priced = price(entry);
    if (!priced) {
      costTotal.unknown = true;
      return;
    }
    costTotal.amount += priced.amount;
    if (priced.kind === 'source') costTotal.reported = true;
    else costTotal.estimated = true;
  }

  function add(total: typeof today, costTotal: UsageCost, entry: Entry) {
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += entry.tokens[key];
    addCost(costTotal, entry);
  }

  const daily: Record<string, number> = {};
  const dailyCost: Record<string, UsageCost> = {};
  for (const entry of dailyEntries) {
    if (localDay(new Date(entry.time)) === todayKey) {add(today, cost.today, entry);if(entry.model)todayModels[entry.model]=(todayModels[entry.model]??0)+entry.tokens.total;}
  }
  for (const entry of entries) {
    if (entry.time >= blockStart) lastFiveHours += entry.tokens.total;
    const day = localDay(new Date(entry.time));
    if (day > todayKey) continue;
    if (day !== todayKey) {
      daily[day] = (daily[day] ?? 0) + entry.tokens.total;
      addCost(dailyCost[day] ??= newCost(), entry);
    }
    if (day >= weekKey) add(week, cost.week, entry);
    if (day >= monthKey) add(month, cost.month, entry);
  }
  daily[todayKey] = today.total;
  dailyCost[todayKey] = cost.today;
  return { todayModels, daily, dailyCost, today, week, month, cost, lastFiveHours, extraRoot, unreadable: found.unreadable + unreadableFiles.size };
}
