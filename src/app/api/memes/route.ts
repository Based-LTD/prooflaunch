import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { createServerClient } from '@/lib/supabase';
import { verifyDeposit } from '@/services/pumpfun';
import { encryptPrivateKey } from '@/lib/crypto';

// Free submission perk for PROOF holders.
// Holding >= this many PROOF (UI amount, 6 decimals) waives the 0.02 SOL
// submission fee. Threshold tunable via env (PROOF_FREE_SUBMISSION_MIN_TOKENS).
const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const PROOF_DECIMALS = 6;
const FREE_SUBMISSION_THRESHOLD_TOKENS = Number(
  process.env.PROOF_FREE_SUBMISSION_MIN_TOKENS || '500000',
);

// Reads creator's effective PROOF balance (direct + Streamflow-locked) and
// returns true if it meets the free-submission threshold. Conservative: any
// RPC error returns false (= fee required), so we never accidentally waive
// the fee due to an upstream failure.
async function qualifiesForFreeSubmission(creatorWallet: string): Promise<boolean> {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!rpcUrl) return false;
  try {
    const conn = new Connection(rpcUrl, 'confirmed');
    const owner = new PublicKey(creatorWallet);
    const mint = new PublicKey(PROOF_MINT);
    const accts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    const directBalance = accts.value.reduce(
      (sum: number, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0),
      0,
    );
    // Phase 1: direct balance only. Streamflow-locked support can be added
    // later — most holders just hold liquid. Simpler to ship.
    return directBalance >= FREE_SUBMISSION_THRESHOLD_TOKENS;
  } catch (e) {
    console.warn('qualifiesForFreeSubmission RPC error:', e instanceof Error ? e.message : e);
    return false; // fail-closed: require the fee on any uncertainty
  }
}

