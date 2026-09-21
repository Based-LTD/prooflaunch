# PoolLaunch Deployments

## Robinhood Chain mainnet (chain 4663)

| Contract | Address | Deployed | Notes |
|---|---|---|---|
| CampaignFactory v1 | `0x74Fa741f5E4F0089227cb1ce45B1d00c9698388d` | 2026-09-13 | backers 90% / platform 7% / holder-rewards 3%. Live-verified: bps + recipients read back correct. |

Legs:
- platform (7%): `0xD994AE0945c787A487c6dbd5188512E358986E29` (founder Phantom EVM)
- holder-rewards (3%): `0x6ca08565CAf4f5CaAfB4BfeeCEcE6E0Ea3c65dcB` (dedicated account; future platform-token buyback feed)

**Source verification (2026-09-21):** EquityRouter, LegDeployerV3, CampaignFactoryV5 (v7) + CampaignDeployerV3, CampaignV3 + FeeSplitterV3 (RWA TEST), CampaignFactoryV4 (v6), LegDeployerV2 — all `exact_match` on Sourcify (chain 4663), submitted with `verify.sh`. Blockscout's API is Cloudflare-walled; it imports Sourcify matches.

Deployer: `0xC571bf9770c147c7643f87366B2e6D99f736c58A` — throwaway, no
post-deploy authority (contracts are ownerless). Keystore at
`~/.rhc-deployer/` may be discarded.

Pons integration targets at deploy time (they rotate — rediscover via
TokenLaunched topic scan before pointing new UIs at them):
- pons factory: `0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75`
- pons locker: `0x10F2756e373bAb14999fdC9177587D51D30a1Cf5`

Factory upgrades: deploy a new CampaignFactory and point the frontend at
it; existing campaigns keep their immutable terms forever.

| CampaignFactory v2 | `0x129f7e8FaEab93C4c7E65033Be24ed383eBa6ad5` | 2026-09-14 | Adds creator bot legs: burnBps (deploys ownerless BurnLeg per campaign — buy-and-burn from fees on the pons v3 pool) + vault legs. Same 90/7/3 platform floor; backer share = 90% − bots. WETH `0x0Bd7D308...`, v3 factory `0x1f7d7550...`, fee tier 10000. v1 remains read-only in the UI (its campaigns are immutable and keep working). |
| LegDeployer | `0xA530b670762A5e82062A8f2256B0d877Afc8eBe4` | 2026-09-14 | Carries bot-leg creation code (EIP-170: RHC enforces 24KB; monolithic v3 failed on-chain at 27.5KB). |
| CampaignFactory v3 | `0xE2989dA79b04d64D9d68f476b6Ee8f971467b470` | 2026-09-14 | Superseded by v6 (its campaigns run forever). burnBps + lpBps (FeedLPLeg: full-range POL locked by construction, fee-compounding) + vault legs. 19,695 bytes runtime. |
| CampaignFactoryV2 (v4) | `0x552db842cdB40ea73Dcac6cfAe15AF1E03405a9D` | 2026-09-14 | Superseded by v6 (its campaigns run forever). Targets **pons V2** — the live pons generation (3,640 launches/100k blocks vs 24 on V1): adjustable creatorTaxBps (cap read live from pons, 1000 = 10%), pons-native buybackEnabled, native-ETH fee flow (curve → FeeEscrow → FeeSplitterV2.harvest, all pull-based), curve refund on oversized raises claimable pro-rata (excessAtLaunch). Vault + airdrop legs; trustless Burn/FeedLP legs stay on v3 until their Uniswap-v4 ports. 5/5 fork tests vs live pons V2. |

