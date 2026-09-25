# ProofLaunch on RHC — X post series

> **2026-09-23, updated 2026-09-25:** Threads A–E and the standalones predate the rev flywheel. Any line that says 90% to backers is STALE. The flywheel split (30% $PLAUNCH burn / 10% platform / the rest to backers) is the v8 factory, which is BUILT BUT NOT DEPLOYED — write it in future tense until `flip-v8.mjs` has run. Today's live v7 factory fixes only 7% platform + 3% (a retired leg that pays holders nothing) and the rest is the creator's budget. Threads F and G are current.


Audience: crypto X. Goal: introduce the pooled-launch model on Robinhood
Chain, weaponize WalletProof's numbers, court the pons creator audience,
and set up the platform-token launch.

**Before posting: refresh the WalletProof numbers** (they're live,
`/v1/rhc/stats?hours=24`) and screenshot the /rhc/check panel + stats bar
for receipts. Numbers below pulled 2026-09-15.

Compliance notes: never promise profit; "earn the fee stream" is the
approved framing (matches the site + disclaimer). Never the word "meme."

---

## Thread A — the reveal (WalletProof). Post this FIRST, before pitching anything.

**A1**
Yesterday on Robinhood Chain: 13,524 token launches.

164 graduated.

We replayed every single trade on-chain.

2 were real.

🧵

**A2**
Not "we think." Replayed. Every buy, every sell, every wallet.

148 of 164 graduations were manufactured — crews of wallets pumping the
curve to graduation, then dumping in synchronized exits (8+ sellers
inside 5 seconds).

**A3**
84% of ALL buy volume on the chain's launchpad comes from 39,144 wallets
we've already tagged in coordinated dumps.

You're not trading against a community. You're the exit liquidity for a
job.

**A4**
We built the tool that sees it: WalletProof.

Paste any token → independent buyers vs crew volume vs one-shot wallets
vs launch bots. Deployer history too: how many launches, how many they
crew-dumped.

Free. No wallet doxxing — counts only.

prooflaunch.fun/rhc/check

**A5**
Why does every launch look like this? Because one person holds the
supply, snipers front-run the curve, and nobody has a reason to stay
past minute one.

The launch model is the scam surface.

So we replaced the launch model. Next thread. 👇

---

## Thread B — the new way (PoolLaunch)

**B1**
What if a token launch had:

— no dev holding supply
— no sniper window
— no trusted operator
— and the community that funded it earning the fee stream, forever?

That's live on Robinhood Chain today. Here's the machine. 🧵

**B2**
It's called a pooled launch.

Backers pool ETH BEFORE the token exists. One transaction creates the
token on pons and buys with the entire pool — snipe-exempt, on the
launch block.

Everyone gets the identical entry. There is nothing to front-run.

**B3**
The contract IS the creator.

Not us. Not the person who filled in the form. An ownerless contract
with no admin key, no pause switch, no upgrade path.

We could not touch backer funds if we wanted to. That's not a promise —
delete-your-keys is not a policy, it's architecture.

**B4**
Two ways to raise:

⚡ OPEN RAISE — ETH goal, unlimited backers, optional whale cap.
Launches when the pool hits the goal.

🎟 SEAT ROUND — N seats, one fixed price. Equal entry, whales impossible
by construction, and the last seat filling IS the launch trigger.

**B5**
Then the part nobody else does:

90% of the creator fee stream goes to the backers. Pro-rata, pull-based,
forever. The contract splits it; no operator has to be alive for anyone
to get paid.

Every launchpad fights over creator revenue. We route it to the crowd
that showed up first.

**B6**
Miss the goal? Refunds open automatically at the deadline. Code, not
support tickets.

Withdraw any time before launch. Full amount. The contract can't say no.

**B7**
This is the platform where launches are verifiable instead of trusted —
on the same chain where we just showed you 90% of graduations are
manufactured.

prooflaunch.fun/rhc

---

