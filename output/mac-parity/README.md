Current feature implementation and validation (2026-11-15): see docs/MISSING_FEATURES_2026-11-15.md. Final full suite: 114 tests, 110 passed, 4 native Mac peers excluded. Windows default: 104 passed, 10 excluded (six portable Swift checks run in Docker). Logs: features-complete-tests.log, features-complete-swift.log, features-ui-extra.log, state-ipc-third.log, features-battle-ui.log, features-package.log.

# Previously skipped tests — 2026-11-14

Reference: `../PokeTokenBar`, `origin/feature/battle`, commit `ad1bb7c9217028270ec28ebfb8d2dc05059a09da`.

## Results

- Full suite with compiled Swift comparisons in Linux Docker: **106 tests, 102 passed, 0 failed, 4 skipped**.
- Windows `pnpm test`, including the TypeScript build: **106 tests, 96 passed, 0 failed, 10 skipped**. The six portable Swift executables are Linux executables, so they are enabled by the Docker runner rather than the Windows default command. Windows output is saved in `windows-tests.log`.
- All six tests that could be enabled on this machine passed. No substitute peer was used for the four macOS integration tests.

The added profile oracle also passed: 544 identical seed/metadata samples match the original Swift IV, gender and ability results. Current logs: swift-final.log, windows-tests-complete.log, runtime-ui-verified.log and battle-ui-verified.log. The audit document in docs records all fixes.

## Original ten skipped tests

| Test | Original reason | Result |
| --- | --- | --- |
| Engine, animation player and trainer assets | The test looked at the checked-out `main`, which lacks the battle resources | Passed against Git blobs from `origin/feature/battle`: 3,357 files. UTF-8 checkout line endings are normalized; binary bytes are exact. |
| Original Swift normalized moves and computed stats | `POKE_MAC_DETAILS_ORACLE` unset; no host Swift compiler | Passed using compiled original Swift functions in Docker. |
| Original Swift move defaults and replacements | `POKE_MAC_LOADOUT_ORACLE` unset | Passed using compiled original Swift functions in Docker. |
| All bundled move tooltips in eight languages | `POKE_MAC_TOOLTIP_ORACLE` unset | Passed. Fixed the stale builder to include the new `moveType` helper. This fixture covers species-independent tooltips, with species/form omitted. |
| Agent, service status and frame timing | `POKE_MAC_RUNTIME_ORACLE` unset; the harness imported AppKit | Passed. The original calculations were compiled with identity-only image DTOs for the frame timing samples. This does not test AppKit drawing or GIF decoding. |
| Battle commitment digest | `POKE_MAC_BATTLE_ORACLE` unset; CryptoKit unavailable on Linux | Passed. Original action/decision/JSON encoding/digest bodies use Apple's Swift Crypto SHA-256 backend on Linux. |
| Original Mac battle coordinator as guest | `POKE_MAC_BATTLE_PEER` unset | Still skipped: requires macOS SDK and the compiled original PokeTokenBar module. |
| Original Mac battle coordinator as host | `POKE_MAC_BATTLE_PEER` unset | Still skipped: same requirement. |
| Original Mac TradeSession exchanging with Windows | `POKE_MAC_TRADE_PEER` unset | Still skipped: requires macOS SDK and the compiled original PokeTokenBar module. |
| Windows joining an original Swift host with active partner | `POKE_MAC_TRADE_PEER` unset | Still skipped: same requirement. |

The remaining peers import `@testable PokeTokenBar`; their builders link the Mac target's `.build/debug` module and object files. The target declares macOS 14 and uses Apple platform frameworks. This host has no macOS SDK, Xcode or compiled Mac module. The Linux Swift container cannot execute those native Mac integration peers. Existing Windows/Node LAN tests did run and pass.

## Reproduce on Windows with Docker Desktop running

```powershell
pnpm build
node scripts/prepare-mac-pure-reference.mjs
Get-Content scripts/swift-parity.Dockerfile | docker build -t poketokenbar-swift-parity:local -
$parityWorkspace = (Get-Location).Path
$parityReference = (Resolve-Path ../PokeTokenBar).Path
docker run --rm --env POKE_MAC_REFERENCE=/mac-reference --env POKE_MAC_SOURCE=/mac-reference --mount "type=bind,source=$parityWorkspace,target=/workspace" --mount "type=bind,source=$parityReference,target=/mac-reference,readonly" poketokenbar-swift-parity:local node scripts/run-portable-swift-parity.mjs --full
```

The initial build downloads the official Swift/Node images and Swift Crypto dependencies. Subsequent runs can add `--env POKE_OFFLINE=1` to disable Swift package resolution. Local socket access remains necessary for LAN tests.

Only selected branch files are exported; the Mac checkout is never switched or modified. Generated source, compiler outputs and dependency checkouts are ignored by the local `.gitignore`.

Compiler image: `swift:6.0.3-jammy`. Node: `22.23.5`. Swift Crypto: `3.10.0` (`ff0f781cf7c6a22d52957e50b104f5768b50c779`); Swift ASN.1: `1.6.0` (`9f542610331815e29cc3821d3b6f488db8715517`). Swift Crypto's Linux CryptoKit-compatible API is documented by [Apple's Swift Crypto project](https://github.com/apple/swift-crypto).
