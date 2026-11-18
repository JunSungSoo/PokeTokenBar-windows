# Quota parity verification — 2026-11-13

Reference: `../PokeTokenBar`, `origin/feature/battle` at `ad1bb7c9217028270ec28ebfb8d2dc05059a09da`. Tests read this branch with `git show`, without changing the Mac checkout. Override the path/ref with `POKE_MAC_REFERENCE` / `POKE_MAC_REFERENCE_REF`.

Follow-up on 2026-11-14: the skipped-test audit enabled six more tests. The Docker integration run now passes 89 tests with 0 failures and 4 macOS-only skips. See `../mac-parity/README.md` for reasons and reproduction commands.

- Connected the existing pace and depletion calculations to the official quota UI.
- Used/remaining modes mirror the pace marker and retain the same utilization-based tier.
- Every selected account uses its own official utilization, reset, and attributed local block.
- Tabs use account IDs, so accounts with the same display name remain distinct.
- Added Claude `weekly_scoped` spans and rejected nonpositive Codex spans.
- Only Claude session windows support token-based depletion estimates, matching the reference.

## Validation

- `pnpm build`: passed.
- `pnpm typecheck`: passed.
- `node --test tests/quota.test.mjs tests/usage.test.mjs`: 14 passed.
- 135 depletion samples and 5 pace samples agree with arithmetic expressions extracted directly from the selected Swift branch. Boundary tests also cover forecast guards, reset equality, tier thresholds, remaining mode, prompt ownership, account switches, missing history, expired windows and sessions not yet started.
- `pnpm exec electron scripts/runtime-ui-smoke.mjs`: passed with hidden, isolated test windows and offline fixtures. Added checks for actual pace markers, gauge colors/tooltips, account switching with identical labels, both forecast outcomes, suppression, 8 languages, 360/490px widths and dark mode.
- `pnpm test` with local socket access: 83 passed, 0 failed, 10 skipped. The previously reported shop mismatch was caused by comparing against `main`, rather than the requested `feature/battle` branch.
- Red Maple remains available at 100M tokens, matching Mint. The selected Mac branch and Windows both list four bag items and seven shop products. Regression coverage verifies graduated-only use, rejection of active/released/profileless targets, six IVs in 0...31, consumption of exactly one item, unchanged wallet/profile fields, purchase accounting and restart persistence.
- The initial sandboxed run also timed out on LAN tests; all affected LAN tests passed with local socket access.
- Swift is not installed on the Windows host. The follow-up Docker runner compiles the portable original Swift comparison functions; four full Mac integration peer tests still require macOS. The quota source-expression comparison itself does not execute a compiled Mac application.

## Species registration

The reference declares `PokemonAssets.animatedSpeciesIDs = 1...649`. Every ID in that range exists in the Windows national dex, hatch data and battle species catalog, with a usable name and primary type. There are no missing IDs within the supported Gen I–V range. This does not claim registration of later generations or availability of remote sprite downloads.

## Sample screenshots

These use synthetic accounts and offline test data.

- `quota-used.png`: 25% elapsed pace marker.
- `quota-remaining.png`: the same marker mirrored to 75%.
- `quota-second-account.png`: a different reset and no depletion before reset.
- `quota-dark.png`: dark mode.
