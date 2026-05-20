import { NextRequest, NextResponse } from 'next/server';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { createServerClient } from '@/lib/supabase';
import { verifyDeposit } from '@/services/pumpfun';
import { encryptPrivateKey } from '@/lib/crypto';

// GET /api/memes - List all memes with optional filters
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const creator = searchParams.get('creator');
    const limit = parseInt(searchParams.get('limit') || '1000');
    const offset = parseInt(searchParams.get('offset') || '0');
    // Hide expired memes after 24 hours by default (unless querying specific creator)
    const includeStaleExpired = searchParams.get('includeStaleExpired') === 'true';

    let query = supabase
      .from('memes_with_stats')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (creator) {
      query = query.eq('creator_wallet', creator);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter out expired memes older than 24 hours (unless creator is specified or includeStaleExpired)
    let filteredData = data;
    if (!creator && !includeStaleExpired) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      filteredData = data?.filter((meme) => {
        // Keep all non-backing memes (live, funded, etc.)
        if (meme.status !== 'backing') return true;
        // Keep backing memes that haven't expired yet
        const deadline = new Date(meme.backing_deadline);
        if (deadline > new Date()) return true;
        // Keep expired memes that are within 24 hours of deadline
        return deadline > twentyFourHoursAgo;
      });
    }

    return NextResponse.json({ memes: filteredData });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Required creation fee in SOL
const CREATION_FEE_SOL = 0.02; // Goes to escrow to cover launch costs

