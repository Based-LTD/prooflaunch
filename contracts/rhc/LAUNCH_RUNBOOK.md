# $PROOF launch + v8 runbook

Everything up to step 1 is already on prod and dark behind env flags.
The order is forced by immutables: the burner needs the token's campaign,
the factory needs the burner. Nothing here can be reordered.

Decisions on record (2026-09-22): 30% PROOF burn / 10% platform, fixed;
backers get the rest; locking pays (×1.25 at 180d, ×1.5 at 365d); zero dev
allocation; founder takes ONE public seat, locked a year; payout asset
SpaceX. Ticker and raise style are still yours.

## 0. Before the day

- [ ] Ticker, name, logo (square), banner (3:1), description, socials.
- [ ] Raise style: seat round (N seats × price) or open raise. Goal ≤ 2 ETH
      (the beta cap) unless external review has lifted it.
- [ ] Creator tax for $PROOF itself: **5%** is my recommendation — high
      enough that its own burn leg is visible, low enough to trade.
- [ ] Deployer wallet `0xC571…c58A` funded. The factory + two satellites
      are the expensive deploy (v7 was the same shape); check the live
      gas price and budget generously — 0.01 ETH at 0.1 gwei is plenty.
- [ ] `contracts/rhc/.env` filled from `env.example` (PLATFORM_RECIPIENT,
      EQUITY_ROUTER, LEG_DEPLOYER, PLATFORM_BPS=1000, PROOF_BURN_BPS=3000).
- [ ] The post is drafted and NOT sent (Thread F/G in docs/x-launch-threads.md).

## 1. Launch $PROOF on v7 (the live factory) — from the website

1. prooflaunch.fun/rhc/create, connected as the founder wallet.
2. Preset **Burn Heavy** (coin burn 30%). On v7 that BURN leg buys and
   burns $PROOF itself from the first trade — the flywheel starts before
   v8 exists. (Fixed legs on v7 are 7% platform + 3% holder-rewards → the
   two founder wallets; that is documented on the audit page.)
3. FEE PAYOUT: SpaceX. Tax: 5%. Team round if you want a reserved seat.
4. Create. Take ONE seat from the founder wallet.
   v7 campaigns have no lock, so the founder seat's "locked a year" is a
   public commitment (say it in the post) enforced by not claiming; v8
   campaigns enforce it on-chain.
5. When the raise fills, Launch. Record: campaign address, token address,
   curve, splitter, launch tx → `docs/rhc-receipts.md`.
6. Set `PROOF_CAMPAIGN=<campaign address>` in `contracts/rhc/.env`.

## 2. Deploy the burner

```bash
cd contracts/rhc
forge script script/DeployProofBurner.s.sol --rpc-url rhc --broadcast --keystore ~/.rhc-deployer/<file> -vv
```
The constructor reverts `NotLaunched` if step 1.5 isn't done. Copy the
printed `ProofBurner` address → `PROOF_BURNER=` in `.env`.

## 3. Deploy v8

```bash
forge script script/DeployV6.s.sol --rpc-url rhc --broadcast --keystore ~/.rhc-deployer/<file> -vv
```
Prints factory v8, campaignDeployerV4, splitterDeployerV4. It reads back
`proofBurner()` and `proofBurnBps()` — check they are the burner and 3000.

## 4. Verify (Sourcify; Blockscout imports it)

Add to `verify.sh`: ProofBurner, CampaignFactoryV6, CampaignDeployerV4,
SplitterDeployerV4, the $PROOF CampaignV3 + FeeSplitterV3 instances. Run
`bash verify.sh`. All must be `exact_match`. Then update `DEPLOYMENTS.md`.

## 5. Flip the UI (no code change)

Vercel → project env (Production), build-time:
```
NEXT_PUBLIC_V8_LIVE=1
NEXT_PUBLIC_POOLLAUNCH_FACTORY_V8=<factory v8>
NEXT_PUBLIC_PROOF_BURNER=<burner>
```
Then deploy with the usual command PLUS those three as `--build-env`.
What lights up, all probe-gated today:
- board: the FLYWHEEL panel (burned / spent / collected / next up, crank button)
- create page: targets v8; budget bar shows PROOF burn 30 / platform 10
- campaign pages: lock picker with ×1.25 / ×1.5, roster lock tags, hold-aware
  fee card, "forfeits burn $PROOF", flywheel panel in the rail on v8 splitters
- audit page: v8 + burner rows

Smoke: create a tiny v8 campaign, take a locked seat, launch, trade once,
`pull()` + `crank()` the burner from a stranger wallet, screenshot the
counters moving. That screenshot is the post.

## 6. After

- The 3% holder-rewards leg on v7 campaigns (incl. $PROOF's own) keeps
  paying the founder EOA. Forward it to the burner by hand and say so, or
  leave it and disclose it. Pick one before the post.
- GitHub support purge of the orphaned commit (from the 09-21 comb).
- External review of ProofBurner — the brief already has the questions.
