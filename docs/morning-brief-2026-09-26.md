# Morning brief — 2026-09-26 (for the 10 AM Space)

Numbers read directly from chain + Dexscreener at 05:06 UTC. Every tx is
in `docs/rhc-receipts.md` §7.

## What happened while you slept

- **Keeper is live and proven.** Your key landed, deploy went Ready, and
  the first cron tick cranked on its own at **05:01:33 UTC**: $SMOKE's
  coin-burn leg, 0.011181 ETH → 5,326,275 $SMOKE, sent by the keeper
  wallet (`0xC571…c58A`). At 05:06 the keeper's report showed **zero
  pending actions** everywhere: nothing at pons, nothing owed to any leg,
  burner empty. It has caught the whole system up. Nobody has to crank
  anymore; anyone still can.
- **No new $PLAUNCH burns after 04:29 UTC** because there was nothing
  left to burn: all tax was harvested and cranked. New burns arrive as
  new trades create tax, in ≤5-minute steps.
- **Seats: 19 of 20 claimed** (was 13 when you went down). One seat's
  tokens (18,176,032 $PLAUNCH) still sit in the campaign, unclaimed.
- **Deployer/keeper gas: 0.0594 ETH.** Fine for days at current volume.
  Refill when it nears 0.02.

## The scoreboard (say these numbers out loud)

| | |
|---|---|
| Raise | 20 seats × 0.05 ETH = 1 ETH, filled, launched 2026-09-25 ~21:00 UTC |
| Graduated | 03:15:23 UTC, ~6 h after launch, straight to Uniswap v4 |
| Dexscreener | auto-listed in 90 s with logo + socials; price $0.0000544, FDV $52.3k, liquidity $22.4k, 24h volume $12.3k, 277 txns |
| Burned to 0x…dEaD | **37,729,482 $PLAUNCH = 3.77% of supply** |
| …by the token's own coin-burn leg | 16.91M, 0.202 ETH spent, 6 cranks |
| …by the v8 ProofBurner | 2.64M, 0.043 ETH spent (seeds + $SMOKE's 30% leg) |
| …sent direct (seat 1 burned) | 18.18M |
| Who cranked | keeper/deployer 6, backer `0x143b…` 2, stranger `0x4a00…` 1 |
| Fee escrow for backers | 0.4495 ETH accounted, 0.404 ETH in the backer pool |
| Platform leg (`0xD994…`) | 0.0471 ETH claimable |
| Retired 3% leg (`0x6ca0…`) | 0.0202 ETH claimable |
| Dev holds | 0 (launcher wallet held nothing; seat 1 went to dead) |

Reproduce: `curl https://prooflaunch.fun/api/rhc/flywheel` and
`curl https://prooflaunch.fun/api/rhc/keeper`.

## Decisions waiting on you (none urgent)

1. **Claim the platform leg + retired leg** (0.067 ETH total) to
   `0xD994…` whenever you want; it accrues either way.
2. **Nudge the last unclaimed seat.** One backer hasn't claimed. Tokens
   never expire in the campaign; a DM is the only lever.
3. **Solana FAQ pointer** on the RHC docs ("Is this the same platform as
   the Solana site?"): keep or kill. It's the one remaining Solana mention.
4. **Axiom Pulse** still won't show contract-launched tokens; it indexes
   ours on-demand only. Nothing to do on our side; the Dexscreener listing
   is the discovery surface that works.

## Still owed by me (not blocking anything)

- Reown AppKit swap for a nicer wallet modal (WalletConnect already works).
- External review of ProofBurner (self-reviewed, unaudited; say so if asked).
- Regrind the `pooL` vanity pool on the Solana side (3 left).
- Word cull on the create page and docs.

## Space talking points, refreshed with tonight's numbers

**Open:** "We launched our own platform token on our own platform
yesterday, and I want to walk you through what happened on chain, in
order, because all of it is public."

1. **The raise.** 20 seats at 0.05 ETH. Five were disclosed team seats. 1
   ETH pooled, launched atomically, nobody got a different price than
   anyone else. The launcher wallet held zero tokens; seat 1's allocation
   was sent to the dead address.
2. **Six hours to graduation.** Bonded off the pons curve at 4.2 ETH and
   moved to Uniswap v4 automatically. Dexscreener picked it up in 90
   seconds with our logo and links. No listing form, no fee.
3. **The burn is real and you can count it.** 37.7 million $PLAUNCH,
   3.77% of supply, at the dead address after one night. Three sources,
   all on chain: the token's own burn leg (every $PLAUNCH trade taxes
   itself and buys itself back), the v8 ProofBurner (every launch on the
   platform sends 30% of its tax to buy and burn $PLAUNCH), and one
   direct send.
4. **Nobody has to run it.** Every step is a public function on an
   ownerless contract. Last night a backer cranked twice and a wallet
   I've never seen cranked once. Then we added a keeper: a cron that
   presses the same public buttons every five minutes from a gas-only
   wallet. It made its first crank at 5 AM UTC with nobody awake. If we
   disappeared, anyone could keep cranking; if nobody did, the keeper
   would.
5. **Backers earn from day one.** 0.45 ETH of trading tax already flowed
   through the fee splitter; 0.40 ETH of that belongs to the 20 seat
   holders, pro-rata, claimable any time. That's on a 1 ETH raise, in one
   night.
6. **Why RHC.** Yes, Solana was first for us. RHC is where this design
   fits: contracts can hold the fee stream trustlessly, a launch is one
   atomic transaction, Uniswap v4 hooks let pons route tax without a
   trusted server, and tokenized stocks live on the same chain, so a
   launch can pay its backers in equity. We measured that; we didn't
   guess.
7. **What's next (v8, live now).** Lock your seat for a longer window and
   your share of the fee pool weighs ×1.25 or ×1.5. Locks only get
   longer. Creators can take up to 20%, disclosed on the card as CREATOR.
   Test tokens are marked TEST TOKEN in red so nobody confuses them.

**Honest caveats if asked:** ProofBurner is self-reviewed, not externally
audited. The keeper is a convenience, not a dependency. Liquidity is
$22k; it's a day-old token.

**Close:** "Everything I just said has a transaction hash. They're all in
the receipts doc on the site. Go check me."
