# Collection metadata

`catalog.json`, `gen6-fairy.json` and `move-targets.json` are unchanged catalogs from
PokeTokenBar `deaf07e`, `Sources/PokeTokenBar/Resources/BattleText/` (MIT;
see LICENSE). They supply the same eight-language species, ability and move
names/descriptions and tooltip target scopes as the reference app. The Fairy
learnset supplements the Black 2 / White 2 PokéAPI selection for collection
display and legal move replacement. The collection UI saves explicitly chosen
moves to the owned individual; tooltip hover does not change progress or battle state.

Species metadata is requested from fixed PokéAPI endpoints and cached separately
from user progress for 30 days, with stale-cache fallback on network failure.
