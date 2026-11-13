export type ServiceIndicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown';
export interface ServiceStatus {
  provider: 'claude' | 'codex';
  indicator: ServiceIndicator;
  component: string;
  checkedAt: number;
}
export type AgentState = 'idle' | 'working' | 'waiting' | 'done';
export interface AgentEvent { state: AgentState; label?: string; message?: string }
export interface AgentNote { label?: string; message?: string }
export interface AgentSummary {
  working: boolean;
  waiting?: AgentNote;
  done?: AgentNote;
  otherWaitingCount: number;
}
