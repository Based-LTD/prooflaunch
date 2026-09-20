# ProofLaunch on Robinhood Chain — Receipts

Every claim we make, next to the on-chain fact that backs it. Read this
with an explorer open. Anything not on this page is not a claim.

Chain: Robinhood Chain, id 4663 (Arbitrum Orbit L2).
Explorer: `https://robinhoodchain.blockscout.com/{tx,address}/…`
Repo: `github.com/Based-LTD/prooflaunch`, contracts in `contracts/rhc/`.
Snapshot: 2026-09-19.

---

## 0. What is and is not live — read this first

| | Status |
|---|---|
| Campaign factory v6 (creates every campaign today) | **Live** |
| Trustless **burn** bot | **Live and executed on mainnet** (once — see §3). Live leg carries review finding F1 (per-call cap); fixed in v3 legs for v7 |
| Trustless **pool-feeder** bot | Deployed as code, fork-proven, **never created by a mainnet campaign** |
| v7 factory (team rounds, token gating, ERC20/stock-quoted raises) | Built, 4/4 on live fork, **not deployed** |
| EquityRouter ("get paid in stock") | Built, 7/7 on live fork against real pools, **not deployed** |
| Per-campaign equity payouts (`claimBackerAs` / `claimLegAs`, creator's default `payoutAsset`) | Built into v7's FeeSplitterV3, 5/5 on live fork (real MSFT + SPCX from a campaign's fees), **not deployed** — needs the router's mainnet address at deploy |
| RewardsVault + `claimAs` | Built, 14/14, **not deployable** until the platform token exists (immutable `stakeToken`) |
| Platform token on RHC | **Does not exist yet** |
| Security review | **Self-review with receipts done 2026-09-19** — 10 findings, 6 fixed with tests, 2 accepted with rationale, 2 deferred: `docs/rhc-review-findings.md`. **No independent human review yet.** Brief: `docs/rhc-review-scope.md` |
| Holder-snapshot airdrop leg | **Operated by us, not trustless** — labelled as such wherever it appears |

UI caps raise goals at 2 ETH until the review completes.

---

## 1. The design rules being backed

Every row below is evidence for one of these, or an honest exception.

1. The platform never holds user funds. No owner, admin, pause or
   upgrade on any contract. The deployer was a throwaway.
2. Every post-launch action is a permissionless crank.
3. Funds can never be stranded: refunds open unconditionally at
   deadline + 3-day grace if launch never happened.
4. All distribution is pull-based. No recipient can grief another.

Known exception to (1)/(2): the 📸 airdrop leg is platform-run.

---

## 2. Live contracts

| Contract | Address | Fact |
|---|---|---|
| **CampaignFactory v6** (active) | `0xB86b783ccaCC20746ae9dd33CffE4a205B35E334` | `creationFee()` = 0.001 ETH, `platformBps()` = 700, `holderRewardsBps()` = 300, `campaignCount()` = 1. No owner function exists in the ABI. |
| LegDeployerV2 | `0x42a2495D9426fd5d88A01e724E62275DCe02dfF4` | Carries bot-leg creation code (RHC enforces EIP-170 24,576 B). Nonce 2 → exactly **one** leg contract ever created. |
| Platform fee leg (7%) | `0xD994AE0945c787A487c6dbd5188512E358986E29` | EOA. Founder. |
| Holder-rewards leg (3%) | `0x6ca08565CAf4f5CaAfB4BfeeCEcE6E0Ea3c65dcB` | EOA. Future platform-token buyback feed; will be repointed to RewardsVault by factory redeploy. |
| Airdrop operator (📸) | `0xFd88ee2413514374654eD267A80ebE3319cAB3B9` | EOA, platform-run. The one non-trustless bot. |

Superseded factories (campaigns on them run forever; none create new ones):
v5 `0xa5aC43cd8ff09e294240E97c2a63466B2c2a80E8` · v4 `0x552db842cdB40ea73Dcac6cfAe15AF1E03405a9D` · v3 `0xE2989dA79b04d64D9d68f476b6Ee8f971467b470` · v2 `0x129f7e8FaEab93C4c7E65033Be24ed383eBa6ad5` · v1 `0x74Fa741f5E4F0089227cb1ce45B1d00c9698388d` · LegDeployer (v3) `0xA530b670762A5e82062A8f2256B0d877Afc8eBe4` (nonce 1 → 0 legs).

pons V2 targets we launch through (theirs, not ours; they rotate):
factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` · LaunchAndBuy `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` · FeeEscrow `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` · memeHook `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` · Uniswap v4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`.

---

## 3. Every mainnet campaign, end to end

Two campaigns have ever been created. Both launched. Both are ours (tests).

### `PL TEST` — v6, the full current pipeline

| Step | Receipt |
|---|---|
| Created | tx `0x45208cad2e35c64b79fde3a4a77f35956ec0d667f859e44824587f3dba9a8217`, block 63325015 |
| Campaign | `0x29aeBAE5Aac418dDb2088DF22c3F1FF68c4e2bF6` — goal 0.02 ETH, 2 seats |
| Creator | `0xD994AE0945c787A487c6dbd5188512E358986E29` |
| Funded | `totalRaised()` = 0.02 ETH, `backerCount()` = 2 |
| Launched | tx `0x7a70c268e847f16e3f71ef4f241125142f2c8876176103726b4717ae980c4566`, block 63327961 — one transaction: token created on pons + pooled buy |
| Token | `0xEBb0e11f799668F5cd5cA9F9941934898402CF12` (`PL TEST`, supply 1,000,000,000) |
| Pooled buy | `tokensAtLaunch()` = 11,133,576.43 for `totalRaisedAtLaunch()` = 0.02 ETH |
| Curve | `0xd90eb3450e1232AE6bbc4d7B658149c18a920966` |
| FeeSplitter | `0x4D267d821731BB54A76C2071C4E39858464Ba922` — legs: holder-rewards 300 bps · **burn leg 1000 bps** · platform 700 bps → backers 8000 bps. Immutable at creation. |

### The burn bot, executed on mainnet

| | |
|---|---|
| Leg contract | `0xB3Ef76F1325E54C4c1Fd68eDB4Fa3DDf3e9714cb` (`BurnLegV2`, 4,755 B runtime) |
| Wired to | `campaign()` = `0x29aeBAE5…`, `splitter()` = `0x4D267d82…`, `poolManager()` = `0x8366a39C…` |
| Counters | `totalEthSpent()` = 0.000209 ETH · `totalTokensBurned()` = 120,679.2437 |
| The burn | tx `0xab70fcf896c7d47d8376629f28677e751edcb279a5f57b38ce3f335202b9e830`, block 63352016 — `Transfer(0xB3Ef76F1… → 0x…dEaD, 120,679.2437)` |
| Cross-check | `PL TEST.balanceOf(0x…dEaD)` = 120,679.2437 — matches the counter exactly. 0.0121% of supply. |
| Who cranked it | Anyone could. No owner, no operator, no off switch (`BurnLegV2.sol`). |

Honest scale: this is one crank on a 0.02 ETH test raise. It proves the
mechanism on mainnet; it does not prove volume.

### `PLSMOKE` — v1, the original pipeline

Campaign `0x97eFA9283a805360B698868cF06D015B8b047a04`, created tx
`0xed1dc86e6967a58c021b7e61958d05fd448d9dbb676114eff5e482817264c9e1`,
launched, 0.002 ETH raised, legs 300/700 (no bots on v1).

---

## 4. Trustless bots — what is proven where

| Bot | Mainnet | Fork (live pons pools) | Notes |
|---|---|---|---|
| Burn (`BurnLegV2`) | **Executed**, §3 | `test_fork_burnLeg` | Dual-phase: buys on the curve pre-graduation, swaps direct on PoolManager after |
| Pool feeder (`FeedLPLegV2`) | **Never created** by a real campaign | `test_fork_feedLpLeg` — locked 445,353,007,798,054,306 liquidity units | Full-range position locked by construction: no withdraw function exists |

We believe these are the first trustless launch bots anywhere. We
cannot prove a negative; we say "believe".

---

## 5. Tokenized equity — the part that is measured, not built

**Not our claim to be first.** pons already runs equity-quoted
launches. Payouts from the pons FeeEscrow `0xd3AFEB2a…`, fees only
(inflows exceed the RPC's 10k-log cap, so true totals are higher):

| Asset | Paid out | Recipients | ≈USD |
|---|---|---|---|
| MSFT `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | 1,362 | 1,857 | $677k |
| META `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` | 540 | 1,474 | $379k |
| LLY `0x8005d266423c7ea827372c9c864491e5786600ea` | 216 | 690 | $246k |
| SNAP `0xF6589F11Bc40b669e584073F428B05562F568733` | 33,696 | 952 | $194k |

Depth, measured in Uniswap **v4** (the v3 pools for these assets are
near-empty — measuring them gives a wildly wrong answer):
PoolManager holds 20,515 ETH; MSFT 1,848 (30.6% of supply), META 2,050
(44.2%), SPCX 20,101 (30.4%), SNAP 45,314 (34.3%), LLY 311 (17.0%).

What *is* ours, and **not yet deployed**: pooled community raises (pons
is single-creator), and letting the *claimer* choose the asset their
ETH entitlement arrives as — at every claim surface: a campaign's
backers and legs (`FeeSplitterV3.claimBackerAs` / `claimLegAs`, with a
creator-set default that never locks anyone in) and $PROOF stakers
(`RewardsVault.claimAs`). `EquityRouter` + both surfaces: 19/19 on a
live fork against the real pools. Measured all-in routing
cost at ~$122: SPCX 0.5%, MSFT 1%, META 5%, LLY 6%. Pool keys and fee
tiers: `contracts/rhc/RWA_POOLS.md`. The protocol only ever owes ETH;
the recipient does the swap. No allowlist of assets exists on-chain.

---

## 6. Tests

92 tests / 16 suites, all green including every fork suite. The `Review`
suite is one test per review finding (`docs/rhc-review-findings.md`). Fork suites run against live pons and live v4 pools:
`ForkDeep` (burn leg, pool-feeder leg, oversized raise, real fee flow
at 90/7/3), `ForkV3` (USDG-quoted, SPCX-quoted, every pons-approved
stock, native seat round), `EquityRouter`, `RewardsVaultClaimAs`,
`Vanity` (CREATE2 signature addresses). Fork suites hammer the RPC;
run with `--threads 1`.

---

## 7. Things we have gotten wrong and corrected (so you don't have to find them)

- Docs and audit page named factory v4 as "active" until 2026-09-19;
  it was v6. Fixed.
- We measured equity liquidity in Uniswap v3 and concluded the market
  was tiny and MSFT unbuyable. Wrong venue. v4 numbers above.
- An early holder count of "23,632 MSFT wallets" counted routers and
  bots; it is an activity number, not a holder number. Not used here.
- Two brand names ("PoolLaunch"/"ProofLaunch") on one site until
  2026-09-19. One name now.

Reproduce any number here: `tools/_receipts-facts.mjs`,
`tools/_bot-census.mjs`, `tools/_leg-receipt.mjs`,
`tools/_pons-equity-launches.mjs`, `tools/_rwa-poolkeys.mjs`.
