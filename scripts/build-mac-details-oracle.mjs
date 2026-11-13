// Compiles the original pure normalization/stat functions against matching minimal DTOs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const source = resolve(process.argv[2] ?? '../PokeTokenBar');
const output = resolve(process.argv[3] ?? '/private/tmp/poketokenbar-details-parity');
await mkdir(output, { recursive: true });
const api = await readFile(join(source,'Sources/PokeTokenBar/Core/PokeAPIClient.swift'),'utf8');
const profile = await readFile(join(source,'Sources/PokeTokenBar/Core/PokemonProfile.swift'),'utf8');
function extract(source, marker) {
  const start = source.indexOf(marker); if (start < 0) throw new Error('Missing ' + marker);
  let end = source.indexOf('{',start)+1, depth=1;
  while(depth) { const char=source[end++]; if(char==='{')depth++; if(char==='}')depth--; }
  return source.slice(start,end);
}
const version = profile.match(/static let preferredVersionGroup = "([^"]+)"/)[1];
const natures = 'hardy lonely brave adamant naughty bold docile relaxed impish lax timid hasty serious jolly naive modest mild quiet bashful rash calm gentle sassy careful quirky'.split(' ');
const code = `import Foundation
struct NamedDTO: Decodable { let name:String }
struct MethodDTO: Decodable { let version_group:NamedDTO; let move_learn_method:NamedDTO; let level_learned_at:Int }
struct PokemonMoveDTO: Decodable { let move:NamedDTO; let version_group_details:[MethodDTO] }
struct PokemonMoveLearnMethod: Codable { let method:String; let level:Int }
struct PokemonMoveOption: Codable { let name:String; let learnMethods:[PokemonMoveLearnMethod] }
struct PokemonDetails { static let preferredVersionGroup = "${version}"; let speciesID:Int; let baseStats:[String:Int] }
struct PokemonProfile { let level:Int; let ivs:PokemonIVs }
enum PokemonNature:String { case ${natures.join(',')} }
${extract(profile,'struct PokemonIVs:')}
${extract(profile,'struct PokemonComputedStat:')}
${extract(profile,'enum PokemonStatCalculator {')}
${extract(profile,'extension PokemonNature {')}
enum PokeAPIClient { ${extract(api,'static func normalizedMoves(')} }
@main struct Oracle {
 static func main() throws {
  let data=FileHandle.standardInput.readDataToEndOfFile()
  let raw=try JSONSerialization.jsonObject(with:data) as! [String:Any]
  let moves=try JSONDecoder().decode([PokemonMoveDTO].self,from:JSONSerialization.data(withJSONObject:raw["moves"]!))
  let normalized=try JSONSerialization.jsonObject(with:JSONEncoder().encode(PokeAPIClient.normalizedMoves(moves)))
  let cases=raw["stats"] as! [[String:Any]]
  let results=try cases.map { row in
    let ivs=try JSONDecoder().decode(PokemonIVs.self,from:JSONSerialization.data(withJSONObject:row["ivs"]!))
    let profile=PokemonProfile(level:row["level"] as! Int,ivs:ivs)
    return PokemonStatCalculator.stats(baseStats:row["baseStats"] as! [String:Int],speciesID:row["speciesID"] as! Int,profile:profile,nature:PokemonNature(rawValue:row["nature"] as! String)).map { ["name":$0.name,"base":$0.base,"iv":$0.iv,"value":$0.value] as [String:Any] }
  }
  FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:["moves":normalized,"stats":results]))
 }
}`;
await writeFile(join(output,'Oracle.swift'),code);
execFileSync('swiftc',['-parse-as-library','-module-cache-path',join(output,'module-cache'),join(output,'Oracle.swift'),'-o',join(output,'oracle')],{stdio:'inherit'});
console.log(join(output,'oracle'));
