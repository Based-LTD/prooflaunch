// Market-cap fetcher for the dev leaderboard cron.
//
// Strategy: Jupiter Lite Price API is the source of truth — it indexes
// both Pump.fun bonding-curve tokens and Meteora DBC tokens, gives us
// a real USD price, and is rate-friendly. If Jupiter doesn't have a
// token (very fresh launch, ~10s before they index), the cron just
// skips this tick and tries again next hour.
//
// Supply is assumed to be the standard 1B with 6 decimals — both
// Pump.fun and our Meteora config use that. If we ever launch a token
// with a different supply, this needs to read from on-chain mint data.

const JUPITER_PRICE_ENDPOINT = 'https://lite-api.jup.ag/price/v3';
const ASSUMED_SUPPLY = 1_000_000_000; // both pump.fun + our DBC config

export interface MarketCapResult {
  mint: string;
  priceUsd: number;
  marketCapUsd: number;
  source: 'jupiter';
}

// Fetch USD price for a single mint via Jupiter's Lite Price API.
// Returns null if Jupiter doesn't have the token yet.
async function fetchJupiterPrice(mint: string): Promise<number | null> {
  try {
    const url = `${JUPITER_PRICE_ENDPOINT}?ids=${mint}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const entry = json?.[mint];
    if (!entry) return null;
    const price = Number(entry.usdPrice);
    if (!Number.isFinite(price) || price <= 0) return null;
    return price;
  } catch {
    return null;
  }
}

// Single-mint market cap. Returns null if Jupiter doesn't have it.
export async function getMarketCap(mint: string): Promise<MarketCapResult | null> {
  const priceUsd = await fetchJupiterPrice(mint);
  if (priceUsd === null) return null;
  return {
    mint,
    priceUsd,
    marketCapUsd: priceUsd * ASSUMED_SUPPLY,
    source: 'jupiter',
  };
}

// Batch fetch — Jupiter accepts a comma-separated list of mints. Use
// when polling many memes at once in the cron. Returns a map keyed
// by mint; mints Jupiter doesn't know about are simply missing.
export async function getMarketCapsBatch(mints: string[]): Promise<Record<string, MarketCapResult>> {
  if (mints.length === 0) return {};

  // Jupiter has a per-request URL limit; 50 mints per batch is safe.
  const CHUNK = 50;
  const result: Record<string, MarketCapResult> = {};

  for (let i = 0; i < mints.length; i += CHUNK) {
    const chunk = mints.slice(i, i + CHUNK);
    try {
      const url = `${JUPITER_PRICE_ENDPOINT}?ids=${chunk.join(',')}`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const json = await res.json();
      for (const mint of chunk) {
        const entry = json?.[mint];
        if (!entry) continue;
        const priceUsd = Number(entry.usdPrice);
        if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
        result[mint] = {
          mint,
          priceUsd,
          marketCapUsd: priceUsd * ASSUMED_SUPPLY,
          source: 'jupiter',
        };
      }
    } catch {
      // chunk failed — leave its mints out of the result; cron retries next tick
    }
  }
  return result;
}

// Convert a market cap to a $10k bucket index.
//   $0–$9,999    → 0
//   $10,000      → 1
//   $19,999      → 1
//   $20,000      → 2
//   $250,000     → 25
export function mcToBucket(marketCapUsd: number): number {
  if (!Number.isFinite(marketCapUsd) || marketCapUsd <= 0) return 0;
  return Math.floor(marketCapUsd / 10_000);
}

// Points awarded for crossing buckets [prev+1 .. new]. Each $10k
// bucket = 10,000 points. 1:1 USD-to-points so the displayed totals
// feel chunky.
export function bucketsToPoints(prevBucket: number, newBucket: number): number {
  if (newBucket <= prevBucket) return 0;
  return (newBucket - prevBucket) * 10_000;
}
