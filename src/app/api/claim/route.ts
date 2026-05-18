import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { distributeFromPool } from '@/services/pumpfun';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { createLaunchLogger } from '@/lib/launchLog';

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
      .from('memes').select('*').eq('id', meme_id).single();
    if (memeErr || !meme) return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    if (caller_wallet !== meme.creator_wallet) {
      return NextResponse.json({ error: 'Only the creator can trigger distribution' }, { status: 403 });
    }
    if (meme.status !== 'live' || !meme.mint_address || !meme.pool_wallet || !meme.encrypted_pool_key) {
      return NextResponse.json({ error: 'Meme not in a distributable state' }, { status: 400 });
    }
    const poolTokens = BigInt(meme.pool_token_balance || 0);
    if (poolTokens <= BigInt(0)) {
      return NextResponse.json({ error: 'No pooled tokens recorded for this meme' }, { status: 400 });
    }

    // Proportional split over ALL confirmed backings (stable denominator),
    // but only DISTRIBUTE the ones not yet claimed (idempotent). Last
    // unclaimed backer absorbs rounding remainder so no dust is lost.
    const { data: all } = await supabase
      .from('backings')
      .select('id, backer_wallet, amount_sol, claim_tx')
      .eq('meme_id', meme_id)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: true });
    if (!all || all.length === 0) {
      return NextResponse.json({ error: 'No confirmed backings' }, { status: 400 });
    }

    const totalSol = all.reduce((s, b) => s + Number(b.amount_sol), 0);
    let running = BigInt(0);
    const planned = all.map((b, i) => {
      let toks: bigint;
      if (i === all.length - 1) {
        toks = poolTokens - running; // last gets exact remainder
      } else {
        toks = (poolTokens * BigInt(Math.round(Number(b.amount_sol) * 1e9))) / BigInt(Math.round(totalSol * 1e9));
        running += toks;
      }
      return { id: b.id, backerWallet: b.backer_wallet, tokens: toks.toString(), alreadyClaimed: !!b.claim_tx };
    });

    const todo = planned.filter(p => !p.alreadyClaimed);
    if (todo.length === 0) {
      return NextResponse.json({ success: true, message: 'All backers already distributed', distributed: 0 });
    }

    const log = createLaunchLogger(meme_id);
    const { results } = await distributeFromPool(
      meme.encrypted_pool_key, meme.pool_wallet, meme.mint_address,
      todo.map(t => ({ backerWallet: t.backerWallet, tokens: t.tokens })),
      log,
    );

    // Persist per-backer outcomes (idempotency keys = claim_tx)
    let ok = 0;
    const failures: { backerWallet: string; error?: string }[] = [];
    for (const r of results) {
      const p = todo.find(t => t.backerWallet === r.backerWallet);
      if (!p) continue;
      if (r.signature) {
        await supabase.from('backings').update({
          status: 'distributed',
          claim_tokens: r.tokens,
          claim_tx: r.signature,
          claimed_at: new Date().toISOString(),
          tokens_received: r.tokens,
        }).eq('id', p.id);
        ok++;
      } else {
        failures.push({ backerWallet: r.backerWallet, error: r.error });
      }
    }

    return NextResponse.json({
      success: failures.length === 0,
      distributed: ok,
      remaining: failures.length,
      failures,
    });
  } catch (error) {
    console.error('Claim error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
