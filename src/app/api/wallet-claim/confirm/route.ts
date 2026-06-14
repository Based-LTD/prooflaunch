// POST /api/wallet-claim/confirm
//
// Step 2 of the claim flow. Creator has decrypted the sealed blob,
// saved the key, and is confirming they have it. We set
// pool_wallet_claimed = true and pool_wallet_claimed_at = now().
//
// 24h later, the burn cron clears encrypted_pool_key. Until then the
// platform's backup is still in place — a fail-safe in case the
// creator realizes they didn't actually save the key.
//
// Re-claim is allowed (silent): if pool_wallet_claimed is already true,
// we still let the request through (it's idempotent — no-op).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { isWalletClaimEnabled } from '@/lib/walletClaim';

export async function POST(request: NextRequest) {
  try {
    if (!isWalletClaimEnabled()) {
      return NextResponse.json({ error: 'Wallet claim feature is not enabled' }, { status: 403 });
    }

    const body = await request.json();
    const { meme_id, caller_wallet, signature, message } = body;

    if (!meme_id || !caller_wallet || !signature || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: meme_id, caller_wallet, signature, message' },
        { status: 400 },
      );
    }

    const auth = verifySignedAuthMessage(
      `claim-confirm:${meme_id}:${caller_wallet}`,
      message, signature, caller_wallet,
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createServerClient();
    const { data: meme, error: memeErr } = await supabase
      .from('memes')
      .select('id, creator_wallet, pool_wallet, creator_sealed_pool_key_verified_at, pool_wallet_claimed')
      .eq('id', meme_id)
      .single();
    if (memeErr || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }
    if (caller_wallet !== meme.creator_wallet) {
      return NextResponse.json({ error: 'Only the creator can claim this wallet' }, { status: 403 });
    }
    if (!meme.creator_sealed_pool_key_verified_at) {
      return NextResponse.json(
        { error: 'No sealed pool key for this meme (verified_at NULL). Cannot confirm a claim that never started.' },
        { status: 400 },
      );
    }
    // Already-claimed is fine — re-confirm is a silent no-op. The 24h
    // burn timer is anchored to the FIRST claim_confirmed_at, not this one.
    if (meme.pool_wallet_claimed) {
      return NextResponse.json({
        success: true,
        already_claimed: true,
        message: 'Wallet was already claimed. This confirmation is a no-op.',
      });
    }

    const claimedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('memes')
      .update({
        pool_wallet_claimed: true,
        pool_wallet_claimed_at: claimedAt,
      })
      .eq('id', meme_id);
    if (updateErr) {
      console.error('claim-confirm DB update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to record claim confirmation' }, { status: 500 });
    }

    await supabase.from('wallet_claim_events').insert({
      meme_id,
      event: 'claim_confirmed',
      details: { caller_wallet, claimed_at: claimedAt, grace_period_hours: 24 },
    });

    return NextResponse.json({
      success: true,
      claimed_at: claimedAt,
      grace_period_ends: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      message: 'Claim confirmed. The platform-encrypted backup will be destroyed in 24 hours.',
    });
  } catch (error) {
    console.error('Wallet claim confirm error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
