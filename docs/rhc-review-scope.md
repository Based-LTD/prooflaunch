# PoolLaunch (Robinhood Chain) — External Review Scope

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
- BurnLegV2 swaps with minOut 0 under a 0.2 ETH per-crank cap —
  sandwich loss bounded by cap × pool depth; challenge the bound.
- The 📸 airdrop leg is a platform-operated EOA by design (labeled).

## v7 addendum (contracts built, NOT yet deployed — review together)

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
- **RewardsVault**: Synthetix-style accumulator, ETH-only; solvency
  invariant unit-tested under churn; ETH sent while unstaked pool
  waits unaccounted and is inherited by first stakers (intended);
  pokeClaim try/catch spray.

Tests: 37 unit + ForkV3 (USDG-quoted lifecycle incl. withdraw, SPCX
stock-quoted lifecycle, native seat-round) against live pons.

## Out of scope

Frontend, the Solana platform, WalletProof, pons internals beyond the
interaction surface.
