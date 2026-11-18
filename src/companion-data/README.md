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

`ability-options.json` is copied unchanged from `origin/feature/battle`, commit
`ad1bb7c9217028270ec28ebfb8d2dc05059a09da`, `Resources/BattleText/ability-options.json`.
It supplies the BW2 legal ability slots, including historical repairs such as Levitate for Gengar.
`form-names.json` uses that branch's form IDs and official PokeAPI CSV names in the
same eight-language fallback order as Mac. Regenerate with `node scripts/sync-mac-form-names.mjs`;
`form-names-source.json` records the reference, source URL and input SHA-256.
