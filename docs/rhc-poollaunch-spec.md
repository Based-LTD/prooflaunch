# PoolLaunch on Robinhood Chain — Design Spec (Decision Document)

Status: DRAFT for build/pass decision · 2026-09-07
Author: research + design pass, no code written, nothing deployed.

## 0. The decision being made

Should proof launch expand to Robinhood Chain by building `PoolLaunch` — a
trust-minimized, contract-based version of the community-pooled launch —
on top of the Pons launchpad? This doc gives the verified landscape, the
contract design, what it costs, and the criteria for a yes/no.

## 1. Verified landscape (researched 2026-09-07)

### Robinhood Chain (RHC)
- Mainnet live July 1, 2026. Arbitrum-stack L2, ~100ms blocks, gas in ETH.
- Chain ID **4663** — verified directly against the live RPC
  (`https://rpc.mainnet.chain.robinhood.com` returned `0x1237`).
- Explorer: `robinhoodchain.blockscout.com` (Cloudflare-gated to scripts;
  fine in a browser).
- 420k+ wallets holding tokenized assets within six weeks of launch.

### Pons (the pump.fun of RHC)
- Permissionless, no KYC. Fixed 1B supply per token. Launch fee 0.0005 ETH.
- Uniswap-v3-style pool from block one; **1% pool fee**; graduation at
  **4.2 ETH** in the pool — nothing migrates, same pool continues.
- **Creator/protocol fee split: 70/30 on the active factory** (legacy was
  90/10), snapshotted per token at launch, immutable afterward.
- **`feeWallet` is a `launchToken()` parameter** — creator fees route to
  any address from birth. Locker exposes `feeRedirects(token)` for
  post-launch redirection. Third-party integrators report a **public
  `collect()`** — anyone can trigger the fee sweep to the fee wallet
  (needs on-chain verification, see §6).
- **Snipe protection**: on the launch block, ONLY the creator's initial
  buy can execute (`initialBuyAmount` is a launch parameter, explicitly
  exempt from limits); 2 protected blocks; then 5% max hold / 5.5% max
  buy per wallet during the restriction window (`restrictionsEndBlock`).
- Contracts (active): factory `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`
  (bytecode verified present via RPC), locker
  `0x736D76699C26D0d966744cAe304C000d471f7F35`.
- Traction: ~$500M single-day volume record, ~$4B cumulative, ~$4.9M
  daily fees ≈ 63.9% of all tracked launchpad fees in crypto (early Sept).

### Competitive landscape — the wedge
| Player | Model | Pooled community launch? |
|---|---|---|
| Pons | solo-creator bonding curve | no |
| Pools Trade (**operated by Uniswap Labs**) | 4h crowd-bid window w/ $10k FDV floor + refunds, or instant launch; 0.25% LP fee, 80% autocompounds into locked liquidity | no — individual bids, not pooling |
| PonsDrop / PonsShare | fee-routing wrappers on top of Pons (vaults, splits, X-linked claims) | no — post-launch fee tooling only |

**Nobody on RHC offers: pool funds → one atomic launch+buy → pro-rata
allocation → ongoing trustless fee share to backers.** That is exactly
proof launch's model. The funding side of the market is unclaimed; only
the fee-distribution side is getting crowded.

## 2. Design

Three contracts. The platform never holds funds at any point.

### 2.1 `CampaignFactory`
Deploys a `Campaign` + `FeeSplitter` pair per launch. Registry +
canonical event source for the indexer. Takes platform config (platform
fee bps, holder-rewards address) at deploy; per-campaign params at
creation.

### 2.2 `Campaign` (one per launch)
State machine: `Open → Funded → Launched → Claimable` | `Open → Expired → Refundable`

- **Open**: creator sets goal (ETH), min/max per backer, slot count,
  deadline, fee split bps, optional bot legs. Backers `deposit()` ETH —
  held by the contract, withdrawable (`withdraw()`) any time before
  Funded (replaces our withdraw/re-back dance and its false-positive
  duplicate rows).
- **Funded**: goal reached (or slots full). Deposits lock.
- **Launch**: `launch()` is **permissionless** once Funded — anyone can
  call it (the cron *can*, but nothing depends on us). One transaction:
  calls Pons `launchToken(...)` with `feeWallet = FeeSplitter` and
  `initialBuyAmount = pooled ETH − launch fee`. Because the Campaign
  contract IS the creator, the pooled buy executes on the launch block,
  snipe-exempt by Pons's own rules. Tokens land in the Campaign.
