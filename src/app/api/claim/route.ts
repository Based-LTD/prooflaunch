import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { createLaunchLogger } from '@/lib/launchLog';
import { settlePoolDistribution } from '@/services/distribution';

// Distribution can transfer to many backers — give it room.
export const maxDuration = 300;

// POST /api/claim — distribute pooled tokens to backers proportionally.
// Idempotent: only backers without a claim_tx are processed, so it can
// be safely retried (and the reconcile cron can call distributeFromPool
// the same way as a safety net). Creator-triggered (signed).
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { meme_id, caller_wallet, signature, message } = await request.json();

    if (!meme_id || !caller_wallet || !signature || !message) {
      return NextResponse.json({ error: 'Missing meme_id / auth fields' }, { status: 400 });
    }
    const auth = verifySignedAuthMessage(
      `claim:${meme_id}:${caller_wallet}`, message, signature, caller_wallet
    );
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data: meme, error: memeErr } = await supabase
      .from('memes').select('id, status, creator_wallet').eq('id', meme_id).single();
    if (memeErr || !meme) return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    if (caller_wallet !== meme.creator_wallet) {
      return NextResponse.json({ error: 'Only the creator can trigger distribution' }, { status: 403 });
    }

    // All split/idempotency/persistence logic lives in the shared,
    // reconcile-safe settler so the cron and this route never diverge.
    const log = createLaunchLogger(meme_id);
    const r = await settlePoolDistribution(supabase, meme_id, log);

    if (r.error) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    if (r.alreadyComplete) {
      return NextResponse.json({ success: true, message: 'All backers already distributed', distributed: 0 });
    }

    return NextResponse.json({
      success: r.ok,
      distributed: r.distributed,
      remaining: r.remaining,
      failures: r.failures,
    });
  } catch (error) {
    console.error('Claim error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
