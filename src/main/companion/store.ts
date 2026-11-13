import {validBattleDefaultItem}from'./battle-items.js';
import { mergeCandyLedgers, observeCandyWindows, type CandyLedger, type CandyWindow } from './candy-grants.js';
import { object, type Row } from '../usage/jsonl.js';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { rarities, type Rarity, type CompanionProfile, type CompanionView, type SaveImportResult, type Species } from '../../shared/companion.js';
import { bagItems, candyXP, shopCatalog, type BagItem, type CompanionAction, type EggTier } from '../../shared/companion.js';
import type { Provider } from '../../shared/usage.js';
import type { Entry } from '../usage/entries.js';
import { tradePreview, wireItem, type OfferedItem } from '../trade/item.js';
import type { TradeChoice } from '../../shared/trade.js';
import { appearance, lineForms } from './forms.js';
import { hatchData } from './hatch-data.js';
import { families, natures, speciesFor } from './catalog.js';
import { levelUpMoves, moveOptions, replacingMove, type KnownMove, type MoveChange } from '../../shared/pokemon-loadout.js';
import type { PokemonDetails, PokemonDetailView } from '../../shared/pokemon-details.js';

export interface Individual {
  id: string;
  family: number;
  stage: number;
  hatchedAt: number;
  nature: string;
  shiny: boolean;
  repeat: boolean;
  route?: Species[];
  totalForms?: number;
  rarity?: Rarity;
  form?: string;
  level?: number;
  macProfile?: Row;
  releasedAt?: number;
  championAchievedAt?:number;
  battleDefaultItem?:string;
  dittoDisguise?: number;
  dittoRevealed?: boolean;
}

interface Save extends CandyLedger {
  version: 1;
  baseline: number | null;
  ledger: Record<string, number>;
  raised: number;
  progress: number;
  active: Individual | null;
  growthDifficulty?: number;
  shopDifficulty?: number;
  spentTokens?: number;
  inventory?: Partial<Record<BagItem, number>>;
  eggTier?: EggTier;
  pendingHatchID?: number;
  pendingForm?: string;
  eggPrayers?: number;
  representativeSpeciesID?: number;
  representativeForm?: string;
  challengeCashClaims?: Record<string, number>;
  challengeShinyClaims?:Record<string,string>;
  graduated: (Individual & { graduatedAt: number })[];
}

export const hatchThreshold = 5_000_000;
const graduation = { common: 750_000_000, uncommon: 1_875_000_000, rare: 3_000_000_000, legendary: 6_000_000_000 };
export type ImportedProgress = Pick<Save, 'raised' | 'progress' | 'active' | 'graduated' | 'spentTokens' |
  'inventory' | 'eggTier' | 'pendingHatchID' | 'pendingForm' | 'eggPrayers' | 'representativeSpeciesID' | 'representativeForm' | 'challengeCashClaims'|'challengeShinyClaims'> & CandyLedger;

function routeOf(individual: Individual): Species[] {
  return individual.route ?? families[individual.family];
}
const empty = (): Save => ({ version: 1, baseline: null, ledger: {}, raised: 0, progress: 0, active: null, graduated: [] });

function threshold(individual: Individual | null, difficulty = 1): number {
  if (!individual) return Math.round(hatchThreshold * difficulty);
  const length = individual.totalForms ?? routeOf(individual).length;
  const phase = Math.round(graduation[individual.rarity ?? 'common'] * (individual.stage + 1) / (length * (length + 1) / 2));
  return Math.round(Math.round(phase / (individual.repeat ? 2 : 1)) * difficulty);
}

const statNames = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];

function wallet(state: Save): number {
  const bonus = Object.values(state.challengeCashClaims ?? {}).reduce((sum, amount) =>
    Math.min(Number.MAX_SAFE_INTEGER, sum + Math.min(500_000_000, amount)), 0);
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, state.raised - (state.spentTokens ?? 0) + bonus));
}

function disguised(mon: Individual): boolean {
  return mon.dittoDisguise !== undefined && !mon.dittoRevealed;
}

function remainingStages(state: Save): CompanionView['economy']['candyStages'] {
  const mon = state.active;
  if (!mon) return [];
  const route = routeOf(mon);
  if (route.length !== (mon.totalForms ?? route.length)) return [];
  return route.slice(mon.stage).map((_, index) => ({
    threshold: threshold({ ...mon, stage: mon.stage + index }, state.growthDifficulty ?? 1),
    species: route[mon.stage + index + 1] ?? null,
  }));
}

function maxCandy(state: Save, stages = remainingStages(state)): number {
  const remaining = stages.reduce((sum, stage) => sum + stage.threshold, 0) - state.progress;
  return Math.min(state.inventory?.rareCandy ?? 0, Math.ceil(Math.max(0, remaining) / candyXP));
}

