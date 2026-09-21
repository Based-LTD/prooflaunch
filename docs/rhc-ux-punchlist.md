# RHC UX punch list — founder's first prod test, 2026-09-20

Logged during the first real v7 run. Fix after the test completes; do not
deploy mid-test.

| # | Symptom (founder's words) | Suspected cause | Status |
|---|---|---|---|
| 1 | "The single token page doesn't have the picture" | **Confirmed**: campaign page has zero image refs; `tokenMeta` is already fetched, `logo` just isn't rendered | open |
| 2 | "Had to hard refresh when I went to proving grounds because it wasn't there" | **Confirmed**: API sets `s-maxage=30, stale-while-revalidate=600`; board paints from sessionStorage first; create page never clears either | open |
| 3 | "Wallet connection issues — nothing happens when I click the button" | **Confirmed**: single `injected()` connector; `useConnect().error` is never rendered, so a wallet that doesn't answer looks like a dead button. With two wallets in one browser the second wallet's connect went to the first wallet's provider (already authorized → silent). | **fixed `c3fceee`, deployed** — EIP-6963 chooser lists installed wallets by name; connect errors rendered. Pending founder confirmation. Polish: map `ProviderNotFoundError` to "No wallet extension detected" |
| 4 | First v7 campaign address didn't look like `…5EED` | Founder pasted the **token** address; the campaign itself is `0x78BFd61594413C4B4A846839a145122F94Da5eEd` — the signature grind landed on the first try | not a bug |
