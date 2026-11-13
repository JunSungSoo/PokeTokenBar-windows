import Foundation
@testable import PokeTokenBar

let now = Date(timeIntervalSince1970: 1_781_665_200)
var state = CompanionState()
state.installBaselineSet = true
state.usedSinceInstall = 911_000_000
state.claimedTodayTokensByProvider = ["codex": 64_000_000]
var profile = PokemonProfile.generate(seed: 42, instanceID: "fixture-active")
profile.level = 21
state.active = MonState(baseID: 16, pathIDs: [16, 17], plannedPathIDs: [16, 17, 18],
                        stageIndex: 1, usedAtStage: 42_000_000, rarity: .uncommon, totalForms: 3,
                        isShiny: true, nature: .jolly, profile: profile)
state.dex = [
    DexEntry(id: "fixture-graduated", baseID: 133, finalID: 197, chainOrder: [133, 197], rarity: .rare,
             caughtAt: now, nature: .calm, names: [133: ["ko": "이브이"], 197: ["ko": "블래키"]]),
    DexEntry(id: "fixture-released", baseID: 201, finalID: 201, chainOrder: [201], rarity: .common,
             caughtAt: nil, nature: .hardy, names: [201: ["ko": "안농"]],
             releasedAt: now, form: PokemonForm("b")),
]
FileHandle.standardOutput.write(try SaveTransfer.encode(state: state, appVersion: "3.1.2",
                                                        deviceName: "Fixture Mac", now: now))