function profile(individual: Individual & { graduatedAt?: number }): CompanionProfile {
  const saved = individual.macProfile;
  const ivs = object(saved?.ivs);
  return {
    id: individual.id, hatchedAt: individual.hatchedAt, nature: individual.nature, shiny: individual.shiny && !disguised(individual),
    species: routeOf(individual).slice(0, individual.stage + 1).map(species => ({ ...species, ...appearance(species.number, individual.form) })), graduatedAt: individual.graduatedAt,
    totalForms: individual.totalForms ?? routeOf(individual).length, repeatGrowth: individual.repeat,
    battleDefaultItem:individual.battleDefaultItem,championAchievedAt:individual.championAchievedAt,releasedAt: individual.releasedAt, rarity: individual.rarity, form: individual.form, level: individual.level,
    ivs: ivs ? Object.fromEntries(statNames.flatMap(key => typeof ivs[key] === 'number' ? [[key, ivs[key]]] : [])) : undefined,
    gender: saved?.gender === 'male' || saved?.gender === 'female' || saved?.gender === 'genderless' ? saved.gender : undefined,
    abilityIsHidden: saved?.abilityIsHidden === true,
    ability: typeof saved?.abilityName === 'string' ? saved.abilityName : undefined,
    hasCustomMoves:saved?.hasCustomMoves===true,
    moves: Array.isArray(saved?.moves) ? saved.moves.slice(0,4).flatMap(move => {
      const name = object(move)?.name;
      return typeof name === 'string' ? [name] : [];
    }) : undefined,
  };
}

function knownMoves(mon: Individual): KnownMove[] {
  return Array.isArray(mon.macProfile?.moves) ? mon.macProfile.moves.slice(0,4).flatMap(value=>{
    const row=object(value);
    return typeof row?.name==='string' ? [{name:row.name,learnedAtLevel:typeof row.learnedAtLevel==='number'?row.learnedAtLevel:0}] : [];
  }) : [];
}

function enrichMoves(mon: Individual, details: PokemonDetails, graduated: boolean): void {
  if (!mon.macProfile) {
    const bytes=createHash('sha256').update('profile:'+mon.id).digest();
    mon.macProfile={instanceID:mon.id,seed:bytes.readBigUInt64BE().toString(),
      ivs:Object.fromEntries(statNames.map((name,index)=>[name,bytes[8+index]%32])),
      level:mon.level ?? (graduated?100:5),growthTokens:graduated?graduation[mon.rarity ?? 'common']:0,abilityIsHidden:false,moves:[]};
  }
  const saved=mon.macProfile;
  const level=mon.level ?? (typeof saved.level==='number'?saved.level:graduated?100:5);
  mon.level=level;saved.level=level;
  const moves=knownMoves(mon);
  const form=appearance(details.speciesID,mon.form).form;
  const changedSpecies=saved.loadoutSpeciesID!==undefined && (saved.loadoutSpeciesID!==details.speciesID || saved.loadoutForm!==form);
  if (saved.hasCustomMoves!==true && (!moves.length || changedSpecies ||
      (saved.automaticMovesLevel!==undefined && saved.automaticMovesLevel!==level))) saved.moves=levelUpMoves(details.moves,level).slice(-4);
  else saved.moves=moves;
  saved.loadoutSpeciesID=details.speciesID;saved.loadoutForm=form;saved.automaticMovesLevel=level;
}

function evolutionPreview(mon: Individual | null): NonNullable<CompanionView['evolutionPreview']> {
  if (!mon) return [];
  const realized = routeOf(mon).slice(0, mon.stage + 1);
  const nodes: NonNullable<CompanionView['evolutionPreview']> = realized.map((species,index) => ({ species: { ...species, ...appearance(species.number, mon.form) }, reached:true, current:index===mon.stage }));
  let current=realized.at(-1)!.number;
  const seen=new Set(realized.map(species=>species.number));
  while (nodes.length < 12) {
    const children=evolutionChildren.get(current) ?? [];
    if (children.length>1) { nodes.push({species:null,reached:false,current:false}); break; }
    if (!children.length) {
      if (nodes.length < (mon.totalForms ?? realized.length)) nodes.push({species:null,reached:false,current:false});
      break;
    }
    current=children[0]; if(seen.has(current)) break; seen.add(current);
    nodes.push({species:{...speciesFor(current),...appearance(current,mon.form)},reached:false,current:false});
  }
  return nodes;
}

