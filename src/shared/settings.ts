import type { Provider } from './usage.js';

export interface AppSettings {
  skippedUpdateVersion?:string;
  petPosition?:{x:number;y:number};
  language: 'system' | 'ko' | 'en' | 'ja' | 'es' | 'fr' | 'pt' | 'de' | 'ru';
  animationQuality: 'powerSaver' | 'balanced' | 'smooth';
  statusChecks: boolean;
  petAgentActivity: boolean;
  theme: 'system' | 'light' | 'dark';
  animated: boolean;
  back: boolean;
  refreshSeconds: number;
  activityVisualization?: 'bars'|'heatmap';
  trend: '14' | '30' | 'month';
  limitMode: 'used' | 'remaining';
  providers: Provider[];
  petEnabled: boolean;
  petSize: number;
  companionNotifications: boolean;
  limitNotifications: boolean;
  warnThreshold: number;
  criticalThreshold: number;
  updateNotifications: boolean;
  trayTokens: boolean;
  trayCost: boolean;
  trayGrowth: boolean;
  trayLimits: boolean;
  tradeNickname: string;
  claudeRoots: string[];
  claudeTrackedAccount?:string;
}
export interface SettingsAPI {
  readPower?():Promise<boolean>;
  onPowerSaver?(handler:(value:boolean)=>void):void;
  read(): Promise<AppSettings>;
  change(patch: Partial<AppSettings>): Promise<AppSettings>;
  onChange(handler: (settings: AppSettings) => void): void;
  backup(): Promise<string | null>;
  openDataFolder(): Promise<void>;
  snapshots(): Promise<{ id: string; createdAt: number; label: string }[]>;
  snapshot(): Promise<void>;
  addClaudeRoot(): Promise<AppSettings | null>;
}
