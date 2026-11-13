import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BattleAction, BattleFrame, BattleMode } from '../../shared/battle.js';

type Stat = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type Stats = Record<Stat, number>;
export interface Member {
  id: string;
  speciesID: number;
  species: string;
  displayName: string;
  level: number;
  ability: string;
  nature: string;
  gender: string;
  shiny: boolean;
  form?: string;
  ivs: Stats;
  stats: Stats;
  moves: string[];
  item?: string;
}
export interface Resource {
  id: string;
  hp: number;
  status: string;
  item: string;
  sleepStart?: number;
  sleepRemaining?: number;
  moves: { id: string; pp: number; maxPP: number }[];
}
export interface EngineFrame extends BattleFrame { resources: Resource[] }
export interface Engine {
  choose(player: number, decision: string, actions: BattleAction[],order?:number[]): void;
  runCPU(): void;
  frame(player: number): EngineFrame;
  surrender(player: number): void;
}
interface EngineOptions {
  profile: 'challenge'|'peer';
  resources?: [Resource[], null];
  automaticOpponent?: boolean;
  expectedPolicyRevision?: string;
  challengeBoosts?: Record<string,number>;
  challengeBattleSize?: 4;
}
const require = createRequire(import.meta.url);
const engineDir = new URL('../../battle-engine/', import.meta.url);
export const { OwnedBattle, REVISION } = require('../../battle-engine/engine.cjs') as {
  OwnedBattle: new (mode: BattleMode, teams: [Member[], Member[]], seed: number[], options?: EngineOptions) => Engine;
  REVISION: string;
};
interface Named { id: string; name: string; exists: boolean; gen: number }
interface Species extends Named {
  num: number; forme: string; isMega: boolean; baseStats: Stats; types: string[];
  abilities: { 0: string; 1?: string; H?: string };
}
interface Move extends Named { pp: number; basePower: number; type: string; category: string; accuracy: number | true }
interface DexData {
  species: { get(name: string): Species; all(): Species[];
    getFullLearnset(id: string): { learnset?: Record<string, string[]> }[] };
  moves: { get(name: string): Move };
  abilities: { get(name: string): Named };
  natures: { get(name: string): Named & { plus?: Stat; minus?: Stat } };
}
const { Dex } = require('pokemon-showdown') as { Dex: { mod(id: string): DexData } };
export const dex = Dex.mod('gen5');
export const { battleDex, allowedFairyMoves } = require('../../battle-engine/held-items.cjs') as {
  battleDex(): typeof dex; allowedFairyMoves: Set<string>;
};

interface Encounter { id: string; nameKo: string; phase: string; team: Member[] }
const catalog = require('../../battle-engine/challenge-opponents.json') as { encounters: Encounter[] };
const doubleSets = require('../../battle-engine/challenge-doubles-opponents.json') as Record<string,
  { speciesID: number; ability: string; moves: string[]; item: string }[]>;
const doublesOrder = ['brock', 'misty', 'ltsurge', 'erika', 'koga1', 'sabrina', 'blaine', 'giovanni',
  'lorelei', 'bruno1', 'agatha', 'lance1', 'blue', 'red'];

export const encounters: Record<BattleMode, Encounter[]> = {
  singles: catalog.encounters,
  doubles: doublesOrder.map(id => {
    const single = catalog.encounters.find(encounter => encounter.id === id)!;
    return { ...single, team: doubleSets[id].map(set => ({
      ...single.team.find(member => member.speciesID === set.speciesID)!, ...set, abilitySlot: undefined,
    })) };
  }),
};

export const policyRevision: Record<BattleMode, string> = {
  singles: createHash('sha256').update(readFileSync(new URL('challenge-policy.json', engineDir))).digest('hex'),
  doubles: require('../../battle-engine/challenge-doubles-lineup.cjs').REVISION,
};

export const engineIdentity = createHash('sha256')
  .update(REVISION).update(JSON.stringify(encounters))
  .update(JSON.stringify(policyRevision))
  .update(readFileSync(new URL('challenge-doubles-lineup-model.json', engineDir)))
  .digest('hex');

export function freshResources(team: Member[]): Resource[] {
  const rules = battleDex();
  return team.map(member => ({
    id: member.id, hp: member.stats.hp, status: '', item: member.item ?? '',
    moves: member.moves.map(name => {
      const move = rules.moves.get(name);
      return { id: move.id.startsWith('hiddenpower') ? 'hiddenpower' : move.id, pp: move.pp, maxPP: move.pp };
    }),
  }));
}
