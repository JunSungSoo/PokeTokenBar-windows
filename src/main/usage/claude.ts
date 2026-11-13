import{basename,dirname}from'node:path';
import { jsonl, object, timestamp, token } from './jsonl.js';
import { type Entry, tokens } from './entries.js';

export async function readClaudeFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  const parent=dirname(path),session=basename(parent)==='subagents'?basename(dirname(parent)):basename(path,'.jsonl');
  let costs = new Map<string, number>();
  const baseModel = (model: string) => model.split('[')[0];
  for await (const row of jsonl(path, line => line.includes('cost-state') || (line.includes('assistant') && line.includes('usage')))) {
    if (row.type === 'cost-state') {
      const reported = new Map<string, number>();
      for (const [model, raw] of Object.entries(object(row.modelUsage) ?? {})) {
        const cost = object(raw)?.costUSD;
        if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) continue;
        const key = baseModel(model);
        reported.set(key, (reported.get(key) ?? 0) + cost);
      }
      if (reported.size) costs = reported;
      continue;
    }
    if (row.type !== 'assistant') continue;
    const message = object(row.message);
    const usage = object(message?.usage);
    const time = timestamp(row.timestamp);
    if (!message || !usage || time === undefined) continue;
    const messageID = typeof message.id === 'string' ? message.id : '';
    const requestID = typeof row.requestId === 'string' ? row.requestId : '';
    entries.push({
      id: messageID + '|' + requestID,
      growthIdentity: Boolean(messageID || requestID),
      claudeSessions:session?[session]:[],
      time,
      model: typeof message.model === "string" ? message.model : "unknown",
      tokens: tokens(token(usage.input_tokens), token(usage.output_tokens),
        token(usage.cache_creation_input_tokens), token(usage.cache_read_input_tokens)),
    });
  }
  const deduped = deduplicateClaude(entries);
  for (const [model, cost] of costs) {
    const matches = deduped.filter(entry => entry.tokens.total > 0 && baseModel(entry.model ?? '') === model);
    const total = matches.reduce((sum, entry) => sum + entry.tokens.total, 0);
    let remaining = cost;
    for (const [i, entry] of matches.entries()) {
      const share = i === matches.length - 1 ? remaining : cost * entry.tokens.total / total;
      entry.explicitCost = Math.max(0, share);
      remaining -= share;
    }
  }
  return deduped;
}

export function deduplicateClaude(entries: Iterable<Entry>): Entry[] {
  const result = new Map<string, Entry>();
  for (const entry of entries) {
    const prior = result.get(entry.id);
    if (!prior) {
      result.set(entry.id, entry);
    } else {
      const best = entry.tokens.total > prior.tokens.total ? entry : prior;
      const sessions=[...new Set([...(prior.claudeSessions??[]),...(entry.claudeSessions??[])])].sort();
      result.set(entry.id, { ...best, time: Math.min(entry.time, prior.time),...(sessions.length?{claudeSessions:sessions}:{}) });
    }
  }
  return [...result.values()];
}
