import { object, type Row } from '../usage/jsonl.js';

type JSONWithSource = {
  parse(text: string, reviver: (key: string, value: unknown, context?: { source?: string }) => unknown): unknown;
  rawJSON(text: string): unknown;
};
const codec = JSON as unknown as JSONWithSource;

export function parseMacJSON(text: string): unknown {
  return codec.parse(text, (key, value, context) =>
    key === 'seed' && typeof value === 'number' && context?.source ? context.source : value);
}

export function readMacProfile(value: unknown): Row | undefined {
  const profile = object(value);
  if (!profile) return;
  const seed = profile.seed;
  if (typeof seed !== 'string' || !/^\d{1,20}$/.test(seed) || BigInt(seed) > 18446744073709551615n) return;
  const ivs = object(profile.ivs);
  if (!ivs || !['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed']
    .every(stat => typeof ivs[stat] === 'number' && Number.isInteger(ivs[stat]) && ivs[stat] >= 0 && ivs[stat] <= 31)) return;
  if (typeof profile.level !== 'number' || !Number.isInteger(profile.level) || profile.level < 1 || profile.level > 100 ||
      typeof profile.growthTokens !== 'number' || !Number.isSafeInteger(profile.growthTokens) || profile.growthTokens < 0 ||
      typeof profile.abilityIsHidden !== 'boolean' || !Array.isArray(profile.moves) || profile.moves.length > 128) return;
  const bytes = Buffer.byteLength(JSON.stringify(profile));
  return bytes <= 32768 ? profile : undefined;
}

export function wireMacProfile(saved: unknown, id: string): Row | undefined {
  const profile = readMacProfile(saved);
  if (!profile) return;
  return { ...profile, instanceID: id, seed: codec.rawJSON(profile.seed as string) };
}
