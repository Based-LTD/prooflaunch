import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// Public dev leaderboard read endpoint. Returns the top-N devs by
// total_points along with their best meme + meme count.
//
// Cached at the edge for a minute — the underlying data only refreshes
// on the hourly cron, so further serving is wasteful.

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface LeaderRow {
  rank: number;
  creator_wallet: string;
  total_points: number;
  meme_count: number;
  best_meme_id: string | null;
  best_meme_mc: number | null;
  best_meme: {
    id: string;
    name: string;
    symbol: string;
    mint_address: string | null;
    image_url: string | null;
  } | null;
  in_top_10: boolean;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  const supabase = createServerClient();

  const { data: leaders, error } = await supabase
    .from('dev_points')
    .select('creator_wallet, total_points, meme_count, best_meme_id, best_meme_mc')
    .order('total_points', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[leaderboard] db error:', error);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }

  // Hydrate best_meme details in one batched query
  const bestMemeIds = (leaders ?? [])
    .map((l) => l.best_meme_id)
    .filter((x): x is string => !!x);
  const memeMap: Record<string, { id: string; name: string; symbol: string; mint_address: string | null; image_url: string | null }> = {};
  if (bestMemeIds.length > 0) {
    const { data: memeRows } = await supabase
      .from('memes')
      .select('id, name, symbol, mint_address, image_url')
      .in('id', bestMemeIds);
    for (const m of memeRows ?? []) {
      memeMap[m.id as string] = m as { id: string; name: string; symbol: string; mint_address: string | null; image_url: string | null };
    }
  }

  const rows: LeaderRow[] = (leaders ?? []).map((l, idx) => {
    const rank = idx + 1;
    return {
      rank,
      creator_wallet: l.creator_wallet as string,
      total_points: Number(l.total_points) || 0,
      meme_count: Number(l.meme_count) || 0,
      best_meme_id: (l.best_meme_id as string | null) ?? null,
      best_meme_mc: l.best_meme_mc !== null ? Number(l.best_meme_mc) : null,
      best_meme: l.best_meme_id && memeMap[l.best_meme_id as string]
        ? memeMap[l.best_meme_id as string]
        : null,
      in_top_10: rank <= 10,
    };
  });

  return new NextResponse(JSON.stringify({ leaders: rows, snapshotDate: '2026-10-22T00:00:00Z' }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
