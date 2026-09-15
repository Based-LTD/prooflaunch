# PoolLaunch Deployments

## Robinhood Chain mainnet (chain 4663)

| Contract | Address | Deployed | Notes |
|---|---|---|---|
| CampaignFactory v1 | `0x74Fa741f5E4F0089227cb1ce45B1d00c9698388d` | 2026-09-13 | backers 90% / platform 7% / holder-rewards 3%. Live-verified: bps + recipients read back correct. |

Legs:
- platform (7%): `0xD994AE0945c787A487c6dbd5188512E358986E29` (founder Phantom EVM)
- holder-rewards (3%): `0x6ca08565CAf4f5CaAfB4BfeeCEcE6E0Ea3c65dcB` (dedicated account; future platform-token buyback feed)

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
| CampaignFactory v3 | `0xE2989dA79b04d64D9d68f476b6Ee8f971467b470` | 2026-09-14 | ACTIVE. burnBps + lpBps (FeedLPLeg: full-range POL locked by construction, fee-compounding) + vault legs. 19,695 bytes runtime. |
| CampaignFactoryV2 (v4) | `0x552db842cdB40ea73Dcac6cfAe15AF1E03405a9D` | 2026-09-14 | ACTIVE. Targets **pons V2** — the live pons generation (3,640 launches/100k blocks vs 24 on V1): adjustable creatorTaxBps (cap read live from pons, 1000 = 10%), pons-native buybackEnabled, native-ETH fee flow (curve → FeeEscrow → FeeSplitterV2.harvest, all pull-based), curve refund on oversized raises claimable pro-rata (excessAtLaunch). Vault + airdrop legs; trustless Burn/FeedLP legs stay on v3 until their Uniswap-v4 ports. 5/5 fork tests vs live pons V2. |

pons V2 targets (extracted from the pons frontend bundle, verified on-chain
2026-09-14 — they rotate; re-extract from the app bundle if launches fail):
- V2 factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (maxCreatorTaxBps 1000)
- LaunchAndBuy: `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` (atomic create+buy, snipe exemptions)
- FeeEscrow: `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` (creator fees pull here)
- memeHook (v4): `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` — curve→escrow sweep is gated to its feeSweepOperator (pons' bot; their protocol share rides the same sweep)

Fork suites hammer the RPC — run with `--threads 1` or parallel forks trip
Cloudflare and fail spuriously.
| LegDeployerV2 | `0x42a2495D9426fd5d88A01e724E62275DCe02dfF4` | 2026-09-14 | Carries the v4 bot legs' creation code (EIP-170). |
| CampaignFactoryV3 (v5) | `0xa5aC43cd8ff09e294240E97c2a63466B2c2a80E8` | 2026-09-14 | ACTIVE. pons V2 + trustless bot legs on Uniswap v4: BurnLegV2 (dual-phase: curve buy pre-grad, direct PoolManager swap after), FeedLPLegV2 (full-range locked-by-construction v4 position, fee-compounding; accumulates during curve phase). Graduation cranks proven PERMISSIONLESS. 21,447 bytes. Full suite 26/26. Deploy gotcha: forge's default EIP-1559 max-fee buffer (2× base) can exceed a thin deployer balance — pin with --legacy --with-gas-price just above base fee. |
| CampaignFactoryV4 (v6) | `0xB86b783ccaCC20746ae9dd33CffE4a205B35E334` | 2026-09-15 | ACTIVE. v5 + creation buy-in: 0.001 ETH exact-fee with createCampaign, forwarded instantly to platform recipient (factory never holds a balance). Waiver hooks (feeWaiverToken/threshold) deployed DORMANT (zero) — redeploy with the platform token address once it exists for on-chain holder waiver. Reuses LegDeployerV2 0x42a2495D…. 6/6 fee-gate tests + fork create→launch. |
