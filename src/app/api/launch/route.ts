import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { launchPooledAtomic, LaunchConfig } from '@/services/pumpfun';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { rateLimiters } from '@/lib/rateLimit';
import { createLaunchLogger } from '@/lib/launchLog';

// Launch can take ~36s of Jito bundle retries + RPC fallback + buys.
// Without this the platform default would kill it mid-launch.
export const maxDuration = 300;

// POST /api/launch - Launch a funded meme token via batched RPC buys
// Creates token on pump.fun, then executes buys from each backer's burner wallet
// Genesis (slots 1-4) buy first at best prices, Wave 2 (slots 5-8) follow in second wave
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
    };

    console.log(`Launching ${config.name} via pooled-atomic from pool ${meme.pool_wallet}`);

    // ONE atomic createV2+buy from the pool wallet (zero sniper gap,
    // dev holds 0%). Logger persists every step to launch_events.
    const launchLog = createLaunchLogger(meme_id);
    const result = await launchPooledAtomic(
      config, meme.encrypted_pool_key, meme.pool_wallet, launchLog
    );

    if (!result.success || !result.mintAddress || !result.tokensReceived) {
      await supabase.from('memes').update({ status: 'funded' }).eq('id', meme_id);
      console.error('Pooled launch failed:', result.error);
      return NextResponse.json(
        { error: result.error || 'Launch failed' },
        { status: 500 }
      );
    }

    // Live. Record the pool's token balance — backers' proportional
    // claims are computed from this. Distribution is a SEPARATE step
    // (/api/claim); backings stay 'confirmed' until claimed.
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

    return NextResponse.json({
      success: true,
      mint_address: result.mintAddress,
      pump_fun_url: result.pumpFunUrl,
      create_signature: result.createSignature,
      pool_wallet: result.poolWallet,
      pool_token_balance: result.tokensReceived,
      total_backers: backings.length,
    });
  } catch (error) {
    console.error('Launch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