- **Claimable**: `claim()` transfers each backer's pro-rata tokens.
  Pull-based; unclaimed tokens sit in the contract indefinitely (no
  distribution cron, no per-backer retry logic, no PPAYS founder-skip
  class — a failed claim is the backer's tx to retry).
- **Expired**: deadline passed unfunded → `refund()` per backer,
  pull-based and permissionless. No refund cron, no pool-key custody.

### 2.3 `FeeSplitter` (one per launch)
Receives the token's creator-fee share (70% of the 1% pool fee under the
active factory). Anyone can call Pons's public `collect()` to push fees
in — then `split()` (also permissionless) allocates by immutable bps:

- **backers leg** — accounted per backer pro-rata (same ratios as the
  Campaign), each backer `claimFees()` pulls their share
- **holder-rewards leg** — forwarded to the $PROOF holder-rewards
  address (SOL-side bridge treatment is an open question, §6; simplest
  v1: accumulate on RHC, periodically bridge/swap manually and disclose)
- **platform leg** — forwarded to a platform address that holds nothing
  else (commingling dead by design)
- **bot legs (optional)** — burn leg (buy token on the v3 pool, send to
  `0xdead`) and LP-feed leg (half-swap + v3 `mint`/`increaseLiquidity`,
  position owned by the splitter). EVM ports of our proven bot designs,
  but as permissionless-crank contract functions instead of cron-driven
  custodial wallets.

### 2.4 Honest fee math (headline copy must change)
On Solana we advertise "90% of creator fees to backers." On Pons, the
protocol takes 30% first. If we configure 90/5/5 on our splitter, backers
receive 90% × 70% = **63% of total trading fees** (0.63% of volume).
Copy must say "90% of the creator share" — the whitepaper-review lesson
from RARE applies to our own marketing.

## 3. Why this kills our worst bug classes (money-audit by design)

| Audit check (skill) | Solana today | PoolLaunch |
|---|---|---|
| 2.1 Books vs bank | DB credits vs escrow balance drifted −1.48 SOL | books ARE the bank: balances live in the contract; insolvency is unrepresentable |
| 2.3 Identity coherence | 2 half-rotated keys, 2 incidents, stranded funds | no custodial keys exist; nothing to rotate |
| 2.5 Dead pipelines | buyback sweep never ran; PROOF fees stranded | every step is a permissionless crank; anyone can execute; nothing depends on our cron |
| 2.6 Commingling | escrow = gas + revenue + custody (CEGG theft hit backers) | per-campaign contracts; platform leg isolated; theft surface is the audited contract only |
| 2.9 Idempotency/partial failure | per-backer retry patches, reconcile crons | pull-based claims; the "batch" doesn't exist |
| 2.7 Alarm calibration / 2.2 counters | hand-tuned sensors, row-cap lies | indexer reads events; totals are sums over an append-only chain log |

