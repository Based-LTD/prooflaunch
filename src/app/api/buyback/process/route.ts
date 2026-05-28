import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { runBuybackBotsForAllLive, executeBuybackForMeme } from '@/services/buybackBot';

// Vercel cron + manual-trigger endpoint for per-meme buyback bots.
//
// GET  → iterate every live meme with buyback_bot_enabled=true.
//        Auth: x-vercel-cron:1 (cron) OR Bearer CRON_SECRET (manual).
//        ?force=1 ignored — runs are always idempotent (threshold + atomic
//        drain guard against duplicates).
//
// POST → manual single-meme trigger. Same Bearer auth.
//        Body: { meme_id }
//
// The actual flow (claim escrow → swap via Jupiter → action) lives in
// src/services/buybackBot.ts so it can be tested/triggered independently.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorize(request: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  // Same fallback default as /api/fees/process + /api/airdrop/daily so
  // a missing CRON_SECRET env doesn't soft-break manual triggers.
  const expectedKey = process.env.CRON_SECRET || 'prooflaunch-fees';
  if (isVercelCron) return { ok: true };
  if (authHeader === `Bearer ${expectedKey}`) return { ok: true };
  return { ok: false, status: 401, error: 'Unauthorized' };
}

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const supabase = createServerClient();
    const results = await runBuybackBotsForAllLive(supabase);
    const completed = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.ok).length;
    return NextResponse.json({
      success: true,
      scanned: results.length,
      completed, skipped, failed,
      results,
    });
  } catch (e) {
    console.error('[buyback/process] top-level error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const memeId = typeof body?.meme_id === 'string' ? body.meme_id : null;
    if (!memeId) return NextResponse.json({ error: 'meme_id required' }, { status: 400 });
    const supabase = createServerClient();
    const result = await executeBuybackForMeme(supabase, memeId);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}
