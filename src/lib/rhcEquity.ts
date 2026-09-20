// Tokenized-equity payouts: "claim as stock" on Robinhood Chain.
//
// The protocol always owes ETH. These are the pools a claimer can route
// that ETH through on the way out, so the asset that lands in their
// wallet is their choice. Nothing here is an allowlist in the contract
// sense — EquityRouter accepts any ETH-paired v4 pool, and this list is
// only the convenience menu the UI shows. Being wrong here costs a bad
// quote, never a stuck claim.
//
// Pool keys were read off live v4 Initialize events, NOT assumed — see
// contracts/rhc/RWA_POOLS.md. Measure depth in v4: the v3 pools for
// these assets are near-empty and reading them gives a wildly wrong
// answer.
import { parseAbi } from 'viem';
import { rhcPublicClient } from './rhc';

// Deployed 2026-09-20 (contracts/rhc/DEPLOYMENTS.md). The LIVE flag is a
// build-time env switch (NEXT_PUBLIC_EQUITY_ROUTER_LIVE=1), ON in
// production since 2026-09-20 — every prod deploy must carry it.
export const EQUITY_ROUTER = '0x0A568a0AdcC45F8f6597f0219df39FA9ACA82943' as `0x${string}`;
export const EQUITY_ROUTER_LIVE = process.env.NEXT_PUBLIC_EQUITY_ROUTER_LIVE === '1';

export interface EquityAsset {
  symbol: string;
  label: string;
  address: `0x${string}`;
  decimals: number;
  /// v4 PoolKey fields; currency0 is always native ETH (address(0)).
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
  /// Pool fee in basis points — the cost the claimer eats on the swap.
  /// NOT uniform across these assets, and invisible unless we show it.
  feeBps: number;
  blurb: string;
}

const NO_HOOK = '0x0000000000000000000000000000000000000000' as `0x${string}`;

/// Ordered cheapest-first: the top of this list is what a claimer should
/// reach for, and the ordering is the honest recommendation.
export const EQUITY_ASSETS: EquityAsset[] = [
  {
    symbol: 'SPCX',
    label: 'SpaceX',
    address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa',
    decimals: 18,
    fee: 3000,
    tickSpacing: 30,
    hooks: NO_HOOK,
    feeBps: 30,
    blurb: 'Deepest equity pool on the chain and the cheapest to route into.',
  },
  {
    symbol: 'MSFT',
    label: 'Microsoft',
    address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74',
    decimals: 18,
    fee: 10000,
    tickSpacing: 200,
    hooks: NO_HOOK,
    feeBps: 100,
    blurb: 'The most widely held equity here. Routes for about 1%.',
  },
  {
    symbol: 'META',
    label: 'Meta',
    address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35',
    decimals: 18,
    fee: 48000,
    tickSpacing: 480,
    hooks: NO_HOOK,
    feeBps: 480,
    blurb: 'Thinner pool — the swap itself costs about 4.8%.',
  },
  {
    symbol: 'SNAP',
    label: 'Snap',
    address: '0xF6589F11Bc40b669e584073F428B05562F568733',
    decimals: 18,
    fee: 47500,
    tickSpacing: 475,
    hooks: NO_HOOK,
    feeBps: 475,
    blurb: 'Thinner pool — the swap itself costs about 4.75%.',
  },
  {
    symbol: 'LLY',
    label: 'Eli Lilly',
    address: '0x8005d266423c7ea827372c9c864491e5786600ea',
    decimals: 18,
    fee: 50000,
    tickSpacing: 200,
    hooks: NO_HOOK,
    feeBps: 500,
    blurb: 'Thinnest pool of the five — the swap itself costs about 5%.',
  },
];

/// Above this, the pool fee is large enough that showing only the ticker
/// would read as us skimming. The UI must say so out loud.
export const PRICEY_FEE_BPS = 200;

export function equityBySymbol(symbol: string): EquityAsset | undefined {
  return EQUITY_ASSETS.find((a) => a.symbol === symbol);
}

export function poolKeyFor(a: EquityAsset) {
  return {
    currency0: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    currency1: a.address,
    fee: a.fee,
    tickSpacing: a.tickSpacing,
    hooks: a.hooks,
  } as const;
}

export const equityRouterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'function routeEthTo(PoolKey key, uint256 minOut, address recipient, bytes hookData) payable returns (uint256 assetOut)',
]);

export const vaultClaimAsAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'function claimAs(PoolKey key, uint256 minOut) returns (uint256 assetOut)',
  'function claim()',
  'function earned(address user) view returns (uint256)',
]);

/// What would this claim actually be worth in shares? Simulated against
/// the live pool rather than computed from a stale price, so the number
/// shown is the number the swap would produce right now.
export async function quoteEquityOut(
  asset: EquityAsset,
  ethIn: bigint,
  account: `0x${string}`
): Promise<bigint | null> {
  if (!EQUITY_ROUTER_LIVE || ethIn === 0n) return null;
  try {
    const { result } = await rhcPublicClient.simulateContract({
      address: EQUITY_ROUTER,
      abi: equityRouterAbi,
      functionName: 'routeEthTo',
      args: [poolKeyFor(asset), 0n, account, '0x'],
      value: ethIn,
      account,
    });
    return result as bigint;
  } catch {
    // No pool, no depth, or the sim reverted — the caller renders this as
    // "can't route right now", never as a zero quote.
    return null;
  }
}

/// Slippage floor for the real transaction. The claimer's own bound is
/// the only protection the contract offers, so never send 0 on a live
/// claim — a quote that moved against them should revert, not fill.
export function minOutFrom(quote: bigint, slippageBps = 100): bigint {
  return (quote * BigInt(10_000 - slippageBps)) / 10_000n;
}

/// Share amounts want more precision than ETH — 0.24 shares of MSFT is a
/// real answer and "0.2" throws away money the user can see.
export function fmtShares(amount: bigint, decimals = 18, digits = 4): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = ((amount % base) * 10n ** BigInt(digits)) / base;
  return `${whole}.${frac.toString().padStart(digits, '0')}`;
}