pons V2 targets (extracted from the pons frontend bundle, verified on-chain
2026-09-14 — they rotate; re-extract from the app bundle if launches fail):
- V2 factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (maxCreatorTaxBps 1000)
- LaunchAndBuy: `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` (atomic create+buy, snipe exemptions)
- FeeEscrow: `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` (creator fees pull here)
- memeHook (v4): `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` — curve→escrow sweep is gated to its feeSweepOperator (pons' bot; their protocol share rides the same sweep)

Fork suites hammer the RPC — run with `--threads 1` or parallel forks trip
Cloudflare and fail spuriously.
| LegDeployerV2 | `0x42a2495D9426fd5d88A01e724E62275DCe02dfF4` | 2026-09-14 | Carries the v4 bot legs' creation code (EIP-170). |
| CampaignFactoryV3 (v5) | `0xa5aC43cd8ff09e294240E97c2a63466B2c2a80E8` | 2026-09-14 | Superseded by v6 (its campaigns run forever). pons V2 + trustless bot legs on Uniswap v4: BurnLegV2 (dual-phase: curve buy pre-grad, direct PoolManager swap after), FeedLPLegV2 (full-range locked-by-construction v4 position, fee-compounding; accumulates during curve phase). Graduation cranks proven PERMISSIONLESS. 21,447 bytes. Full suite 26/26. Deploy gotcha: forge's default EIP-1559 max-fee buffer (2× base) can exceed a thin deployer balance — pin with --legacy --with-gas-price just above base fee. |
| CampaignFactoryV4 (v6) | `0xB86b783ccaCC20746ae9dd33CffE4a205B35E334` | 2026-09-15 | ACTIVE. v5 + creation buy-in: 0.001 ETH exact-fee with createCampaign, forwarded instantly to platform recipient (factory never holds a balance). Waiver hooks (feeWaiverToken/threshold) deployed DORMANT (zero) — redeploy with the platform token address once it exists for on-chain holder waiver. Reuses LegDeployerV2 0x42a2495D…. 6/6 fee-gate tests + fork create→launch. |

## 2026-09-20 — v7 generation + EquityRouter (LIVE)

Prod built with `NEXT_PUBLIC_V7_LIVE=1` / `NEXT_PUBLIC_EQUITY_ROUTER_LIVE=1` (build-time flags — every prod deploy must carry them). v7 creates every new campaign from this date; v6 is superseded. Constructor args verified by live read-back (`tools/_verify-v7-deploy.mjs`).

| Contract | Address | Tx / block | Notes |
|---|---|---|---|
| EquityRouter | `0x0A568a0AdcC45F8f6597f0219df39FA9ACA82943` | `0x41d97f246282a526520e9b9d6a2d84aaa06d0cfcb2bf1abfe42383f15e26e49d` · 68239958 | ETH in, any ETH-paired v4 asset out. No asset allowlist by design. 2,370 B. |
| LegDeployerV3 | `0x518B6b80736af35D25F98Cc403A7f2dD8a0763AB` | `0x808eac3fd2af5202d326419fb85047b29d3f925d6a0f2190bbb87ab4e9b0ee2e` · 68241203 | Carries BurnLegV3 + FeedLPLegV3 (one crank per block; ticks derived from spacing — review F1/F2/F4). |
| CampaignFactoryV5 (v7) | `0x6928C1Ace232124641e9cfFEfD16D82E1B9c531B` | `0x1eb80c0235d3b0766ecf59c5c8a0d17f814911f670d2df48968872050ad5291c` · 68241233 | Team rounds, token gating, ERC20/stock-quoted raises, CREATE2 5EED, creation fee 0.001 ETH, `equityRouter` immutable = router above. Holder-rewards still → EOA `0x6ca08565…` (vault gated on platform token). Its constructor deployed the satellite below. |
| CampaignDeployerV3 | `0xdDCf167F6DA48e8f6C1fC716fDFef4CCEEBd4fe3` | (same tx as factory) | CREATE2 satellite carrying CampaignV3 creation code (EIP-170). `factory()` = v7. 22,128 B. |

Deploy gotchas learned: Foundry loads `.env` from the SHELL cwd, not `--root` — run from `contracts/rhc/`. Forge resolves the script path against cwd too. Deployer `0xC571bf97…` funded 0.002768 → spent ≈0.00093 across both.


## v8 — the rev flywheel (rebuilt 2026-09-22, NOT DEPLOYED)

Founder decisions 2026-09-21/22: pivot to "rev meta". Two fixed legs on every
campaign's creator tax, immutable in the factory and every splitter:
**proofBurnBps → ProofBurner** (buys the platform token, burns it) and
**platformBps → platform** (~10%). Backers get the remainder after the
creator's optional coin-burn / pool-feeder / vault legs. Sellers' forfeited
shares (hold rule) and every creation fee go to the burner too. The
RewardsVault / staking plan is retired — burns and yield compete for the
same ETH and burns are the meta.

| Contract | Status | Notes |
|---|---|---|
| `ProofBurner` | built, 9 unit + 3 live-fork tests | `BurnLegV3` with a fixed target: reads the platform token's own (launched) campaign at construction; `initializer = address(0)` so `init()` is unreachable. `pull(splitter)` / `pullMany` collect the ETH leg from any splitter (raw call, result ignored, only arriving ETH counts); `pullCampaignToken` burns foreign token-side fees; `crank()` burns held PROOF and buys+burns up to 0.2 ETH per block via the pons curve or the v4 pool. No withdraw, no owner, no retarget. Fork-proven on live pons V2: curve phase, v4 phase, and pulling a 30% leg from another campaign's splitter. |
| `FeeSplitterV4` | built, 14 tests | Hold-weighted claims (sellers forfeit to `forfeitTo` = the burner); `settle()` crank; `backerOwed()` for the UI. Vault-stake path removed. |
| `SplitterDeployerV4` / `CampaignV4` | built, 6 lock tests | Pre-launch lock; `forfeitTo = legs[0]` = the burner. |
| `CampaignFactoryV6` (v8) | built | ctor: `platformFeeRecipient, proofBurner, platformBps, proofBurnBps, …`; creation fee → burner; legs order: burner FIRST, coin burn?, lp?, vaults…, platform LAST. |
| `script/DeployProofBurner.s.sol` | ready | env `PROOF_CAMPAIGN` (the launched platform-token campaign). |
| `script/DeployV6.s.sol` | ready | env `PROOF_BURNER`, `PLATFORM_BPS` (e.g. 1000), `PROOF_BURN_BPS` (e.g. 3000), `EQUITY_ROUTER`, `LEG_DEPLOYER`. |

**Deploy order (forced by immutables):** platform token launches on v7 with a
heavy coin-burn leg (`BurnLegV3` buys the campaign's own token = a PROOF
burn from day one) → `DeployProofBurner` → `DeployV6` → UI flips.

**Owed before deploy:** the split numbers (founder), the fee-card / audit
page reading `proofBurner()` + a live "fees → burned" ticker from the
burner's counters, explorer verification day-of, external review of
`ProofBurner` (the review brief has the questions).

Frontend (done 2026-09-21): the campaign page probes `forfeitTo()`; on a
v8 splitter it reads `backerOwed` + `heldBps`, scales the projected
collect by hold, shows a hold line on the fee card and words a zero-paid
claim as "went to the holder-rewards leg". Held = wallet + unclaimed
(incl. pre-launch lock) + staked in the rewards vault when the campaign's
token is the vault's stake token (raw staticcall; an EOA recipient answers
zero). Still owed before deploy: fork test against the live router
(`ForkClaimBackerAs` is V3-only) and explorer verification on deploy day.

Known edge, stated in the contract header: without a `settle` crank a
seller can buy back just before claiming. The crank is permissionless and
the vault (or anyone) can run it; the pons round trip costs ~8% at a 3% tax.
