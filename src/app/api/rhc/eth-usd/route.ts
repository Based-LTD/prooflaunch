import { NextResponse } from 'next/server';

// ETH/USD for the trade card's market-cap line. One upstream call a
// minute, shared by every visitor; if CoinGecko is down the card simply
// shows ETH and no dollar figure.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let cache: { usd: number; at: number } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 60_000) return NextResponse.json({ usd: cache.usd, cached: true });
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', { next: { revalidate: 0 } });
    const j = (await r.json()) as { ethereum?: { usd?: number } };
    const usd = j.ethereum?.usd;
    if (typeof usd !== 'number' || !(usd > 0)) throw new Error('bad price');
    cache = { usd, at: Date.now() };
    return NextResponse.json({ usd, cached: false }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch {
    return NextResponse.json({ usd: cache?.usd ?? null }, { status: cache ? 200 : 503 });
  }
}
