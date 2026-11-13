import Foundation
@testable import PokeTokenBar
private final class NoDiscovery: BattleLink {
 var onPeerFound:(@Sendable(TradePeer)->Void)?;var onPeerLost:(@Sendable(String)->Void)?
 var onConnected:(@Sendable()->Void)?;var onDisconnected:(@Sendable()->Void)?;var onDataReceived:(@Sendable(Data)->Void)?
 func startDiscovery(){};func stopDiscovery(){};func connect(to peer:TradePeer)throws{};func sendData(_ data:Data)throws{};func disconnect(){}
}
private enum Failure:Error{case timeout;case source(String)}
@main struct Peer{
 @MainActor static func main()async throws{
  let args=CommandLine.arguments,suite="ptb-battle-peer-"+UUID().uuidString,defaults=UserDefaults(suiteName:suite)!;defer{defaults.removePersistentDomain(forName:suite)}
  defaults.set(args.count>4 && args[4]=="host" ? "AAAAAAAA":"ZZZZZZZZ",forKey:"tradeCode");TradeIdentity.setNickname("Original Mac Battle",defaults:defaults)
  let history=BattleHistoryStore(url:URL(fileURLWithPath:args[3])),c=BattleCoordinator(defaults:defaults,history:history,linkFactory:{_,_ in NoDiscovery()})
  let team=try JSONDecoder().decode([BattlePokemon].self,from:Data(contentsOf:URL(fileURLWithPath:args[2])))
  c.search();c.connectManual(args[1]);var registered=false,readied=false,last="",played=false
  for _ in 0..<1000{
   if let error=c.error{throw Failure.source(error)}
   if c.phase == .connected,c.opponent != nil,!registered{c.register(team:team);registered=true}
   if c.canSelectLineup,!readied{c.ready(team:team);readied=true}
   if let f=c.frame,!f.waiting,!f.ended,f.decisionID != last{
    if f.turn>=2{played=true;c.surrender()}else{
     last=f.decisionID;let actions=f.slots.map{slot -> BattleAction in
      if slot.canPass{return .pass}
      if slot.mustSwitch{return .init(kind:"switch",index:f.own.firstIndex(where:{!$0.active && !$0.fainted})!+1,target:0)}
      let move=slot.moves.first(where:{!$0.disabled && $0.pp>0})!;return .init(kind:"move",index:move.index,target:move.targetRequired ? (move.targets.first(where:{$0.location>0})?.location ?? 0):0)
     };c.choose(.init(decisionID:f.decisionID,actions:actions,order:[]))
    }
   }
   if c.phase == .ended{
    let result:[String:Any]=["played":played,"result":c.outcome ?? "","turn":c.frame?.turn ?? 0,"historyCount":history.records.count,"teamCount":history.records.first?.team.count ?? 0]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result));c.shutdown();return
   }
   try await Task.sleep(for:.milliseconds(15))
  }
  c.shutdown();throw Failure.timeout
 }
}
