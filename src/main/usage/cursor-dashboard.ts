import { tokens, type Entry } from './entries.js';
import { object, parseRow, timestamp, token, type Row } from './jsonl.js';
import { cursorBearer, cursorToken } from './limits.js';

function eventEntry(event: Row, index: number, since: number): Entry | undefined {
  const raw = event.timestamp;
  const epoch = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  const time = Number.isFinite(epoch) && epoch >= 1e9
    ? (epoch > 1e12 ? epoch : epoch * 1000) : timestamp(raw);
  if (time === undefined || time < since) return;
  const usage = object(event.tokenUsage);
  const counts = tokens(token(usage?.inputTokens), token(usage?.outputTokens),
    token(usage?.cacheWriteTokens), token(usage?.cacheReadTokens));
  if (!counts.total) return;
  const model = typeof event.model === 'string' ? event.model : 'unknown';
  const cents = Number(usage?.totalCents ?? NaN);
  const stable = event.id ?? event.eventId ?? event.requestId;
  return {
    id: 'cursor|api|' + (stable ?? [raw, model, index].join('|')), time, model, tokens: counts,
    explicitCost: Number.isFinite(cents) && cents >= 0 ? cents / 100 : undefined,
  };
}

function cookie(raw: string, bearer: string): string {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* use the original token */ }
  if (decoded.includes('::')) return raw;
  const payload = bearer.split('.')[1];
  const subject = payload && parseRow(Buffer.from(payload, 'base64url').toString())?.sub;
  return typeof subject === 'string' ? subject + '::' + bearer : raw;
}

export async function cursorDashboard(since: number, now: number, send = fetch): Promise<Entry[] | undefined> {
  const raw = await cursorToken();
  if (!raw) return;
  const bearer = cursorBearer(raw);
  const entries: Entry[] = [];
  const deadline = AbortSignal.timeout(120000);
  let viaBearer = false;
  let index = 0;
  for (let page = 1; page <= 200;) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', Origin: 'https://cursor.com', Referer: 'https://cursor.com/dashboard/usage',
      'User-Agent': 'Mozilla/5.0',
    };
    if (viaBearer) headers.Authorization = 'Bearer ' + bearer;
    else headers.Cookie = 'WorkosCursorSessionToken=' + cookie(raw, bearer);
    const response = await send('https://cursor.com/api/dashboard/get-filtered-usage-events', {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]),
      body: JSON.stringify({ teamId: 0, startDate: String(since), endDate: String(now), page, pageSize: 100 }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (!viaBearer && (response.status === 401 || response.status === 403)) {
        viaBearer = true;
        continue;
      }
      return;
    }
    const data = object(await response.json());
    const rows = data?.usageEventsDisplay ?? data?.usageEvents ?? data?.events;
    if (!Array.isArray(rows)) return;
    for (const raw of rows) {
      const row = object(raw);
      const entry = row && eventEntry(row, index, since);
      if (entry) entries.push(entry);
      index++;
    }
    const pagination = object(data?.pagination);
    const next = typeof pagination?.hasNextPage === 'boolean' ? pagination.hasNextPage
      : typeof pagination?.numPages === 'number' ? page < pagination.numPages
      : typeof data?.totalUsageEventsCount === 'number' ? page * 100 < data.totalUsageEventsCount : rows.length >= 100;
    if (!next) return entries;
    if (!rows.length) return;
    page++;
  }
}
