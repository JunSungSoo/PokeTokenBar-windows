export interface CandyWindow {
  key: string;
  used: number;
  weekly: boolean;
  epoch?: string;
  requiresArming?: boolean;
}

export interface CandyLedger {
  candyFeatureSeeded?: boolean;
  candyArmedWindows?: string[];
  candyGrantTier?: Record<string, number>;
  candyWindowEpoch?: Record<string, string>;
}

function newEpoch(previous: string, next: string, weekly: boolean): boolean {
  if (previous === next) return false;
  const a = Date.parse(previous);
  const b = Date.parse(next);
  return !Number.isFinite(a) || !Number.isFinite(b) || b - a >= (weekly ? 86_400_000 : 1_800_000);
}

export function observeCandyWindows(ledger: CandyLedger, windows: CandyWindow[]): number {
  if (!windows.length) return 0;
  const tiers = ledger.candyGrantTier ??= {};
  const epochs = ledger.candyWindowEpoch ??= {};
  const armed = new Set(ledger.candyArmedWindows ?? []);
  let count = 0;
  for (const { key, used, weekly, epoch, requiresArming } of windows) {
    if (requiresArming) {
      if (used < 100) armed.add(key);
      if (!armed.has(key)) continue;
    }
    if (!ledger.candyFeatureSeeded) {
      if (used >= 100) {
        tiers[key] = 1;
        if (epoch) epochs[key] = epoch;
      }
      continue;
    }
    if (epoch && (!epochs[key] || newEpoch(epochs[key], epoch, weekly))) {
      if (epochs[key]) delete tiers[key];
      epochs[key] = epoch;
    }
    if (used < 100) {
      delete tiers[key];
      if (epoch) epochs[key] = epoch;
    } else if (!(tiers[key] >= 1)) {
      tiers[key] = 1;
      if (epoch) epochs[key] = epoch;
      count += weekly ? 5 : 1;
    }
  }
  ledger.candyArmedWindows = [...armed];
  ledger.candyFeatureSeeded = true;
  return count;
}

export function mergeCandyLedgers(imported: CandyLedger, current: CandyLedger): CandyLedger {
  const tiers: Record<string, number> = {};
  const epochs: Record<string, string> = {};
  const keys = new Set([imported, current].flatMap(state =>
    [...Object.keys(state.candyGrantTier ?? {}), ...Object.keys(state.candyWindowEpoch ?? {})]));
  for (const key of keys) {
    const a = imported.candyGrantTier?.[key] ?? 0;
    const b = current.candyGrantTier?.[key] ?? 0;
    if (a || b) tiers[key] = Math.max(a, b);
    const first = imported.candyWindowEpoch?.[key];
    const second = current.candyWindowEpoch?.[key];
    const epoch = a > 0 && b === 0 ? first : b > 0 && a === 0 ? second : [first, second].filter(Boolean).sort().at(-1);
    if (epoch) epochs[key] = epoch;
  }
  return { candyArmedWindows: [...new Set([...(imported.candyArmedWindows ?? []), ...(current.candyArmedWindows ?? [])])],
    candyFeatureSeeded: Boolean(imported.candyFeatureSeeded || current.candyFeatureSeeded),
    candyGrantTier: tiers, candyWindowEpoch: epochs };
}
