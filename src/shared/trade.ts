import type { Rarity, Species } from './companion.js';
import type { PlayerProfile } from './player-profile.js';

export interface TradePreview {
  id: string;
  label: string;
  species: Species;
  active: boolean;
  shiny: boolean;
  rarity: Rarity;
  form?: string;
  level?: number;
  nature: string;
  progress: number;
}
export type TradeChoice = TradePreview;

export interface TradeState {
  phase: 'idle' | 'waiting' | 'connected' | 'committing' | 'complete' | 'closed';
  codes: string[];
  peer?: string;
  localProfile?: PlayerProfile;
  peerProfile?: PlayerProfile;
  mine?: string;
  theirs?: string;
  mineItem?: TradePreview;
  theirItem?: TradePreview;
  accepted: boolean;
  canAccept: boolean;
  message: string;
  backupPath?: string;
}

export interface TradeAPI {
  state(): Promise<TradeState>;
  choices(): Promise<TradeChoice[]>;
  host(): Promise<void>;
  connect(code: string): Promise<void>;
  offer(id: string): Promise<void>;
  withdraw(): Promise<void>;
  reject(): Promise<void>;
  accept(replaceCurrent?: boolean): Promise<void>;
  revealBackup(): Promise<void>;
  close(): Promise<void>;
  onState(handler: (state: TradeState) => void): void;
}
