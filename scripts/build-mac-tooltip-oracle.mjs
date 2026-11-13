// Executes the original Mac tooltip/target/localization functions against its catalogs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const source=resolve(process.argv[2] ?? '../PokeTokenBar'),output=resolve(process.argv[3] ?? '/private/tmp/poketokenbar-tooltip-parity');
await mkdir(output,{recursive:true});
const core=join(source,'Sources/PokeTokenBar/Core/Battle');
const catalog=await readFile(join(core,'BattleTextCatalog.swift'),'utf8');
const localization=await readFile(join(core,'BattleLocalization.swift'),'utf8');
const presentation=await readFile(join(core,'BattlePresentationLocalization.swift'),'utf8');
function extract(text,marker){const start=text.indexOf(marker);if(start<0)throw new Error(marker);let end=text.indexOf('{',start)+1,depth=1;while(depth){const c=text[end++];if(c==='{')depth++;if(c==='}')depth--;}return text.slice(start,end);}
const properties=['battleUnknownMove','battleUnknownType','battleDescriptionUnavailable','battlePP','battleBaseAccuracy'];
const code=`import Foundation
enum AppLanguage:String,Codable,Sendable { case ko,en,ja,es,fr,pt,de,ru }
enum BattleMoveAccuracy:Decodable,Sendable { case percent(Int),always
init(from decoder:Decoder)throws{let c=try decoder.singleValueContainer();if let number=try? c.decode(Int.self){self = .percent(number)}else{_ = try c.decode(Bool.self);self = .always}}}
struct L {let lang:AppLanguage;init(_ value:AppLanguage){lang=value}
func t(_ values:String...)->String { values[[AppLanguage.ko,.en,.ja,.es,.fr,.pt,.de,.ru].firstIndex(of:lang)!] }
${properties.map(name=>extract(presentation,'var '+name+':')).join('\n')}
${extract(localization,'var battlePower:')}
${extract(localization,'var battleTarget:')}
${extract(localization,'func battleCategory(')}
${extract(presentation,'func battleAccuracy(')}
${extract(presentation,'func battleMoveTarget(scope:')}
}
struct BattleMegaText {static let catalog=Empty();struct Empty{let types:[String:[String:String]]=[:]}}
struct BattleTextCatalog {
${extract(catalog,'struct Move:')}
let moves:[String:Move];let types:[String:[String:String]]
static let moveTargets=try! JSONDecoder().decode([String:String].self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[3])))
${extract(catalog,'static func key(')}
${['moveName','description','typeName','moveTooltip'].map(name=>extract(catalog,'func '+name+'(')).join('\n')}
}
struct Catalog:Decodable {let moves:[String:BattleTextCatalog.Move];let types:[String:[String:String]]}
struct Input:Decodable {let name:String;let language:AppLanguage}
@main struct Oracle { static func main()throws {
let base=try JSONDecoder().decode(Catalog.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
let fairy=try JSONDecoder().decode(Catalog.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[2])))
let catalog=BattleTextCatalog(moves:base.moves.merging(fairy.moves){_,new in new},types:base.types.merging(fairy.types){_,new in new})
let cases=try JSONDecoder().decode([Input].self,from:FileHandle.standardInput.readDataToEndOfFile())
FileHandle.standardOutput.write(try JSONEncoder().encode(cases.map{catalog.moveTooltip($0.name,language:$0.language)}))
}}
`;
await writeFile(join(output,'Oracle.swift'),code);
execFileSync('swiftc',['-parse-as-library','-module-cache-path',join(output,'module-cache'),join(output,'Oracle.swift'),'-o',join(output,'oracle')],{stdio:'inherit'});
console.log(join(output,'oracle'));
