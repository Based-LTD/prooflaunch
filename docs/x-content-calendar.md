# X content calendar — PoolLaunch on Robinhood Chain

Two posts a day promoting the launchpad: what it is, how it works,
what's new. NO WalletProof content (held for the reveal — roadmap item).
No profit promises ("earn the fee stream" is the approved framing).
Never the m-word.

Format is machine-read by tools/x-post.mjs: `## D<n>` day blocks,
`### SLOT1` / `### SLOT2` posts. The queue wraps around after the last
day until new content lands. Slot 1 posts ~15:00 UTC, slot 2 ~23:00 UTC.

---

## D1
### SLOT1
There's a new way to launch a token on Robinhood Chain.

No dev holding supply. No sniper window. No trusted operator. The community that funds the launch earns the creator fee stream — forever, enforced by contracts nobody can edit.

prooflaunch.fun/rhc

### SLOT2
How a pooled launch works:

1. Backers pool ETH before the token exists
2. One transaction creates it on pons + buys with the whole pool — snipe-exempt, one price for all
3. Backers claim tokens pro-rata + 90% of the fee stream

That's the whole trick. It's live.

## D2
### SLOT1
On PoolLaunch, the contract IS the token's creator.

Not us. Not the person who filled in the form. An ownerless contract with no admin key, no pause switch, no upgrade path.

We couldn't touch backer funds if we wanted to. That's architecture, not a promise.

### SLOT2
"Snipe-exempt" isn't marketing. The pooled buy executes in the same transaction that creates the token — there is no block where a sniper can act before the community does.

You cannot front-run something that doesn't exist yet.

## D3
### SLOT1
🎟 Seat Rounds: pick a number of seats and one price.

8 seats × 0.25 ETH. Same price, same share, whales impossible by construction — and the last seat filling IS the launch trigger.

Fair launches aren't a claim anymore. They're a data structure.

prooflaunch.fun/rhc/create

### SLOT2
Watch a seat round fill: every block on the grid is one backer, one equal share of the raise and the fee stream.

When the grid fills, the contract launches. No countdowns, no discretion, no "team decided to wait."

## D4
### SLOT1
90% of the creator fee stream goes to the backers who funded the launch. Pro-rata. Forever.

7% keeps the lights on. 3% to holder rewards. Fixed at creation — no admin key exists to change it.

Every other launchpad fights over creator revenue. We route it to the crowd.

### SLOT2
Your fee share is pull-based: it sits in the contract with your name on it until you claim it.

No operator has to be alive for you to get paid. No distribution wallet to trust. No "rewards paused." The splitter is just math that never turns off.

## D5
### SLOT1
⚡ Open Raises: set an ETH goal, and anyone can back with any amount — unlimited backers.

Not a typo. Claims are pull-based, so there's no loop anywhere that grows with backer count. 24 backers or 24,000, the contract doesn't care.

### SLOT2
Worried about whales in an open raise? The creator can cap any single wallet's deposit at creation.

Set it and no wallet can out-back your community. Leave it open and let momentum ride. Creator's choice, locked forever either way.

## D6
### SLOT1
pons creators know the tax dial: up to 10% of every trade, locked at launch, can never be raised.

Launch through PoolLaunch and that tax flows to your backers instead of one wallet.

Same curve. Same graduation. Different beneficiary: everyone who believed first.

### SLOT2
"Community takeover" is usually a vibe.

A pooled launch makes it a cash flow: 50 people fund the raise → 50 people share the creator side of every trade, enforced by a contract none of us can edit.

A reason to hold that no chart can give you.

## D7
### SLOT1
🔥 Our burn bot is an ownerless contract.

It takes its slice of the fee stream, buys the token — on the bonding curve before graduation, straight against the Uniswap v4 pool after — and sends everything to the dead address.

Anyone can crank it. Nobody can stop it.

### SLOT2
Launch bots you can't turn off. Not you. Not us. Not anyone.

Configure the percentages at launch, and they're immutable contract state from that moment — verifiable by anyone before backing a single wei.

We believe these are the first trustless launch bots anywhere.

## D8
### SLOT1
🌊 The Pool Feeder mints full-range liquidity from trading fees and compounds its own earnings.

The contract that owns the liquidity has NO withdraw function. Not timelocked. Not renounced. The code to remove it was never written.

### SLOT2
You can't rug what you can't touch.

Our pool feeder's liquidity isn't locked by a promise, a timelock, or a locker site. The owning contract simply has no function that withdraws principal. Ever.

## D9
### SLOT1
Miss the goal? Refunds open automatically at the deadline. Code, not support tickets.

Every failure path on PoolLaunch ends with backers getting their ETH back — unconditionally, enforced by the contract, with nobody's permission required.

### SLOT2
Your money is yours until the launch transaction fires.

Withdraw your full deposit any time before launch. No fee, no cooldown, no "contact the team." The contract can't say no — the function is public.

## D10
### SLOT1
What if a raise overshoots? Nothing breaks.

A pooled buy that crosses pons graduation gets the excess refunded by the curve — and backers claim it pro-rata with their tokens. Same blended entry for everyone, nothing stranded, no whale timing games.

### SLOT2
One transaction. One price. Everyone.

There is no "first buyer" on a pooled launch. The person who put in 0.01 ETH and the person who put in 1 ETH entered at the identical price, in the same atomic buy, before the market existed.

## D11
### SLOT1
A traditional launch: one person holds the supply, snipers eat the first block, and the fee stream pays whoever set it up.

A pooled launch: nobody holds the supply, the first buy is the community's, and the fee stream pays the community.

Pick your poison. We know ours.

### SLOT2
Why Robinhood Chain? Because the launches graduate into permanently locked Uniswap v4 pools, fees are near-zero, and the launchpad underneath (pons) does real volume every single day.

We built the trustless layer on top. prooflaunch.fun/rhc

## D12
### SLOT1
We ran this model on Solana first — pooled raises, community fee shares, launch bots. It works.

The Robinhood Chain version keeps every promise the same way, minus the part where you have to trust us: the contracts enforce what our operations used to.

### SLOT2
One site, two chains. The SOL | RHC toggle in the navbar switches worlds — same boards, same submit flow, same design.

Solana runs on our track record. Robinhood Chain runs on contracts that don't need one.

## D13
### SLOT1
Launching on pons costs 0.0005 ETH. Launching through PoolLaunch costs... 0.0005 ETH. Same fee, paid to pons at launch — we add no creation fee on top.

What you add: a funded community at your back before block one.

### SLOT2
Everything a backer needs to verify is on-chain before they deposit: the goal, the seat price, the tax, the bot stack, the fee split.

Immutable from creation. Read it yourself: every campaign links its contract. prooflaunch.fun/rhc/audit

## D14
### SLOT1
On the roadmap: raises denominated in tokenized stocks.

pons already approves tokenized equities as pair assets on Robinhood Chain. A community pooling tokenized SpaceX stock to launch a token — that's plumbing, not science fiction.

prooflaunch.fun/roadmap

### SLOT2
Browse the raises. Read the contracts. Take a seat.

⚡ Open raises for momentum. 🎟 Seat rounds for fairness. 90% of the fee stream to backers either way, forever.

prooflaunch.fun/rhc
