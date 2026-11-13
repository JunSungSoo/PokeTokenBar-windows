import type { Tokens } from '../../shared/usage.js';

export interface Entry {
  id: string;
  time: number;
  tokens: Tokens;
  model?: string;
  claudeSessions?:string[];
  growthIdentity?: boolean;
  explicitCost?: number;
  costIsEstimate?: boolean;
  costUnavailable?: boolean;
}

export function tokens(input = 0, output = 0, cacheWrite = 0, cacheRead = 0): Tokens {
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead };
}
