export const method = (method, level = 0, version = 'black-2-white-2') => ({ move_learn_method: { name: method }, level_learned_at: level, version_group: { name: version } });
export function detailFixture(id = 1) {
  return {
    pokemon: { id, name: ({ 1:'bulbasaur', 2:'ivysaur', 3:'venusaur', 25:'pikachu', 292:'shedinja' })[id] ?? 'test', height: 7, weight: 69, base_experience: 64,
      types: [{ slot: 2, type: { name: 'poison' } }, { slot: 1, type: { name: 'grass' } }],
      stats: [['hp',45],['attack',49],['defense',49],['special-attack',65],['special-defense',65],['speed',45]].map(([name, base_stat]) => ({ stat: { name }, base_stat })),
      abilities: [{ ability: { name: 'chlorophyll' }, slot: 3, is_hidden: true }, { ability: { name: 'overgrow' }, slot: 1, is_hidden: false }],
      moves: [
        { move: { name: 'vine-whip' }, version_group_details: [method('level-up', 7), method('level-up', 3, 'red-blue')] },
        { move: { name: 'tackle' }, version_group_details: [method('level-up', 1), method('machine', 0, 'scarlet-violet')] },
        { move: { name: 'toxic' }, version_group_details: [method('machine'), method('tutor')] },
        { move: { name: 'leafage' }, version_group_details: [method('level-up', 1, 'sun-moon')] },
      ],
    }, species: { id, gender_rate: 1 },
  };
}
