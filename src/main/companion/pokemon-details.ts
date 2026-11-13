import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { object } from '../usage/jsonl.js';
import { writeSaveAtomically } from './store.js';
import type { Language } from '../../shared/localization.js';
import { statOrder, type PokemonDetails, type PokemonMove, type PokemonDetailView } from '../../shared/pokemon-details.js';

type Names = Record<string, string>;
interface TextMove { names: Names; descriptions: Names; type: string; category: string; power: number; accuracy: number | true; pp: number }
interface TextCatalog { species: Record<string, Names>; types: Record<string, Names>; abilities: Record<string, Names>; abilityDescriptions: Record<string, Names>; moves: Record<string, TextMove> }
const catalog = JSON.parse(readFileSync(new URL('../../companion-data/catalog.json', import.meta.url), 'utf8')) as TextCatalog;
const moveTargets=JSON.parse(readFileSync(new URL('../../companion-data/move-targets.json',import.meta.url),'utf8')) as Record<string,string>;
const fairy = JSON.parse(readFileSync(new URL('../../companion-data/gen6-fairy.json', import.meta.url), 'utf8')) as {
  moves: Record<string, TextMove>; types: Record<string, Names>; learnsets: Record<string, Record<string, { method: string; level: number }[]>>;
};
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const localized = (names: Names | undefined, language: Language, fallback: string) => names?.[language] ?? names?.en ?? fallback;
const integer = (value: unknown, minimum = 0, maximum = 1000000): value is number => typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,100}$/.test(value);
function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Invalid Pokémon metadata'); return value; }
function resource(value: unknown): string { const name = object(value)?.name; if (!identifier(name)) throw new Error('Invalid metadata identifier'); return name; }

