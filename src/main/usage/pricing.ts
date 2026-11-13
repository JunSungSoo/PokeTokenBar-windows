import type { Entry } from './entries.js';

// USD per million tokens. Baseline: PokeTokenBar macOS 3.1.2 (deaf07e).
const rates = new Map<string, [number, number, number, number]>([
  ["claude-opus-5", [5, 25, 6.25, 0.5]],
  ["claude-opus-5-5", [4, 20, 5, 0.2]],
  ["claude-sonnet-5", [2, 10, 2.5, 0.2]],
  ["claude-sonnet-5-5", [2, 10, 2.5, 0.1]],
  ["claude-opus-4-20250514", [15, 75, 18.75, 1.5]],
  ["claude-sonnet-4-20250514", [3, 15, 3.75, 0.3]],
  ["claude-sonnet-4-5-20250929", [3, 15, 3.75, 0.3]],
  ["claude-opus-4-8", [5, 25, 6.25, 0.5]],
  ["claude-opus-4-7", [5, 25, 6.25, 0.5]],
  ["claude-sonnet-4-6", [3, 15, 3.75, 0.3]],
  ["claude-haiku-4-5-20251001", [1, 5, 1.25, 0.1]],
  ["claude-fable-5", [10, 50, 12.5, 1.0]],
  ["claude-fable-5-1", [10, 50, 12.5, 0.25]],
  ["gpt-6-astra", [10, 50, 12.5, 1]],
  ["gpt-6-sol", [2, 10, 2.5, 0.2]],
  ["gpt-6.1-sol", [2, 10, 2.5, 0.1]],
  ["gpt-6-luna", [0.1, 0.5, 0.125, 0.01]],
  ["gpt-5.6-sol", [4, 20, 5, 0.4]],
  ["gpt-5.6-terra", [2, 12, 2.5, 0.2]],
  ["gpt-5.6-luna", [0.2, 1.2, 0.25, 0.02]],
  ["gpt-5", [1.25, 10, 0, 0.125]],
  ["gpt-5-codex", [1.25, 10, 0, 0.125]],
  ["gpt-5.1", [1.25, 10, 0, 0.125]],
  ["gpt-5.1-codex", [1.25, 10, 0, 0.125]],
  ["gpt-5.2", [1.75, 14, 0, 0.175]],
  ["gpt-5.2-codex", [1.75, 14, 0, 0.175]],
  ["gpt-5.3-codex", [1.75, 14, 0, 0.175]],
  ["gpt-5.4", [2.5, 15, 0, 0.25]],
  ["gpt-5.5", [5, 30, 0, 0.5]],
  ["gemini-2.5-pro", [1.25, 10, 0, 0.125]],
  ["gemini-2.5-flash", [0.30, 2.5, 0, 0.03]],
  ["gemini-2.5-flash-lite", [0.10, 0.40, 0, 0.01]],
  ["gemini-2.0-flash", [0.10, 0.4, 0, 0.025]],
]);
const aliases = new Map([
  ["gpt-5.6", "gpt-5.6-sol"],
  ["claude-sonnet-4", "claude-sonnet-4-20250514"],
  ["claude-opus-4", "claude-opus-4-20250514"],
  ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"],
  ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
  ["gpt-5-2025-08-07", "gpt-5"],
  ["gpt-5.1-2025-11-13", "gpt-5.1"],
  ["gpt-5.2-2025-12-11", "gpt-5.2"],
  ["gpt-5.4-2026-03-05", "gpt-5.4"],
  ["gpt-5.5-2026-04-23", "gpt-5.5"],
]);

const longContext = new Set([
  'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-sol',
  'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4',
]);

export function price(entry: Entry): { amount: number; kind: 'source' | 'estimate' } | undefined {
  if (entry.explicitCost !== undefined && entry.explicitCost >= 0 && Number.isFinite(entry.explicitCost)) {
    return { amount: entry.explicitCost, kind: entry.costIsEstimate ? 'estimate' : 'source' };
  }
  if (!entry.model || entry.costUnavailable) return;
  const normalized = entry.model.trim().toLowerCase().replace(/^(openai|anthropic|google|models)\//, '');
  const model = aliases.get(normalized) ?? normalized;
  const rate = rates.get(model);
  const { input, output, cacheWrite, cacheRead } = entry.tokens;
  if (!rate || (cacheWrite > 0 && rate[2] === 0)) return;
  const prompt = input + cacheWrite + cacheRead;
  const large = longContext.has(model) && prompt > 272000 || model === 'gemini-2.5-pro' && prompt > 200000;
  const inputCost = input * rate[0] + cacheWrite * rate[2] + cacheRead * rate[3];
  return { amount: (inputCost * (large ? 2 : 1) + output * rate[1] * (large ? 1.5 : 1)) / 1e6, kind: 'estimate' };
}
