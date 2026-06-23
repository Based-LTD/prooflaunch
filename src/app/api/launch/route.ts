import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { LaunchConfig } from '@/services/pumpfun';
import { launchOnPlatform, type LaunchPlatform } from '@/services/launch';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { rateLimiters } from '@/lib/rateLimit';
import { createLaunchLogger } from '@/lib/launchLog';
import { settlePoolDistribution } from '@/services/distribution';
import { decryptPrivateKey } from '@/lib/crypto';
import { sealPoolKeyForCreator, isWalletClaimEnabled, isStructurallyValidSealedBlob } from '@/lib/walletClaim';
import bs58 from 'bs58';

const VALID_PLATFORMS: LaunchPlatform[] = ['pumpfun', 'meteora', 'bags', 'bonk'];

// Launch can take ~36s of Jito bundle retries + RPC fallback + buys.
// Without this the platform default would kill it mid-launch.
export const maxDuration = 300;

// POST /api/launch - Launch a funded meme via the pooled-atomic path.
// The meme's pool wallet (funded by all backers) does ONE atomic
// createV2+buy on pump.fun: same price for every backer, dev holds 0%,
// zero sniper gap. Token distribution to backers is a separate step
// (/api/claim).
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { meme_id, caller_wallet, signature, message, derivation_signature } = body;

    if (!meme_id) {
      return NextResponse.json(
        { error: 'Missing meme_id' },
        { status: 400 }
      );
    }

    if (!caller_wallet || !signature || !message) {
      return NextResponse.json(
        { error: 'Missing required auth fields: caller_wallet, signature, message' },
        { status: 400 }
      );
    }

    // Verify timestamped wallet signature
    const auth = verifySignedAuthMessage(
      `launch:${meme_id}:${caller_wallet}`,
      message, signature, caller_wallet
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Rate limiting - 2 launch attempts per minute per meme
    const rateLimitResult = rateLimiters.launch(meme_id);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Launch already in progress. Please wait.' },
        { status: 429 }
      );
    }

    // Get meme
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('*')
      .eq('id', meme_id)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // Verify caller is the creator
    if (caller_wallet !== meme.creator_wallet) {
      return NextResponse.json(
        { error: 'Only the creator can launch this token' },
        { status: 403 }
      );
    }

    // Check if meme is ready to launch
    if (meme.status !== 'funded') {
      return NextResponse.json(
        { error: `Meme is not ready to launch (status: ${meme.status}, need: funded)` },
        { status: 400 }
      );
    }

    // Pooled model: the meme's pool wallet (funded by backers) does ONE
    // atomic createV2+buy. No per-backer burners.
    if (!meme.pool_wallet || !meme.encrypted_pool_key) {
      return NextResponse.json(
        { error: 'Meme has no pool wallet — cannot launch (legacy/misprovisioned)' },
        { status: 400 }
      );
    }

    // Need at least one confirmed backing (the pool must have funds)
    const { data: backings } = await supabase
      .from('backings')
      .select('backer_wallet, amount_sol')
      .eq('meme_id', meme_id)
      .eq('status', 'confirmed');

    if (!backings || backings.length === 0) {
      return NextResponse.json(
        { error: 'No confirmed backings found for this meme' },
        { status: 400 }
      );
    }

    // Update status to launching
    await supabase.from('memes').update({ status: 'launching' }).eq('id', meme_id);

    const config: LaunchConfig = {
      name: meme.name,
      symbol: meme.symbol,
      description: meme.description,
      imageUrl: meme.image_url,
      twitter: meme.twitter,
      telegram: meme.telegram,
      discord: meme.discord,
      website: meme.website,
      github: meme.github,
      // Quote currency (migration 053). Defaults to 'sol' for legacy
      // memes pre-053. Meteora adapter reads this to pick the right
      // DBC config (SOL vs USDC quote mint).
      quoteCurrency: (meme.quote_currency as 'sol' | 'usdc' | undefined) ?? 'sol',
      totalBackingSol: meme.current_backing_sol,
      creatorWallet: meme.creator_wallet,
      // Per-coin sub-escrow (P2 set this at submission); if null/legacy
      // (pre-P2 memes like PROOF/TEST), launchPooledAtomic falls back
      // to shared escrow as creator → behavior identical to today.
      creatorPubkey: meme.creator_subescrow_pubkey || undefined,
    };

    // Pick the launch platform. Default to pumpfun for legacy memes that
    // were submitted before migration 046 added the launch_platform column.
    const platform: LaunchPlatform = VALID_PLATFORMS.includes(meme.launch_platform as LaunchPlatform)
      ? (meme.launch_platform as LaunchPlatform)
      : 'pumpfun';

    // Pre-flight readiness check — refuse to send any tx if the
    // platform's required env isn't configured. Catches the failure
    // BEFORE the meme is moved into 'launching' state via the (now
    // already-applied) status update above, so we revert it. Without
    // this, a misconfigured Meteora launch would set status=launching,
    // the adapter would return error, and the catch block would still
    // see status=launching after the route returns — confusing the
    // UI's "ready to deploy" gate.
    if (platform === 'meteora' && !process.env.METEORA_DBC_CONFIG) {
      await supabase
        .from('memes')
        .update({ status: 'funded', funded_at: new Date().toISOString() })
        .eq('id', meme_id);
      return NextResponse.json(
        { error: 'Meteora launches are not yet configured — try Pump.fun.' },
        { status: 503 },
      );
    }

    console.log(`Launching ${config.name} via ${platform} from pool ${meme.pool_wallet}`);

    // ONE atomic create+buy from the pool wallet (zero sniper gap,
    // dev holds 0%). Logger persists every step to launch_events.
    // Dispatch to the per-platform adapter under src/services/launch/.
    const launchLog = createLaunchLogger(meme_id);
    const result = await launchOnPlatform(platform, {
      config,
      poolEncryptedKey: meme.encrypted_pool_key,
      poolWalletAddress: meme.pool_wallet,
      log: launchLog,
      // Meteora's poolCreator is a tx signer. When the sub-escrow is
      // the creator (P2+ memes), the adapter needs the encrypted key
      // to add as signer. Pump.fun ignores this field.
      creatorEncryptedKey: meme.encrypted_creator_subescrow_key ?? undefined,
    });

    if (!result.success || !result.mintAddress || !result.tokensReceived) {
      // Reset funded_at: the 24h launch countdown shouldn't penalize
      // the creator for a Jito/RPC-side failure outside their control.
      // (Re-attempt costs gas + tip, so this isn't a free extension.)
      await supabase
        .from('memes')
        .update({ status: 'funded', funded_at: new Date().toISOString() })
        .eq('id', meme_id);
      console.error('Pooled launch failed:', result.error);
      return NextResponse.json(
        { error: result.error || 'Launch failed' },
        { status: 500 }
      );
    }

    // Live. Record the pool's token balance — backers' proportional
    // shares are computed from this. For Meteora launches, also
    // persist the DBC pool address so the hourly fee cron can locate
    // the pool to claim from. Pump.fun launches leave dbc_pool_address
    // NULL (it's irrelevant for them).
    const liveUpdate: Record<string, unknown> = {
      status: 'live',
      mint_address: result.mintAddress,
      pump_fun_url: result.pumpFunUrl,
      launched_at: new Date().toISOString(),
      pool_token_balance: result.tokensReceived,
    };
    // Bags tokens launch onto Meteora DBC pools under the hood, so the
    // Bags adapter populates dbcPoolAddress on its LaunchOutcome the
    // same way the Meteora adapter does. Persisting it under the same
    // column lets the existing Meteora fee-collection cron drain Bags
    // launches with zero new code.
    if ((platform === 'meteora' || platform === 'bags') && result.dbcPoolAddress) {
      liveUpdate.dbc_pool_address = result.dbcPoolAddress;
    }
    await supabase.from('memes').update(liveUpdate).eq('id', meme_id);

    await supabase.rpc('increment_successful_launches', { wallet: meme.creator_wallet });

    console.log(`Pooled launch complete: ${result.tokensReceived} tokens in pool ${meme.pool_wallet}`);

    // Fire launch.live webhook for partner-attributed launches.
    // Best-effort, non-blocking — the launch is already complete on-chain.
    const { firePartnerEvent } = await import('@/lib/partnerWebhooks');
    void firePartnerEvent(supabase, { type: 'launch.live', meme_id });

    // ── Self-custody enrollment (feature flag) ──────────────────────
    // After the launch tx confirms, seal the pool wallet's secret key
    // to an X25519 pubkey derived from the creator's deterministic
    // signature. The sealed blob is stored in creator_sealed_pool_key
    // and can only be decrypted by the creator's wallet re-signing the
    // same derivation message.
    //
    // CRITICAL: this step must NEVER fail the launch. If anything in
    // the seal pipeline errors, we log it, keep the platform-encrypted
    // backup intact, and continue. The launch already succeeded.
    if (isWalletClaimEnabled() && derivation_signature && meme.encrypted_pool_key) {
      try {
        const sigBytes = bs58.decode(derivation_signature);
        if (sigBytes.length !== 64) {
          throw new Error(`derivation_signature must be 64 bytes, got ${sigBytes.length}`);
        }
        const poolSecretB58 = decryptPrivateKey(meme.encrypted_pool_key);
        const poolSecretBytes = bs58.decode(poolSecretB58);
        if (poolSecretBytes.length !== 64) {
          throw new Error(`pool secret key must be 64 bytes, got ${poolSecretBytes.length}`);
        }

        const { sealed } = await sealPoolKeyForCreator({
          poolSecretKey: poolSecretBytes,
          derivationSignature: sigBytes,
        });

        // Sanity: structural verification of the blob before persisting.
        // sealPoolKeyForCreator already round-trip verified, but cheap
        // double-check defense in depth.
        if (!isStructurallyValidSealedBlob(sealed)) {
          throw new Error('seal produced structurally invalid blob');
        }

        // Persist. Immutability trigger means this UPDATE can only
        // succeed if creator_sealed_pool_key was previously NULL —
        // re-attempting after success is silently rejected by Postgres,
        // which is the correct behavior.
        const verifiedAt = new Date().toISOString();
        const { error: sealUpdateError } = await supabase
          .from('memes')
          .update({
            creator_sealed_pool_key: sealed,
            creator_sealed_pool_key_verified_at: verifiedAt,
          })
          .eq('id', meme_id);
        if (sealUpdateError) {
          throw new Error(`DB update failed: ${sealUpdateError.message}`);
        }

        await supabase.from('wallet_claim_events').insert({
          meme_id,
          event: 'sealed_at_launch',
          details: { verified_at: verifiedAt, blob_length_bytes: sealed.length },
        });

        // Zero the plaintext in our buffer. JS GC can't fully guarantee
        // this isn't sitting in another heap region, but every safe step.
        poolSecretBytes.fill(0);
        sigBytes.fill(0);

        console.log(`[wallet-claim] sealed pool key for meme ${meme_id}, verified at ${verifiedAt}`);
      } catch (e) {
        // Non-fatal. Platform-encrypted backup remains intact; creator
        // can still claim later via the backfill path (Phase 5) once we
        // have time to investigate why this launch's seal failed.
        console.error(`[wallet-claim] seal at launch failed for meme ${meme_id} (non-fatal):`, e);
        await supabase.from('wallet_claim_events').insert({
          meme_id,
          event: 'sealed_at_launch',
          details: { error: e instanceof Error ? e.message : String(e), ok: false },
        }).then(() => {}, () => { /* audit log insert failure also non-fatal */ });
      }
    }

    // Distribution is AUTOMATIC: the platform pushes each backer's
    // proportional share to their wallet immediately, in this same
    // request — no human "Distribute" click required. settlePoolDistribution
    // is shared + idempotent, so the manual button (retry) and the
    // reconcile cron (backstop) remain safe no-ops once this completes.
    // Best-effort: a partial/failed distribution must NOT fail an
    // otherwise-successful launch — the cron finishes any remainder.
    let distribution: { distributed: number; remaining: number } | undefined;
    try {
      const d = await settlePoolDistribution(supabase, meme_id, launchLog);
      distribution = { distributed: d.distributed, remaining: d.remaining };
      console.log(`Auto-distribute: ${d.distributed} sent, ${d.remaining} pending (cron backstop)`);
    } catch (e) {
      console.error('Auto-distribute error (cron will finish):', e);
    }

    return NextResponse.json({
      success: true,
      mint_address: result.mintAddress,
      pump_fun_url: result.pumpFunUrl,
      create_signature: result.createSignature,
      pool_wallet: result.poolWallet,
      pool_token_balance: result.tokensReceived,
      total_backers: backings.length,
      distribution,
    });
  } catch (error) {
    console.error('Launch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