// POST /api/memes - Submit a new meme
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const {
      creator_wallet,
      name,
      symbol,
      description,
      image_url,
      creator_twitter,
      twitter,
      telegram,
      discord,
      website,
      // New slot-based backing system
      total_slots,         // 2-8 backer slots
      min_backing_sol,     // Minimum SOL per backer
      // Legacy field (unused, kept for old client compatibility)
      backing_days,
      // Legacy trust score parameters (no longer used in fee distribution)
      // All backers (including creator) now split 90% equally
      creator_fee_pct = 0, // Creator gets no special cut - must back to earn fees
      backer_share_pct = 90, // Max allowed by DB constraint (actual distribution uses feeTracker.ts)
      dev_initial_buy_sol = 0,
      trust_score = 75,
      // Creation fee payment (goes to escrow for platform costs)
      creation_fee_signature,
      creation_fee_sol,
    } = body;

    // Validation
    if (!creator_wallet || !name || !symbol || !description || !image_url) {
      const missing = [];
      if (!creator_wallet) missing.push('creator_wallet');
      if (!name) missing.push('name');
      if (!symbol) missing.push('symbol');
      if (!description) missing.push('description');
      if (!image_url) missing.push('image_url');
      console.log('Missing fields:', missing, 'Body:', JSON.stringify(body).slice(0, 500));
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(', ')}` },
        { status: 400 }
      );
    }

    // Require creation fee payment
    if (!creation_fee_signature) {
      return NextResponse.json(
        { error: 'Creation fee payment required' },
        { status: 400 }
      );
    }

    if (!creation_fee_sol || creation_fee_sol < CREATION_FEE_SOL) {
      return NextResponse.json(
        { error: `Creation fee must be at least ${CREATION_FEE_SOL} SOL` },
        { status: 400 }
      );
    }

    // Prevent replay — ensure this tx signature hasn't already been used for another meme
    const { data: existingMemeWithTx } = await supabase
      .from('memes')
      .select('id')
      .eq('creation_fee_signature', creation_fee_signature)
      .maybeSingle();
    if (existingMemeWithTx) {
      return NextResponse.json(
        { error: 'This creation fee transaction has already been used' },
        { status: 400 }
      );
    }

    // Verify the creation fee tx on-chain: creator_wallet spent >= CREATION_FEE_SOL
    // and the escrow received the fee
    const feeValid = await verifyDeposit(creation_fee_signature, CREATION_FEE_SOL, creator_wallet);
    if (!feeValid) {
      return NextResponse.json(
        { error: 'Creation fee transaction could not be verified on-chain' },
        { status: 400 }
      );
    }

    // Validate slot-based backing system
    if (!total_slots || total_slots < 2 || total_slots > 8) {
      return NextResponse.json(
        { error: 'Total slots must be between 2 and 8' },
        { status: 400 }
      );
    }

    if (!min_backing_sol || min_backing_sol < 0.05) {
      return NextResponse.json(
        { error: 'Minimum backing must be at least 0.05 SOL' },
        { status: 400 }
      );
    }

    if (symbol.length > 10) {
      return NextResponse.json(
        { error: 'Symbol must be 10 characters or less' },
        { status: 400 }
      );
    }

    // Calculate deadline
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + (backing_days || 7));

    // Ensure user exists
    const { error: userError } = await supabase
      .from('users')
      .upsert({ wallet_address: creator_wallet }, { onConflict: 'wallet_address' });

    if (userError) {
      console.error('User upsert error:', userError);
    }

    // Create meme with slot-based backing system
    const { data, error } = await supabase
      .from('memes')
      .insert({
        creator_wallet,
        name,
        symbol: symbol.toUpperCase(),
        description,
        image_url,
        creator_twitter,
        twitter,
        telegram,
        discord,
        website,
        // Slot-based backing system
        total_slots,
        min_backing_sol,
        backing_goal_sol: min_backing_sol * total_slots, // Minimum possible raise (for compatibility)
        backing_deadline: deadline.toISOString(),
        status: 'backing', // Start in backing phase
        submission_fee_paid: true, // Fee paid via creation_fee_signature
        current_backing_sol: 0, // Starts at 0, backers add to this
        // Trust score parameters
        creator_fee_pct,
        backer_share_pct,
        dev_initial_buy_sol,
        auto_refund: true, // Always auto-refund on failure - no option to hold backer funds
        trust_score,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Provision this meme's POOL wallet — the wallet backers fund and
    // that does the atomic createV2+buy at launch. This is a plain
    // RANDOM keypair: the vanity is reserved for the token CA (the
    // mint), consumed at launch — that's the most-visible address and
    // the brand signal. The pool wallet doesn't need to be vanity.
    const poolKp = Keypair.generate();
    const poolWallet = poolKp.publicKey.toBase58();
    const encryptedPoolKey = encryptPrivateKey(bs58.encode(poolKp.secretKey));

    // Also provision this meme's per-coin CREATOR sub-escrow keypair.
    // It will be passed as the `creator` arg to createV2 at launch
    // (instead of the shared platform escrow), so pump.fun's
    // creator-vault PDA is keyed per-meme — isolating this coin's
    // trading fees in its own vault we can collect from independently.
    // Holds 0% tokens, never buys, signs only at fee-distribution time.
    // Backwards compatible: launchPooledAtomic falls back to shared
    // escrow when this column is NULL (i.e. for pre-Phase-2 memes).
    const subKp = Keypair.generate();
    const subPub = subKp.publicKey.toBase58();
    const encryptedSubKey = encryptPrivateKey(bs58.encode(subKp.secretKey));

    const { error: poolErr } = await supabase
      .from('memes')
      .update({
        pool_wallet: poolWallet,
        encrypted_pool_key: encryptedPoolKey,
        creator_subescrow_pubkey: subPub,
        encrypted_creator_subescrow_key: encryptedSubKey,
      })
      .eq('id', data.id);
    if (poolErr) {
      // Pool/sub-escrow are essential — fail the submission cleanly
      // rather than leave a meme that can never launch or share fees.
      // (The co-presence CHECK constraint also guarantees we never end
      // up with one sub-escrow column set without the other.)
      await supabase.from('memes').delete().eq('id', data.id);
      return NextResponse.json({ error: `Wallet provisioning failed: ${poolErr.message}` }, { status: 500 });
    }
    (data as { pool_wallet?: string; creator_subescrow_pubkey?: string }).pool_wallet = poolWallet;
    (data as { creator_subescrow_pubkey?: string }).creator_subescrow_pubkey = subPub;

    // Note: Creation fee goes to escrow, not recorded as a backing
    // The creator's token wallet is stored on the meme itself, not as a backing record
    // This prevents the creation fee from showing in portfolio as a "backing"

    // Update user's meme count
    await supabase.rpc('increment_memes_created', { wallet: creator_wallet });

    return NextResponse.json({ meme: data }, { status: 201 });
  } catch (error) {
    console.error('Create meme error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
