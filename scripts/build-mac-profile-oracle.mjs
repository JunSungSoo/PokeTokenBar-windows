// Compile deterministic identity generation/enrichment directly from feature/battle source.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const source=resolve(process.argv[2]),out=resolve(process.argv[3]);await mkdir(out,{recursive:true});
const profile=await readFile(join(source,'Sources/PokeTokenBar/Core/PokemonProfile.swift'),'utf8');
function extract(marker){const start=profile.indexOf(marker);if(start<0)throw Error(marker);let end=profile.indexOf('{',start)+1,depth=1;while(depth){const c=profile[end++];if(c==='{')depth++;if(c==='}')depth--;}return profile.slice(start,end);}
const code=`import Foundation
${extract('enum PokemonGender:')}
${extract('struct PokemonIVs:')}
${extract('struct PokemonKnownMove:')}
${extract('private struct ProfileRNG:')}
struct PokemonAbilityOption:Codable{let name:String;let slot:Int;let isHidden:Bool}
struct PokemonForm:Codable,Equatable{static func resolved(speciesID:Int,form:PokemonForm?)->PokemonForm?{form}}
struct PokemonDetails:Codable{let speciesID:Int;let genderRate:Int;let abilities:[PokemonAbilityOption];func levelUpMoves(through:Int)->[PokemonKnownMove]{[]}}
enum BattleTextCatalog{static func key(_ value:String)->String{value.lowercased().filter{$0.isLetter || $0.isNumber}}}
enum PokemonLoadout{static var legal:[PokemonAbilityOption]=[];static func abilityOptions(details:PokemonDetails,form:PokemonForm?)->[PokemonAbilityOption]{legal}}
struct PokemonProfile:Codable{
var instanceID:String;var seed:UInt64;var gender:PokemonGender?;var ivs:PokemonIVs;var abilitySlot:Int?;var abilityName:String?;var abilityIsHidden:Bool;var level:Int;var growthTokens:Int;var moves:[PokemonKnownMove];var hasCustomMoves:Bool?;var hasCustomAbility:Bool?;var loadoutSpeciesID:Int?;var loadoutForm:PokemonForm?;var automaticMovesLevel:Int?
${extract('static func generate(')}
${extract('mutating func enrich(')}
}
struct Input:Decodable{let seed:String;let details:PokemonDetails;let legal:[PokemonAbilityOption]}
@main struct Oracle{static func main()throws{let rows=try JSONDecoder().decode([Input].self,from:FileHandle.standardInput.readDataToEndOfFile());let output=rows.map{row in PokemonLoadout.legal=row.legal;var p=PokemonProfile.generate(seed:UInt64(row.seed)!,instanceID:"test");p.enrich(with:row.details);return p};FileHandle.standardOutput.write(try JSONEncoder().encode(output))}}
`;
await writeFile(join(out,'Oracle.swift'),code);execFileSync('swiftc',['-parse-as-library',join(out,'Oracle.swift'),'-o',join(out,'oracle')],{stdio:'inherit'});console.log(join(out,'oracle'));
