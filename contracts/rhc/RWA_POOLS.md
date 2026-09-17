# RWA → ETH swap routes on Robinhood Chain

Measured 2026-09-16 against live v4. Source: `tools/_rwa-poolkeys.mjs`
(PoolManager `Initialize` events filtered to `currency0 = address(0)`,
liquidity read from StateView `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b`).

**Measure depth in Uniswap v4, not v3.** The v3 pools for these assets are
near-empty; reading them gives a wildly wrong answer. v4 is a singleton, so
`balanceOf(PoolManager)` is total depth across every pool.

PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` holds **20,515 ETH**.

## Deepest ETH-paired pool per asset

All five equity pools below are **hookless** (`hooks = address(0)`), so a
router needs no hook permissions — plain `unlock` → `swap` → `settle`/`take`.

| Asset | poolId | fee | tickSpacing | liquidity | ETH per unit |
|---|---|---|---|---|---|
| SPCX | `0x541942afd092e6c18ccd56bb3d9205f80a2adce77edf260c464c5f9919f37168` | 3000 (0.30%) | 30 | 4.65e21 | 0.0626559 |
| MSFT | `0x34147f36f89c42a67f77601e612abdb1bd40869e53e8d0edd19705ae0499192d` | 10000 (1.00%) | 200 | 9.92e20 | 0.204173 |
| META | `0xab596028265cf92320a28aa7256a584bfe8fe0547c19d3b0ced4234eae4b43b0` | 48000 (4.80%) | 480 | 6.24e19 | 0.288458 |
| SNAP | `0xe33f9e4655f5b4af1934ab71b14173304dd68dd5302e28040b1860245aeec8d6` | 47500 (4.75%) | 475 | 2.73e19 | 0.00236806 |
| LLY  | `0xd58164121a81a0ad02d68e7390931a7e1647310e05b328ed9a3b2d1348db41b5` | 50000 (5.00%) | 200 | 8.97e18 | 0.468691 |
| USDG | `0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551` | dynamic | 10 | 7.44e18 | 4.11e8 ¹ |

¹ USDG is 6-decimal — divide the raw ratio by 1e12. 4.11e8 → 4.11e-4 ETH/USDG.

## Sanity check

Implied ETH ≈ **$2,433** (from the USDG pool). That prices MSFT ≈ $497,
META ≈ $702, LLY ≈ $1,141, SNAP ≈ $5.76, SPCX ≈ $152 — all plausible against
real share prices, which cross-validates both the decoding and the pool choice.

## Product consequence: pool fees are NOT uniform

**SPCX 0.30% and MSFT 1.00% are cheap. META, SNAP and LLY all sit near 5%.**
That fee is paid by whoever swaps, so a claimer routing rewards into LLY loses
5% to the pool before slippage. Implications:

- Default and promote **SPCX and MSFT**; they are both deepest and cheapest.
- The claim UI must show **expected output**, not just the asset name — a 5%
  pool fee is invisible otherwise and reads as us skimming.
- Creator-set reward assets should surface the fee at selection time so a
  creator picking LLY knows what they are signing their holders up for.

USDG's deepest pools carry hooks and thin per-pool liquidity despite a large
aggregate balance — route USDG with care, or prefer ETH for stable payouts.