## Thread C — the pons revenue angle (for the creator/community audience)

**C1**
pons creators: you already know the tax dial. Up to 10% of every trade,
locked at launch.

Now imagine pointing it at your whole community instead of one wallet.

**C2**
Launch through PoolLaunch and your campaign's contract is the pons
creator. Same 0.0005 ETH launch fee. Same curve, same graduation, same
locked Uniswap v4 liquidity.

One difference: the creator fee stream + your tax lands in a splitter
that pays your backers 90%, pro-rata, forever.

**C3**
"Community takeover" is usually a vibe. This makes it a cash flow.

50 people fund the raise → 50 people share the creator side of every
trade, enforced by a contract none of us can edit.

The token's earliest believers become its payroll. That's a reason to
hold that no chart can give you.

**C4**
And your launch buy is snipe-exempt on the launch block — the pooled
buy happens before any sniper can act, at one price for everyone who
funded it.

The fairest cap table on the chain, by construction.

---

## Thread D — the trustless bots (contracts, not companies)

**D1**
Every launchpad has "bots." Ours can't be turned off. Not by you. Not
by us. Not by anyone.

We believe these are the first trustless launch bots anywhere. 🧵

**D2**
🔥 BURN — an ownerless contract takes its slice of the fee stream, buys
the token (on the curve pre-graduation, straight against the Uniswap v4
pool after), and sends everything to the dead address.

Anyone can crank it. Nobody can stop it. The terms can never change.

**D3**
🌊 POOL FEEDER — mints full-range liquidity with its fee slice and
compounds the position's own trading fees.

The contract that owns the liquidity has NO withdraw function. Not
timelocked. Not renounced. The code to remove it was never written.

**D4**
Configure them at launch: pick percentages, deploy, done. They're
immutable contract state from that moment — verifiable by anyone before
backing a single wei.

"Trust me" is not in the stack.

---

## Standalone bangers (fill gaps between threads)

**S1**
164 tokens graduated on Robinhood Chain yesterday.
2 had real buyers.
We can prove it, trade by trade.
prooflaunch.fun/rhc/check

**S2**
Our pool feeder's liquidity isn't locked by a promise or a timelock.
The contract that owns it has no withdraw function.
You can't rug what you can't touch.

**S3**
90% of creator fees → the backers who funded the launch.
7% keeps the lights on. 3% to holder rewards.
Fixed at creation. No admin key exists to change it.

**S4**
The SOL version of this platform runs on our operations being honest.
The Robinhood Chain version runs on contracts that don't need us to be.
Same product. Better guarantees.

**S5**
A seat round: 8 seats, 0.25 ETH each. Same price, same share, whales
impossible, and the last seat filling IS the launch trigger.
Fair launches aren't a claim anymore. They're a data structure.

---

## Thread E — platform token launch (SKELETON — hold until token decisions are made)

**E1** We're launching our own token — through our own contracts, as a
[seat round / open raise], with the exact terms every other creator
gets. Eat your own cooking or don't cook.

**E2** [ticker/name] + the raise terms, screenshot of the campaign page
pre-launch. Terms readable on-chain before anyone deposits.

**E3** Holder utility, decided: (1) the 3% holder-rewards leg from
EVERY campaign flows to holders; (2) creation fees waived for holders
(the contract checks your balance — no application, no list); (3)
creators can token-gate seats on their raises. [Mechanism copy pends
the rewards-vault build; keep "earn the fee stream" framing.]

**E4** [RESOLVED 2026-09-24: the RHC platform token is **$PLAUNCH** (a
different, unrelated $PROOF already trades on RHC — proofon.co). Solana
$PROOF is a separate token on a separate chain and receives nothing from
the RHC flywheel; do not imply otherwise.]

**E5** WalletProof will be pointed at our own launch, live. Judge us
with the same lens we built for everyone else.

---

## Thread F — what shipped (post-dated 2026-09-20; every number has a tx in docs/rhc-receipts.md)