Remaining risk concentrates in one place: **the correctness of ~2 small
contracts**, which is auditable once, instead of an ops posture
maintained forever. (Solana's sensors stay; this is about the new stack.)

## 4. What we reuse vs build

**Reuse**: product design, brand, submit/backing UX, DB for off-chain
metadata (descriptions, images, chat), the health-endpoint pattern
(pointed at an indexer), the money-audit discipline.

**Build**: Solidity (Campaign, FeeSplitter, factory — small, ~500 lines
total target), Foundry tests incl. fork tests against real Pons on RHC,
wagmi/viem wallet path in the frontend next to the Solana adapter, a
thin event indexer, ETH gas float for our own convenience crons
(optional — nothing breaks without them).

**Shrinks**: distribution service, refund crons, per-backer retry,
solvency management, encrypted key handling — none of it exists on RHC.

## 5. Phases + effort (solo founder + Claude)

- **P0 — verify (days)**: pull verified factory/locker source from
  Blockscout in a browser; confirm `launchToken` ABI, `collect()`
  semantics/auth, `feeRedirects` auth, `initialBuyAmount` cap; write a
  fork-test that launches a token on a local RHC fork.
- **P1 — contracts (2–4 wks)**: build + Foundry test suite incl.
  adversarial tests (reentrancy on claims, griefing the launch call,
  dust/rounding on pro-rata, fee-split invariants).
- **P2 — app (1–2 wks)**: wagmi path, campaign pages, indexer.
- **P3 — review (1–2 wks + $)**: independent audit if budget allows
  (contracts are small; a focused review is cheap-ish), else at minimum
  a public repo + competitive review + capped launches.
- **P4 — soft launch**: cap first campaigns (e.g. ≤2 ETH goals) until
  the contracts have survived real value.

## 6. Open questions / risks (the honest list)

1. **`collect()` and `feeRedirects` auth** — reported by integrators,
   not in official docs. If fee redirection is creator-mutable or
   subject to Pons "community takeover," our fee promise could be
   stripped from outside. MUST verify in source before P1. (Mitigation
   if hostile: Campaign never exposes any path to change the redirect.)
2. **`initialBuyAmount` cap** — is there a max? If the pooled buy can't
   absorb a large raise (e.g. > some % of the curve), big campaigns need
   a buy-split strategy across the restriction window, which reopens
   snipe exposure. Verify limit; possibly cap campaign size in v1.
3. **Contract-as-creator assumptions** — does anything in Pons assume
   the deployer is an EOA (signatures, social verification, UI display)?
4. **Holder-rewards bridging** — RHC fees accrue in ETH; $PROOF holders
   are on Solana. v1: accumulate + manual bridge with disclosure; later:
   automated bridge or RHC-native rewards token. Decide before marketing.
5. **Chain risk** — RH controls the sequencer; a permissioned L2 can
   pause or reorder. Also ToS: verify Pons/RHC terms permit third-party
   launch aggregation.
6. **Fee-split economics** — 70/30 protocol cut + our 10% means backers
   net 63% of trading fees; competitors (Pools Trade) push 80% into
   locked liquidity instead. Our pitch must lean on the pooling +
   fee-share combo, not raw fee %.
7. **Audit budget** — the entire pitch is "trustless"; an unaudited
   trustless contract is a contradiction trolls will find. P4 caps are
   the fallback, a real audit is the answer.
8. **Speed of copycats** — Pons ecosystem ships fast (PonsDrop/PonsShare
   appeared within weeks). First-mover window on pooling is real but
   short. P0+P1 pace matters.

## 7. Decision criteria

**Build if**: P0 verification confirms (a) fee routing to a contract is
immutable-by-us, (b) initial buy can carry ≥ realistic campaign sizes,
(c) no ToS blocker — AND founder accepts the P3 audit cost or P4 caps.

**Pass if**: fee redirection is strippable by third parties, the initial
buy caps out below viable campaign size, or ToS forbids aggregation —
any one of these kills the trustless story, which is the entire point of
going.

---

## 8. P0 VERIFICATION RESULTS — 2026-09-07 · ALL GATES PASSED → BUILD

Method: function surfaces extracted from deployed bytecode (whatsabi +
selector DBs), semantics confirmed by decoding a real launch tx, auth
tested by `eth_call` simulation against the LIVE chain (with state
overrides for funding) — stronger evidence than reading source.

### Corrected addresses (docs + almanac are BOTH stale)
The documented "active" factory (`0xA5aA...`) has `launchEnabled=false`
and zero recent launches. The real active pair, found by chain-wide
`TokenLaunched` topic scan:
- **Factory: `0xf4fc0cd27fc8ecf17e55ee4c3f7201897df3eb75`** (launchEnabled=true)
- **Locker: `0x10F2756e373bAb14999fdC9177587D51D30a1Cf5`** (protocolFeeShare=30)

Three factory generations in two months, and even Pons's own docs lag.
→ Integration MUST discover the live factory dynamically (scan for the
`TokenLaunched` topic + check `launchEnabled`) and alert on churn. Our
identity-drift sensor pattern, applied to someone else's contracts.

### Gate results
| §7 gate | Result | Evidence |
|---|---|---|
| Launch permissionless | ✅ PASS | sample deployer `whitelistedLaunchers=false`, launched via EOA; simulated `launchToken` from an arbitrary address succeeds. Whitelist exists but is not required. |
| Fee redirect un-strippable | ✅ PASS | `setFeeRedirect` from random addr reverts (`0xea8e4eb5`); succeeds only from the token's deployer — which will be our Campaign contract, which exposes no path to call it. (Pons locker owner CAN redirect any token — ecosystem-wide admin power, disclose as a trust note.) |
| Initial buy carries a pooled raise | ✅ PASS | simulated launches with 0.1 / 1 / 3 / **4.5 ETH** initial buys all succeed — above the 4.2 ETH graduation threshold, so a large campaign may graduate at launch. No cap encountered at viable sizes. |
| ToS permits aggregation | ✅ PASS | terms are brand-hygiene only: no impersonation, no implied endorsement, lowercase "pons" + link attribution. Integration section explicitly supports builders. |

### Exact signatures (from live calldata decode)
- `launchToken((name, symbol, logo, description, (5 social strings), address feeWallet), uint256 launchConfigId, uint256 dexId, bytes32 salt)` — payable; selector `0x686399cb`; initial buy = `msg.value − launchFee` (0.0005 ETH); `predictTokenAddress(...)` gives the CREATE2 address pre-launch.
- Locker: `setFeeRedirect(token, addr)` deployer-only; `collectFees(token)` deployer-authorized (verified on a fee-bearing token: random ❌, deployer ✅) — NOT public as third parties reported. **Design tweak: Campaign exposes a public `pokeCollect()` crank that calls `locker.collectFees(token)` as the deployer — permissionless collection restored one hop up.**
- `MAX_PROTOCOL_FEE_SHARE = 50` on-chain: protocol split (currently 30) can rise to at most 50 for FUTURE tokens; per-token snapshot protects launched ones.

### Honest data point for the strategy
Current-factory launch rate is ~20-30 tokens/day — far below headline
froth. The DEX/trading volume is where RHC is exploding; launch counts
have cooled. Good for us (fee revenue comes from trading, and less
launch spam = less noise to compete with), but size expectations off
trading volume, not launch counts.

**Verdict: build criteria met. Proceed to P1 (contracts + Foundry fork
tests) on founder go.**

---

## 9. P1 STATUS — contracts built, 17/17 tests green (2026-09-08)

`contracts/rhc/` (Foundry): `CampaignFactory` + `Campaign` + `FeeSplitter`,
zero external dependencies, no owner/admin/pause/upgrade anywhere. 15
unit/adversarial tests (reentrancy, double-claim, launch gating, grace
refunds, split accumulation) + 2 fork tests that launch a REAL token
through the live pons factory on a fork of RHC and verify pro-rata
claims + fee routing end-to-end.

### Fork discoveries (things no doc mentions)
1. **pons delivers the launch-time initial-buy tokens to `feeWallet`,
   not to the launch caller.** Fix shipped: `FeeSplitter.drainTo()`
   (campaign-only) sweeps the launch allocation to the Campaign inside
   the same tx as `launchToken` — atomicity guarantees it can never
   catch fee flow.
2. **The live locker RECORDS the feeWallet as `feeRedirects(token)` at
   launch** (docs described zero-until-redirected). Resolved recipient
   verified == our splitter on-fork.
3. **Curve economics: a 1.5 ETH initial buy bought ~52% of supply.**
   Pooled raises are proportionally enormous on this curve vs Solana
   (where backers got ~20%). Product guidance needed: either cap v1
   campaign goals (~1-2 ETH) or embrace majority-community-owned floats
   as the differentiator. OPEN P2 ITEM: fork-test a raise far above the
   4.2 ETH graduation threshold and verify where excess ETH goes
   (refund? post-grad buying?) before allowing big goals.

### Remaining for P2/P3
Wagmi frontend path + indexer; fork test of oversized raises (above);
WETH fee-flow fork test after real swaps; independent review/audit
before uncapped goals; dynamic factory discovery + churn alarm in ops.

---

## 10. P2 CONTRACT VERIFICATION — 19/19, money path fully proven (2026-09-12)

Plan of record per founder: full build to live; split = **backers 90% /
platform 7% / holder-rewards 3%** (deploy-time factory config); platform
token launches on RHC through our own contracts as a real campaign once
live.

### Unknown #1 CLOSED — oversized raises are safe
A 6.5 ETH pooled buy (goal 6, threshold 4.2): zero ETH stranded or
refunded, the pool absorbed everything and **graduated at birth**
(6.43 collected vs 4.2), backers received **~82.6% of supply**. No goal
caps needed for safety — only for float-design taste. "Graduated at
launch, community owns the float" is a legitimate campaign flex.

### Unknown #2 CLOSED — real fee flow verified at 90/7/3
On-fork: real v3 swaps on the live pool (buy + sell through a callback
swapper), `pokeCollect()` pulled 0.0108 WETH + 28.6k tokens of creator
fees into the FeeSplitter, `distribute()` + claims paid backer/platform/
rewards at exactly 90/7/3 in BOTH assets.

### New pons gotchas (recorded so nobody relearns them)
- **Pons tokens have transfer hooks**: every transfer probes the
  counterparties (`getPool` + `.fee()` staticcalls, try/caught) to
  enforce restrictions. Benign for us (probe-reverts are caught), but
  transfers cost extra gas and traces look scary.
- **`restrictionsEndBlock` is NOT on the `block.number` clock**
  (Arbitrum-stack L1/L2 block split: event said ~25.9M when
  block.number was ~61.3M). Never compare or roll against it naively.
- The factory emits other 4-topic events; match `TokenLaunched` by
  topic0 (`0xdb51ea9a…c4235a`), never by shape.

**Contracts are DONE pending review: 19/19 (15 unit/adversarial + 4
fork incl. launch, oversized raise, real fee flow, CREATE2 prediction).
Remaining to live: deploy script + founder's RHC deployer wallet,
frontend, factory-churn sensor, then capped soft launch.**
