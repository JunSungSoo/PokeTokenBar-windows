// Compile original Mac move-selection functions without a UI or production saves.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const source=resolve(process.argv[2] ?? '../PokeTokenBar'),output=resolve(process.argv[3] ?? '/private/tmp/poketokenbar-loadout-parity');
await mkdir(output,{recursive:true});
const profile=await readFile(join(source,'Sources/PokeTokenBar/Core/PokemonProfile.swift'),'utf8');
const loadout=await readFile(join(source,'Sources/PokeTokenBar/Core/PokemonLoadout.swift'),'utf8');
function extract(source,marker){const start=source.indexOf(marker);if(start<0)throw new Error(marker);let end=source.indexOf('{',start)+1,depth=1;while(depth){const c=source[end++];if(c==='{')depth++;if(c==='}')depth--;}return source.slice(start,end);}
const code=`import Foundation
struct PokemonMoveLearnMethod:Codable{let method:String;let level:Int}
struct PokemonMoveOption:Codable{let name:String;let learnMethods:[PokemonMoveLearnMethod]}
struct PokemonKnownMove:Codable{let name:String;let learnedAtLevel:Int}
struct PokemonDetails:Decodable{let moves:[PokemonMoveOption];${extract(profile,'func levelUpMoves(')}}
struct PokemonProfile{let level:Int;var moves:[PokemonKnownMove];var hasCustomMoves:Bool?}
enum PokemonFairyMoves{static func mergedMoves(details:PokemonDetails)->[PokemonMoveOption]{details.moves}}
enum PokemonLoadout{${extract(loadout,'static func moveOptions(')}\n${extract(loadout,'static func replacingMove(')}}
struct Input:Decodable{let details:PokemonDetails;let level:Int;let moves:[PokemonKnownMove];let slot:Int;let name:String}
@main struct Oracle{static func main()throws{
let rows=try JSONDecoder().decode([Input].self,from:FileHandle.standardInput.readDataToEndOfFile())
let output=try rows.map{row -> [String:Any] in
let profile=PokemonProfile(level:row.level,moves:row.moves)
func json<T:Encodable>(_ value:T)throws->Any{try JSONSerialization.jsonObject(with:JSONEncoder().encode(value))}
return ["automatic":try json(Array(row.details.levelUpMoves(through:row.level).suffix(4))),"options":try json(PokemonLoadout.moveOptions(details:row.details,level:row.level)),"replacement":try PokemonLoadout.replacingMove(profile,slot:row.slot,name:row.name,details:row.details).map{try json($0.moves)} ?? NSNull()]
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:output))}}
`;
await writeFile(join(output,'Oracle.swift'),code);
execFileSync('swiftc',['-parse-as-library','-module-cache-path',join(output,'module-cache'),join(output,'Oracle.swift'),'-o',join(output,'oracle')],{stdio:'inherit'});
console.log(join(output,'oracle'));
