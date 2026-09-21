# RHC UX punch list — founder's first prod test, 2026-09-20

Logged during the first real v7 run. Fix after the test completes; do not
deploy mid-test.

| # | Symptom (founder's words) | Suspected cause | Status |
|---|---|---|---|
| 1 | "The single token page doesn't have the picture" | **Confirmed**: campaign page has zero image refs; `tokenMeta` is already fetched, `logo` just isn't rendered | **fixed `f6abe37`** |
| 2 | "Had to hard refresh when I went to proving grounds because it wasn't there" | **Confirmed**: API sets `s-maxage=30, stale-while-revalidate=600`; board paints from sessionStorage first; create page never clears either | **fixed `f6abe37`** — cache cleared on create, one-time CDN bypass, SWR 60 s |
| 3 | "Wallet connection issues — nothing happens when I click the button" | **Confirmed**: single `injected()` connector; `useConnect().error` is never rendered, so a wallet that doesn't answer looks like a dead button. With two wallets in one browser the second wallet's connect went to the first wallet's provider (already authorized → silent). | **fixed `c3fceee`, deployed** — EIP-6963 chooser lists installed wallets by name; connect errors rendered. Pending founder confirmation. Polish: map `ProviderNotFoundError` to "No wallet extension detected" |
| 4 | First v7 campaign address didn't look like `…5EED` | Founder pasted the **token** address; the campaign itself is `0x78BFd61594413C4B4A846839a145122F94Da5eEd` — the signature grind landed on the first try | not a bug |
| 5 | "We must polish the native swap. SELL SUCCESS or something — not informative and too primitive" | Trade panel reports a bare status word; no amounts, no tx link, no balance delta | **fixed `f6abe37`** — every confirmed action reports exact deltas + tx link |
| 6 | "pons has a 1% tax, that should be added to when we are selecting what tax rate" | Create form showed only the creator tax; traders actually pay creator tax + pons' 1% protocol fee (seen on Axiom as 4% for a 3% launch) | **fixed** — total shown live under the slider + in the preview; the 1% framed as the $PONS rev flywheel |
| 7 | "Fees should be there?" — page showed a 0 fee share while 0.0018 ETH sat in pons' escrow | Creator tax accrues in pons' FeeEscrow until someone cranks Collect; the page never read the escrow | **fixed** — shows "X ETH waiting at pons", Collect goes primary with the amount |
| 8 | Fees-waiting line and Collect were only visible to connected backers | Collect is a permissionless crank and the escrow amount is public; both sat inside the `myContribution > 0` block | **fixed** (not yet deployed) — shown to any visitor; Collect for any connected wallet |
| 9 | "Says ETH" — fee share and Claim framed in ETH on a campaign whose creator picked SPCX | Picker made ETH the primary button and only sorted the creator's pick first in the drawer — the opposite of the creators-set / claimers-override decision | **fixed** — primary is `Claim as SPCX · ~shares` (quoted live); ETH is the alternative; label says fees arrive as the creator's pick unless you choose otherwise |
| 10 | Shared link preview says "Shared Token Launches on Solana" | Root metadata + OG image predate RHC becoming the front door | **fixed** — root + RHC layouts and the OG image say Robinhood Chain; Solana stays a keyword, not the headline |
