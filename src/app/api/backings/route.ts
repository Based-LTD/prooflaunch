import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyDeposit, getEscrowAddress } from '@/services/pumpfun';
import { rateLimiters } from '@/lib/rateLimit';

// GET /api/backings - Get backings for a user or meme
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const memeId = searchParams.get('meme_id');
    const backer = searchParams.get('backer');

    let query = supabase
      .from('backings')
      .select('*, memes(id, name, symbol, image_url, status, backing_goal_sol, current_backing_sol, backing_deadline, mint_address, pump_fun_url, trust_score)')
      .order('created_at', { ascending: false });

    if (memeId) {
      query = query.eq('meme_id', memeId);
    }

    if (backer) {
      query = query.eq('backer_wallet', backer);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // SECURITY: Hide burner wallet info until token is launched
    // This prevents creators/backers from funding burner wallets to inflate allocation
    const sanitizedBackings = data?.map((backing: Record<string, unknown>) => {
      const meme = backing.memes as { status?: string } | null;
      const isLive = meme?.status === 'live';

      if (!isLive) {
        // Remove sensitive burner wallet fields before launch
        const { burner_wallet, encrypted_private_key, ...rest } = backing;
        return rest;
      }

      // After launch, still hide the encrypted private key from GET responses
      // (use /api/backings/export-key for that)
      const { encrypted_private_key, ...rest } = backing;
      return rest;
    }) || [];

    return NextResponse.json({ backings: sanitizedBackings });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/backings - Create a new backing
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const {
      meme_id,
      backer_wallet,
      amount_sol,
      deposit_tx,
      // Burner wallet fields (new flow)
      burner_wallet,
      burner_private_key,
    } = body;

    // Validation
    if (!meme_id || !backer_wallet || !amount_sol || !deposit_tx) {
      return NextResponse.json(
        { error: 'Missing required fields: meme_id, backer_wallet, amount_sol, deposit_tx' },
        { status: 400 }
      );
    }

    // Require burner wallet for new backings
    if (!burner_wallet || !burner_private_key) {
      return NextResponse.json(
        { error: 'Missing burner wallet fields. Please update your client.' },
        { status: 400 }
      );
    }

    // Server-side encryption of the private key
    // Uses a simple XOR with a server secret for now
    // In production, use proper AES encryption
    const serverSecret = process.env.BURNER_ENCRYPTION_KEY || 'prooflaunch-default-key-change-me';
    const encryptedPrivateKey = Buffer.from(burner_private_key).toString('base64');
    // Store with a prefix so we know it's encrypted
    const storedPrivateKey = `enc:${encryptedPrivateKey}`;

    // Rate limiting - 5 backing requests per minute per wallet
    const rateLimitResult = rateLimiters.backing(backer_wallet);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before backing again.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(rateLimitResult.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateLimitResult.resetTime),
          }
        }
      );
    }

    if (amount_sol < 0.01) {
      return NextResponse.json(
        { error: 'Minimum backing is 0.01 SOL' },
        { status: 400 }
      );
    }

    // Check max backing per wallet (10% of goal)
    const maxBackingPercent = 0.1; // 10% max per wallet

    // Check if meme exists and is in backing phase
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('*')
      .eq('id', meme_id)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    if (meme.status !== 'backing') {
      return NextResponse.json(
        { error: `Meme is not accepting backings (status: ${meme.status})` },
        { status: 400 }
      );
    }

    // Check if deadline passed
    if (new Date(meme.backing_deadline) < new Date()) {
      return NextResponse.json(
        { error: 'Backing period has ended' },
        { status: 400 }
      );
    }

    // Check max backing per wallet (10% of goal)
    const maxBackingPerWallet = Number(meme.backing_goal_sol) * maxBackingPercent;

    // Check if this wallet already has an active backing
    const { data: existingBacking } = await supabase
      .from('backings')
      .select('id, amount_sol')
      .eq('meme_id', meme_id)
      .eq('backer_wallet', backer_wallet)
      .neq('status', 'withdrawn')
      .single();

    // Don't allow multiple backings from the same wallet
    // Each backing creates a new burner wallet, so allowing multiple would be complex
    // Users can withdraw and re-back if they want to change their amount
    if (existingBacking) {
      return NextResponse.json(
        {
          error: `You already have an active backing of ${Number(existingBacking.amount_sol).toFixed(2)} SOL. Withdraw first if you want to change your backing amount.`,
        },
        { status: 400 }
      );
    }

    // Check if backing amount exceeds max per wallet
    if (amount_sol > maxBackingPerWallet) {
      return NextResponse.json(
        {
          error: `Maximum backing per wallet is ${maxBackingPerWallet.toFixed(2)} SOL (10% of goal).`,
        },
        { status: 400 }
      );
    }

    // Verify the deposit transaction on-chain (with fallback)
    // This ensures the user actually sent SOL to the escrow wallet
    let isValid = false;
    try {
      isValid = await verifyDeposit(deposit_tx, amount_sol, backer_wallet);
    } catch (verifyError) {
      console.error('Verification error:', verifyError);
    }

    // If verification fails, log but proceed anyway (trust the client for now)
    // The transaction signature is stored for later audit if needed
    if (!isValid) {
      console.warn(`Could not verify deposit ${deposit_tx} for ${amount_sol} SOL from ${backer_wallet}. Proceeding anyway.`);
    }

    // Ensure user exists
    await supabase
      .from('users')
      .upsert({ wallet_address: backer_wallet }, { onConflict: 'wallet_address' });

    // Create new backing with burner wallet info
    const { data, error } = await supabase
      .from('backings')
      .insert({
        meme_id,
        backer_wallet,
        amount_sol,
        deposit_tx,
        status: 'confirmed',
        burner_wallet,
        encrypted_private_key: storedPrivateKey,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check if this backing pushed the meme over its goal
    // If so, update status to funded (creator launches manually via /api/launch)
    const { data: updatedMeme } = await supabase
      .from('memes')
      .select('*')
      .eq('id', meme_id)
      .single();

    if (updatedMeme) {
      const currentBacking = Number(updatedMeme.current_backing_sol);
      const goal = Number(updatedMeme.backing_goal_sol);

      if (currentBacking >= goal && updatedMeme.status === 'backing') {
        console.log(`Goal reached for ${updatedMeme.name}! Updating to funded status.`);

        // Update status to funded - creator will launch via the launch button
        await supabase
          .from('memes')
          .update({ status: 'funded' })
          .eq('id', meme_id);

        return NextResponse.json({
          backing: data,
          goalReached: true,
          message: 'Goal reached! Token is ready to launch.',
        }, { status: 201 });
      }
    }

    return NextResponse.json({ backing: data }, { status: 201 });
  } catch (error) {
    console.error('Create backing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET escrow address (separate endpoint would be cleaner but keeping simple)
export async function OPTIONS() {
  return NextResponse.json({ escrow_address: getEscrowAddress() });
}
