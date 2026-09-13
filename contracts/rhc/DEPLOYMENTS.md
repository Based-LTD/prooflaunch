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
