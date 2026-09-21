# RHC UX punch list — founder's first prod test, 2026-09-20

Logged during the first real v7 run. Fix after the test completes; do not
deploy mid-test.

| # | Symptom (founder's words) | Suspected cause | Status |
|---|---|---|---|
| 1 | "The single token page doesn't have the picture" | Campaign detail page never renders `meta.logo`; only the board card does | open |
| 2 | "Had to hard refresh when I went to proving grounds because it wasn't there" | Board is served from a 30 s CDN cache + a sessionStorage cache; nothing invalidates either after a successful create | open |
| 3 | "Wallet connection issues — nothing happens when I click the button" | `connect({ connector: connectors[0] })` — if `connectors[0]` isn't the injected wallet, or the click lands while `isPending`, it no-ops silently with no feedback | open |
