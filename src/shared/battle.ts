export type BattleMode = 'singles' | 'doubles';
export type BattleAction = { kind: 'pass' } | { kind: 'switch'; index: number } |
  { kind: 'move'; index: number; target: number; mega?: boolean };
export interface Battler {
  id: string;
  name: string;
  speciesID: number;
  level: number;
  active: boolean;
  fainted: boolean;
  hp: number;
  maxHP: number;
  status: string;
  gender?: 'M' | 'F' | '';
  shiny?: boolean; form?: string | null; mega?: boolean; item?: string; ability?: string;
  stats?: Record<string,number>; boosts?: Record<string,number>; effectiveSpeed?: number; speedStage?: number;
  effects?: unknown[];
}
export interface BattleMove {
  index: number;
  name: string;
  pp: number;
  maxPP: number;
  disabled: boolean;
  type: string;
  apiName?: string; power?: number; accuracy?: number | true; category?: string; description?: string;
  targetScope?: string; ignoresTypeMatchup?: boolean; disableReason?: string;
  matchups?: {location:number;name:string;multiplier:number|null}[];
  targetRequired: boolean;
  targets: { location: number; name: string }[];
}
export interface BattleSlot {
  slot: number;
  mustSwitch: boolean;
  canPass: boolean;
  trapped: boolean;
  canMegaEvo: boolean;
  moves: BattleMove[];
}
export interface BattleFrame {
  turn: number;
  decisionID: string;
  waiting: boolean;
  ended: boolean;
  winner: number | null;
  own: Battler[];
  foe: Battler[];
  slots: BattleSlot[];
  log: string[];
  logOffset?: number; preview?: boolean; field?: Record<string,unknown>;
  foeTeamStatus?: {selected:number;fainted:number};
  effects?: BattleVisualEvent[]; scenes?: BattleScene[];
}
export interface BattleScene {id:number;turn:number;own:Battler[];foe:Battler[];field?:Record<string,unknown>;foeTeamStatus?:{selected:number;fainted:number}}
export interface BattleVisualEvent {globalField?:boolean;id:number;move:string;moveID?:string;phase?:string;source:{own:boolean;slot:number};targets:{position:{own:boolean;slot:number};hit:boolean}[];type?:string;category?:string}
export interface BattleChoice {championAchievedAt?:number;battleDefaultItem?:string;
  id: string;
  label: string;
  speciesID: number;
  shiny?: boolean; form?: string; level?: number;
}
export type BattleReward = 'heal' | 'pp' | 'all' | 'skip';
export interface ChallengeView {
  mode: BattleMode;
  practice: boolean;
  checkpoint: string;
  phase: 'preparation'|'battling' | 'reward'|'intermission' | 'lost' | 'cleared';
  encounter: number;
  encounterCount: number;
  opponent: string;
  frame: BattleFrame;
  rewards: { kind: BattleReward; label: string }[];
  encounterID?: string; arena?: string;
  preview?:BattleRosterMember[];
  progress?:ChallengeProgressView;
}
export interface BattleAPI {
  open(kind?:'challenge'|'lan'): Promise<void>;
  closeWindow(): Promise<void>;
  auxiliary(kind:'field'|'stats',visible?:boolean): Promise<void>;
  assets(): Promise<string>;
  audio(patch?: {music?:number;effects?:number;enabled?:boolean;typeHints?:boolean}): Promise<{music:number;effects:number;enabled:boolean;typeHints?:boolean}>;
  context(): Promise<import('./settings.js').AppSettings>;
  onContext(handler:(context:import('./settings.js').AppSettings)=>void):void;
  onState(handler:(view:ChallengeView)=>void):void;
  lan(command:'state'|'host'|'connect'|'register'|'ready'|'unready'|'choose'|'surrender'|'cancel'|'history',value?:unknown):Promise<LanBattleState>;
  onLan(handler:(state:LanBattleState)=>void):void;
  choices(purpose?:'champion'): Promise<BattleChoice[]>;
  resume(mode: BattleMode): Promise<ChallengeView | null>;
  start(mode: BattleMode, ids: string[] | null,items?:Record<string,string>): Promise<ChallengeView>;
  choose(mode: BattleMode, decisionID: string, actions: BattleAction[]): Promise<ChallengeView>;
  advance(mode: BattleMode, reward: BattleReward, checkpoint: string): Promise<ChallengeView>;
  surrender(mode: BattleMode): Promise<ChallengeView>;
  cpu(command:'prepare'|'reward'|'purchase'|'next'|'claim',value?:unknown):Promise<ChallengeView>;
}
export interface ChallengeProgressView{
  points:number;resources:{id:string;hp:number;status:string;item:string;moves:{id:string;pp:number;maxPP:number}[]}[];
  team:{id:string;speciesID:number;level:number;shiny:boolean;form?:string;stats:Record<string,number>;moves:string[];item?:string;ability:string;displayName:string}[];
  shop:{id:string;price:number}[];buffs:{id:string;kind:string;remaining:number}[];roll?:string;retired:string[];
  cash:number;champion?:{recipientID?:string;claimed:boolean};
}
export interface BattleRosterMember {id:string;speciesID:number;level:number;shiny:boolean;form?:string|null}
export interface LanBattleState {
  phase:'idle'|'searching'|'connecting'|'connected'|'preparing'|'playing'|'reconnecting'|'ended';
  identity:{nickname:string;code:string;nonce:string};opponent?:{nickname:string;code:string;nonce:string};
  host:boolean;codes:string[];peers?:{code:string;nickname:string;address:string}[];registered:BattleRosterMember[];opponentRoster:BattleRosterMember[];
  localReady:boolean;remoteReady:boolean;submitted:boolean;frame?:BattleFrame;outcome?:'win'|'loss'|'draw'|'interrupted';
  deadline?:number;error?:string;history?:BattleRecord[];
}
export interface BattleRecord {id:string;opponentCode:string;opponentName:string;mode:BattleMode;startedAt:number;endedAt:number;result:string;reason:string;team:BattleRosterMember[];turns:number}
