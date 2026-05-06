import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyDeposit, getEscrowAddress } from '@/services/pumpfun';
import { encryptPrivateKey } from '@/lib/crypto';
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
      .select('*, memes(id, name, symbol, image_url, status, total_slots, backing_goal_sol, current_backing_sol, backing_deadline, mint_address, pump_fun_url, trust_score)')
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

    // Encrypt the private key with AES-256-GCM before storing
    const storedPrivateKey = encryptPrivateKey(burner_private_key);

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

    // Validate minimum backing amount (set by creator)
    const minBacking = Number(meme.min_backing_sol) || 0.05;
    if (amount_sol < minBacking) {
      return NextResponse.json(
        { error: `Minimum backing is ${minBacking} SOL` },
        { status: 400 }
      );
    }

    // Check if this wallet already has an active backing
    const { data: existingBacking } = await supabase
      .from('backings')
      .select('id, amount_sol')
      .eq('meme_id', meme_id)
      .eq('backer_wallet', backer_wallet)
      .neq('status', 'withdrawn')
      .single();

    // Don't allow multiple backings from the same wallet
    if (existingBacking) {
      return NextResponse.json(
        {
          error: `You already have an active backing of ${Number(existingBacking.amount_sol).toFixed(2)} SOL. Withdraw first if you want to change your backing amount.`,
        },
        { status: 400 }
      );
    }

    // Count current confirmed backings to check slot availability
    const { count: currentBackerCount } = await supabase
      .from('backings')
      .select('id', { count: 'exact', head: true })
      .eq('meme_id', meme_id)
      .neq('status', 'withdrawn');

    const totalSlots = Number(meme.total_slots) || 8;
    const filledSlots = currentBackerCount || 0;

    if (filledSlots >= totalSlots) {
      return NextResponse.json(
        { error: 'All backer slots are filled' },
        { status: 400 }
      );
    }

    // Assign slot number (1-indexed)
    const slotNumber = filledSlots + 1;
    const slotTier = slotNumber <= 4 ? 'Genesis' : 'Wave 2';

    // Verify the deposit transaction on-chain
    let isValid = false;
    try {
      isValid = await verifyDeposit(deposit_tx, amount_sol, backer_wallet);
    } catch (verifyError) {
      console.error('Verification error:', verifyError);
    }

    if (!isValid) {
      return NextResponse.json(
        { error: 'Could not verify deposit on-chain. Please try again.' },
        { status: 400 }
      );
    }

    // Ensure user exists
    await supabase
      .from('users')
      .upsert({ wallet_address: backer_wallet }, { onConflict: 'wallet_address' });

    // Create new backing with burner wallet info and slot number
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
        slot_number: slotNumber,
      })
      .select()
      .single();

    console.log(`Backing created: slot ${slotNumber} (${slotTier}) for ${amount_sol} SOL`);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check if all slots are now filled - if so, update status to funded
    const newFilledSlots = slotNumber; // We just filled this slot
    const allSlotsFilled = newFilledSlots >= totalSlots;

    if (allSlotsFilled && meme.status === 'backing') {
      console.log(`All ${totalSlots} slots filled for ${meme.name}! Updating to funded status.`);

      // Update status to funded - creator will launch via the launch button
      await supabase
        .from('memes')
        .update({ status: 'funded' })
        .eq('id', meme_id);

      return NextResponse.json({
        backing: data,
        slotNumber,
        slotTier,
        allSlotsFilled: true,
        message: `All slots filled! Token is ready to launch. You claimed slot ${slotNumber} (${slotTier}).`,
      }, { status: 201 });
    }

    return NextResponse.json({
      backing: data,
      slotNumber,
      slotTier,
      slotsRemaining: totalSlots - slotNumber,
      message: `You claimed slot ${slotNumber} (${slotTier}). ${totalSlots - slotNumber} slots remaining.`,
    }, { status: 201 });
  } catch (error) {
    console.error('Create backing error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Backing failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// GET escrow address (separate endpoint would be cleaner but keeping simple)
export async function OPTIONS() {
  return NextResponse.json({ escrow_address: getEscrowAddress() });
}
