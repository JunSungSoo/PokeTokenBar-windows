import{claudeAccountSources,type ClaudeAccountSource}from'./claude-accounts.js';
import type { CandyWindow } from '../companion/candy-grants.js';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { LimitResult, LimitWindow, Provider } from '../../shared/usage.js';
import { object, parseRow, timestamp, type Row } from './jsonl.js';
import { localRoots } from './local-providers.js';
import {SessionKeys,LimitsError} from './session-key.js';

const supported = ['codex', 'claude', 'antigravity', 'opencode', 'grok', 'cursor'] as const;
type LimitedProvider = typeof supported[number];
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const string = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

export function parseLimits(provider: LimitedProvider, value: unknown, now = Date.now(), candy?: CandyWindow[]): LimitWindow[] {
  const data = object(value);
  if (!data) return [];
  const windows: LimitWindow[] = [];
  function add(label: string, used: unknown, reset?: number, expire = false, spanSeconds?:number, forecastEligible=false) {
    const percent = number(used);
    if (percent === undefined) return;
    const ended = expire && reset !== undefined && reset <= now;
    windows.push({ label, usedPercent: ended ? 0 : Math.max(0, percent), resetsAt: ended ? undefined : reset, ...(spanSeconds!==undefined?{spanSeconds}:{}),...(forecastEligible?{forecastEligible:true,notStarted:percent===0&&reset===undefined}:{}) });
  }
  function reward(key: string, used: unknown, weekly: boolean, reset?: number) {
    const percent = number(used);
    if (percent === undefined || !candy || candy.some(window => window.key === key)) return;
    candy.push({ key, used: Math.max(0, percent), weekly, epoch: reset === undefined ? undefined : new Date(reset).toISOString() });
  }
  if (provider === 'codex') {
    const first = object(data.rateLimits);
    if (!first) return [];
    const snapshots = [first];
    for (const [id, raw] of Object.entries(object(data.rateLimitsByLimitId) ?? {}).sort()) {
      const row = object(raw);
      if (row && id !== (first.limitId ?? 'codex') && (!row.limitId || row.limitId !== first.limitId)) snapshots.push(row);
    }
    for (const row of snapshots) {
      const name = (string(row.limitName ?? row.limitId) ?? 'Codex').replaceAll('_', ' ');
      for (const key of ['primary', 'secondary']) {
        const window = object(row[key]);
        const mins = number(window?.windowDurationMins);
        const reset = number(window?.resetsAt);
        const period = mins === 300 ? '5시간' : mins === 10080 ? '주간' : mins ? mins + '분' : '한도';
        reward('codex.' + (string(row.limitId ?? row.limitName) ?? 'codex') + '.' + key,
          window?.usedPercent, (mins ?? 0) > 1440);
        add(name + ' · ' + period, window?.usedPercent, reset === undefined ? undefined : reset * 1000,false,mins!==undefined&&mins>0?mins*60:undefined);
      }
      const spend = object(row.individualLimit);
      const remaining = number(spend?.remainingPercent);
      const reset = number(spend?.resetsAt);
      if (remaining !== undefined) add(name + ' · 지출', Math.min(100, 100 - remaining), reset === undefined ? undefined : reset * 1000);
    }
  } else if (provider === 'claude') {
    for (const [key, label] of [['five_hour', '5시간'], ['seven_day', '주간'],
      ['seven_day_opus', 'Opus 주간'], ['seven_day_sonnet', 'Sonnet 주간']]) {
      const window = object(data[key]);
      const reset = timestamp(window?.resets_at);
      if (key === 'five_hour' || key === 'seven_day') {
        reward(key === 'five_hour' ? 'claude.fiveHour' : 'claude.sevenDay', window?.utilization, key === 'seven_day', reset);
      }
      add(label, window?.utilization, reset,false,key==='five_hour'?18000:604800,key==='five_hour');
    }
    if (Array.isArray(data.limits)) for (const raw of data.limits) {
      const row = object(raw);
      const model = object(object(row?.scope)?.model);
      const label = string(model?.display_name ?? row?.group) ??
        (row?.kind === 'session' ? '5시간' : row?.kind === 'weekly_all' ? '주간' : '추가 한도');
      const reset = timestamp(row?.resets_at);
      if (row?.kind === 'session' || row?.kind === 'weekly_all') {
        reward(row.kind === 'session' ? 'claude.fiveHour' : 'claude.sevenDay', row.percent, row.kind === 'weekly_all', reset);
      }
      if ((data.five_hour || data.seven_day) && (row?.kind === 'session' || row?.kind === 'weekly_all')) continue;
      add(label, row?.percent, reset,false,row?.kind==='session'?18000:row?.kind==='weekly_all'||row?.kind==='weekly_scoped'||row?.kind==='weekly_model'?604800:undefined,row?.kind==='session');
    }
  } else if (provider === 'opencode') {
    const usage = object(data.usage);
    for (const [key, label] of [['rolling', '5시간'], ['weekly', '주간'], ['monthly', '월간']]) {
      const window = object(usage?.[key]);
      add(label, window?.percent, timestamp(window?.resetsAt), true,key==='rolling'?18000:key==='weekly'?604800:undefined);
    }
  } else if (provider === 'grok') {
    const config = object(data.config);
    const period = object(config?.currentPeriod);
    add(period?.type === 'USAGE_PERIOD_TYPE_MONTHLY' ? '월간 크레딧' : '주간 크레딧',
      config?.creditUsagePercent, timestamp(period?.end), true, timestamp(period?.start)!<timestamp(period?.end)!?(timestamp(period?.end)!-timestamp(period?.start)!)/1000:undefined);
  } else if (provider === 'cursor') {
    const plan = object(data.planUsage);
    const limit = number(plan?.limit);
    const used = number(plan?.includedSpend);
    const epoch = Number(data.billingCycleEnd);
    const reset = epoch > 1e12 ? epoch : epoch > 1e9 ? epoch * 1000 : undefined;
    add('월간', number(plan?.totalPercentUsed) ?? (limit && used !== undefined ? used / limit * 100 : undefined), reset);
  } else if (Array.isArray(data.groups)) {
    for (const raw of data.groups) {
      const group = object(raw);
      if (!string(group?.displayName) || !Array.isArray(group?.buckets)) continue;
      for (const value of group.buckets) {
        const row = object(value);
        const remaining = number(row?.remainingFraction);
        if (!row || remaining === undefined || !string(row.bucketId) || !string(row.displayName)) continue;
        const used = Math.min(100, (1 - remaining) * 100);
        const reset = timestamp(row.resetTime);
        const groupKey = String(group.displayName).toLowerCase().includes('gemini') ? 'gemini' : '3p';
        const bucket = String(row.bucketId);
        if (row.window === '5h' || bucket.includes('5h')) reward('antigravity.' + groupKey + '.5h', used, false, reset);
        if (row.window === 'weekly' || bucket.includes('weekly')) reward('antigravity.' + groupKey + '.weekly', used, true, reset);
        add(group.displayName + ' · ' + row.displayName, used, reset,false,row.window==='5h'||bucket.includes('5h')?18000:row.window==='weekly'||bucket.includes('weekly')?604800:undefined);
      }
    }
  }
  return windows;
}

