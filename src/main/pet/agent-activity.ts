import type { AgentEvent, AgentSummary, AgentState } from '../../shared/runtime.js';

export function sanitizeAgentText(raw: string | null): string | undefined {
  if (!raw) return;
  const text = raw.replace(/\p{Cc}/gu, ' ').replace(/\p{Cf}/gu, scalar => scalar === '\u200d' ? scalar : '')
    .split(/\s+/u).filter(Boolean).join(' ');
  return text || undefined;
}

export function parseAgentURL(raw: string): AgentEvent | undefined {
  if (raw.length > 65536) return;
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol.toLowerCase() !== 'poketokenbar:' || url.hostname.toLowerCase() !== 'agent' || !raw.includes('://')) return;
  const params = new URLSearchParams(url.search.slice(1).replace(/\+/g, '%2B'));
  const state = params.get('state')?.toLowerCase();
  if (!state || !['idle', 'working', 'waiting', 'done'].includes(state)) return;
  return { state: state as AgentState, label: sanitizeAgentText(params.get('label')),
    ...(state === 'waiting' || state === 'done' ? { message: sanitizeAgentText(params.get('message')) } : {}) };
}

interface Entry extends AgentEvent { sequence: number; deadline?: number }

export class AgentTracker {
  private agents = new Map<string, Entry>();
  private sequence = 0;

  apply(event: AgentEvent, now: number): void {
    this.expire(now);
    const key = event.label ?? '';
    if (event.state === 'idle') { this.agents.delete(key); return; }
    if (!this.agents.has(key) && this.agents.size >= 8) {
      const oldest = [...this.agents].sort((a, b) => a[1].sequence - b[1].sequence)[0];
      this.agents.delete(oldest[0]);
    }
    this.agents.set(key, { ...event, sequence: ++this.sequence,
      deadline: event.state === 'working' ? now + 600_000 : event.state === 'done' ? now + 6000 : undefined });
  }

  expire(now: number): void {
    for (const [key, entry] of this.agents) if (entry.deadline !== undefined && now >= entry.deadline) this.agents.delete(key);
  }

  deadline(): number | undefined {
    const values = [...this.agents.values()].flatMap(entry => entry.deadline === undefined ? [] : [entry.deadline]);
    return values.length ? Math.min(...values) : undefined;
  }

  summary(): AgentSummary {
    const entries = [...this.agents.values()].sort((a, b) => b.sequence - a.sequence);
    const waiting = entries.filter(entry => entry.state === 'waiting');
    const done = entries.find(entry => entry.state === 'done');
    const note = (entry: Entry) => ({ label: entry.label, message: entry.message });
    return { working: entries.some(entry => entry.state === 'working'), waiting: waiting[0] && note(waiting[0]),
      done: done && note(done), otherWaitingCount: Math.max(0, waiting.length - 1) };
  }

  dismiss(): void {
    for (const [key, entry] of this.agents) if (entry.state !== 'working') this.agents.delete(key);
  }

  reset(): void { this.agents.clear(); }
}
