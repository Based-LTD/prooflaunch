# $PROOF launch + v8 runbook

Everything up to step 1 is already on prod and dark behind env flags.
The order is forced by immutables: the burner needs the token's campaign,
the factory needs the burner. Nothing here can be reordered.

Decisions on record (2026-09-24): ticker **$PLAUNCH** (a PROOF already
exists on RHC — proofon.co); **seat round: 20 seats × 0.05 ETH = 1 ETH**
(≈36% of supply to the seats on the live pons curve, 1.8% per seat, ≈$135
at ETH $2,700); **5 reserved TEAM seats** on the allowlist (named founder
wallets, tagged TEAM on the roster, disclosed in the post as held — v7 has
no on-chain lock, so it is a promise the roster lets everyone watch), 15
public; 30% PROOF burn / 10% platform fixed on every launch after this one
(this one is v7: 7/3); creator tax 3% (traders pay 4% with pons' 1%);
payout asset SpaceX; Burn Heavy
preset. The v7 3% holder-rewards leg is dead — no real launch ever fed it.

## Rehearsed 2026-09-22

- `test/ForkV8Lifecycle.t.sol`: the whole day against live pons on a mainnet
  fork — $PROOF on the live v7, burner, v8 factory, a v8 campaign with a
  locked seat, real trades, sweep, harvest at 30/10, a seller's forfeit,
  the 1.5× lock weight, claim-as-SPCX through the live router, pull, crank,
  $PROOF at 0x…dEaD, lock released on schedule. PASS.
- `deploy-v8.sh` executed for real against an anvil fork (RWA TEST as the
  stand-in campaign, impersonated deployer): both scripts ran, the burner
  address fed forward, the factory read the token from the burner,
  v8.addresses.json written. `tools/flip-v8.mjs --check` against that fork:
  6/6 green. To repeat:
  `anvil --fork-url https://rpc.mainnet.chain.robinhood.com` then
  `bash deploy-v8.sh "--unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" <env file> http://127.0.0.1:8545`
  and `RHC_RPC_URL=http://127.0.0.1:8545 node tools/flip-v8.mjs --check`.
- Not yet rehearsed: the UI pointed at a v8 fork (create → lock → launch →
  claim → crank in a browser). Founder + test wallet needed.

## 0. Before the day

- [ ] Ticker, name, logo (square), banner (3:1), description, socials.
- [ ] Seat round: 20 seats × 0.05 ETH (goal 1 ETH). Team round with
      reservedSeats = 5 and the allowlist = the five team wallets, each
      funded with 0.05 ETH + gas from a DISCLOSED source. Public seats 15.
- [ ] Creator tax for $PLAUNCH itself: **3%** (founder decision 2026-09-24;
      4% to the trader with pons' 1%). Enter links WITH https:// — the form
      now adds it, but check the review modal before confirming.
- [ ] Deployer wallet `0xC571…c58A` funded. The factory + two satellites
      are the expensive deploy (v7 was the same shape); check the live
      gas price and budget generously — 0.01 ETH at 0.1 gwei is plenty.
- [ ] `contracts/rhc/.env` filled from `env.example` (PLATFORM_RECIPIENT,
      EQUITY_ROUTER, LEG_DEPLOYER, PLATFORM_BPS=1000, PROOF_BURN_BPS=3000).
- [ ] The post is drafted and NOT sent (Thread F/G in docs/x-launch-threads.md).

## 1. Launch $PLAUNCH on v7 (the live factory) — from the website

1. prooflaunch.fun/rhc/create, connected as a **fresh launcher wallet**
   (gas only, never trades). Axiom and friends tag the wallet that signs
   the launch tx as the "DA", not pons' deployer (the contract). RWA TEST
   showed `0xD533…` as DA because it launched AND sat AND sold. A clean
   launcher reads as: dev holds 0, dev never sold. The founder's known
   wallet takes its seat as a backer in step 4.
2. Preset **Burn Heavy** (coin burn 30%). On v7 that BURN leg buys and
   burns $PROOF itself from the first trade — the flywheel starts before
   v8 exists. (Fixed legs on v7 are 7% platform + 3% holder-rewards → the
   two founder wallets; that is documented on the audit page.)
3. FEE PAYOUT: SpaceX. Tax: 3%. RAISE STYLE: seats, 20 × 0.05 ETH,
   reserved seats 5, allowlist = the five team wallets.
4. Review modal → confirm → wallet. On the success screen, sign ONCE to
   attach the banner + GitHub link (the dry run on 09-24 skipped this and
   the page had no banner). Then open the campaign page and read the
   METADATA card top to bottom before sharing the link.
   Take the five TEAM seats from the five
   allowlisted wallets (one is the known `0xD533…`); they show on the
   roster tagged TEAM. Fifteen public seats fill from the room.
   v7 campaigns have no lock, so the founder seat's "locked a year" is a
   public commitment (say it in the post) enforced by not claiming; v8
   campaigns enforce it on-chain.
5. When the raise fills, Launch from the launcher wallet. Record: campaign address, token address,
   curve, splitter, launch tx → `docs/rhc-receipts.md`.
6. Set `PROOF_CAMPAIGN=<campaign address>` in `contracts/rhc/.env`.

## 2 + 3. Deploy the burner, then v8 — one command

```bash
cd contracts/rhc && bash deploy-v8.sh "--keystore ~/.rhc-deployer/<keystore file>"
```
Deploys ProofBurner against `PROOF_CAMPAIGN`, feeds its address into the
factory deploy (the factory also reads the $PROOF token from the burner
for the hold-to-launch-free hook; `FEE_WAIVER_THRESHOLD` env, 0 = dormant),
and writes `v8.addresses.json`. The burner constructor reverts
`NotLaunched` if $PROOF hasn't launched — it cannot be run early.

## 4. Verify (Sourcify; Blockscout imports it)

Add to `verify.sh`: ProofBurner, CampaignFactoryV6, CampaignDeployerV4,
SplitterDeployerV4, the $PROOF CampaignV3 + FeeSplitterV3 instances. Run
`bash verify.sh`. All must be `exact_match`. Then update `DEPLOYMENTS.md`.

## 5. Flip the UI — one command

```bash
node tools/flip-v8.mjs          # add --check to only verify
```
Reads `v8.addresses.json`, verifies every address against the chain
(factory → burner → $PROOF token, bps, satellite; refuses on any mismatch),
sets the three Vercel production env values, and runs the prod deploy with
them. The $PROOF CA is never typed by hand: the UI reads it from the burner.
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

- $PROOF's own campaign is v7, so its splitter has the old 7/3 legs (both
  founder wallets) instead of 30/10. It is the one campaign that predates
  the flywheel; its 30% coin-burn leg burns $PROOF anyway. Disclosed on the
  audit page.
- GitHub support purge of the orphaned commit (from the 09-21 comb).
- External review of ProofBurner — the brief already has the questions.
