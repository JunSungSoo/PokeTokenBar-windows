import Foundation
@testable import PokeTokenBar
private struct Pokemon:Decodable {let id:String;let speciesID:Int;let battleDefaultItem:String?}
private struct Input:Decodable {let roster:[Pokemon];let remembered:[String:String];let overrides:[String:String]}
@main struct Oracle {
 static func main()throws {
  let input=try JSONDecoder().decode([Input].self,from:FileHandle.standardInput.readDataToEndOfFile())
  let output=input.map {row in
   let roster=row.roster.map {p in
    var entry=DexEntry(id:p.id,baseID:p.speciesID,finalID:p.speciesID,chainOrder:[p.speciesID],rarity:.common,caughtAt:nil)
    entry.battleDefaultItem=p.battleDefaultItem;return entry
   }
   var loadout=BattleItemLoadout();loadout.restore(roster:roster,remembered:row.remembered,overrides:row.overrides)
   return Dictionary(uniqueKeysWithValues:roster.map{($0.id,loadout.items[$0.id] ?? "")})
  }
  FileHandle.standardOutput.write(try JSONEncoder().encode(output))
 }
}
