import type { PokemonDetails, PokemonMove } from './pokemon-details.js';

export interface KnownMove { name: string; learnedAtLevel: number }
export interface MoveChange {
  id: string; speciesID: number; form?: string; slot: number; name: string; expectedMoves: string[];
}

/** Mac PokemonDetails.levelUpMoves: earliest learn level per move, then level/name order. */
export function levelUpMoves(moves: PokemonMove[], level: number): KnownMove[] {
  const byName = new Map<string, number>();
  for (const move of moves) {
    const levels = move.learnMethods.filter(method => method.method === 'level-up' && method.level <= level).map(method => method.level);
    if (levels.length) byName.set(move.name, Math.min(byName.get(move.name) ?? 100, ...levels));
  }
  return [...byName].map(([name, learnedAtLevel]) => ({ name, learnedAtLevel }))
    .sort((a,b) => a.learnedAtLevel-b.learnedAtLevel || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** TM/egg/tutor/Fairy choices are available; level-up-only choices require the current level. */
export function moveOptions(details: PokemonDetails, level: number): KnownMove[] {
  return details.moves.flatMap(move => {
    const methods = move.learnMethods.filter(method => method.method !== 'level-up' || method.level <= level);
    return methods.length ? [{name:move.name,learnedAtLevel:Math.min(...methods.map(method=>method.level))}] : [];
  }).sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function replacingMove(moves: KnownMove[], slot: number, name: string, options: KnownMove[]): KnownMove[] | null {
  const selected = options.find(move => move.name === name);
  if (!Number.isInteger(slot) || slot < 0 || slot >= 4 || slot > moves.length || !selected ||
      moves.some((move,index)=>index !== slot && move.name === name)) return null;
  const result = moves.slice(0,4);
  if (slot === result.length) result.push(selected); else result[slot] = selected;
  return result;
}
