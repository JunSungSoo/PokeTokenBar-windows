// Export only the selected branch files needed by the portable Swift oracles.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {readMacSource,macReferenceRef} from '../tests/mac-reference.mjs';
const output=resolve(process.argv[2]??'output/mac-parity/reference');
const paths=[
 'Core/PokeAPIClient.swift','Core/PokemonProfile.swift','Core/PokemonLoadout.swift',
 'Core/AgentActivity.swift','Core/ProviderStatusChecker.swift','UI/SpriteAnimation.swift',
 'Core/Battle/BattleModels.swift','Core/Battle/BattleCoordinator.swift',
 'Core/Battle/BattleTextCatalog.swift','Core/Battle/BattleLocalization.swift','Core/Battle/BattlePresentationLocalization.swift',
 'Resources/BattleText/catalog.json','Resources/BattleText/gen6-fairy.json','Resources/BattleText/move-targets.json',
];
for(const path of paths){const relative='Sources/PokeTokenBar/'+path,file=join(output,relative);await mkdir(dirname(file),{recursive:true});await writeFile(file,readMacSource(relative));}
console.log('Exported '+paths.length+' files from '+macReferenceRef+' to '+output);
