// POST /api/wallet-claim/backfill
//
// For memes that launched BEFORE Phase 2 shipped (no derivation
// signature was collected at launch time, so no sealed_pool_key exists).
// The creator visits the meme page, clicks "Enable Self-Custody", signs
// the derivation message, and we run the same seal+verify ceremony
// retroactively against the meme's existing encrypted_pool_key.
//
// Idempotent: if creator_sealed_pool_key is already set, return success
// without re-sealing (immutability trigger would reject the UPDATE
// anyway).
//
// Auth: creator-wallet signed message. Same pattern as /api/launch.
//
// Behavior on failure: throws, leaves encrypted_pool_key intact. The
// creator can retry.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage, decryptPrivateKey } from '@/lib/crypto';
import { sealPoolKeyForCreator, isWalletClaimEnabled, isStructurallyValidSealedBlob } from '@/lib/walletClaim';
import bs58 from 'bs58';

export async function POST(request: NextRequest) {
  try {
    if (!isWalletClaimEnabled()) {
      return NextResponse.json({ error: 'Wallet claim feature is not enabled' }, { status: 403 });
    }

    const body = await request.json();
    const { meme_id, caller_wallet, signature, message, derivation_signature } = body;

    if (!meme_id || !caller_wallet || !signature || !message || !derivation_signature) {
      return NextResponse.json(
        { error: 'Missing required fields: meme_id, caller_wallet, signature, message, derivation_signature' },
        { status: 400 },
      );
    }

    const auth = verifySignedAuthMessage(
      `claim-backfill:${meme_id}:${caller_wallet}`,
      message, signature, caller_wallet,
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createServerClient();
    const { data: meme, error: memeErr } = await supabase
      .from('memes')
      .select('id, creator_wallet, status, encrypted_pool_key, creator_sealed_pool_key, creator_sealed_pool_key_verified_at')
      .eq('id', meme_id)
      .single();
    if (memeErr || !meme) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }
    if (caller_wallet !== meme.creator_wallet) {
      return NextResponse.json({ error: 'Only the creator can backfill self-custody for this token' }, { status: 403 });
    }
    if (meme.status !== 'live') {
      return NextResponse.json(
        { error: `Backfill only applies to launched tokens. Current status: ${meme.status}` },
        { status: 400 },
      );
    }
    if (!meme.encrypted_pool_key) {
      return NextResponse.json(
        { error: 'No encrypted_pool_key exists for this token. Cannot backfill — the pool wallet was either never created or has already been burned post-claim.' },
        { status: 400 },
      );
    }
    if (meme.creator_sealed_pool_key && meme.creator_sealed_pool_key_verified_at) {
      // Idempotent: already backfilled. Return success without re-sealing.
      return NextResponse.json({
        success: true,
        already_sealed: true,
        verified_at: meme.creator_sealed_pool_key_verified_at,
      });
    }

    // Decode + decrypt.
    let sigBytes: Uint8Array;
    let poolSecretBytes: Uint8Array;
    try {
      sigBytes = bs58.decode(derivation_signature);
      if (sigBytes.length !== 64) {
        throw new Error(`derivation_signature must be 64 bytes (got ${sigBytes.length})`);
      }
      const poolSecretB58 = decryptPrivateKey(meme.encrypted_pool_key);
      poolSecretBytes = bs58.decode(poolSecretB58);
      if (poolSecretBytes.length !== 64) {
        throw new Error(`pool secret key must be 64 bytes (got ${poolSecretBytes.length})`);
      }
    } catch (e) {
      return NextResponse.json(
        { error: `Backfill failed at decode/decrypt: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 },
      );
    }

    // Seal + verify (the lib does round-trip internally).
    let sealed: string;
    try {
      const result = await sealPoolKeyForCreator({
        poolSecretKey: poolSecretBytes,
        derivationSignature: sigBytes,
      });
      sealed = result.sealed;
      if (!isStructurallyValidSealedBlob(sealed)) {
        throw new Error('seal produced structurally invalid blob');
      }
    } catch (e) {
      poolSecretBytes.fill(0);
      sigBytes.fill(0);
      return NextResponse.json(
        { error: `Backfill seal+verify failed: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 },
      );
    }

    // Persist.
    const verifiedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('memes')
      .update({
        creator_sealed_pool_key: sealed,
        creator_sealed_pool_key_verified_at: verifiedAt,
      })
      .eq('id', meme_id);
    if (updateErr) {
      poolSecretBytes.fill(0);
      sigBytes.fill(0);
      return NextResponse.json(
        { error: `Backfill DB update failed: ${updateErr.message}` },
        { status: 500 },
      );
    }

    await supabase.from('wallet_claim_events').insert({
      meme_id,
      event: 'sealed_at_launch',
      details: { verified_at: verifiedAt, blob_length_bytes: sealed.length, backfilled: true },
    });

    // Zero the plaintext.
    poolSecretBytes.fill(0);
    sigBytes.fill(0);

    return NextResponse.json({
      success: true,
      verified_at: verifiedAt,
      message: 'Self-custody enabled. You can now claim the pool wallet from /claim/' + meme_id,
    });
  } catch (error) {
    console.error('Wallet claim backfill error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
