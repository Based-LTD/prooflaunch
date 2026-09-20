# ProofLaunch on Robinhood Chain — External Review Scope

Prepared 2026-09-15 for an independent smart-contract review. This gate
lifts the UI's 2 ETH beta goal cap. Repo: `contracts/rhc/` (Foundry).

## What this system is

Community-pooled token launches on pons V2 (Robinhood Chain's dominant
launchpad, chain id 4663). Backers pool native ETH in a Campaign
contract; at launch, one transaction creates the token on pons and
executes the pooled buy snipe-exempt; backers pull-claim tokens
pro-rata and earn 90% of the creator fee stream forever via an
immutable FeeSplitter. Optional per-campaign "bot legs" (ownerless
contracts) burn or lock liquidity from their fee share.

Design constitution (every finding should be judged against these):
1. The platform NEVER holds user funds; no owner/admin/pause/upgrade
   anywhere; deployer is a throwaway with zero post-deploy authority.
2. Every post-launch action is a permissionless crank.
3. Funds can never be stranded: refunds open unconditionally at
   deadline + 3-day grace if launch never happened.
4. All distribution is pull-based; no recipient can grief another.

## In-scope contracts (live generation, v6)

| Contract | Address | Role |
|---|---|---|
| CampaignFactoryV4 | `0xB86b783ccaCC20746ae9dd33CffE4a205B35E334` | ACTIVE factory: policy (90/7/3), 0.001 ETH creation fee (exact, forwarded), dormant holder-waiver hooks |
| LegDeployerV2 | `0x42a2495D9426fd5d88A01e724E62275DCe02dfF4` | Satellite carrying bot-leg creation code (EIP-170) |
| CampaignV2 | per-campaign | Pool, launch via pons LaunchAndBuy, claims, refunds, excessAtLaunch |
| FeeSplitterV2 | per-campaign | Immutable split; per-asset accounting (native ETH + token); harvest() pulls from pons FeeEscrow |
| BurnLegV2 | per-campaign (optional) | Dual-phase buy-and-burn: curve.buy pre-graduation, direct Uniswap-v4 PoolManager swap after |
| FeedLPLegV2 | per-campaign (optional) | Full-range v4 liquidity, locked by construction (no withdraw exists), self-compounding |
| V4LegBase | inherited | unlock/callback plumbing, settlement, pool key derivation |

Prior generations (v1–v5) remain live with immutable campaigns but are
read-only in the UI; review effort should focus on the v6 lineage
above (v5 shares all code except the factory fee gate).

## External dependencies (pons V2 — NOT in scope, but the trust surface)