// GET /api/memes - List all memes with optional filters
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const creator = searchParams.get('creator');
    const limit = parseInt(searchParams.get('limit') || '1000');
    const offset = parseInt(searchParams.get('offset') || '0');
    // Hide expired-backing memes from listings immediately (no grace period).
    // Exemptions: when querying a specific creator (so they/their backers can
    // still see + handle refunds in Portfolio), or when explicitly requested
    // via includeStaleExpired=true (admin / debug use).
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

    // Hide failed/expired memes from public listings IMMEDIATELY.
    // Whitelist what's allowed to show — defends against any new failure-
    // shaped statuses (refunded, cancelled, etc.) added later without us
    // having to revisit this filter.
    //   - 'backing'  → show only if deadline hasn't passed
    //   - 'funded'   → always (filled pool, awaiting launch)
    //   - 'live'     → always (already launched, trading)
    //   - everything else (failed, refunded, etc.) → HIDDEN
    // Plus visibility filter (Launch Config v2 — Phase 1):
    //   - 'open'      → show normally
    //   - 'spectator' → show (public listing, only backing is gated)
    //   - 'stealth'   → HIDE from public listings (creator-scoped queries
    //                   are exempt so creators see their own stealth launches)
    // Creator-scoped queries (Portfolio) and admin (includeStaleExpired)
    // remain exempt so refunds can still be tracked / handled.
    let filteredData = data;
    if (!creator && !includeStaleExpired) {
      const now = new Date();
      const PUBLIC_STATUSES = new Set(['backing', 'funded', 'live']);
      filteredData = data?.filter((meme) => {
        if (!PUBLIC_STATUSES.has(meme.status)) return false;
        // Hide stealth launches from public listings — they only become
        // visible when the creator flips visibility (manually or auto on funded)
        if (meme.visibility === 'stealth') return false;
        // For backing memes, also require an unexpired deadline
        if (meme.status === 'backing') {
          const deadline = new Date(meme.backing_deadline);
          return deadline > now;
        }
        return true;
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
      total_slots,         // 2-24 backer slots
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
      // Partner attribution — set when the user arrived via a partner
      // hosted-checkout URL (?session=pls_xxx). The session row carries
      // the partner_id and validation context.
      partner_session_id,
      // Launch Configuration v2 — visibility mode + initial allowlist.
      // visibility defaults to 'open' (legacy behavior). Stealth and
      // spectator require an allowlist; the creator's own wallet is
      // auto-added below so they can always back their own launch.
      visibility = 'open',
      initial_allowlist = [],
      // Launch Configuration v2 — fee distribution preset + percentages.
      // All five _pct fields must sum to 100. fee_preset is the user's
      // chosen template ('standard' | 'community_first' | ... | 'custom').
      // If fee_preset is missing entirely we leave the columns NULL,
      // which the distribution code treats as "use legacy hardcoded".
      fee_preset,
      fee_backer_pct,
      fee_holder_rewards_pct,
      fee_platform_pct,
      fee_burn_pct,
      fee_charity_pct,
      fee_charity_wallet,
      // Phase 3 — Buyback bot (migration 031). When enabled, a system-
      // controlled wallet takes one slot and accrues fees like any backer;
      // a cron periodically buys + executes the chosen action.
      buyback_bot_enabled = false,
      buyback_bot_action,
    } = body;

    // ── Partner session lookup (optional) ──────────────────────────
    // If a partner_session_id was supplied, look it up and validate it
    // BEFORE we charge any fees. Reject early if the session is dead so
    // the user doesn't pay the creation fee on a doomed submission.
    let partnerSessionRow: {
      id: string; partner_id: string; creator_wallet: string;
      status: string; expires_at: string; meme_id: string | null;
    } | null = null;
    if (partner_session_id) {
      const { data: sess, error: sessErr } = await supabase
        .from('partner_sessions')
        .select('id, partner_id, creator_wallet, status, expires_at, meme_id')
        .eq('id', partner_session_id)
        .maybeSingle();
      if (sessErr) {
        console.error('Partner session lookup error:', sessErr);
        return NextResponse.json({ error: 'Failed to validate partner session' }, { status: 500 });
      }
      if (!sess) {
        return NextResponse.json({ error: 'Partner session not found' }, { status: 400 });
      }
      if (sess.status !== 'pending') {
        return NextResponse.json({ error: `Partner session is ${sess.status} and cannot be used` }, { status: 400 });
      }
      if (new Date(sess.expires_at) <= new Date()) {
        return NextResponse.json({ error: 'Partner session has expired' }, { status: 400 });
      }
      // Wallet identity check: only the wallet the partner registered can
      // complete the session. Prevents an attacker from hijacking someone
      // else's checkout link to mint a token under their name.
      if (sess.creator_wallet !== creator_wallet) {
        return NextResponse.json(
          { error: 'Connected wallet does not match the partner session creator_wallet' },
          { status: 403 },
        );
      }
      partnerSessionRow = sess;
    }

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

    // Check for free-submission perk: holding >= threshold PROOF waives the
    // 0.02 SOL creation fee. Fail-closed: any RPC issue → fee required as
    // normal.
    const freeSubmission = await qualifiesForFreeSubmission(creator_wallet);

    if (!freeSubmission) {
      // Require creation fee payment
      if (!creation_fee_signature) {
        return NextResponse.json(
          { error: `Creation fee payment required (or hold ≥${FREE_SUBMISSION_THRESHOLD_TOKENS.toLocaleString()} PROOF for free submissions)` },
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
    } else {
      console.log(`Free submission granted to ${creator_wallet} (PROOF holder perk)`);
    }

    // Validate slot-based backing system (max raised 8 → 24 in migration 021)
    if (!total_slots || total_slots < 2 || total_slots > 24) {
      return NextResponse.json(
        { error: 'Total slots must be between 2 and 24' },
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

    // ── Visibility validation (Launch Config v2 — Phase 1) ──────────
    const VALID_VISIBILITIES = new Set(['open', 'stealth', 'spectator']);
    if (!VALID_VISIBILITIES.has(visibility)) {
      return NextResponse.json(
        { error: `visibility must be one of: open, stealth, spectator` },
        { status: 400 },
      );
    }
    // Fee distribution validation (Launch Config v2 — Phase 2). When
    // fee_preset is supplied, all five _pct fields must be present,
    // each 0-100, summing to exactly 100. Charity wallet required when
    // fee_charity_pct > 0. Missing fee_preset = NULL row = legacy behavior.
    const VALID_FEE_PRESETS = new Set(['standard', 'community_first', 'deflationary', 'charity_aligned', 'custom']);
    if (fee_preset !== undefined && fee_preset !== null) {
      if (!VALID_FEE_PRESETS.has(fee_preset)) {
        return NextResponse.json(
          { error: 'fee_preset must be one of: standard, community_first, deflationary, charity_aligned, custom' },
          { status: 400 },
        );
      }
      const pcts = [fee_backer_pct, fee_holder_rewards_pct, fee_platform_pct, fee_burn_pct, fee_charity_pct];
      if (pcts.some((p) => typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p > 100)) {
        return NextResponse.json(
          { error: 'All fee_*_pct fields must be integers 0-100' },
          { status: 400 },
        );
      }
      const sum = pcts.reduce((a: number, b: number) => a + b, 0);
      if (sum !== 100) {
        return NextResponse.json(
          { error: `Fee percentages must sum to 100 (got ${sum})` },
          { status: 400 },
        );
      }
      if (fee_charity_pct > 0) {
        if (typeof fee_charity_wallet !== 'string'
            || fee_charity_wallet.length < 32
            || fee_charity_wallet.length > 50) {
          return NextResponse.json(
            { error: 'fee_charity_wallet (valid Solana address) required when fee_charity_pct > 0' },
            { status: 400 },
          );
        }
      }
    }

    // Buyback bot validation (Phase 3 — migration 031). When enabled,
    // action must be one of the four supported modes. Currently 'burn'
    // and 'hold' are wired end-to-end; distribute_* return early in the
    // cron with a "Phase 3.1" notice but are accepted at submit so the
    // creator can flip later via dashboard.
    const VALID_BOT_ACTIONS = new Set(['burn', 'hold', 'distribute_holders', 'distribute_backers']);
    if (buyback_bot_enabled) {
      if (typeof buyback_bot_action !== 'string' || !VALID_BOT_ACTIONS.has(buyback_bot_action)) {
        return NextResponse.json(
          { error: 'buyback_bot_action must be one of: burn, hold, distribute_holders, distribute_backers' },
          { status: 400 },
        );
      }
    }

    // For gated launches, parse + validate the initial allowlist (if any).
    // Creator's own wallet gets auto-added after the meme insert so they
    // can always back their own launch — don't require it in the input.
    let validatedAllowlist: string[] = [];
    if (visibility !== 'open') {
      if (!Array.isArray(initial_allowlist)) {
        return NextResponse.json(
          { error: 'initial_allowlist must be an array of wallet addresses' },
          { status: 400 },
        );
      }
      // Dedupe + filter empty + reject obvious non-pubkey shapes
      // (full base58 validation would require a PublicKey import here;
      //  the DB UNIQUE constraint will catch duplicates and any bad
      //  insert would fail loud — this is a cheap pre-filter.)
      validatedAllowlist = Array.from(new Set(
        initial_allowlist
          .filter((w: unknown): w is string => typeof w === 'string')
          .map((w: string) => w.trim())
          .filter((w: string) => w.length >= 32 && w.length <= 50),
      ));
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
        submission_fee_paid: true, // Fee paid via creation_fee_signature (or waived for PROOF holders)
        current_backing_sol: 0, // Starts at 0, backers add to this
        // Trust score parameters
        creator_fee_pct,
        backer_share_pct,
        dev_initial_buy_sol,
        auto_refund: true, // Always auto-refund on failure - no option to hold backer funds
        trust_score,
        // Partner attribution — set only when this submission came from a
        // partner hosted-checkout session. Drives the "Launched via X" badge
        // on the public token page and rev-share routing at fee distribution.
        partner_id: partnerSessionRow?.partner_id ?? null,
        partner_session_id: partnerSessionRow?.id ?? null,
        // Launch Configuration v2 — visibility mode
        visibility,
        // Launch Configuration v2 — fee distribution config.
        // When fee_preset is undefined we pass NULL across the board,
        // which the distribution code treats as legacy hardcoded behavior.
        fee_preset:             fee_preset ?? null,
        fee_backer_pct:         fee_preset ? fee_backer_pct : null,
        fee_holder_rewards_pct: fee_preset ? fee_holder_rewards_pct : null,
        fee_platform_pct:       fee_preset ? fee_platform_pct : null,
        fee_burn_pct:           fee_preset ? fee_burn_pct : null,
        fee_charity_pct:        fee_preset ? fee_charity_pct : null,
        fee_charity_wallet:     fee_preset && fee_charity_pct > 0 ? fee_charity_wallet : null,
        // Phase 3 — Buyback bot. The wallet + key are filled in
        // immediately below via a follow-up UPDATE so the insert stays
        // small if the keygen fails for any reason.
        buyback_bot_enabled: !!buyback_bot_enabled,
        buyback_bot_action:  buyback_bot_enabled ? buyback_bot_action : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ── Allowlist setup (Launch Config v2 — Phase 1) ────────────────
    // For stealth + spectator launches, seed the backing_allowlist with:
    //   1. The creator's own wallet (always, so they can back their own launch)
    //   2. Any wallets they supplied in initial_allowlist
    // Failures here log but don't roll back the meme — the creator can
    // re-add wallets via the dashboard if anything went wrong.
    if (visibility !== 'open' && data) {
      const allowlistRows = [
        { meme_id: data.id, wallet: creator_wallet, added_by: creator_wallet, note: 'creator (auto)' },
        ...validatedAllowlist
          .filter((w) => w !== creator_wallet)
          .map((wallet) => ({ meme_id: data.id, wallet, added_by: creator_wallet, note: null })),
      ];
      const { error: allowlistErr } = await supabase
        .from('backing_allowlist')
        .insert(allowlistRows);
      if (allowlistErr) {
        console.error('Allowlist seed failed (meme created, creator can re-add):', allowlistErr);
      }

      // Audit log the initial visibility state for the transparency trail.
      await supabase.from('meme_visibility_changes').insert({
        meme_id: data.id,
        from_value: null,
        to_value: visibility,
        changed_by: creator_wallet,
        reason: 'initial_at_submission',
      });
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

    // Phase 3 — Buyback bot keypair (only when enabled).
    let buybackBotWallet: string | null = null;
    let encryptedBuybackBotKey: string | null = null;
    if (buyback_bot_enabled) {
      const botKp = Keypair.generate();
      buybackBotWallet = botKp.publicKey.toBase58();
      encryptedBuybackBotKey = encryptPrivateKey(bs58.encode(botKp.secretKey));
    }

    const { error: poolErr } = await supabase
      .from('memes')
      .update({
        pool_wallet: poolWallet,
        encrypted_pool_key: encryptedPoolKey,
        creator_subescrow_pubkey: subPub,
        encrypted_creator_subescrow_key: encryptedSubKey,
        buyback_bot_wallet: buybackBotWallet,
        encrypted_buyback_bot_key: encryptedBuybackBotKey,
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
    (data as { pool_wallet?: string; creator_subescrow_pubkey?: string; buyback_bot_wallet?: string | null }).pool_wallet = poolWallet;
    (data as { creator_subescrow_pubkey?: string }).creator_subescrow_pubkey = subPub;
    (data as { buyback_bot_wallet?: string | null }).buyback_bot_wallet = buybackBotWallet;

    // Note: Creation fee goes to escrow, not recorded as a backing
    // The creator's token wallet is stored on the meme itself, not as a backing record
    // This prevents the creation fee from showing in portfolio as a "backing"

    // Update user's meme count
    await supabase.rpc('increment_memes_created', { wallet: creator_wallet });

    // Mark the partner session as submitted so polling + future webhooks
    // see the linked meme_id. Best-effort — failure here doesn't roll
    // back the meme creation (the meme is already valid; we just lose
    // partner attribution polling if this fails, which is recoverable
    // via the partner_id column on memes).
    if (partnerSessionRow) {
      const { error: sessUpdateErr } = await supabase
        .from('partner_sessions')
        .update({
          status: 'submitted',
          meme_id: data.id,
          submitted_at: new Date().toISOString(),
        })
        .eq('id', partnerSessionRow.id);
      if (sessUpdateErr) {
        console.warn('Partner session update failed (meme still created):', sessUpdateErr.message);
      }
    }

    return NextResponse.json({ meme: data }, { status: 201 });
  } catch (error) {
    console.error('Create meme error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
