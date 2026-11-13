import Foundation
@testable import PokeTokenBar

private enum FixtureError: Error { case unavailable }
private struct OfflineProvider: PokeProviding {
    func line(baseSpeciesID: Int) async throws -> EvoLine { throw FixtureError.unavailable }
    func baseSpeciesIndex() async throws -> [BaseSpecies] { throw FixtureError.unavailable }
    func baseSpecies(id: Int) async throws -> BaseSpecies? { nil }
}

@main
struct Peer {
    @MainActor static func main() async throws {
        let args = CommandLine.arguments
        let path = URL(fileURLWithPath: args[2])
        let sent = DexEntry(id: "mac-fixture", baseID: 25, finalID: 25, chainOrder: [25], rarity: .common,
                            caughtAt: Date(timeIntervalSince1970: 1750000000),
                            names: [25: ["ko": "피카츄"]])
        let hostActive = args.count > 3 && args[3] == "host-active"
        var state = CompanionState()
        let item: TradeItem
        if hostActive {
            let profile = PokemonProfile.generate(seed: UInt64.max, instanceID: "mac-active")
            let mon = MonState(baseID: 133, pathIDs: [133], plannedPathIDs: [133, 196], stageIndex: 0,
                               usedAtStage: 33_000_000, rarity: .uncommon, totalForms: 2,
                               nature: .jolly, profile: profile)
            state.active = mon
            item = .activeMon(mon)
        } else {
            state.dex = [sent]
            item = .dexEntry(sent)
        }
        try JSONEncoder().encode(state).write(to: path)
        let suite = "poketokenbar-trade-fixture-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        TradeIdentity.setNickname("Mac Fixture", defaults: defaults)
        let store = CompanionStore(provider: OfflineProvider(), fileURL: path,
                                   dittoDisguiseRollingEnabled: false, defaults: defaults)
        let transport = ManualTradeTransport()
        let session = TradeSession(transport: transport, defaults: defaults)
        session.onPeerIdentified = { _ in session.proposeOffer(item) }
        session.onOffersReady = { _, _ in session.accept() }
        session.onReadyToCommit = { incoming in
            do {
                _ = try store.applyTradeCommit(sending: item, receiving: incoming)
                session.confirmLocalCommit()
            } catch { session.reject(reason: "fixture save failed") }
        }
        var completed = false
        session.onCompleted = { completed = true }
        if hostActive {
            let code: String? = await withCheckedContinuation { continuation in
                transport.startListening { continuation.resume(returning: $0) }
            }
            guard let code else { throw FixtureError.unavailable }
            FileHandle.standardOutput.write(Data(("CODE " + code + "\n").utf8))
        } else {
            try transport.connectManually(code: args[1])
        }
        for _ in 0..<200 {
            if completed {
                try await Task.sleep(for: .milliseconds(200))
                return
            }
            try await Task.sleep(for: .milliseconds(40))
        }
        throw FixtureError.unavailable
    }
}
