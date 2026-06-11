import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyPoolDeposit, getEscrowAddress, refundFromPool } from '@/services/pumpfun';
import { rateLimiters } from '@/lib/rateLimit';

// Helper — refund a confirmed-but-rejected deposit straight from the pool
// wallet back to the backer (0% fee since we're rejecting their backing
// through no fault of theirs). Returns a NextResponse with both the
// error context AND the refund tx so the client UI can show "rejected
// → refunded" in one shot. Used by every post-verify rejection path so
// the quote currency can't be stranded in a pool wallet after a
// server-side rule fires.
//
// Quote-currency branch (migration 053). When the meme is USDC-quoted,
// we route through sendUsdcFromPool (SPL transfer) instead of
// refundFromPool (SystemProgram.transfer of lamports). Existing memes
// (quote_currency='sol') go through the unchanged SOL path.
async function rejectAndRefund(
  meme: {
    id: string;
    pool_wallet: string;
    encrypted_pool_key: string;
    quote_currency?: 'sol' | 'usdc';
  },
  backerWallet: string,
  amountSol: number,
  error: string,
  status = 400,
  extra: Record<string, unknown> = {},
): Promise<NextResponse> {
  try {
    let result: { success: boolean; signature?: string; amountRefunded?: number; error?: string };
    if (meme.quote_currency === 'usdc') {
      const { sendUsdcFromPool } = await import('@/lib/usdc');
      const { decryptPrivateKey } = await import('@/lib/crypto');
      const { Connection, Keypair, PublicKey } = await import('@solana/web3.js');
      const bs58Mod = await import('bs58');
      const conn = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
        'confirmed',
      );
      const poolKp = Keypair.fromSecretKey(bs58Mod.default.decode(decryptPrivateKey(meme.encrypted_pool_key)));
      const usdcResult = await sendUsdcFromPool({
        conn,
        poolKp,
        destOwner: new PublicKey(backerWallet),
        amount: amountSol, // amount_sol = "quote units" for USDC memes
        label: `reject-refund-usdc:${meme.id.slice(0, 8)}`,
      });
      result = {
        success: usdcResult.ok,
        signature: usdcResult.signature,
        amountRefunded: usdcResult.ok ? amountSol : undefined,
        error: usdcResult.error,
      };
    } else {
      result = await refundFromPool(
        meme.encrypted_pool_key,
        meme.pool_wallet,
        backerWallet,
        amountSol,
        0,
      );
    }
    if (result.success) {
      return NextResponse.json(
        {
          error,
          refunded: true,
          refund_tx: result.signature,
          refund_amount_sol: result.amountRefunded,
          ...extra,
        },
        { status },
      );
    }
    // Refund itself failed — surface both errors so support can act.
    return NextResponse.json(
      {
        error: `${error} — auto-refund FAILED (${result.error || 'unknown'}). Contact support with your deposit tx so we can recover the funds manually.`,
        refunded: false,
        refund_failure: result.error,
        ...extra,
      },
      { status: 500 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: `${error} — auto-refund crashed (${e instanceof Error ? e.message : 'unknown'}). Contact support with your deposit tx.`,
        refunded: false,
        ...extra,
      },
      { status: 500 },
    );
  }
}

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

    // Check if meme exists.
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('*')
      .eq('id', meme_id)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // Pooled model: backers fund the meme's pool wallet. New memes are
    // provisioned with one at submission; reject if somehow missing.
    if (!meme.pool_wallet || !meme.encrypted_pool_key) {
      return NextResponse.json(
        { error: 'This meme has no pool wallet (legacy or misprovisioned) and cannot accept pooled backings' },
        { status: 400 }
      );
    }

    // ── Verify on-chain deposit FIRST ────────────────────────────────
    // Everything after this point assumes the quote currency is
    // confirmed in the pool wallet. Any subsequent rejection MUST refund
    // via rejectAndRefund so funds can't be stranded by a server-side
    // rule fire. Pre-verify rejections (above) don't need to refund
    // because we can't prove the deposit even landed.
    //
    // Quote-currency branch (migration 053). USDC memes route to the
    // SPL verifier in src/lib/usdc — checks token-balance deltas
    // instead of native lamport deltas. SOL is unchanged.
    let isValid = false;
    try {
      if (meme.quote_currency === 'usdc') {
        const { verifyPoolUsdcDeposit } = await import('@/lib/usdc');
        const { Connection } = await import('@solana/web3.js');
        const usdcConn = new Connection(
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
          'confirmed',
        );
        isValid = await verifyPoolUsdcDeposit(
          usdcConn,
          deposit_tx,
          amount_sol, // `amount_sol` is the canonical "backing size in quote units"
          backer_wallet,
          meme.pool_wallet,
        );
      } else {
        isValid = await verifyPoolDeposit(deposit_tx, amount_sol, backer_wallet, meme.pool_wallet);
      }
    } catch (verifyError) {
      console.error('Verification error:', verifyError);
    }
    if (!isValid) {
      return NextResponse.json(
        { error: 'Could not verify deposit on-chain. Please try again.' },
        { status: 400 }
      );
    }

    // ── From here on, SOL is confirmed in the pool. Every reject MUST
    //    use rejectAndRefund so the backer gets their SOL back. ─────────
    const poolForRefund = {
      id: meme.id,
      pool_wallet: meme.pool_wallet,
      encrypted_pool_key: meme.encrypted_pool_key,
      // Threaded through so post-verify rejections refund in the right
      // currency. Defaults to 'sol' (legacy memes pre-migration 053).
      quote_currency: (meme.quote_currency as 'sol' | 'usdc' | undefined) ?? 'sol',
    };

    if (meme.status !== 'backing') {
      return rejectAndRefund(
        poolForRefund, backer_wallet, amount_sol,
        `Meme is not accepting backings (status: ${meme.status})`,
      );
    }

    if (new Date(meme.backing_deadline) < new Date()) {
      return rejectAndRefund(
        poolForRefund, backer_wallet, amount_sol,
        'Backing period has ended',
      );
    }

    // Visibility gate — stealth/spectator launches restrict backing
    // to allowlisted wallets. Refund non-allowlist deposits.
    if (meme.visibility === 'stealth' || meme.visibility === 'spectator') {
      const { data: allowed } = await supabase
        .from('backing_allowlist')
        .select('id')
        .eq('meme_id', meme_id)
        .eq('wallet', backer_wallet)
        .maybeSingle();
      if (!allowed) {
        return rejectAndRefund(
          poolForRefund, backer_wallet, amount_sol,
          'This launch is in a restricted backing round. Your wallet is not on the allowlist.',
          403,
          { visibility: meme.visibility },
        );
      }
    }

    // Min backing amount.
    const minBacking = Number(meme.min_backing_sol) || 0.05;
    if (amount_sol < minBacking) {
      return rejectAndRefund(
        poolForRefund, backer_wallet, amount_sol,
        `Minimum backing is ${minBacking} SOL`,
      );
    }

    // Team-fairness cap.
    const cap = meme.max_backing_sol != null ? Number(meme.max_backing_sol) : null;
    if (cap !== null && amount_sol > cap + 1e-9) {
      return rejectAndRefund(
        poolForRefund, backer_wallet, amount_sol,
        `This launch has a per-backer ceiling of ${cap} SOL (team-fairness cap). Your backing of ${amount_sol} SOL exceeds it.`,
        400,
        { max_backing_sol: cap },
      );
    }

    // Existing-backing check — one active backing per wallet per meme.
    const { data: existingBacking } = await supabase
      .from('backings')
      .select('id, amount_sol')
      .eq('meme_id', meme_id)
      .eq('backer_wallet', backer_wallet)
      .neq('status', 'withdrawn')
      .single();
    if (existingBacking) {
      return rejectAndRefund(
        poolForRefund, backer_wallet, amount_sol,
        `You already have an active backing of ${Number(existingBacking.amount_sol).toFixed(2)} SOL. Withdraw first if you want to change your backing amount.`,
      );
    }

    // Slot assignment + reserved-slot gate.
    const { data: activeSlotRows } = await supabase
      .from('backings')
      .select('slot_number')
      .eq('meme_id', meme_id)
      .neq('status', 'withdrawn');
    const taken = new Set((activeSlotRows || []).map((r) => Number(r.slot_number)));
    const totalSlots = Number(meme.total_slots) || 8;
    const reservedSlots = Number(meme.reserved_slots) || 0;
    const openSlots = Math.max(0, totalSlots - reservedSlots);

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
    // Slot assignment respects the open/reserved structure.
    //
    // Allowlisted backers PREFER reserved slots (openSlots+1..totalSlots).
    // This keeps the OPEN bucket (1..openSlots) for the public; without
    // it, team backers would consume open slot numbers (since they were
    // assigned monotonically from 1) and starve public backers of room
    // even when reserved capacity remained.
    //
    // Falls through to open slots only if all reserved are taken
    // (more allowlisted backers than reserved capacity).
    //
    // Non-allowlisted backers are confined to 1..openSlots — unchanged.
    // Memes with reservedSlots=0 skip the preference block entirely
    // and walk 1..totalSlots monotonically — also unchanged.
    let slotNumber = 0;
    if (isAllowlisted && reservedSlots > 0) {
      for (let i = openSlots + 1; i <= totalSlots; i++) {
        if (!taken.has(i)) { slotNumber = i; break; }
      }
    }
    if (slotNumber === 0) {
      const maxSlot = isAllowlisted ? totalSlots : openSlots;
      for (let i = 1; i <= maxSlot; i++) {
        if (!taken.has(i)) { slotNumber = i; break; }
      }
    }
    if (slotNumber === 0) {
      const allOpenFilled = !isAllowlisted && reservedSlots > 0;
      return rejectAndRefund(
        poolForRefund, backer_wallet, amount_sol,
        allOpenFilled
          ? `All ${openSlots} open slots are filled. The remaining ${reservedSlots} slots are reserved for allowlisted wallets.`
          : 'All backer slots are filled',
        400,
        { reserved_slots: reservedSlots, open_slots: openSlots },
      );
    }

    const slotTier = slotNumber <= 4 ? 'Genesis' : 'Wave 2';

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
      // Postgres unique violation: another backing claimed this slot
      // in the race window between our slot-find and our insert.
      // Both backers's SOL hit the pool wallet; the loser gets refunded
      // here so they don't have to chase support.
      if ((error as { code?: string }).code === '23505') {
        return rejectAndRefund(
          poolForRefund, backer_wallet, amount_sol,
          'That slot was just claimed by another backer. Please retry.',
          409,
        );
      }
      // Unknown DB failure — try to refund so the SOL isn't stranded,
      // but surface the original error too for debugging.
      return rejectAndRefund(
        poolForRefund, backer_wallet, amount_sol,
        `Backing insert failed: ${error.message}`,
        500,
      );
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