async function config(path: string): Promise<Row | undefined> {
  try { return parseRow(await readFile(path, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

async function sqliteValue(path: string, query: string): Promise<unknown> {
  try { await access(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try { return db.prepare(query).get()?.value; }
  catch (error) {
    if (/no such (table|column):/.test(String(error))) return;
    throw error;
  } finally { db.close(); }
}

export async function cursorToken(): Promise<string | undefined> {
  const configured = string(process.env.CURSOR_SESSION_TOKEN);
  if (configured) return configured;
  for (const root of localRoots('cursor')) {
    const raw = await sqliteValue(join(root, 'state.vscdb'),
      "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1");
    const key = string(raw instanceof Uint8Array ? Buffer.from(raw).toString() : raw);
    if (key) return key;
  }
}

export function cursorBearer(raw: string): string {
  let key = raw;
  try { key = decodeURIComponent(raw); } catch { /* use the original token */ }
  const separator = key.indexOf('::');
  return separator >= 0 ? key.slice(separator + 2) : key;
}

async function credential(provider: Exclude<LimitedProvider, 'codex'>, claudeRoot?: string): Promise<string | undefined> {
  const home = homedir();
  if (provider === 'claude') {
    const roots = claudeRoot ? [claudeRoot] : [...(process.env.CLAUDE_CONFIG_DIR ?? '').split(',').map(path => path.trim()).filter(Boolean),
      join(home, '.claude'), join(home, '.config', 'claude')];
    let expired=false;
    for (const root of roots) {
      const oauth = object((await config(join(root, '.credentials.json')))?.claudeAiOauth);
      const expiry = number(oauth?.expiresAt);
      const key = string(oauth?.accessToken);
      if (key && (!expiry || expiry > Date.now())) return key;
      if(key&&expiry&&expiry<=Date.now())expired=true;
    }
    if(expired)throw new LimitsError('oauthExpired');
  } else if (provider === 'grok') {
    const data = await config(join(process.env.GROK_HOME || join(home, '.grok'), 'auth.json'));
    return Object.values(data ?? {}).map(object).filter(row => string(row?.key))
      .sort((a, b) => (timestamp(b?.expires_at) ?? 0) - (timestamp(a?.expires_at) ?? 0))
      .map(row => string(row?.key))[0];
  } else if (provider === 'opencode') {
    for (const root of localRoots('opencode')) {
      const raw = await sqliteValue(join(root, 'opencode.db'),
        "SELECT value FROM credential WHERE integration_id = 'opencode-go' AND active = 1 ORDER BY time_updated DESC LIMIT 1");
      const db = typeof raw === 'string' ? parseRow(raw) : undefined;
      const legacy = object((await config(join(root, 'auth.json')))?.['opencode-go']);
      for (const row of [db, legacy]) {
        const key = string(row?.key);
        if (key && (row?.type === 'api' || row?.type === 'key')) return key;
      }
    }
  } else if (provider === 'cursor') {
    const raw = await cursorToken();
    return raw ? cursorBearer(raw) : undefined;
  } else {
    const paths = [process.env.ANTIGRAVITY_TOKEN_FILE,
      ...['antigravity-cli', 'antigravity-ide', 'antigravity'].flatMap(dir =>
        ['antigravity-oauth-token', 'jetski-standalone-oauth-token'].map(name => join(home, '.gemini', dir, name)))];
    for (const path of paths) {
      if (!path) continue;
      let raw: string;
      try { raw = (await readFile(path, 'utf8')).trim(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (raw.startsWith('go-keyring-base64:')) raw = Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString();
      const data = parseRow(raw);
      const oauth = object(data?.token) ?? data;
      const key = string(oauth?.access_token) ?? string(data?.token);
      const expires = timestamp(oauth?.expiry);
      if (key && (!expires || expires > Date.now())) return key;
    }
  }
}

async function codexBinary(): Promise<string | undefined> {
  const win = process.platform === 'win32';
  const name = win ? 'codex.exe' : 'codex';
  const home = homedir();
  const candidates = [
    join(process.env.CODEX_HOME || join(home, '.codex'), 'bin', name),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(path => {
      if (!win) return [join(path, name)];
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
      const triple = arch + '-pc-windows-msvc';
      return [join(path, name), ...[
        join(path, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-' + process.arch, 'vendor'),
        join(path, 'node_modules', '@openai', 'codex', 'vendor'),
      ].flatMap(vendor => [join(vendor, triple, 'codex', name), join(vendor, triple, 'bin', name)])];
    }),
    ...(process.platform === 'darwin' ? ['/Applications/Codex.app/Contents/Resources/codex',
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'] : []),
  ];
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path; } catch { /* continue searching */ }
  }
}

async function codexLimits(): Promise<unknown> {
  const binary = await codexBinary();
  if (!binary) return;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    let finished = false;
    const timer = setTimeout(() => end(new Error('Codex quota timed out')), 20000);
    function end(error?: Error, result?: unknown) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.kill();
      if (error) reject(error);
      else resolve(result);
    }
    function send(value: Row) { child.stdin.write(JSON.stringify(value) + '\n'); }
    child.once('error', error => end(error));
    child.stdin.on('error', error => end(error));
    child.once('close', () => end(new Error('Codex closed before returning quotas')));
    lines.on('line', line => {
      const row = parseRow(line);
      if (row?.id !== 0 && row?.id !== 1) return;
      if (row.error) { end(new Error('Codex quota request failed')); return; }
      if (row.id === 0) {
        send({ method: 'initialized', params: {} });
        send({ id: 1, method: 'account/rateLimits/read', params: {} });
      } else end(undefined, row.result);
    });
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'poketokenbar_windows',
      title: 'PokeTokenBar Windows', version: '1.0.0' }, capabilities: { experimentalApi: true } } });
  });
}

const endpoints = {
  claude: 'https://api.anthropic.com/api/oauth/usage',
  grok: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
  opencode: 'https://opencode.ai/zen/go/v1/usage',
  antigravity: 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  cursor: 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
};

async function request(provider: Exclude<LimitedProvider, 'codex'>, claudeRoot?: string): Promise<unknown> {
  const token = await credential(provider, claudeRoot);
  if (!token) return;
  const post = provider === 'antigravity' || provider === 'cursor';
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  if (post) headers['Content-Type'] = 'application/json';
  if (provider === 'claude') headers['anthropic-beta'] = 'oauth-2025-04-20';
  if (provider === 'cursor') headers['Connect-Protocol-Version'] = '1';
  if (provider === 'antigravity') headers['User-Agent'] = 'antigravity/2.9.1';
  const options = { method: post ? 'POST' : 'GET', body: post ? '{}' : undefined,
    headers, redirect: 'error' as const, signal: AbortSignal.timeout(10000) };
  let response = await fetch(endpoints[provider], options);
  if (provider === 'antigravity' && (response.status === 404 || response.status >= 500)) {
    await response.body?.cancel();
    response = await fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', options);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new LimitsError(response.status===401||response.status===403?'oauthExpired':response.status===429?'rateLimited':'network',response.status);
  }
  return response.json();
}

export async function fetchLimits(candy?: CandyWindow[], claudeRoots: string[] = [], enabled: readonly Provider[] = supported,onAccounts?:(sources:ClaudeAccountSource[])=>void,sessionKeys?:SessionKeys): Promise<LimitResult[]> {
  const sources=enabled.includes('claude')?await claudeAccountSources(claudeRoots):[];onAccounts?.(sources);
  const defaults = supported.filter(provider => enabled.includes(provider)).map(provider => ({ provider, root: undefined as string | undefined,accountID:provider==='claude'?'claude-default':undefined }));
  const requests = [...defaults, ...sources.filter(row=>!row.isDefault).map(row=>({provider:'claude' as const,root:row.roots[0],accountID:row.id}))];
  return Promise.all(requests.map(async ({ provider, root,accountID }, index) => {
    const source=sources.find(row=>row.id===accountID),account=source?.identity?.split('\n')[0]??(root ? basename(root) + ' · ' + (index - defaults.length + 1) : undefined);
    try {
      const rewards: CandyWindow[] = [];
      let raw:unknown,sessionError:unknown;
      if(provider==='claude'&&sessionKeys&&accountID)try{raw=await sessionKeys.usage(accountID);}catch(error){sessionError=error;}
      if(raw===undefined)try{raw=await(provider==='codex'?codexLimits():request(provider,root));}catch(error){throw sessionError??error;}
      if(raw===undefined&&sessionError)throw sessionError;
      const windows = parseLimits(provider, raw, Date.now(), rewards);
      const login=source?object((await config(join(source.roots[0],'.credentials.json')))?.claudeAiOauth):undefined;
      const plan=provider==='claude'?string(object(raw)?.subscription_type??object(raw)?.plan??login?.subscriptionType):undefined;
      if (root) {
        const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
        for (const reward of rewards) {
          reward.key = reward.key.replace('claude.', 'claude.' + key + '.');
          reward.requiresArming = true;
        }
      }
      candy?.push(...rewards);
      return { provider, account,plan,accountID,checkedAt:Date.now(), windows, status: windows.length ? 'available' : 'unavailable' };
    } catch(error) {
      return { provider, account,accountID,checkedAt:Date.now(), windows: [], status: 'failed',error:error instanceof LimitsError?error.kind:'network' };
    }
  }));
}
