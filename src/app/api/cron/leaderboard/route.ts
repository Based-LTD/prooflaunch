import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { authorizeCron } from '@/lib/cronAuth';
import {
  getMarketCapsBatch,
  mcToBucket,
  bucketsToPoints,
} from '@/lib/marketCap';

// Hourly dev leaderboard tick.
//
// 1. Pull every `live` meme that has a mint_address.
// 2. Batch-fetch current MC from Jupiter for all of them.
// 3. For each meme:
//      - read or create its meme_mc_tracking row
//      - compute newBucket = floor(currentMC / 10k)
//      - if newBucket > highest_mc_bucket → award (newBucket - prev) × 10000
//        points to the meme's creator_wallet
//      - persist the new watermark
// 4. Refresh the dev_points cache (sum across each dev's memes).
//
// Idempotent: re-running on the same data is a no-op because the
// watermark only moves up.

export const maxDuration = 60;

interface MemeRow {
  id: string;
  creator_wallet: string;
  mint_address: string;
}

interface TickResult {
  ok: boolean;
  scanned: number;
  priced: number;
  newMilestones: number;
  totalPointsAwarded: number;
  walletsTouched: number;
  error?: string;
}

async function runLeaderboardTick(): Promise<TickResult> {
  const supabase = createServerClient();

  // 1. live memes with a mint
  const { data: memes, error: memesErr } = await supabase
    .from('memes')
    .select('id, creator_wallet, mint_address')
    .eq('status', 'live')
    .not('mint_address', 'is', null);

  if (memesErr) return { ok: false, scanned: 0, priced: 0, newMilestones: 0, totalPointsAwarded: 0, walletsTouched: 0, error: memesErr.message };
  if (!memes || memes.length === 0) {
    return { ok: true, scanned: 0, priced: 0, newMilestones: 0, totalPointsAwarded: 0, walletsTouched: 0 };
  }

  // 2. batch MC fetch
  const mints = memes.map((m: MemeRow) => m.mint_address);
  const mcMap = await getMarketCapsBatch(mints);

  // 3. existing trackers
  const memeIds = memes.map((m: MemeRow) => m.id);
  const { data: trackers } = await supabase
    .from('meme_mc_tracking')
    .select('meme_id, highest_mc_usd, highest_mc_bucket')
    .in('meme_id', memeIds);
  const trackByMeme = new Map<string, { highest_mc_usd: number; highest_mc_bucket: number }>();
  for (const t of trackers || []) {
    trackByMeme.set(t.meme_id as string, {
      highest_mc_usd: Number(t.highest_mc_usd) || 0,
      highest_mc_bucket: Number(t.highest_mc_bucket) || 0,
    });
  }

  // 4. compute updates
  const trackerUpserts: Array<{
    meme_id: string;
    highest_mc_usd: number;
    highest_mc_bucket: number;
    last_mc_usd: number;
    last_checked_at: string;
    updated_at: string;
  }> = [];
  const pointDeltas = new Map<string, number>(); // wallet → points to add
  const walletsToRecompute = new Set<string>();
  let priced = 0;
  let newMilestones = 0;
  let totalPointsAwarded = 0;

  const now = new Date().toISOString();
  for (const m of memes as MemeRow[]) {
    const mc = mcMap[m.mint_address];
    if (!mc) continue;
    priced++;

    const prev = trackByMeme.get(m.id) ?? { highest_mc_usd: 0, highest_mc_bucket: 0 };
    const newBucket = mcToBucket(mc.marketCapUsd);
    const newHighest = Math.max(prev.highest_mc_usd, mc.marketCapUsd);
    const points = bucketsToPoints(prev.highest_mc_bucket, newBucket);

    if (points > 0) {
      newMilestones++;
      totalPointsAwarded += points;
      pointDeltas.set(m.creator_wallet, (pointDeltas.get(m.creator_wallet) ?? 0) + points);
    }
    // Always touch the wallet so meme_count / best_meme stay fresh
    walletsToRecompute.add(m.creator_wallet);

    trackerUpserts.push({
      meme_id: m.id,
      highest_mc_usd: newHighest,
      highest_mc_bucket: Math.max(prev.highest_mc_bucket, newBucket),
      last_mc_usd: mc.marketCapUsd,
      last_checked_at: now,
      updated_at: now,
    });
  }

  // 5. persist tracker updates
  if (trackerUpserts.length > 0) {
    const { error: upErr } = await supabase
      .from('meme_mc_tracking')
      .upsert(trackerUpserts, { onConflict: 'meme_id' });
    if (upErr) {
      return { ok: false, scanned: memes.length, priced, newMilestones, totalPointsAwarded, walletsTouched: 0, error: `tracker upsert: ${upErr.message}` };
    }
  }

  // 6. recompute dev_points for every wallet that had a meme touched
  //    this tick. We re-sum from meme_mc_tracking rather than
  //    incrementing — keeps the cache eventually-consistent even if a
  //    prior tick partially failed.
  let walletsTouched = 0;
  for (const wallet of walletsToRecompute) {
    // Pull every meme this wallet created + its tracker row
    const { data: theirMemes } = await supabase
      .from('memes')
      .select('id, mint_address, meme_mc_tracking(highest_mc_usd, highest_mc_bucket)')
      .eq('creator_wallet', wallet);

    if (!theirMemes) continue;

    let total = 0;
    let bestMc = 0;
    let bestMemeId: string | null = null;
    let memeCount = 0;
    for (const row of theirMemes as Array<{
      id: string;
      mint_address: string | null;
      meme_mc_tracking: { highest_mc_usd: number | string; highest_mc_bucket: number | string }[] | null;
    }>) {
      if (!row.mint_address) continue;
      memeCount++;
      const tr = Array.isArray(row.meme_mc_tracking) ? row.meme_mc_tracking[0] : row.meme_mc_tracking;
      if (!tr) continue;
      const bucket = Number(tr.highest_mc_bucket) || 0;
      const mc = Number(tr.highest_mc_usd) || 0;
      total += bucket * 10_000;
      if (mc > bestMc) {
        bestMc = mc;
        bestMemeId = row.id;
      }
    }

    const { error: dpErr } = await supabase
      .from('dev_points')
      .upsert({
        creator_wallet: wallet,
        total_points: total,
        meme_count: memeCount,
        best_meme_id: bestMemeId,
        best_meme_mc: bestMc,
        updated_at: now,
      }, { onConflict: 'creator_wallet' });
    if (!dpErr) walletsTouched++;
  }

  return {
    ok: true,
    scanned: memes.length,
    priced,
    newMilestones,
    totalPointsAwarded,
    walletsTouched,
  };
}

export async function GET(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;
  try {
    const result = await runLeaderboardTick();
    return NextResponse.json(result);
  } catch (e) {
    console.error('[cron/leaderboard] error:', e);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Same as GET — manual trigger path with the same auth.
  return GET(request);
}
