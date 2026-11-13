import type { PokemonDetailView } from './pokemon-details.js';
import type { ServiceStatus } from './runtime.js';
import type { CompanionAction, CompanionView, SaveImportPreview, SaveImportResult } from './companion.js';

export const providerLabels = {
  codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI', antigravity: 'Antigravity',
  opencode: 'OpenCode', hermes: 'Hermes Agent', cursor: 'Cursor', grok: 'Grok Build CLI',
  copilot: 'Copilot CLI', kiro: 'Kiro CLI', pi: 'Pi Agent', omp: 'omp', omo: 'omo',
  aside: 'Aside', kimi: 'Kimi Code', devin: 'Devin CLI',
} as const;

export type Provider = keyof typeof providerLabels;
export const providers = Object.keys(providerLabels) as Provider[];

export interface Tokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

export interface UsageCost {
  amount: number;
  reported: boolean;
  estimated: boolean;
  unknown: boolean;
}

export interface ProviderUsage {
  todayModels?: Record<string, number>;
  daily: Record<string, number>;
  dailyCost: Record<string, UsageCost>;
  today: Tokens;
  week: Tokens;
  month: Tokens;
  cost: Record<'today' | 'week' | 'month', UsageCost>;
  lastFiveHours: number;
  extraRoot: string | null;
  unreadable: number;
}

export interface LimitWindow {
  spanSeconds?:number;
  forecastEligible?:boolean;
  notStarted?:boolean;
  label: string;
  usedPercent: number;
  resetsAt?: number;
}

export interface LimitResult {
  accountID?:string;
  block?:import('./quota-presentation.js').UsageBlock;
  checkedAt?:number;
  provider: Provider;
  account?: string;
  status: 'available' | 'unavailable' | 'failed';
  windows: LimitWindow[];
}

export interface UsageSnapshot {
  history?: import('./usage-recap.js').UsageHistory;
  labels: typeof providerLabels;
  companion: CompanionView | null;
  activity?: 'egg' | 'tired' | 'sulk' | 'sleep' | 'idle' | 'working' | 'focus';
  usage: Record<Provider, ProviderUsage>;
}

export interface UsageAPI {
  onSnapshot(handler:(snapshot:UsageSnapshot)=>void):void;
  onLimits(handler:(results:LimitResult[])=>void):void;
  openMaple(): Promise<void>;
  pokemonDetails(speciesID: number): Promise<PokemonDetailView>;
  setPokemonMove(change: import('./pokemon-loadout.js').MoveChange): Promise<CompanionView>;
  previewSnapshot(id: string): Promise<SaveImportPreview | null>;
  previewImport(format?: 'mac' | 'windows'): Promise<SaveImportPreview | null>;
  cancelImport(token: string): Promise<void>;
  confirmImport(token: string): Promise<SaveImportResult>;
  onCompanion(handler: (state: CompanionView | null) => void): void;
  companion(): Promise<CompanionView>;
  changeCompanion(action: CompanionAction): Promise<CompanionView>;
  onStatuses(handler: (statuses: ServiceStatus[]) => void): void;
  statuses(): Promise<ServiceStatus[]>;
  refresh(): Promise<UsageSnapshot>;
  configure(provider: Provider, reset: boolean): Promise<void>;
  limits(): Promise<LimitResult[]>;
}