/** Same trust boundary and version-group selection as Mac PokeAPIClient.normalizedMoves. */
export function normalizedMoves(raw: unknown): PokemonMove[] {
  return list(raw).flatMap(value => {
    const row = object(value);
    const name = resource(row?.move);
    const learnMethods = list(row?.version_group_details).flatMap(value => {
      const method = object(value);
      if (resource(method?.version_group) !== 'black-2-white-2') return [];
      if (!integer(method?.level_learned_at, 0, 100)) throw new Error('Invalid move level');
      return [{ method: resource(method.move_learn_method), level: method.level_learned_at }];
    });
    return learnMethods.length ? [{ name, learnMethods }] : [];
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function parsePokemonDetails(pokemon: unknown, species: unknown, expectedID: number): PokemonDetails {
  const row = object(pokemon), source = object(species);
  if (row?.id !== expectedID || source?.id !== expectedID || !identifier(row?.name) ||
    !integer(row.height) || !integer(row.weight) || !integer(source.gender_rate ?? -1, -1, 8)) throw new Error('Invalid Pokémon metadata');
  const baseStats = Object.fromEntries(list(row.stats).map(value => {
    const stat = object(value); const name = resource(stat?.stat);
    if (!statOrder.includes(name as typeof statOrder[number]) || !integer(stat?.base_stat, 1, 255)) throw new Error('Invalid base stat');
    return [name, stat.base_stat];
  })) as PokemonDetails['baseStats'];
  if (statOrder.some(name => !baseStats[name])) throw new Error('Missing base stats');
  const abilities = list(row.abilities).map(value => {
    const entry = object(value);
    if (!integer(entry?.slot, 1, 10) || typeof entry.is_hidden !== 'boolean') throw new Error('Invalid ability');
    return { name: resource(entry.ability), slot: entry.slot, isHidden: entry.is_hidden };
  }).sort((a, b) => a.slot - b.slot);
  return { speciesID: expectedID, name: row.name, height: row.height, weight: row.weight,
    genderRate: (source.gender_rate ?? -1) as number, baseExperience: integer(row.base_experience) ? row.base_experience : undefined,
    types: list(row.types).map(value => { const type = object(value); if (!integer(type?.slot, 1, 2)) throw new Error('Invalid type'); return { slot: type.slot, name: resource(type.type) }; }).sort((a, b) => a.slot - b.slot).map(type => type.name),
    baseStats, abilities, moves: normalizedMoves(row.moves) };
}

/** Fairy supplement for the displayed learnset and Mac-compatible loadout choices. */
export function mergedMoves(details: PokemonDetails): PokemonMove[] {
  const result = new Map<string, PokemonMove>();
  const extra = Object.entries(fairy.learnsets[details.speciesID] ?? {}).map(([name, learnMethods]) => ({ name, learnMethods }));
  for (const move of [...details.moves, ...extra]) {
    const old = result.get(key(move.name));
    const methods = [...(old?.learnMethods ?? [])];
    for (const method of move.learnMethods) if (!methods.some(item => item.method === method.method && item.level === method.level)) methods.push({ ...method });
    result.set(key(move.name), { name: old?.name ?? move.name, learnMethods: methods });
  }
  return [...result.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function presentPokemonDetails(details: PokemonDetails, language: Language, stale = false, knownMoves: string[] = []): PokemonDetailView {
  const moves = mergedMoves(details);
  return { details: { ...details, moves }, baseMoves:details.moves, stale, labels: {
    species: { [details.speciesID]: localized(catalog.species[details.speciesID], language, details.name) },
    types: Object.fromEntries(Object.entries({ ...catalog.types, ...fairy.types }).map(([id, names]) => [id, localized(names, language, id)])),
    abilities: Object.fromEntries(details.abilities.map(ability => [ability.name, { name: localized(catalog.abilities[key(ability.name)], language, ability.name), description: localized(catalog.abilityDescriptions[key(ability.name)], language, '') }])),
    moves: Object.fromEntries([...new Set([...moves.map(move=>move.name),...knownMoves])].map(name => {
      const move={name};
      const text = fairy.moves[key(move.name)] ?? catalog.moves[key(move.name)];
      return [move.name, { name: localized(text?.names, language, move.name), description: localized(text?.descriptions, language, ''),
        type: localized(catalog.types[key(text?.type ?? '')] ?? fairy.types[key(text?.type ?? '')], language, text?.type ?? '—'),
        category: text?.category ?? '', power: text?.power ?? 0, accuracy: text?.accuracy ?? null, pp: text?.pp ?? 0,
        targetScope:moveTargets[key(move.name)] }];
    })),
  } };
}

interface Snapshot { fetchedAt: number; pokemon: unknown; species: unknown }
export class PokemonDetailsClient {
  private memory = new Map<number, { details: PokemonDetails; stale: boolean }>();
  private pending = new Map<number, Promise<{ details: PokemonDetails; stale: boolean }>>();
  constructor(private directory: string, private request: typeof fetch = fetch, private now = Date.now) {}
  get(speciesID: number, language: Language, knownMoves: string[] = []): Promise<PokemonDetailView> {
    if (!integer(speciesID, 1, 649)) return Promise.reject(new Error('Invalid Pokédex number'));
    const cached = this.memory.get(speciesID);
    if (cached) return Promise.resolve(presentPokemonDetails(cached.details, language, cached.stale, knownMoves));
    let pending = this.pending.get(speciesID);
    if (!pending) {
      pending = this.load(speciesID).then(result => { if (!result.stale) this.memory.set(speciesID, result); return result; }).finally(() => this.pending.delete(speciesID));
      this.pending.set(speciesID, pending);
    }
    return pending.then(result => presentPokemonDetails(result.details, language, result.stale, knownMoves));
  }
  private async download(path: string): Promise<unknown> {
    const response = await this.request('https://pokeapi.co/api/v2/' + path, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (response.status !== 200) { await response.body?.cancel(); throw new Error('Pokémon details unavailable'); }
    const data = await response.text();
    if (data.length > 5_000_000) throw new Error('Pokémon metadata too large');
    return JSON.parse(data);
  }
  private async load(id: number) {
    const path = join(this.directory, id + '.json');
    let disk: { details: PokemonDetails; fetchedAt: number } | undefined;
    try {
      const raw: Snapshot = JSON.parse(await readFile(path, 'utf8'));
      if (Number.isFinite(raw.fetchedAt)) disk = { details: parsePokemonDetails(raw.pokemon, raw.species, id), fetchedAt: raw.fetchedAt };
    } catch { /* Missing or corrupt caches are disposable, unlike user saves. */ }
    if (disk && this.now() - disk.fetchedAt < 30 * 86400000) return { details: disk.details, stale: false };
    try {
      const [pokemon, species] = await Promise.all([this.download('pokemon/' + id), this.download('pokemon-species/' + id)]);
      const details = parsePokemonDetails(pokemon, species, id);
      try { await writeSaveAtomically(path, JSON.stringify({ fetchedAt: this.now(), pokemon, species })); }
      catch { /* Disk cache failure must not hide valid details. */ }
      return { details, stale: false };
    } catch (error) {
      if (disk) return { details: disk.details, stale: true };
      throw error;
    }
  }
}
