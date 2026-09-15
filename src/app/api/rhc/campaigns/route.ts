import { NextResponse } from 'next/server';
import { fetchAllCampaigns, serializeRows } from '@/lib/rhc';

// CDN-cached board snapshot — the same trick that makes the SOL board
// instant. The chain stays the source of truth; this is a 15-second
// cache in front of it, so visitors get JSON in ~100ms instead of
// paying 3 RPC round-trips each. Wallet-specific fields are zeroed
// (no `me`); the client overlays its own position data separately.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await fetchAllCampaigns();
    return new NextResponse(serializeRows(rows), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, s-maxage=30, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502, headers: { 'cache-control': 'no-store' } }
    );
  }
}
