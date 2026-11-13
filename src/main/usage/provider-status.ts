import type { ServiceStatus, ServiceIndicator } from '../../shared/runtime.js';
import { object } from './jsonl.js';

const endpoints = [
  { provider: 'claude' as const, component: 'Claude Code', url: 'https://status.claude.com/api/v2/summary.json' },
  { provider: 'codex' as const, component: 'Codex API', url: 'https://status.openai.com/api/v2/summary.json' },
];

export function parseComponent(raw: unknown, named: string): ServiceIndicator | undefined {
  const source = object(raw);
  if (!Array.isArray(source?.components)) return;
  const components = source.components.map(object);
  if (components.some(row => typeof row?.name !== 'string' || typeof row.status !== 'string')) return;
  const component = components.find(row =>
    typeof row?.name === 'string' && row.name.toLowerCase() === named.toLowerCase());
  if (!component || typeof component.status !== 'string') return;
  return ({
    operational: 'none', degraded_performance: 'minor', partial_outage: 'major',
    major_outage: 'critical', under_maintenance: 'maintenance',
  } as Record<string, ServiceIndicator>)[component.status] ?? 'unknown';
}

export class ProviderStatusChecker {
  private statuses = new Map<ServiceStatus['provider'], ServiceStatus>();
  private generation = 0;
  private trackedKey = '';
  private pending?: Promise<ServiceStatus[]>;

  constructor(private request: typeof fetch = fetch) {}
  current(): ServiceStatus[] { return [...this.statuses.values()]; }

  refresh(enabled: boolean, tracked: readonly string[]): Promise<ServiceStatus[]> {
    if (!enabled) {
      this.generation++;
      this.statuses.clear();
      this.pending = undefined;
      return Promise.resolve([]);
    }
    const key = [...tracked].sort().join(',');
    if (key !== this.trackedKey) { this.trackedKey = key; this.generation++; this.pending = undefined; }
    for (const provider of this.statuses.keys()) if (!tracked.includes(provider)) this.statuses.delete(provider);
    if (this.pending) return this.pending;
    const generation = this.generation;
    const pending = Promise.allSettled(endpoints.filter(endpoint => tracked.includes(endpoint.provider)).map(async endpoint => {
      const response = await this.request(endpoint.url, { headers: { 'User-Agent': 'PokeTokenBar Windows' },
        signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); return; }
      const raw: unknown = await response.json();
      const indicator = parseComponent(raw, endpoint.component);
      if (indicator && generation === this.generation) {
        this.statuses.set(endpoint.provider, { provider: endpoint.provider, indicator,
          component: endpoint.component, checkedAt: Date.now() });
      }
    })).then(() => this.current()).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }
}
