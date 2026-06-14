// POST /api/wallet-claim/initiate
//
// Step 1 of the claim flow. Authenticated creator requests the sealed
// pool key blob for their meme. The client then derives the X25519
// secret from a wallet signature and decrypts the blob locally.
//
// Authentication: timestamped signed message proving ownership of
// meme.creator_wallet. Same pattern as /api/launch.
//
// Returns the sealed blob + the on-chain pool_wallet pubkey (so the
// client can verify post-decrypt that the recovered secret derives to
// the expected pubkey).
//
// Logs claim_initiated to the audit table.

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
      `claim-pool:${meme_id}:${caller_wallet}`,
      message, signature, caller_wallet,
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createServerClient();
    const { data: meme, error: memeErr } = await supabase
      .from('memes')
      .select('id, creator_wallet, pool_wallet, status, creator_sealed_pool_key, creator_sealed_pool_key_verified_at, pool_wallet_claimed')
      .eq('id', meme_id)
      .single();
    if (memeErr || !meme) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }
    if (caller_wallet !== meme.creator_wallet) {
      return NextResponse.json({ error: 'Only the creator can claim this wallet' }, { status: 403 });
    }
    if (meme.status !== 'live') {
      return NextResponse.json(
        { error: `Token is not launched yet (status=${meme.status}). Can only claim after launch.` },
        { status: 400 },
      );
    }
    if (!meme.creator_sealed_pool_key || !meme.creator_sealed_pool_key_verified_at) {
      return NextResponse.json(
        { error: 'No sealed pool key exists for this token. The launch may have predated wallet-claim support — backfill required.' },
        { status: 400 },
      );
    }

    // Log claim_initiated. Re-claim attempts (already-claimed memes)
    // are intentionally still allowed — the sealed blob is permanent
    // and re-decrypt is part of the design (creator may have lost the
    // cleartext and want to re-recover it). We mark these as reclaim_attempted.
    const eventType = meme.pool_wallet_claimed ? 'reclaim_attempted' : 'claim_initiated';
    await supabase.from('wallet_claim_events').insert({
      meme_id,
      event: eventType,
      details: { caller_wallet },
    });

    return NextResponse.json({
      success: true,
      sealed_pool_key: meme.creator_sealed_pool_key,
      pool_wallet: meme.pool_wallet,
      already_claimed: !!meme.pool_wallet_claimed,
    });
  } catch (error) {
    console.error('Wallet claim initiate error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
