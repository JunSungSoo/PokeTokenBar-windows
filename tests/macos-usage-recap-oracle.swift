import Foundation
@testable import PokeTokenBar
private struct Input:Decodable{let scope:String;let now:String;let offset:Int;let firstWeekday:Int;let coveredSince:String;let tokensByDay:[String:Int]}
@main struct Oracle{
 static func main()throws{
  let rows=try JSONDecoder().decode([Input].self,from:FileHandle.standardInput.readDataToEndOfFile())
  let output:[[String:Any]]=rows.map{row in
   let name="ptb-recap-oracle-"+UUID().uuidString,defaults=UserDefaults(suiteName:name)!;defer{defaults.removePersistentDomain(forName:name)}
   defaults.set(row.tokensByDay,forKey:UsageLedger.defaultsKey);defaults.set(row.coveredSince,forKey:UsageLedger.coverageKey)
   let ledger=UsageLedger.load(from:defaults),now=ISO8601DateFormatter().date(from:row.now)!,scope=RecapScope(rawValue:row.scope)!
   var calendar=RecapPeriod.calendar(timeZone:TimeZone(secondsFromGMT:0)!);calendar.firstWeekday=row.firstWeekday+1
   let period=RecapPeriod(scope:scope,containing:now,calendar:calendar).shifted(by:row.offset,calendar:calendar)
   let recap=UsageRecap.make(ledger:ledger,dex:[],period:period,now:now,calendar:calendar),formatter=LocalUsageReader.localDayFormatter(timeZone:calendar.timeZone)
   return ["scope":row.scope,"start":formatter.string(from:period.start),"end":formatter.string(from:period.end),"buckets":recap.buckets.map{["key":$0.key,"tokens":$0.tokens,"isCurrent":$0.isCurrent,"hasData":$0.hasData] as [String:Any]},"total":recap.total,"inProgress":recap.isInProgress,"previousTotal":recap.previousTotal.map{$0 as Any} ?? NSNull(),"delta":recap.delta.map{$0 as Any} ?? NSNull(),"bestDay":recap.bestDay.map{["key":$0.key,"tokens":$0.tokens] as Any} ?? NSNull(),"activeDays":recap.activeDays,"countedDays":recap.countedDays,"bestStreak":recap.bestStreak,"canGoBack":recap.canGoBack]
  }
  FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:output,options:[.sortedKeys]))
 }
}
