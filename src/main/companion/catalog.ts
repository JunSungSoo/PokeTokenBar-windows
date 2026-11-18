import { nationalDex } from "./national-dex.js";
import type { Species } from '../../shared/companion.js';

// The three starter families from each of the first five regions, in Pokédex order.
const starters: [number, string, string, string][] = [
  [1, '이상해씨', '이상해풀', '이상해꽃'],
  [4, '파이리', '리자드', '리자몽'],
  [7, '꼬부기', '어니부기', '거북왕'],
  [152, '치코리타', '베이리프', '메가니움'],
  [155, '브케인', '마그케인', '블레이범'],
  [158, '리아코', '엘리게이', '장크로다일'],
  [252, '나무지기', '나무돌이', '나무킹'],
  [255, '아차모', '영치코', '번치코'],
  [258, '물짱이', '늪짱이', '대짱이'],
  [387, '모부기', '수풀부기', '토대부기'],
  [390, '불꽃숭이', '파이숭이', '초염몽'],
  [393, '팽도리', '팽태자', '엠페르트'],
  [495, '주리비얀', '샤비', '샤로다'],
  [498, '뚜꾸리', '차오꿀', '염무왕'],
  [501, '수댕이', '쌍검자비', '대검귀'],
];

export const families = starters.map(([first, ...names], index): Species[] => {
  const types = ['풀', '불꽃', '물'] as const;
  return names.map((name, stage) => ({ number: first + stage, name, type: types[index % types.length] }));
});

export const natures = [
  '노력', '외로움', '용감', '고집', '개구쟁이', '대담', '온순', '무사태평', '장난꾸러기', '촐랑',
  '겁쟁이', '성급', '성실', '명랑', '천진난만', '조심', '의젓', '냉정', '수줍음', '덜렁',
  '차분', '얌전', '건방', '신중', '변덕',
];

const names = new Map(families.flat().map(species => [species.number, species]));
const types: Record<string, string> = {
  normal: '노말', fire: '불꽃', water: '물', electric: '전기', grass: '풀', ice: '얼음',
  fighting: '격투', poison: '독', ground: '땅', flying: '비행', psychic: '에스퍼', bug: '벌레',
  rock: '바위', ghost: '고스트', dragon: '드래곤', dark: '악', steel: '강철', fairy: '페어리',
};

export function speciesFor(number: number, name?: string): Species {
  const known = names.get(number);
  const [english, type] = nationalDex.get(number) ?? [];
  return {
    number,
    name: name ?? known?.name ?? (number === 132 ? '메타몽' : undefined) ?? english?.replace(/(^|-)[a-z]/g, match => match.toUpperCase()) ?? '포켓몬 #' + number,
    type: known?.type ?? types[type ?? ''] ?? '',
  };
}
export function displayedSpecies(species:Species,form?:string):Species{
 return species.number===493&&form&&types[form]?{...species,type:types[form]}:species;
}

const natureKeys = ('hardy lonely brave adamant naughty bold docile relaxed impish lax timid hasty serious jolly naive ' +
  'modest mild quiet bashful rash calm gentle sassy careful quirky').split(' ');

export function natureKey(name: string): string | undefined {
  return natureKeys[natures.indexOf(name)];
}
