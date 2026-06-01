import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { LaunchConfig } from '@/services/pumpfun';
import { launchOnPlatform, type LaunchPlatform } from '@/services/launch';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { rateLimiters } from '@/lib/rateLimit';
import { createLaunchLogger } from '@/lib/launchLog';
import { settlePoolDistribution } from '@/services/distribution';

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

    const { meme_id, caller_wallet, signature, message } = body;

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
    // shares are computed from this.
    await supabase
      .from('memes')
      .update({
        status: 'live',
        mint_address: result.mintAddress,
        pump_fun_url: result.pumpFunUrl,
        launched_at: new Date().toISOString(),
        pool_token_balance: result.tokensReceived,
      })
      .eq('id', meme_id);

    await supabase.rpc('increment_successful_launches', { wallet: meme.creator_wallet });

    console.log(`Pooled launch complete: ${result.tokensReceived} tokens in pool ${meme.pool_wallet}`);

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
