import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyPoolDeposit, getEscrowAddress } from '@/services/pumpfun';
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
      deposit_tx, // tx that sent amount_sol from backer -> meme's pool wallet
    } = body;

    // Validation
    if (!meme_id || !backer_wallet || !amount_sol || !deposit_tx) {
      return NextResponse.json(
        { error: 'Missing required fields: meme_id, backer_wallet, amount_sol, deposit_tx' },
        { status: 400 }
      );
    }

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

    // ── Visibility gate (Launch Configuration v2 — Phase 1) ──────────
    // `open` launches accept anyone (the default + legacy behavior).
    // `stealth` and `spectator` launches require the backer's wallet
    // to be in this meme's backing_allowlist. The creator controls the
    // list via their dashboard. Auto-flips to open at funded status.
    //
    // We check this BEFORE pool / deadline / amount validation so
    // un-allowlisted wallets don't leak any other meme state in errors.
    if (meme.visibility === 'stealth' || meme.visibility === 'spectator') {
      const { data: allowed } = await supabase
        .from('backing_allowlist')
        .select('id')
        .eq('meme_id', meme_id)
        .eq('wallet', backer_wallet)
        .maybeSingle();

      if (!allowed) {
        return NextResponse.json(
          {
            error: 'This launch is in a restricted backing round. Your wallet is not on the allowlist.',
            visibility: meme.visibility,
          },
          { status: 403 },
        );
      }
    }

    // Pooled model: backers fund the meme's pool wallet. New memes are
    // provisioned with one at submission; reject if somehow missing.
    if (!meme.pool_wallet) {
      return NextResponse.json(
        { error: 'This meme has no pool wallet (legacy or misprovisioned) and cannot accept pooled backings' },
        { status: 400 }
      );
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

    // Team-fairness cap (migration 032). Creator-set ceiling at submission.
    // Universal: applies equally to allowlisted and public backers, so no
    // wallet can out-back any other. NULL = no cap (default — casual launch).
    const cap = meme.max_backing_sol != null ? Number(meme.max_backing_sol) : null;
    if (cap !== null && amount_sol > cap + 1e-9) {
      return NextResponse.json(
        {
          error: `This launch has a per-backer ceiling of ${cap} SOL (team-fairness cap). Your backing of ${amount_sol} SOL exceeds it.`,
          max_backing_sol: cap,
        },
        { status: 400 },
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

    // Find the lowest unfilled slot — fixes a bug where the previous algorithm
    // (count + 1) ignored withdrawn slots in the count but assigned sequential
    // numbers, producing duplicate slot_numbers when an earlier slot was
    // withdrawn and a new backer came in.
    const { data: activeSlotRows } = await supabase
      .from('backings')
      .select('slot_number')
      .eq('meme_id', meme_id)
      .neq('status', 'withdrawn');

    const taken = new Set((activeSlotRows || []).map((r) => Number(r.slot_number)));
    const totalSlots = Number(meme.total_slots) || 8;
    const reservedSlots = Number(meme.reserved_slots) || 0;
    const openSlots = Math.max(0, totalSlots - reservedSlots);

    // Reserved-slot gate (migration 037). When reserved_slots > 0, the
    // LAST `reservedSlots` positions (slots openSlots+1 .. totalSlots)
    // are reserved for wallets in the backing_allowlist. Non-allowlisted
    // backers can only take slots 1..openSlots.
    let isAllowlisted = true;
    if (reservedSlots > 0) {
      const { data: allowed } = await supabase
        .from('backing_allowlist')
        .select('id')
        .eq('meme_id', meme_id)
        .eq('wallet', backer_wallet)
        .maybeSingle();
      isAllowlisted = !!allowed;
    }
    const maxSlot = isAllowlisted ? totalSlots : openSlots;

    let slotNumber = 0;
    for (let i = 1; i <= maxSlot; i++) {
      if (!taken.has(i)) { slotNumber = i; break; }
    }
    if (slotNumber === 0) {
      const allOpenFilled = !isAllowlisted && reservedSlots > 0;
      return NextResponse.json(
        {
          error: allOpenFilled
            ? `All ${openSlots} open slots are filled. The remaining ${reservedSlots} slots are reserved for allowlisted wallets.`
            : 'All backer slots are filled',
          reserved_slots: reservedSlots,
          open_slots: openSlots,
        },
        { status: 400 }
      );
    }

    const slotTier = slotNumber <= 4 ? 'Genesis' : 'Wave 2';

    // Verify on-chain: backer sent amount_sol to THIS meme's pool wallet
    let isValid = false;
    try {
      isValid = await verifyPoolDeposit(deposit_tx, amount_sol, backer_wallet, meme.pool_wallet);
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

    // Create the backing (pooled model — no per-backer burner; the
    // backer's SOL is already in the meme's pool wallet, verified above)
    const { data, error } = await supabase
      .from('backings')
      .insert({
        meme_id,
        backer_wallet,
        amount_sol,
        deposit_tx,
        status: 'confirmed',
        slot_number: slotNumber,
      })
      .select()
      .single();

    console.log(`Backing created: slot ${slotNumber} (${slotTier}) for ${amount_sol} SOL`);

    if (error) {
      // Postgres unique violation: another backing claimed this slot in a race window
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'That slot was just claimed by another backer. Please retry.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check if all slots are now filled - if so, update status to funded.
    // Use the active (non-withdrawn) backing COUNT, not slotNumber:
    // slotNumber is the lowest open slot, so when a previously-withdrawn
    // middle slot is the last to refill, slotNumber < totalSlots even
    // though every slot is now taken. `taken` was computed pre-insert and
    // excludes withdrawn, so active count = taken.size + 1 (this insert).
    const newFilledSlots = taken.size + 1;
    const allSlotsFilled = newFilledSlots >= totalSlots;

    if (allSlotsFilled && meme.status === 'backing') {
      console.log(`All ${totalSlots} slots filled for ${meme.name}! Updating to funded status.`);

      // Set funded_at NOW so the 24h launch-deadline cron can start
      // its countdown. If the creator doesn't launch within 24h,
      // process-memes auto-refunds every backer. Pre-019 funded memes
      // (PROOF) keep funded_at NULL and are exempt forever.
      await supabase
        .from('memes')
        .update({ status: 'funded', funded_at: new Date().toISOString() })
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
