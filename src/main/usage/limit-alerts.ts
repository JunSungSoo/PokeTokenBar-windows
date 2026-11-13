import type { LimitResult } from '../../shared/usage.js';

export interface AlertLedger { [key: string]: { tier: number; reset?: number } }
export function limitAlerts(results: LimitResult[], ledger: AlertLedger, warn: number, critical: number): string[] {
  const notices: string[] = [];
  for (const result of results) {
    if (result.status !== 'available') continue;
    for (const window of result.windows) {
      const key = result.provider + ':' + (result.account ?? '') + ':' + window.label;
      const old = ledger[key];
      const tier = window.usedPercent >= critical ? 2 : window.usedPercent >= warn ? 1 : 0;
      const weekly = /주간|weekly/i.test(window.label);
      const newWindow = old?.reset !== undefined && window.resetsAt !== undefined &&
        window.resetsAt - old.reset >= (weekly ? 86_400_000 : 1_800_000);
      if (tier > (newWindow ? 0 : old?.tier ?? 0)) {
        notices.push(result.provider + (result.account ? ' ' + result.account : '') + ' · ' + window.label + ' · ' + window.usedPercent.toFixed(0) + '% 사용');
      }
      ledger[key] = { tier, reset: window.resetsAt ?? old?.reset };
    }
  }
  return notices;
}
