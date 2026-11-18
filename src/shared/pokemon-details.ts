export const statOrder = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'] as const;
export type StatName = typeof statOrder[number];
export interface LearnMethod { method: string; level: number }
export interface PokemonMove { name: string; learnMethods: LearnMethod[] }
export interface PokemonDetails {
  speciesID: number;
  name: string;
  height: number;
  weight: number;
  genderRate: number;
  baseExperience?: number;
  types: string[];
  baseStats: Record<StatName, number>;
  abilities: { name: string; slot: number; isHidden: boolean }[];
  moves: PokemonMove[];
}
export interface MoveText {
  name: string; description: string; type: string; category: string;
  power: number; accuracy: number | true | null; pp: number; targetScope?: string;
}
export interface PokemonDetailView {
  abilityChoicesByForm?:Record<string,PokemonDetails['abilities']>;
  details: PokemonDetails;
  baseMoves?: PokemonMove[];
  stale: boolean;
  labels: {
    species: Record<string, string>;
    types: Record<string, string>;
    abilities: Record<string, { name: string; description: string }>;
    moves: Record<string, MoveText>;
  };
}

/** Form projection never changes the species cache or the saved individual. */
export function projectDetailView(payload:PokemonDetailView,form?:string):PokemonDetailView{
 if(payload.details.speciesID!==493)return payload;
 const type=form&&Object.hasOwn(payload.labels.types,form)?form:'normal';
 const moves=Object.fromEntries(Object.entries(payload.labels.moves).map(([name,move])=>[name,name.replaceAll('-','').toLowerCase()==='judgment'?{...move,type:payload.labels.types[type]??type}:move]));
 return{...payload,details:{...payload.details,types:[type]},labels:{...payload.labels,moves}};
}

/** Main-series stats, matching Mac PokemonStatCalculator (no EVs). */
export function computedStats(speciesID: number, bases: Record<string, number>, level: number,
  ivs: Record<string, number>, nature: string): { name: string; base: number; iv: number; value: number }[] {
  const order = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
  const korean = ['노력','외로움','용감','고집','개구쟁이','대담','온순','무사태평','장난꾸러기','촐랑','겁쟁이','성급','성실','명랑','천진난만','조심','의젓','냉정','수줍음','덜렁','차분','얌전','건방','신중','변덕'];
  const english = ['hardy','lonely','brave','adamant','naughty','bold','docile','relaxed','impish','lax','timid','hasty','serious','jolly','naive','modest','mild','quiet','bashful','rash','calm','gentle','sassy','careful','quirky'];
  const index = korean.indexOf(nature);
  const name = index < 0 ? nature.toLowerCase() : english[index];
  const modifiers: Record<string, [string, string]> = {
    lonely:['attack','defense'], brave:['attack','speed'], adamant:['attack','special-attack'], naughty:['attack','special-defense'],
    bold:['defense','attack'], relaxed:['defense','speed'], impish:['defense','special-attack'], lax:['defense','special-defense'],
    timid:['speed','attack'], hasty:['speed','defense'], jolly:['speed','special-attack'], naive:['speed','special-defense'],
    modest:['special-attack','attack'], mild:['special-attack','defense'], quiet:['special-attack','speed'], rash:['special-attack','special-defense'],
    calm:['special-defense','attack'], gentle:['special-defense','defense'], sassy:['special-defense','speed'], careful:['special-defense','special-attack'],
  };
  if (!Number.isInteger(level) || level < 1 || level > 100) return [];
  return order.flatMap(stat => {
    const base = bases[stat];
    const iv = ivs[stat] ?? ivs[stat === 'special-attack' ? 'specialAttack' : stat === 'special-defense' ? 'specialDefense' : stat];
    if (!Number.isInteger(base) || !Number.isInteger(iv) || iv < 0 || iv > 31) return [];
    const neutral = Math.floor((2 * base + iv) * level / 100);
    const modifier = modifiers[name]?.[0] === stat ? 1.1 : modifiers[name]?.[1] === stat ? 0.9 : 1;
    const value = stat === 'hp' ? speciesID === 292 ? 1 : neutral + level + 10 : Math.floor((neutral + 5) * modifier);
    return [{ name: stat, base, iv, value }];
  });
}
