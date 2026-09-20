# ProofLaunch on Robinhood Chain — Review Findings

Date: 2026-09-19. Scope: `contracts/rhc/src/` at commit `e750f89` (pre-fix).
Fixes land in the commit that adds this file. Brief: `docs/rhc-review-scope.md`.

## What this is, honestly

A **self-review with receipts**, not an independent audit. Two passes were
run: an automated review recipe over the whole tree (a different prompt and
method from the one that wrote the code), and an adversarial pass driven by
the four design rules in the scope brief. **No claim below counts as a
finding unless it is a test** in `contracts/rhc/test/Review.t.sol` that
fails against the pre-fix code and passes against the fix. No fuzzing, no
formal verification, no human who didn't write the code has read it. That
last one is the remaining gap; this document makes closing it a
one-message ask.

Severity is about **user money**: principal > fee stream > gas/UX.

## Summary

| # | Finding | Where | Live today? | Status |
|---|---|---|---|---|
| F1 | Burn bot's 0.2 ETH cap was per-*call*, so a sandwicher who is also the cranker loops it in one tx | `BurnLegV2` | **Yes** (v5/v6 legs) | Fixed in `BurnLegV3` (one crank per block). Live legs immutable — disclosed |
| F2 | Pool-feeder mints full-range at spot with no per-block cap | `FeedLPLegV2` | Code live, **never executed** | Fixed in `FeedLPLegV3` |
| F3 | ERC20-quoted launch stranded the creator's escrow surplus + any stray ETH forever | `CampaignV3` | No (v7, undeployed) | **Fixed**: refunded at launch; post-launch sweep permissionless |
| F4 | Legs hardcode the pons hook and ±887200 ticks; a pons rotation bricks cranks with funds inside | `V4LegBase`/legs | **Yes** | Tick half fixed in v3 legs. Hook half **accepted** (see below) |
| F5 | Vault can pull ERC20 in but has no way to move ERC20 out | `RewardsVault` | No (not deployable yet) | Mitigated: intake is native-only. **Deployment blocker** recorded |
| F6 | Native raise with `goal < pons launchFee` fills, then `launch()` panics on underflow; backers trapped until grace | `CampaignV2`/`V3` | **Yes** (v6) — UI cannot produce it | Fixed in v7 (rejected at creation; named revert at launch; refund proven) |
| F7 | ETH received while nobody is staked goes entirely to the next staker | `RewardsVault` | No | **Accepted**, with rationale |
| F8 | Zero-address vault leg strands its share forever; the UI regex accepted `0x000…0` | factories + create form | **Yes** (v6) — reachable via UI | UI fixed now; contract fixed in v7 |
| F9 | Duplicated `mulDiv`, reentrancy guard, four near-identical ERC20 interfaces | several | — | Deferred (quality) |
| F10 | Redundant balance/struct reads in `FeedLPLegV2.crank` | `FeedLPLegV2` | — | Deferred (gas) |

## Findings

### F1 — Burn crank cap was per-call, not per-block  *(Live · Medium · fee stream)*
`BurnLegV2.crank()` buys with `minTokensOut = 0` on the curve and
`sqrtPriceLimit = MIN_SQRT` on v4, and `MAX_ETH_PER_CRANK` bounds one
*call*. The scope brief accepted "sandwich loss bounded by cap × depth";
the review sharpened it: the cranker can be the sandwicher, and loop
`crank()` inside one transaction, so the real bound was the leg's whole
balance. **Fix** (`BurnLegV3`): `lastCrankBlock`; a second crank in the
same block reverts `CrankedThisBlock`. Residual: bracketing across
blocks is still possible, bounded to 0.2 ETH per block and paying the
full round-trip each time; full immunity needs a price oracle, which v4
core does not provide. Tests: `test_F1_burnLegV3_oneCrankPerBlock_capIsRealPerBlock`.
**Live exposure**: exactly one V2 leg exists on mainnet (`0xB3Ef76F1…`,
on `PL TEST`), holding 0 ETH today. It cannot be patched. Disclosed here
and in `docs/rhc-receipts.md`.

### F2 — Pool-feeder sizes from live spot with no cap  *(Code live, never run · Medium-Low)*
Same class as F1: `crank()` reads `getSlot0` and mints at that ratio.
The position is full-range and locked, so the loss is the arb on the
amount added, not principal. **Fix** (`FeedLPLegV3`): same per-block
guard. Test: `test_F1_feedLpV3_oneCrankPerBlock`.