function view(state: Save): CompanionView {
  const active = state.active ? profile(state.active) : null;
  const captures = state.graduated.map(profile);
  const species = new Map<number, Species>();
  for (const row of active ? [...captures, active] : captures) {
    for (const form of row.species) species.set(form.number, form);
  }
  const candyStages = remainingStages(state);
  const representativeRows = (active ? [...captures, active] : captures).filter(row =>
    row.species.some(species => species.number === state.representativeSpeciesID) &&
    row.species.find(species => species.number === state.representativeSpeciesID)?.form ===
      appearance(state.representativeSpeciesID!, state.representativeForm).form);
  return {
    current: active?.species.at(-1) ?? null,
    pet: representativeRows.length ? {
      species: representativeRows[0].species.find(species => species.number === state.representativeSpeciesID)!,
      shiny: representativeRows.some(row => row.shiny),
    } : { species: active?.species.at(-1) ?? null, shiny: active?.shiny ?? false },
    prayers: state.eggPrayers ?? 0,
    progress: state.progress, threshold: threshold(state.active, state.growthDifficulty ?? 1),
    next: state.active ? routeOf(state.active)[state.active.stage + 1] ?? null : null,
    evolutionPathMissing: state.active ? routeOf(state.active).length < (state.active.totalForms ?? 0) &&
      state.active.stage + 1 === routeOf(state.active).length : undefined,
    raised: state.raised, active, captures,
    evolutionPreview: evolutionPreview(state.active),
    planned: state.active ? routeOf(state.active).map(species => ({ ...species, ...appearance(species.number, state.active?.form) })) : [],
    economy: {
      growthDifficulty: state.growthDifficulty ?? 1, shopDifficulty: state.shopDifficulty ?? 1,
      prices: Object.fromEntries(Object.entries(shopCatalog).map(([id, item]) =>
        [id, Math.round(item.price * (state.shopDifficulty ?? 1))])) as CompanionView['economy']['prices'],
      wallet: wallet(state), spent: state.spentTokens ?? 0, inventory: state.inventory ?? {},
      eggTier: state.eggTier, maxCandy: maxCandy(state, candyStages), candyStages,
      representative: representativeRows.length ? { speciesID: state.representativeSpeciesID!, form: appearance(state.representativeSpeciesID!, state.representativeForm).form } : null,
      representativeShiny: representativeRows.some(row => row.shiny),
    },
    collection: [...species.values()].sort((a, b) => a.number - b.number),
  };
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validIndividual(value: unknown): value is Individual {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Individual>;
  if (typeof item.id !== 'string' || !item.id || !validNumber(item.stage) || !validNumber(item.hatchedAt) ||
      typeof item.nature !== 'string' || typeof item.shiny !== 'boolean' || typeof item.repeat !== 'boolean') return false;
  if (item.route !== undefined) {
    if (!Array.isArray(item.route) || item.route.length < 1 || item.route.length > 12 ||
        !item.route.every(species => species && validNumber(species.number) && species.number > 0 &&
          typeof species.name === 'string' && typeof species.type === 'string')) return false;
  } else if (!validNumber(item.family) || item.family >= families.length) return false;
  return item.stage < routeOf(item as Individual).length &&
    (item.totalForms === undefined || (validNumber(item.totalForms) && item.totalForms >= routeOf(item as Individual).length && item.totalForms <= 12)) &&
    (item.rarity === undefined || rarities.includes(item.rarity)) &&
    (item.form === undefined || typeof item.form === 'string') &&
    (item.level === undefined || (validNumber(item.level) && item.level <= 100)) &&
    (item.dittoDisguise === undefined || (validNumber(item.dittoDisguise) && item.dittoDisguise >= 1 && item.dittoDisguise <= 649)) &&
    (item.dittoRevealed === undefined || typeof item.dittoRevealed === 'boolean') &&
    (item.releasedAt === undefined || validNumber(item.releasedAt)) && (item.championAchievedAt===undefined||validNumber(item.championAchievedAt)) && (item.battleDefaultItem===undefined||validBattleDefaultItem(routeOf(item as Individual)[item.stage!].number,item.form,item.battleDefaultItem));
}

function validate(value: unknown): Save {
  if (!value || typeof value !== 'object') throw new Error('Invalid companion save');
  const state = value as Partial<Save>;
  if (state.version !== 1 || !(state.baseline === null || validNumber(state.baseline)) ||
      !validNumber(state.raised) || !validNumber(state.progress) ||
      ([state.growthDifficulty, state.shopDifficulty].some(value => value !== undefined &&
        (typeof value !== 'number' || !Number.isFinite(value) || value < .1 || value > 2))) ||
      (state.candyArmedWindows !== undefined && (!Array.isArray(state.candyArmedWindows) ||
        !state.candyArmedWindows.every(key => typeof key === 'string'))) ||
      (state.candyFeatureSeeded !== undefined && typeof state.candyFeatureSeeded !== 'boolean') ||
      (state.candyGrantTier !== undefined && (!object(state.candyGrantTier) || !Object.values(state.candyGrantTier).every(validNumber))) ||
      (state.candyWindowEpoch !== undefined && (!object(state.candyWindowEpoch) ||
        !Object.values(state.candyWindowEpoch).every(epoch => typeof epoch === 'string'))) ||
      (state.spentTokens !== undefined && !validNumber(state.spentTokens)) ||
      (state.inventory !== undefined && (!object(state.inventory) || !Object.entries(state.inventory)
        .every(([key, count]) => bagItems.includes(key as BagItem) && validNumber(count)))) ||
      (state.challengeCashClaims !== undefined && (!object(state.challengeCashClaims) ||
        !Object.values(state.challengeCashClaims).every(validNumber))) ||
      (state.challengeShinyClaims!==undefined&&(!object(state.challengeShinyClaims)||!Object.values(state.challengeShinyClaims).every(value=>typeof value==='string'&&value.length<=256))) ||
      (state.eggTier !== undefined && state.eggTier !== 'uncommon' && state.eggTier !== 'rare') ||
      (state.pendingHatchID !== undefined && !hatchData.some(([id, parent]) => id === state.pendingHatchID && !parent)) ||
      (state.eggPrayers !== undefined && !validNumber(state.eggPrayers)) ||
      (state.pendingForm !== undefined && typeof state.pendingForm !== 'string') ||
      (state.representativeSpeciesID !== undefined && !validNumber(state.representativeSpeciesID)) ||
      (state.representativeForm !== undefined && typeof state.representativeForm !== 'string') ||
      !(state.active === null || validIndividual(state.active)) ||
      !Array.isArray(state.graduated) || !state.graduated.every(item =>
        validIndividual(item) && validNumber(item.graduatedAt) && item.stage === routeOf(item).length - 1) ||
      !state.ledger || typeof state.ledger !== 'object' || Array.isArray(state.ledger) ||
      !Object.entries(state.ledger).every(([id, total]) => /^[a-f0-9]{64}$/.test(id) && validNumber(total))) {
    throw new Error('Invalid or unsupported companion save');
  }
  return state as Save;
}

async function load(path: string): Promise<Save> {
  try { return validate(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw error;
  }
}

async function commit(path: string, bytes: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID();
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

const hatchRoots = hatchData.filter(([, parent, rate]) => !parent && rate > 0);
const evolutionChildren = new Map<number, number[]>();
for (const [id, parent] of hatchData) {
  if (parent) evolutionChildren.set(parent, [...(evolutionChildren.get(parent) ?? []), id]);
}

function hatch(state: Save, now: number, rollDitto: () => boolean): Individual {
  const collected = new Set(state.graduated.filter(item => item.releasedAt === undefined).map(item => routeOf(item)[0].number));
  const ceiling = state.eggTier === 'rare' ? 45 : state.eggTier === 'uncommon' ? 120 : 255;
  const candidates = hatchRoots.filter(([, , rate]) => rate <= ceiling);
  const weights = candidates.map(([id, , rate]) => collected.has(id) ? Math.max(1, Math.floor(rate / 2)) : rate);
  let roll = randomInt(weights.reduce((sum, weight) => sum + weight, 0));
  const [base, , rate, legendary] = candidates.find(([id]) => id === state.pendingHatchID) ??
    candidates[weights.findIndex(weight => (roll -= weight) < 0)];
  const ids = [base];
  while (evolutionChildren.has(ids.at(-1)!)) {
    const children = evolutionChildren.get(ids.at(-1)!)!;
    ids.push(children[randomInt(children.length)]);
  }
  const rarity = legendary ? 'legendary' : rate <= 45 ? 'rare' : rate <= 120 ? 'uncommon' : 'common';
  const id = randomUUID();
  const forms = lineForms(base, ids);
  const collectedForms = new Set(state.graduated.filter(item => routeOf(item)[0].number === base).map(item => item.form));
  const weightedForms = forms.flatMap(form => collectedForms.has(form) ? [form] : [form, form]);
  const pendingForm = base === state.pendingHatchID ? state.pendingForm : undefined;
  const form = pendingForm && forms.includes(pendingForm) ? pendingForm
    : weightedForms.length ? weightedForms[randomInt(weightedForms.length)] : undefined;
  return {
    id, family: -1, stage: 0, hatchedAt: now, route: ids.map(id => speciesFor(id)),
    dittoDisguise: rarity === 'common' && ids.length >= 2 && rollDitto() ? base : undefined,
    repeat: collected.has(base), rarity, nature: natures[randomInt(natures.length)],
    shiny: randomInt(state.inventory?.shinyCharm ? 48 : 64) === 0, form, level: 5,
    macProfile: { instanceID: id, seed: BigInt('0x' + id.replaceAll('-', '').slice(0, 16)).toString(),
      level: 5, growthTokens: 0, abilityIsHidden: false, moves: [],
      ivs: Object.fromEntries(statNames.map(stat => [stat, randomInt(32)])) },
  };
}

function advance(state: Save, delta: number, now: number, rollDitto: () => boolean, fromUsage = true): CompanionView['dittoReveal'] {
  let reveal: CompanionView['dittoReveal'];
  state.progress = Math.min(Number.MAX_SAFE_INTEGER, state.progress + delta);
  if (fromUsage) state.raised = Math.min(Number.MAX_SAFE_INTEGER, state.raised + delta);
  if (!state.active && state.progress >= threshold(null, state.growthDifficulty ?? 1)) {
    state.progress -= threshold(null, state.growthDifficulty ?? 1);
    state.active = hatch(state, now, rollDitto);
    delete state.eggTier;
    delete state.eggPrayers;
    delete state.pendingHatchID;
    delete state.pendingForm;
  }
  if (state.active?.macProfile) {
    const mon = state.active;
    const rarity = mon.rarity ?? 'common';
    const saved = mon.macProfile!;
    const earlier = Array.from({ length: mon.stage }, (_, stage) => threshold({ ...mon, stage })).reduce((a, b) => a + b, 0);
    const growth = Math.min(graduation[rarity], (earlier + state.progress / (state.growthDifficulty ?? 1)) * (mon.repeat ? 2 : 1));
    saved.growthTokens = Math.max(typeof saved.growthTokens === 'number' ? saved.growthTokens : 0, growth);
    const level = Math.min(100, Math.max(mon.level ?? 5, 5 + Math.floor(95 * Number(saved.growthTokens) / graduation[rarity])));
    saved.level = mon.level = level;
  }
  while (state.active) {
    const required = threshold(state.active, state.growthDifficulty ?? 1);
    if (state.progress < required) break;
    if (disguised(state.active)) {
      const mon = state.active;
      const previousRarity = mon.rarity ?? 'common';
      reveal = { id: mon.id, disguise: routeOf(mon)[0].name, shiny: mon.shiny };
      state.progress -= required;
      const ditto = speciesFor(132);
      mon.family = -1;
      mon.route = [ditto];
      mon.totalForms = 1;
      mon.stage = 0;
      mon.rarity = 'rare';
      mon.repeat = state.graduated.some(item => item.releasedAt === undefined && routeOf(item)[0].number === 132);
      mon.dittoRevealed = true;
      delete mon.form;
      if (mon.macProfile) {
        const saved = mon.macProfile;
        const fraction = Math.min(1, Number(saved.growthTokens ?? 0) / graduation[previousRarity]);
        saved.growthTokens = Math.floor(fraction * graduation.rare);
        for (const key of ['gender', 'abilitySlot', 'abilityName', 'hasCustomMoves', 'hasCustomAbility',
          'loadoutSpeciesID', 'loadoutForm', 'automaticMovesLevel']) delete saved[key];
        saved.moves = [];
        saved.abilityIsHidden = false;
      }
      if (state.representativeSpeciesID && !view(state).economy.representative) {
        delete state.representativeSpeciesID;
        delete state.representativeForm;
      }
      continue;
    }
    const route = routeOf(state.active);
    if (state.active.stage + 1 === route.length && route.length < (state.active.totalForms ?? route.length)) break;
    state.progress -= required;
    if (state.active.stage + 1 < route.length) {
      state.active.stage++;
    } else {
      state.graduated.push({ ...state.active, graduatedAt: now });
      state.active = null;
      state.progress = 0; // A new egg starts empty, as on macOS.
    }
  }
  return reveal;
}

type Observations = ReadonlyMap<Provider, readonly Entry[]>;

export class CompanionStore {
  private tradeReservation?: string;
  private moveDetails=new Map<number,PokemonDetails>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string, private readonly rollDitto = () => randomInt(128) === 0) {}

  private refreshCachedMoves(state: Save): boolean {
    let changed=false;
    for(const mon of [...(state.active?[state.active]:[]),...state.graduated]){
      const details=this.moveDetails.get(routeOf(mon)[mon.stage].number);if(!details)continue;
      const before=JSON.stringify(mon);enrichMoves(mon,details,mon!==state.active);
      changed ||= before!==JSON.stringify(mon);
    }
    return changed;
  }

  read(): Promise<CompanionView> {
    return this.queue.then(async () => view(await load(this.path)));
  }

  finishWrites(): Promise<unknown> { return this.queue; }

  pray(): Promise<CompanionView> {
    const result = this.queue.then(async () => {
      const state = await load(this.path);
      if (!state.active && !this.tradeReservation) {
        state.eggPrayers = Math.min(Number.MAX_SAFE_INTEGER, (state.eggPrayers ?? 0) + 1);
        await commit(this.path, JSON.stringify(state));
      }
      return view(state);
    });
    this.queue = result.catch(() => {});
    return result;
  }

  grantCandies(windows: CandyWindow[]): Promise<{ state: CompanionView; count: number } | null> {
    if (!windows.length) return Promise.resolve(null);
    const result = this.queue.then(async () => {
      const state = await load(this.path);
      if (this.tradeReservation) return null;
      const before = JSON.stringify(state);
      const count = observeCandyWindows(state, windows);
      if (count) {
        const inventory = state.inventory ??= {};
        inventory.rareCandy = Math.min(Number.MAX_SAFE_INTEGER, (inventory.rareCandy ?? 0) + count);
      }
      const updated = JSON.stringify(state);
      if (before === updated) return null;
      await commit(this.path, updated);
      return { state: view(state), count };
    });
    this.queue = result.catch(() => {});
    return result;
  }

  change(action: CompanionAction, now = Date.now()): Promise<CompanionView> {
    const result = this.queue.then(async () => {
      if (this.tradeReservation) throw new Error('교환을 확정하는 동안에는 변경할 수 없습니다.');
      const state = await load(this.path);
      const inventory = state.inventory ??= {};
      let reveal: CompanionView['dittoReveal'];
      if (action.kind === 'buy') {
        const cost = Math.round(shopCatalog[action.product].price * (state.shopDifficulty ?? 1)) * action.quantity;
        if (!validNumber(cost) || action.quantity < 1 || cost > wallet(state) ||
          !Number.isSafeInteger((state.spentTokens ?? 0) + cost)) throw new Error('구매 수량과 잔액을 확인해 주세요.');
        if (action.product === 'egg' || action.product === 'eggUncommon' || action.product === 'eggRare') {
          const mon = state.active;
          if (!mon || action.quantity !== 1 || mon.id !== action.activeID) throw new Error('현재 파트너가 변경되었습니다.');
          state.graduated.push({ ...mon, shiny: mon.shiny && !disguised(mon), dittoDisguise: undefined, route: routeOf(mon).slice(0, mon.stage + 1), family: -1,
            graduatedAt: now, releasedAt: now });
          state.active = null;
          state.progress = 0;
          state.eggTier = action.product === 'eggRare' ? 'rare' : action.product === 'eggUncommon' ? 'uncommon' : undefined;
          delete state.eggPrayers;
          delete state.pendingHatchID;
          delete state.pendingForm;
        } else {
          const owned = inventory[action.product] ?? 0;
          if (action.product === 'shinyCharm' && (owned || action.quantity !== 1)) throw new Error('이로치 부적은 한 번만 살 수 있습니다.');
          inventory[action.product] = owned + action.quantity;
        }
        state.spentTokens = (state.spentTokens ?? 0) + cost;
      } else if (action.kind === 'use') {
        const owned = inventory[action.item] ?? 0;
        let consumed = action.quantity;
        if (!validNumber(action.quantity) || action.quantity < 1 || owned < action.quantity ||
          (action.item !== 'rareCandy' && action.quantity !== 1)) throw new Error('사용할 아이템과 수량을 확인해 주세요.');
        if (action.item === 'redMaple') {
          const target = state.graduated.find(item => item.id === action.id && item.releasedAt === undefined);
          if (!target?.macProfile) throw new Error('개체값을 변경할 수 있는 졸업 개체를 선택해 주세요.');
          target.macProfile.ivs = Object.fromEntries(statNames.map(stat => [stat, randomInt(32)]));
        } else {
          const mon = state.active;
          if (!mon || mon.id !== action.id || action.item === 'shinyCharm') throw new Error('현재 파트너에게 이 아이템을 사용할 수 없습니다.');
          if (action.item === 'rareCandy') {
            if (action.quantity > maxCandy(state)) throw new Error('현재 성장 단계에서 사용할 수 있는 수량을 확인해 주세요.');
            if (disguised(mon)) {
              consumed = Math.min(consumed, Math.max(0, Math.ceil((threshold(mon, state.growthDifficulty ?? 1) - state.progress) / candyXP)));
            }
            reveal = advance(state, consumed * candyXP, now, this.rollDitto, false);
          } else {
            const choices = natures.filter(nature => nature !== mon.nature);
            mon.nature = choices[randomInt(choices.length)];
          }
        }
        inventory[action.item] = owned - consumed;
      } else if(action.kind==='battle-default-item'){
        const mon=state.graduated.find(mon=>mon.id===action.id&&mon.releasedAt===undefined);
        if(!mon||!validBattleDefaultItem(routeOf(mon)[mon.stage].number,mon.form,action.item))throw new Error('이 개체에 장착할 수 있는 도구를 선택해 주세요.');
        mon.battleDefaultItem=action.item||undefined;
      } else if (action.kind === 'difficulty') {
        if ([action.growth, action.shop].some(value => !Number.isFinite(value) || value < .1 || value > 2)) {
          throw new Error('난이도 범위를 확인해 주세요.');
        }
        const oldThreshold = threshold(state.active, state.growthDifficulty ?? 1);
        const nextThreshold = threshold(state.active, action.growth);
        const scaled = Math.floor(state.progress / oldThreshold * nextThreshold);
        state.progress = state.progress < oldThreshold ? Math.min(nextThreshold - 1, scaled) : scaled;
        state.growthDifficulty = action.growth;
        state.shopDifficulty = action.shop;
      } else {
        if (action.speciesID !== null && action.form !== appearance(action.speciesID, action.form).form) {
          throw new Error('도감에 등록된 형태를 선택해 주세요.');
        }
        state.representativeSpeciesID = action.speciesID ?? undefined;
        state.representativeForm = action.speciesID === null ? undefined : action.form;
        if (action.speciesID !== null && !view(state).economy.representative) throw new Error('도감에 등록된 형태를 선택해 주세요.');
      }
      this.refreshCachedMoves(state);
      await commit(this.path, JSON.stringify(validate(state)));
      return { ...view(state), ...(reveal && { dittoReveal: reveal }) };
    });
    this.queue = result.catch(() => {});
    return result;
  }

  static decodeWindowsBackup(raw: unknown): ImportedProgress {
    const envelope = object(raw);
    if (envelope?.format !== 'poketokenbar.windows.backup' || envelope.version !== 1) throw new Error('Windows 백업 형식을 확인해 주세요.');
    const source = validate(object(envelope.files)?.['companion-v1.json']);
    const { raised, progress, active, graduated, spentTokens, inventory, eggTier, pendingHatchID, pendingForm,
      eggPrayers, representativeSpeciesID, representativeForm, challengeCashClaims,challengeShinyClaims,
      candyFeatureSeeded, candyGrantTier, candyWindowEpoch, candyArmedWindows } = source;
    return { raised, progress, active, graduated, spentTokens, inventory, eggTier, pendingHatchID, pendingForm,
      eggPrayers, representativeSpeciesID, representativeForm, challengeCashClaims,challengeShinyClaims,
      candyFeatureSeeded, candyGrantTier, candyWindowEpoch, candyArmedWindows };
  }

  createSnapshot(): Promise<void> {
    const result = this.queue.then(async () => {
      const state = await load(this.path);
      const directory = join(dirname(this.path), 'snapshots');
      const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.json';
      await commit(join(directory, id), JSON.stringify({
        format: 'poketokenbar.windows.backup', version: 1, files: { 'companion-v1.json': state },
      }));
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async snapshots(): Promise<{ id: string; createdAt: number; label: string }[]> {
    await this.queue;
    const directory = join(dirname(this.path), 'snapshots');
    let names: string[];
    try { names = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const records = await Promise.all(names.filter(id => /^[a-zA-Z0-9.-]+\.json$/.test(id)).map(async id => {
      try {
        const path = join(directory, id);
        const metadata = await stat(path);
        if (metadata.size > 8 * 1024 * 1024) return null;
        const state = CompanionStore.previewImport(CompanionStore.decodeWindowsBackup(JSON.parse(await readFile(path, 'utf8'))));
        return { id, createdAt: metadata.mtimeMs,
          label: (state.current?.name ?? '알') + ' · 도감 ' + state.collection.length + '종' };
      } catch { return null; }
    }));
    return records.filter(record => record !== null).sort((a, b) => b.createdAt - a.createdAt);
  }

  async snapshotProgress(id: string): Promise<ImportedProgress> {
    if (!(await this.snapshots()).some(record => record.id === id)) throw new Error('스냅샷을 찾을 수 없습니다.');
    return CompanionStore.decodeWindowsBackup(JSON.parse(await readFile(join(dirname(this.path), 'snapshots', id), 'utf8')));
  }

  static previewImport(imported: ImportedProgress): CompanionView {
    return view(validate({ ...empty(), ...imported }));
  }

  replaceImport(imported: ImportedProgress, now: number, expected?: CompanionView): Promise<SaveImportResult> {
    const result = this.queue.then(async () => {
      if (this.tradeReservation) throw new Error('교환 확정 중에는 저장을 가져올 수 없습니다.');
      const replacement = validate({ ...empty(), ...imported, baseline: now });
      let original: Buffer | undefined;
      try { original = await readFile(this.path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      const current = original ? validate(JSON.parse(original.toString('utf8'))) : empty();
      if (expected) {
        if (JSON.stringify(view(current)) !== JSON.stringify(expected)) {
          throw new Error('Windows 육성 상태가 변경되었습니다. 파일을 다시 선택해 미리보기를 확인해 주세요.');
        }
      }
      let backupPath: string | null = null;
      if (original) {
        const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
        backupPath = join(dirname(this.path), 'companion-backups',
          basename(this.path) + '.pre-import-' + stamp + '-' + randomUUID() + '.bak');
        try { await commit(backupPath, original); }
        catch { throw new Error('기존 Windows 저장을 백업하지 못했습니다. 가져오기를 중단했습니다.'); }
      }
      replacement.growthDifficulty = current.growthDifficulty;
      replacement.shopDifficulty = current.shopDifficulty;
      Object.assign(replacement, mergeCandyLedgers(replacement, current));
      replacement.challengeCashClaims={...replacement.challengeCashClaims,...current.challengeCashClaims};
      replacement.challengeShinyClaims={...replacement.challengeShinyClaims,...current.challengeShinyClaims};
      this.refreshCachedMoves(replacement);
      await commit(this.path, JSON.stringify(replacement));
      return { companion: view(replacement), backupPath };
    });
    this.queue = result.catch(() => {});
    return result;
  }

  enrichMoves(details: PokemonDetails): Promise<CompanionView | null> {
    this.moveDetails.set(details.speciesID,details);
    const result=this.queue.then(async()=>{
      if(this.tradeReservation)return null;
      const state=await load(this.path),before=JSON.stringify(state);
      for(const mon of [...(state.active?[state.active]:[]),...state.graduated]) {
        if(routeOf(mon)[mon.stage].number===details.speciesID)enrichMoves(mon,details,mon!==state.active);
      }
      if(JSON.stringify(state)===before)return null;
      await commit(this.path,JSON.stringify(validate(state)));return view(state);
    });
    this.queue=result.catch(()=>{});return result;
  }

  markChallengeChampions(ids:string[],now=Date.now()):Promise<CompanionView|null>{
    const result=this.queue.then(async()=>{if(this.tradeReservation)throw new Error('교환 확정이 끝난 뒤 우승 기록을 저장해 주세요.');const state=await load(this.path);let changed=false;for(const mon of state.graduated)if(ids.includes(mon.id)&&mon.championAchievedAt===undefined){mon.championAchievedAt=now;changed=true;}if(!changed)return null;await commit(this.path,JSON.stringify(validate(state)));return view(state);});this.queue=result.catch(()=>{});return result;
  }

  claimChallenge(award:{runID:string;cash:number;recipient?:string}):Promise<CompanionView>{
    const result=this.queue.then(async()=>{
      if(this.tradeReservation)throw new Error('교환 확정이 끝난 뒤 보상을 받아 주세요.');
      if(!award.runID||award.runID.length>128||!Number.isSafeInteger(award.cash)||award.cash<0||award.cash>500000000)throw new Error('잘못된 챌린지 보상입니다.');
      const state=await load(this.path);
      state.challengeCashClaims??={};state.challengeShinyClaims??={};
      if(award.recipient){
        const previous=state.challengeShinyClaims[award.runID];
        if(previous&&previous!==award.recipient)throw new Error('이미 다른 포켓몬에게 보상을 적용했습니다.');
        if(!previous){const target=state.graduated.find(p=>p.id===award.recipient&&p.releasedAt===undefined);
          if(!target||target.shiny)throw new Error('이로치가 아닌 졸업 포켓몬을 선택해 주세요.');
          target.shiny=true;state.challengeShinyClaims[award.runID]=target.id;
        }
      }
      if(state.challengeCashClaims[award.runID]===undefined)state.challengeCashClaims[award.runID]=award.cash;
      await commit(this.path,JSON.stringify(validate(state)));return view(state);
    });this.queue=result.catch(()=>{});return result;
  }

  replaceMove(action: MoveChange, payload: PokemonDetailView): Promise<CompanionView> {
    const result=this.queue.then(async()=>{
      if(this.tradeReservation)throw new Error('교환을 확정하는 동안에는 변경할 수 없습니다.');
      const state=await load(this.path);
      const mon=state.active?.id===action.id?state.active:state.graduated.find(row=>row.id===action.id && row.releasedAt===undefined);
      if(!mon || routeOf(mon)[mon.stage].number!==action.speciesID || payload.details.speciesID!==action.speciesID ||
          appearance(action.speciesID,mon.form).form!==appearance(action.speciesID,action.form).form)throw new Error('현재 개체와 모습을 다시 확인해 주세요.');
      enrichMoves(mon,{...payload.details,moves:payload.baseMoves ?? payload.details.moves},mon!==state.active);
      const moves=knownMoves(mon);
      if(JSON.stringify(moves.map(move=>move.name))!==JSON.stringify(action.expectedMoves))throw new Error('기술 구성이 변경되었습니다. 다시 선택해 주세요.');
      const next=replacingMove(moves,action.slot,action.name,moveOptions(payload.details,mon.level!));
      if(!next)throw new Error('배울 수 있는 서로 다른 기술을 최대 4개까지 선택해 주세요.');
      mon.macProfile!.moves=next;mon.macProfile!.hasCustomMoves=true;
      await commit(this.path,JSON.stringify(validate(state)));return view(state);
    });
    this.queue=result.catch(()=>{});return result;
  }

  async tradeChoices(): Promise<TradeChoice[]> {
    const state = await this.queue.then(() => load(this.path));
    const eligible = [...(state.active ? [state.active] : []), ...state.graduated.filter(item => item.releasedAt === undefined)];
    return eligible.map(item => tradePreview(this.offered(state, item.id)));
  }

  async tradeOffer(id: string): Promise<OfferedItem> {
    return this.offered(await this.queue.then(() => load(this.path)), id);
  }

  private offered(state: Save, id: string): OfferedItem {
    const active = state.active?.id === id;
    const captured = state.graduated.find(item => item.id === id && item.releasedAt === undefined);
    const item = active ? state.active : captured;
    if (!item) throw new Error('현재 저장에서 교환할 개체를 찾을 수 없습니다.');
    return { item, active, progress: active ? state.progress : 0, route: routeOf(item), graduatedAt: captured?.graduatedAt };
  }

  prepareTrade(session: string, sent: OfferedItem, received: OfferedItem, replaceCurrent = false): Promise<string> {
    const result = this.queue.then(async () => {
      if (this.tradeReservation) throw new Error('다른 교환을 확정 중입니다.');
      const original = await readFile(this.path);
      const state = validate(JSON.parse(original.toString('utf8')));
      const current = this.offered(state, sent.item.id);
      if (JSON.stringify(wireItem(current)) !== JSON.stringify(wireItem(sent))) {
        throw new Error('교환할 개체가 변경되었습니다. 다시 제안해 주세요.');
      }
      if (!replaceCurrent && received.active && !sent.active && (state.active || state.progress > 0 || state.eggTier)) {
        throw new Error('현재 파트너 또는 알의 진행을 보존하려면 도감 개체를 받아 주세요.');
      }
      const backup = join(dirname(this.path), 'companion-backups', 'companion-v1.pre-trade-' + session + '.bak');
      await commit(backup, original);
      this.tradeReservation = session;
      return backup;
    });
    this.queue = result.catch(() => {});
    return result;
  }

  commitTrade(session: string, sent: OfferedItem, received: OfferedItem): Promise<CompanionView> {
    const result = this.queue.then(async () => {
      if (this.tradeReservation !== session) throw new Error('교환 확정이 만료되었습니다.');
      const state = await load(this.path);
      if (sent.active) {
        state.active = null;
        state.progress = 0;
      } else state.graduated = state.graduated.filter(item => item.id !== sent.item.id);

      if (sent.active || received.active) {
        delete state.eggTier;
        delete state.pendingHatchID;
        delete state.pendingForm;
      }

      const item = { ...received.item };
      if (item.id === state.active?.id || (item.macProfile?.instanceID && item.macProfile.instanceID === state.active?.macProfile?.instanceID) || state.graduated.some(row => row.id === item.id ||
          (row.macProfile?.instanceID && row.macProfile.instanceID === item.macProfile?.instanceID))) {
        item.id = randomUUID();
        if (item.macProfile) item.macProfile = {...item.macProfile,instanceID:item.id};
      }
      if (received.active) {
        state.active = item;
        state.progress = received.progress;
      } else {
        state.graduated.push({ ...item, graduatedAt: received.graduatedAt ?? 0 });
      }
      if (state.representativeSpeciesID && !view(state).economy.representative) {
        delete state.representativeSpeciesID;
        delete state.representativeForm;
      }
      await commit(this.path, JSON.stringify(validate(state)));
      return view(state);
    });
    this.queue = result.catch(() => {});
    return result;
  }

  releaseTrade(session: string): void {
    this.queue = this.queue.then(() => {
      if (this.tradeReservation === session) this.tradeReservation = undefined;
    });
  }

  update(observations: Observations, now: number): Promise<CompanionView> {
    const result = this.queue.then(async () => {
      const state = await load(this.path);
      if (this.tradeReservation) return view(state);
      const first = state.baseline === null;
      if (first) state.baseline = now;
      let changed = first;
      let delta = 0;
      for (const [provider, entries] of observations) {
        for (const entry of entries) {
          const total = entry.tokens.total;
          if (!validNumber(total) || total === 0 || entry.time > now || !entry.id || entry.growthIdentity === false) continue;
          const key = createHash('sha256').update(provider + '\0' + entry.id).digest('hex');
          const previous = state.ledger[key];
          if (previous !== undefined && previous >= total) continue;
          // Existing records can finish streaming after setup. Newly discovered older records
          // are historical and must never become rewards when the scan folder is changed.
          if (previous === undefined && !first && entry.time < state.baseline!) continue;
          state.ledger[key] = total;
          changed = true;
          if (!first) delta = Math.min(Number.MAX_SAFE_INTEGER, delta + (total - (previous ?? 0)));
        }
      }
      const readyToReveal = state.active && disguised(state.active) && state.progress >= threshold(state.active, state.growthDifficulty ?? 1);
      const reveal = delta || readyToReveal ? advance(state, delta, now, this.rollDitto) : undefined;
      const movesChanged=this.refreshCachedMoves(state);
      if (changed || reveal || movesChanged) await commit(this.path, JSON.stringify(state));
      return { ...view(state), ...(reveal && { dittoReveal: reveal }) };
    });
    this.queue = result.catch(() => {});
    return result;
  }
}

export { commit as writeSaveAtomically };
