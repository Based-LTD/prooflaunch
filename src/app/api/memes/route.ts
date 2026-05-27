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
    // Creator-scoped queries (Portfolio) and admin (includeStaleExpired)
    // remain exempt so refunds can still be tracked / handled.
    let filteredData = data;
    if (!creator && !includeStaleExpired) {
      const now = new Date();
      const PUBLIC_STATUSES = new Set(['backing', 'funded', 'live']);
      filteredData = data?.filter((meme) => {
        if (!PUBLIC_STATUSES.has(meme.status)) return false;
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