Voice notes: short sentences, no em dashes, no "first", no profit
promises, never the m-word. F3 wants the claim tx as a screenshot from
the explorer, and F2 a screenshot of the FEE PAYOUT picker on /rhc/create.

**F1**
ProofLaunch is live on Robinhood Chain.

Pooled token launches on pons. The community funds the launch, one
transaction creates the token and buys with the whole pool, and the
backers keep most of the creator tax. 30% of it buys and burns $PLAUNCH.
Enforced by contracts with no admin key. Not by us.

prooflaunch.fun

**F2**
New this week: the creator decides what the fee stream pays out in.

ETH in, stock out. Set "holders earn SpaceX" when you create the raise.
Every backer's fee share gets swapped into SPCX on the way to their
wallet, in the same transaction they claim it.

**F3**
It already happened on mainnet.

Campaign RWA TEST. Two seats, 0.02 ETH raise, 3% creator tax. After a
handful of trades a backer claimed. 0.0008 ETH of fees left pons and
landed as 0.01386 SPCX in their wallet, straight out of the Uniswap v4
pool.

Tx 0x5bb1671588c40cfbedb8463a5170ae4aa034fd65e9ad3bb6dc2954177ab342c6

**F4**
Neither our contracts nor our router ever touched the stock. Pool to
wallet, one hop.

The protocol only ever owes ETH. The claimer picks the asset and sets
their own slippage bound. If the pool can't fill, plain ETH is one
click away. Nothing can trap a claim.

**F5**
Tiny numbers. One claim on a test-sized raise. We are not going to
dress that up as volume.

What it proves is the path: pons to splitter to router to v4 pool to
wallet, permissionless at every hop. Nobody at ProofLaunch can pause
it, redirect it, or take a cut that isn't written in the contract.

**F6**
Also shipped: a burn bot and a locked-liquidity feeder that run as
ownerless contracts (anyone can crank them, nobody can switch them
off), wallet-gated team rounds, and 92 tests including forks against
the live pools.

Receipts for every line above, with hashes:
github.com/Based-LTD/prooflaunch/blob/main/docs/rhc-receipts.md

**F7**
Next: our own token, launched through these same contracts, on the
same terms every creator gets.

Soon.

---

## Thread G — where we are, and what's next (drafted 2026-09-21, post after Thread F)

Voice: short sentences, no em dashes, no "first", no dates promised,
never the m-word, no profit language. G6 is optional; it is the REKT-crew
post and only works if it's true and plain.

**G1**
Quick update on ProofLaunch on Robinhood Chain. Everything below is live
or on mainnet with a hash.

**G2**
Every launch page now shows the backer roster: every wallet, what it put
in, and after launch whether it's still holding. Read from the contract,
not self-reported. If a genesis wallet dumped, you can see it.

**G3**
Also live: a chat room per launch (one wallet signature to post), the
creator's track record on every page, and banners. The page now looks
like the one on the SOL side, because it does the same job.

**G4**
Built and tested, waiting on the next contract generation:

Backers who sell stop earning. Sell half, earn half. Sell all, your
share goes to platform token stakers.

And a pre-launch lock. Pick it when you take a seat. Your tokens stay in
the campaign contract until the date. Visible to everyone before launch.
Nobody can shorten it, including us.

**G5**
Our own token is next, launched through these same contracts on the
same terms as every creator.

Zero dev allocation. One public seat from our known wallet, locked for a
year. Holders earn the fee stream in SpaceX.

Ticker and date when the contracts are verified. Not before.

**G6 (optional, the receipts post)**
We combed our public repo today before the token. Found a test wallet's
key sitting in a script since July. Wallet held under a cent. Key
removed, history scrubbed, tool now reads from the environment.

Saying it because the roster does the same thing to backers. Rules
apply to us first.

**G7**
Contracts, receipts, findings, and the test suite are all public:
github.com/Based-LTD/prooflaunch

prooflaunch.fun