| Contract | Address |
|---|---|
| pons factory (UUPS proxy) | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| LaunchAndBuy | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` |
| FeeEscrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
| memeHook (Uniswap v4) | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` |
| v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| v4 StateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` |

Known pons behaviors we depend on (all fork-verified):
- launchToken/launchAndBuy: tokens delivered to `recipient`; a buy
  crossing the 4.2 ETH graduation threshold is partially refunded to
  the buyer (we snapshot as `excessAtLaunch`).
- `expectedEconomics` hash guards against config swaps mid-launch
  (we read `previewLaunchEconomics` in the same tx).
- Creator fees accrue on the curve; the curve→escrow sweep is gated to
  pons' feeSweepOperator bot (their protocol share rides the same
  sweep). Our harvest() is permissionless once funds reach the escrow.
- pons factory is an upgradeable proxy owned by pons — they can change
  behavior for FUTURE interactions. Campaigns pin addresses at
  creation; assess blast radius of a hostile pons upgrade on already-
  launched campaigns (our view: limited to future fee flow, not
  principal — please verify).
- Graduation cranks (factory.graduate, createGraduatedPool) are
  permissionless (verified by calling as a stranger on fork).
- The memeHook admits third-party swaps and third-party liquidity on
  graduated pools (fork-verified; our v4 legs depend on it).
- `buybackEnabled` is always passed false: our fork measurement showed
  it diverting ~22% of buy volume with unclear destination; the UI
  disables it. Confirm passing false is airtight.

## Focus areas, in priority order

1. **Backer principal safety** (Campaign deposit/withdraw/refund/launch
   state machine; reentrancy; the receive() surface added for curve
   refunds; donation/griefing via forced ETH).
2. **Launch atomicity + value flow**: pooled balance → launchAndBuy
   (value = pooled, amountIn = pooled − launchFee, minOut 0 — is 0
   justified given same-tx curve creation? sandwich surface?).
3. **excessAtLaunch accounting**: claimTokens pays token share + ETH
   excess share; rounding, ordering, double-claim, dust.
4. **FeeSplitterV2 per-asset accounting**: accounted/backerPool/
   legOwed/backerClaimed invariants under interleaved distribute/
   claim/harvest; native ETH vs token asset paths; last-leg dust
   absorption; harvest() with a malicious/reverting escrow response.
5. **Bot legs**: callback auth (_pendingUnlock pattern) on PoolManager
   unlock; curve.buy path re-entrancy; MAX_ETH_PER_CRANK sandwich
   economics; FeedLPLegV2 mint math (mulDiv, liquidity sizing) and the
   claim that principal withdrawal is impossible by construction.
6. **Factory policy**: LegOverflow bounds, tax cap live-read, creation
   fee exactness/forwarding, dormant waiver hooks (zero-token must not
   mean free-for-all — unit-tested, please confirm).
7. **Cross-generation UI assumptions** are out of scope, but flag any
   contract-side footgun for indexers (event completeness).

## Test suite

`forge test --threads 1` (parallel fork tests trip the RPC's rate
limits): 32 tests — unit (Campaign.t.sol, FeeGate.t.sol) + live-pons
fork suites (Fork.t.sol, ForkDeep.t.sol V1 era; ForkV2.t.sol,
ForkV2Deep.t.sol, ForkV4Probe.t.sol, ForkFeeGate.t.sol current era).
Fork tests exercise the real pons factory/curve/escrow/PoolManager,
including: launch with tax, 90/7/3 in native ETH via impersonated
sweep, oversized-raise refunds, curve-phase + v4-phase burns, v4
liquidity mint + compound, fee-gate enforcement.

Production evidence: first human E2E completed 2026-09-15 — campaign
`0x29aeBAE5…`, token `0xEBb0e11f…`; live fee split landed
79.99/10/7/2.99; BurnLegV2 burned 120,679 tokens via tx
`0xab70fcf8…e830`, cranked by an unaffiliated wallet.

## Known accepted risks (documented, not bugs)

- pons proxy upgradeability (above) — the ecosystem-wide assumption.
- Fee flow cadence depends on pons' sweeper for curve-phase fees.
- BurnLegV2 (live) swaps with minOut 0 under a 0.2 ETH per-*call* cap —
  the review found the cap loopable in one tx (finding F1). BurnLegV3
  makes it one crank per block; cross-block bracketing remains, bounded
  per block. No oracle on v4 core, so absolute immunity is out of scope.
- pons memeHook is fixed per factory deploy and not readable per launch
  (finding F4): a hook rotation between a campaign's creation and its
  graduation bricks that campaign's legs with funds inside.

Findings and fixes with tests: `docs/rhc-review-findings.md`.
- The 📸 airdrop leg is a platform-operated EOA by design (labeled).

## v7 addendum (LIVE since 2026-09-20 — review together)

Addresses: factory `0x6928C1Ace232124641e9cfFEfD16D82E1B9c531B`, satellite `0xdDCf167F6DA48e8f6C1fC716fDFef4CCEEBd4fe3`, LegDeployerV3 `0x518B6b80736af35D25F98Cc403A7f2dD8a0763AB`, EquityRouter `0x0A568a0AdcC45F8f6597f0219df39FA9ACA82943`. Verified read-back: `tools/_verify-v7-deploy.mjs`.

The v7 generation is code-complete and fork-proven; it deploys only
after this review. Files: CampaignV3.sol (CampaignParams struct),
FeeSplitterV3.sol, CampaignFactoryV5.sol (+ CampaignDeployerV3
satellite), RewardsVault.sol.

New surface to scrutinize:
- **Team rounds**: reservedSeats/allowlist seat buckets — deposit
  assignment, withdraw freeing the right bucket, the public-seat
  guarantee (a public wallet must never take a reserved seat and vice
  versa can spill); constructor rejects reserved seats on unslotted
  raises.
- **Token gating**: gateToken balance check at first deposit (balance
  can be flash-borrowed for entry — accepted, it gates entry not
  economics; challenge that).
- **ERC20 quotes** (USDG + tokenized stocks, fork-proven against both):
  approve+depositToken/withdraw/refund/excess paths; the native launch
  fee escrowed at creation (refundLaunchFee single-shot to creator);
  approve-to-launchAndBuy set then zeroed; nonstandard-token behavior
  (fee-on-transfer would break accounting — pons approval is the
  implicit filter, challenge whether that's enough); bots refused on
  ERC20 quotes at the factory.
- **CREATE2 deployment**: CampaignDeployerV3 is factory-only; salt is
  caller-supplied (vanity 0x…5EED) — confirm no griefing via address
  pre-computation (deploy-before-them front-running reverts on
  collision; assess).
- **RewardsVault**: Synthetix-style accumulator, ETH-only accounting;
  solvency invariant unit-tested under churn; ETH sent while unstaked
  pool waits unaccounted and is inherited by first stakers (intended);
  pokeClaim try/catch spray. `stakeToken` is immutable — the vault
  cannot deploy until the platform token exists.
- **FeeSplitterV3.claimBackerAs / claimLegAs** (added 2026-09-20): the
  native entitlement routed through the factory-fixed EquityRouter;
  effects before the one external call, `nonReentrant`, refund clamped
  to the amount sent, plain `claimBacker` untouched. A caller-supplied
  `PoolKey.hooks` is a contract of the caller's choosing that runs mid-
  swap — confirm the pre-applied accounting leaves it nothing to take.
  `payoutAsset` on the campaign is a UI default only; confirm nothing
  enforces it.
- **EquityRouter** (`EquityRouter.sol`, added 2026-09-17): ETH in,
  ERC20 out through a caller-supplied Uniswap v4 PoolKey. Ownerless,
  stateless between calls, holds nothing. **Deliberately has no asset
  allowlist** — the caller names the pool, so any pool Robinhood lists
  works with no deploy. Scrutinize: unlock/callback auth (`_unlocking`
  is also the reentrancy guard); exact-input delta signs; the
  `NotNativePair` guard on `currency0 == address(0)`; dust refund to
  `msg.sender`; a malicious/degenerate pool can only cost the caller
  what their own `minOut` permits — confirm nothing worse.
- **RewardsVault.claimAs** (added 2026-09-17): claim your ETH
  entitlement routed through EquityRouter in the same tx, asset taken
  straight to the claimer. `_takeOwed()` is the single accounting path
  behind `claim()` and `claimAs()` — confirm they cannot drift. Router
  is an immutable constructor arg (caller-supplied would hand a claim
  to a stranger); `claim()` never touches it, so a broken router can
  delay but never trap. A failed swap must revert the whole tx and
  leave the claim intact (tested). Router refunds are clamped to the
  amount sent so a coincident inbound payment can't be walked out.

**Structural question we most want an outside opinion on:** the
protocol only ever owes ETH; the *recipient* optionally swaps their
own entitlement into a tokenized equity on the way out. We chose this
over "creator picks the payout asset" and over any voted/rotating menu
precisely so there is no governance surface and no moment where the
protocol chooses, holds, or distributes an equity. Is that separation
as clean on-chain as we believe, and is there any path by which the
vault or a campaign FeeSplitter ends up custodying an equity?

Tests: 75 across 14 suites (77 assertions when parametric), including
EquityRouter 7/7 and RewardsVaultClaimAs 7/7 on a live fork against
the real MSFT/SPCX v4 pools, and ForkV3 (USDG-quoted lifecycle incl.
withdraw, SPCX stock-quoted lifecycle, every pons-approved stock,
native seat-round) against live pons. Pool keys and measured routing
cost per asset: `contracts/rhc/RWA_POOLS.md`.

## Out of scope

Frontend, the Solana platform, WalletProof, pons internals beyond the
interaction surface.
