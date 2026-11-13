import { createHash } from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import { natureKey, speciesFor } from '../companion/catalog.js';
import type { OfferedItem } from '../trade/item.js';
import { object } from '../usage/jsonl.js';
import { allowedFairyMoves, battleDex, dex, type Member, type Stats } from './engine.js';

const baseSpecies = new Map(dex.species.all()
  .filter(species => !species.forme && species.gen <= 5 && species.num >= 1 && species.num <= 649)
  .map(species => [species.num, species]));
const stats = { hp: 'hp', atk: 'attack', def: 'defense', spa: 'specialAttack', spd: 'specialDefense', spe: 'speed' } as const;
const statIDs = Object.keys(stats) as (keyof Stats)[];
const types = (values: Record<string, number>) => values as Stats;

const finalSpecies=new Set<number>(JSON.parse(readFileSync(new URL('../../battle-assets/data/final-species.json',import.meta.url),'utf8')));
const {heldItem}=createRequire(import.meta.url)('../../battle-engine/held-items.cjs') as {heldItem:(id:string,species:unknown)=>string};
export function withItems(team:Member[],input:unknown):Member[]{
  const items=input===undefined?{}:object(input);if(!items || Object.keys(items).some(id=>!team.some(p=>p.id===id)))throw new Error('잘못된 소지 도구입니다.');
  const selected=team.map(p=>{const item=items[p.id] ?? p.item ?? '';if(typeof item!=='string'||item.length>100)throw new Error('잘못된 소지 도구입니다.');return{...p,item:heldItem(item,battleDex().species.get(p.species))};});
  const used=selected.map(p=>p.item).filter(Boolean);if(new Set(used).size!==used.length)throw new Error('같은 도구를 중복으로 사용할 수 없습니다.');return selected;
}
export function eligible(number: number): boolean {
  return number !== 493 && baseSpecies.has(number) && finalSpecies.has(number);
}

function loadout(item: OfferedItem | undefined, number: number, id: string, level: number, preset?: string[]): Member {
  const base = baseSpecies.get(number);
  if (!base || !eligible(number)) throw new Error('이 포켓몬은 챌린지에 등록할 수 없습니다.');
  const form = item?.item.form;
  const aliases: Record<string, string> = { exclamation: '!', question: '?' };
  const candidate = form && dex.species.get(base.name + '-' + (aliases[form] ?? form));
  const species = candidate && candidate.exists && candidate.num === number && candidate.gen <= 5 && !candidate.isMega
    ? candidate : base;
  const profile = item?.item.macProfile;
  const stored = object(profile?.ivs);
  const hash = createHash('sha256').update(id).digest();
  const ivs = types(Object.fromEntries(statIDs.map((key, index) =>
    {
      const value = stored?.[stats[key]];
      return [key, typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 31
        ? value : item ? 20 + hash[index] % 12 : 31];
    })));
  const nature = dex.natures.get(item ? natureKey(item.item.nature) ?? 'hardy' : 'hardy');
  const calculated = types(Object.fromEntries(statIDs.map(key => {
    const scaled = Math.floor((2 * species.baseStats[key] + ivs[key]) * level / 100);
    return [key, key === 'hp' ? number === 292 ? 1 : scaled + level + 10
      : Math.floor((scaled + 5) * (nature.plus === key ? 1.1 : nature.minus === key ? 0.9 : 1))];
  })));
  const requestedAbility = typeof profile?.abilityName === 'string' ? dex.abilities.get(profile.abilityName).name : '';
  const slot = profile?.abilitySlot === 3 ? 'H' : profile?.abilitySlot === 2 ? '1' : '0';
  const ability = Object.values(species.abilities).includes(requestedAbility) ? requestedAbility
    : species.abilities[slot as keyof typeof species.abilities] ?? species.abilities[0];

  const rules = battleDex();
  const saved = Array.isArray(profile?.moves) ? profile.moves.flatMap(row => {
    const name = object(row)?.name;
    if (typeof name !== 'string') return [];
    const move = rules.moves.get(name);
    return move.exists && (move.gen <= 5 || allowedFairyMoves.has(move.id)) ? [move.id] : [];
  }) : [];
  const learned = new Set(dex.species.getFullLearnset(species.id).flatMap(row =>
    Object.entries(row.learnset ?? {}).filter(([, sources]) => sources.some(source => /^[1-5]/.test(source)))
      .map(([name]) => name)));
  const attacks = [...learned].map(name => rules.moves.get(name)).filter(move => move.exists && move.basePower >= 35)
    .sort((a, b) => {
      const score = (move: typeof a) => move.basePower * (species.types.includes(move.type) ? 1.4 : 1) *
        (move.accuracy === true ? 1 : move.accuracy / 100) *
        (move.category === 'Physical' ? species.baseStats.atk : species.baseStats.spa);
      return score(b) - score(a) || a.name.localeCompare(b.name, 'en');
    });
  const coverage = [...new Map(attacks.slice().reverse().map(move => [move.type, move])).values()].reverse();
  const moves = preset ?? (saved.length ? [...new Set(saved)].slice(0, 4)
    : [...new Set([...coverage.map(move => move.id), ...attacks.map(move => move.id)])].slice(0, 4));
  if (!moves.length) moves.push([...learned][0] ?? 'tackle');
  return {
    id, speciesID: number, species: species.name,
    displayName: item?.route[item.item.stage].name ?? speciesFor(number).name,
    level, ability, nature: nature.name, gender: profile?.gender === 'male' ? 'M' : profile?.gender === 'female' ? 'F' : '',
    shiny: item?.item.shiny ?? false, form, ivs, stats: calculated, moves,
  };
}

export function ownedMember(item: OfferedItem): Member {
  if (item.active || item.item.releasedAt !== undefined) throw new Error('졸업한 도감 개체를 선택해 주세요.');
  return loadout(item, item.route[item.item.stage].number, item.item.id,
    Math.max(5, item.item.level ?? 100));
}

export function practiceTeam(): Member[] {
  const examples: [number, string[]][] = [
    [9, ['surf', 'icebeam', 'focusblast', 'protect']],
    [6, ['flamethrower', 'airslash', 'dragonpulse', 'protect']],
    [3, ['gigadrain', 'sludgebomb', 'sleeppowder', 'protect']],
    [149, ['dragonclaw', 'firepunch', 'earthquake', 'protect']],
    [130, ['waterfall', 'icefang', 'crunch', 'protect']],
    [65, ['psychic', 'shadowball', 'focusblast', 'protect']],
  ];
  return examples.map(([number, moves]) => loadout(undefined, number, 'practice-' + number, 100, moves));
}