### F3 — ERC20-quoted launch stranded native ETH  *(v7 · High → fixed)*
Escrow is sized at creation from `ponsFactory.launchFee()`; `launch()`
forwards *today's* fee. If pons lowered its fee, the difference stayed in
the campaign; `refundLaunchFee()` required `refundable()`, which is false
once launched; `excessAtLaunch` tracks only the quote token. Stray ETH via
`receive()` was stuck the same way. Violates design rule 3. **Fix**: after
an ERC20 launch, all native goes to the creator (the only native principal
in an ERC20 raise); `refundLaunchFee()` now also sweeps post-launch, is
permissionless, and always pays the creator; still reverts while a raise
is live (the escrow is what launch spends) and **always** reverts on
native-quoted campaigns (that ETH is backers'). Tests: four `test_F3_*`.

### F4 — Hardcoded pons hook and tick range  *(Live · Medium · accepted in part)*
`_poolKey` fixes `hooks = memeHook` from factory deploy time; the tick
range was a constant for spacing 200. pons' `LaunchedToken` record carries
`poolFee` and `tickSpacing` but **no hook**, so the hook cannot be read
per-launch. **Fixed half**: v3 legs derive `±(887272 / spacing) · spacing`.
Test: `test_F4_maxTick_alignedAndInRange_forAnySpacing`. **Accepted half**:
if pons rotates `memeHook` between a campaign's creation and its
graduation, that campaign's legs revert on every post-graduation crank,
with any accrued ETH/tokens inside and no exit. Bounded to legs created
in that window; pons has not rotated the hook since our first deploy.
Documented in the scope brief's accepted risks.

### F5 — Vault could trap ERC20  *(v7 · High for ERC20 raises → mitigated + blocker)*
`pokeClaim(splitter, asset)` accepted any asset; the vault accounts native
only and has no function that moves an ERC20 out. **Mitigation now**:
`pokeClaim` reverts `NativeOnly` for anything else, so ERC20 legs stay
owed in their splitter rather than entering a contract that cannot pay
them. Test: `test_F5_vault_refusesNonNativeAssets`. **Open design item /
deployment blocker**: a factory that points holder-rewards at this vault
must be native-quote-only, *or* the vault gains ERC20 accounting. Either
is a decision to make before the vault deploys — which is already gated
on the platform token existing.

### F6 — `goal < launchFee` traps a funded raise  *(Live · Low; v7 fixed)*
Only `goal == 0` was checked; native `launch()` computes `pooled - fee`.
A raise below 0.0005 ETH could fill and never launch until deadline +
grace. **Live**: the create form's goal is a preset select (floor 0.1
ETH), so this is direct-call-only on v6. **Fix (v7)**: rejected at
creation; `launch()` reverts a named `NotLaunchable` (not `Panic`) if
pons raises its fee past the pool, and refunds are proven to open.
Tests: two `test_F6_*`.

### F7 — First-staker windfall  *(v7 · accepted)*
ETH arriving while `totalStaked == 0` is attributed to whoever stakes
next. The alternatives — burn it, or hold it unclaimable — are worse, and
the condition requires every staker of a live token to have left. If it
ever matters, a factory redeploy can point at a vault with a floor.

### F8 — Zero-address vault leg  *(Live · Medium; UI fixed now, contract fixed v7)*
`previewLegs` never validated `vaultRecipients`; `legOwed[address(0)]`
accrues and only `address(0)` could claim it. The create form's check was
a bare hex regex, so `0x000…000` passed. **UI fix (shipped with this
commit)**: zero address rejected. **Contract fix (v7)**: `BadVault` on
zero recipient or zero bps. Tests: two `test_F8_*`. Live v6 remains
exposed to a direct call with a zero recipient; the share lost is that
leg's bps of that campaign's fees, nothing else.

### F9 / F10 — Quality and gas  *(deferred)*
Real but not security. Tracked for the next generation.

## What changed to close these

`src/BurnLegV3.sol`, `src/FeedLPLegV3.sol`, `src/LegDeployerV3.sol` (new;
V2 sources untouched — they are what is deployed), `CampaignFactoryV5`
(points at V3 legs; `BadVault`), `CampaignV3` (goal floor, launch guard,
escrow refund, sweep), `RewardsVault` (`NativeOnly`), `src/app/rhc/create/page.tsx`
(zero-address vault rejected), `script/DeployV5.s.sol` (deploys
`LegDeployerV3` first). Suite: 87/87 including all fork suites.

## Residual risk, stated plainly

- Live v5/v6 legs carry F1 and F4 as described; one leg exists, balance 0.
- Sandwich immunity for the burn bot is per-block bounded, not absolute.
- No independent human has reviewed this code. This document is the brief
  for whoever does.
