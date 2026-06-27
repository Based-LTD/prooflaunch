import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { simulateAndSend } from '@/lib/rpcHelpers';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const ESCROW_PRIVATE_KEY = process.env.ESCROW_WALLET_PRIVATE_KEY!;

function getEscrowWallet(): Keypair {
  const secretKey = bs58.decode(ESCROW_PRIVATE_KEY);
  return Keypair.fromSecretKey(secretKey);
}

// POST to claim rewards
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_address, meme_id, signature, message } = body;

    if (!wallet_address) {
      return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
    }

    // Require timestamped wallet signature to prove ownership
    if (!signature || !message) {
      return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
    }
    const expectedPrefix = meme_id
      ? `claim:${meme_id}:${wallet_address}`
      : `claim:all:${wallet_address}`;
    const auth = verifySignedAuthMessage(expectedPrefix, message, signature, wallet_address);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const supabase = createServerClient();

    // PAUSED 2026-06-27 pending legal review. BACKER-source claims (your
    // pro-rata of a launch's trading fees) are paused while we work
    // through the active-claim mechanism with counsel — passive auto-
    // claim by US-resident operator looks too much like a securities
    // distribution. Backer fees continue to ACCRUE per backing row;
    // only the actual payout is paused. Creator-source claims (a
    // creator's own fees from a launch they created) remain available —
    // that's self-employment income from your own venture, not passive
    // distribution, and the lawyer-call carve-out is much cleaner.
    //
    // To resume: flip the flag below, ship the underlying claim mechanic
    // (proof-of-work / registered offering / etc.) the lawyer signed
    // off on, push, announce.
    const BACKER_CLAIMS_PAUSED_FOR_LEGAL_REVIEW = true;

    // ── TOCTOU-safe claim flow ───────────────────────────────────────
    // Previous flow read claimable, sent SOL, then zeroed out — concurrent
    // requests could all observe the same pre-zero value and double-pay.
    //
    // New flow uses optimistic-lock atomic UPDATEs:
    //   1. Read current claimable (just to find which rows exist)
    //   2. Atomically zero each row WHERE claimable_fees_sol = observed value
    //      → only ONE concurrent request's UPDATE matches; the rest see 0 rows
    //   3. Send SOL only for the amount we actually claimed (not the read estimate)
    //   4. On SOL failure: REVERT — credit the claimable back to each row
    //
    // The `.eq('claimable_fees_sol', oldClaimable)` clause is the lock. If a
    // racing request beat us to zeroing, our UPDATE matches no rows and we
    // skip that source. Net effect: each balance can only be claimed once,
    // regardless of concurrency level.

    // Step 1: read what's available (this read can be stale; we re-check atomically below)
    type Source = { type: 'backer' | 'creator'; id: string; memeId: string; observedAmount: number; oldTotalClaimed: number };
    const observed: Source[] = [];

    // Backer claims are paused (see flag above). We deliberately don't
    // include backings in the observed-sources list so the rest of the
    // TOCTOU flow runs unchanged for creator-source claims. The GET
    // (status read) below still returns the accruing balance for
    // visibility — only the actual payout is paused.
    if (!BACKER_CLAIMS_PAUSED_FOR_LEGAL_REVIEW) {
      const backingsQuery = supabase
        .from('backings')
        .select('id, meme_id, claimable_fees_sol, total_claimed_sol')
        .eq('backer_wallet', wallet_address)
        .gt('claimable_fees_sol', 0);
      if (meme_id) backingsQuery.eq('meme_id', meme_id);
      const { data: backings } = await backingsQuery;
      for (const b of backings || []) {
        const amount = Number(b.claimable_fees_sol);
        if (amount > 0) observed.push({
          type: 'backer', id: b.id, memeId: b.meme_id, observedAmount: amount,
          oldTotalClaimed: Number(b.total_claimed_sol || 0),
        });
      }
    }

    const creatorQuery = supabase
      .from('memes')
      .select('id, creator_claimable_fees_sol, creator_total_claimed_sol')
      .eq('creator_wallet', wallet_address)
      .gt('creator_claimable_fees_sol', 0);
    if (meme_id) creatorQuery.eq('id', meme_id);
    const { data: creatorMemes } = await creatorQuery;
    for (const m of creatorMemes || []) {
      const amount = Number(m.creator_claimable_fees_sol);
      if (amount > 0) observed.push({
        type: 'creator', id: m.id, memeId: m.id, observedAmount: amount,
        oldTotalClaimed: Number(m.creator_total_claimed_sol || 0),
      });
    }

    if (observed.length === 0) {
      // If backer claims are paused AND this wallet has an accruing
      // backer balance, give a precise paused message instead of a
      // misleading "nothing to claim" — the user can see the balance
      // in the UI and would be confused otherwise.
      if (BACKER_CLAIMS_PAUSED_FOR_LEGAL_REVIEW) {
        const probe = supabase
          .from('backings')
          .select('id', { count: 'exact', head: true })
          .eq('backer_wallet', wallet_address)
          .gt('claimable_fees_sol', 0);
        if (meme_id) probe.eq('meme_id', meme_id);
        const { count } = await probe;
        if ((count || 0) > 0) {
          return NextResponse.json(
            {
              error: 'Backer fee claims are paused pending legal review of the distribution mechanism. Your balance continues to accrue; see /roadmap for the active-claim mechanism rollout. Creator-source claims remain available.',
              code: 'BACKER_CLAIMS_PAUSED',
            },
            { status: 423 }, // 423 Locked — distinct from 400 so the UI can render the paused state, not a generic error.
          );
        }
      }
      return NextResponse.json({ error: 'No rewards to claim' }, { status: 400 });
    }

    // Step 2: atomically zero each source. Track what we actually won.
    type Claimed = { type: 'backer' | 'creator'; id: string; memeId: string; amount: number; oldTotalClaimed: number };
    const claimed: Claimed[] = [];

    for (const src of observed) {
      if (src.type === 'backer') {
        const { data: updated } = await supabase
          .from('backings')
          .update({
            claimable_fees_sol: 0,
            total_claimed_sol: src.oldTotalClaimed + src.observedAmount,
          })
          .eq('id', src.id)
          .eq('claimable_fees_sol', src.observedAmount)  // ← OPTIMISTIC LOCK
          .select('id');
        if (updated && updated.length > 0) {
          claimed.push({ type: 'backer', id: src.id, memeId: src.memeId, amount: src.observedAmount, oldTotalClaimed: src.oldTotalClaimed });
        }
        // If no rows matched, another request already claimed this row; skip.
      } else {
        const { data: updated } = await supabase
          .from('memes')
          .update({
            creator_claimable_fees_sol: 0,
            creator_total_claimed_sol: src.oldTotalClaimed + src.observedAmount,
          })
          .eq('id', src.id)
          .eq('creator_claimable_fees_sol', src.observedAmount)  // ← OPTIMISTIC LOCK
          .select('id');
        if (updated && updated.length > 0) {
          claimed.push({ type: 'creator', id: src.id, memeId: src.memeId, amount: src.observedAmount, oldTotalClaimed: src.oldTotalClaimed });
        }
      }
    }

    const totalClaimable = claimed.reduce((sum, c) => sum + c.amount, 0);
    if (totalClaimable <= 0) {
      // Every source was claimed by a racing request between our read and our UPDATE.
      return NextResponse.json({ error: 'Rewards already claimed (concurrent request)' }, { status: 409 });
    }

    const MIN_CLAIM = 0.001;
    if (totalClaimable < MIN_CLAIM) {
      // Revert the atomic claims since we won't send the SOL
      await revertClaims(supabase, claimed);
      return NextResponse.json(
        { error: `Minimum claim amount is ${MIN_CLAIM} SOL. Current: ${totalClaimable.toFixed(6)} SOL` },
        { status: 400 }
      );
    }

    // Step 3: create fee_claims audit rows tied to the amounts we actually claimed
    const { data: claimRows, error: claimError } = await supabase
      .from('fee_claims')
      .insert(
        claimed.map((c) => ({
          meme_id: c.memeId,
          wallet_address,
          amount_sol: c.amount,
          status: 'processing',
        }))
      )
      .select();
    if (claimError || !claimRows || claimRows.length === 0) {
      await revertClaims(supabase, claimed);
      throw new Error(`Failed to create claim row: ${claimError?.message || 'no rows inserted'}`);
    }
    const claimRowIds = claimRows.map((r) => r.id);

    // Step 4: send SOL
    const connection = new Connection(RPC_URL, 'confirmed');
    const escrowWallet = getEscrowWallet();
    const recipientPubkey = new PublicKey(wallet_address);

    const TX_FEE = 0.000005;
    const amountToSend = totalClaimable - TX_FEE;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrowWallet.publicKey,
        toPubkey: recipientPubkey,
        lamports: Math.floor(amountToSend * LAMPORTS_PER_SOL),
      })
    );
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = escrowWallet.publicKey;

    let txSignature: string;
    try {
      // SOL-029: simulate before send.
      txSignature = await simulateAndSend(connection, transaction, [escrowWallet], { label: 'fees-claim' });
    } catch (e) {
      // On-chain send failed — REVERT the atomic claims so the user can retry,
      // and mark the audit rows failed.
      await supabase.from('fee_claims').update({ status: 'failed' }).in('id', claimRowIds);
      await revertClaims(supabase, claimed);
      throw e;
    }

    // Step 5: mark audit rows completed
    await supabase
      .from('fee_claims')
      .update({
        claim_tx: txSignature,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .in('id', claimRowIds);

    return NextResponse.json({
      success: true,
      amount_claimed: totalClaimable,
      amount_sent: amountToSend,
      tx_signature: txSignature,
      claim_ids: claimRowIds,
      claim_id: claimRowIds[0], // back-compat: callers reading the singular field
    });
  } catch (error) {
    console.error('Claim error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Claim failed' },
      { status: 500 }
    );
  }
}

/**
 * Revert atomic claim updates if the downstream SOL transfer (or audit
 * row creation) fails. Restores the claimable_fees_sol balance on each
 * source so the user can retry.
 *
 * NOTE: this is best-effort. If a revert UPDATE itself fails, the worst
 * case is the user's claimable shows 0 but the SOL never landed — they'd
 * need manual support. To stop that being silent, we log failures hard.
 * Cron / reconcile should also detect and re-credit any orphans.
 */
async function revertClaims(
  supabase: ReturnType<typeof createServerClient>,
  claimed: Array<{ type: 'backer' | 'creator'; id: string; amount: number; oldTotalClaimed: number }>,
) {
  for (const c of claimed) {
    try {
      if (c.type === 'backer') {
        await supabase
          .from('backings')
          .update({
            claimable_fees_sol: c.amount,
            total_claimed_sol: c.oldTotalClaimed,  // restore exact pre-claim value
          })
          .eq('id', c.id);
      } else {
        await supabase
          .from('memes')
          .update({
            creator_claimable_fees_sol: c.amount,
            creator_total_claimed_sol: c.oldTotalClaimed,
          })
          .eq('id', c.id);
      }
    } catch (e) {
      console.error('[fees/claim] REVERT FAILED — orphan claimable:', c.type, c.id, c.amount, e);
    }
  }
}

// PumpFun + PumpSwap PDAs needed to compute "pending" (uncollected
// on-chain creator fees that will be credited at the next cron tick).
// Kept inline rather than reaching into services/distribution.ts so this
// route stays read-only with no shared mutable state.
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

const LAMPORTS_TO_SOL = 1 / LAMPORTS_PER_SOL;

// PROOF's brand promise: 90% of creator fees to backers. Mirrors
// PLATFORM_FEE_CUT = 0.10 in services/distribution.ts.
const BACKER_SHARE = 0.90;

/**
 * Compute the total uncollected creator fees (BC creator-vault + AMM
 * wSOL vault) for a meme's sub-escrow. Returns lamports. Pre-P2 memes
 * (NULL sub-escrow) return 0 — their fees are shared-escrow platform
 * revenue, not backer-distributable.
 */
async function computeMemePendingLamports(
  conn: Connection,
  subEscrowPubkey: string | null,
): Promise<number> {
  if (!subEscrowPubkey) return 0;
  try {
    const subPk = new PublicKey(subEscrowPubkey);
    // BC creator-vault PDA
    const [bcVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), subPk.toBuffer()],
      PUMP_PROGRAM_ID,
    );
    // AMM creator_vault authority PDA + its wSOL ATA
    const [ammAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator_vault'), subPk.toBuffer()],
      PUMP_AMM_PROGRAM_ID,
    );
    const ammWsolAta = await getAssociatedTokenAddress(
      WSOL_MINT,
      ammAuthority,
      true,
    );

    // Read both balances in parallel
    const [bcBal, ammAtaInfo] = await Promise.all([
      conn.getBalance(bcVault),
      conn.getAccountInfo(ammWsolAta),
    ]);

    let ammWsolLamports = 0;
    if (ammAtaInfo) {
      // Token account amount lives at bytes 64..72 in SPL Token v1 + Token-2022
      ammWsolLamports = Number(ammAtaInfo.data.readBigUInt64LE(64));
    }

    return bcBal + ammWsolLamports;
  } catch {
    // RPC hiccup on one meme should not fail the whole portfolio request
    return 0;
  }
}

// GET to check claimable + pending rewards for a wallet
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    const memeId = searchParams.get('meme_id');

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet parameter required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Get backer rewards. Pull each backing's meme's sub-escrow pubkey
    // and current_backing_sol so we can compute the wallet's pro-rata
    // share of on-chain pending fees.
    const backingsQuery = supabase
      .from('backings')
      .select(`
        id,
        meme_id,
        amount_sol,
        claimable_fees_sol,
        total_claimed_sol,
        memes (
          name,
          symbol,
          mint_address,
          backer_share_pct,
          current_backing_sol,
          creator_subescrow_pubkey
        )
      `)
      .eq('backer_wallet', wallet)
      .eq('status', 'distributed');

    if (memeId) {
      backingsQuery.eq('meme_id', memeId);
    }

    const { data: backings } = await backingsQuery;

    // Get creator rewards
    const creatorQuery = supabase
      .from('memes')
      .select('id, name, symbol, creator_claimable_fees_sol, creator_total_claimed_sol, creator_fee_pct')
      .eq('creator_wallet', wallet)
      .eq('status', 'live');

    if (memeId) {
      creatorQuery.eq('id', memeId);
    }

    const { data: creatorMemes } = await creatorQuery;

    // Compute on-chain pending fees per backing, parallelized across
    // distinct sub-escrows so a wallet with N backed memes makes N+1
    // RPC reads (1 batch). Pre-P2 backings (no sub-escrow) get 0.
    const conn = new Connection(RPC_URL, 'confirmed');
    const uniqueSubEscrows = Array.from(
      new Set(
        (backings || [])
          .map((b) => (b.memes as any)?.creator_subescrow_pubkey as string | null)
          .filter((pk): pk is string => !!pk),
      ),
    );
    const pendingByMeme = new Map<string, number>(); // sub-escrow pubkey -> lamports
    await Promise.all(
      uniqueSubEscrows.map(async (pk) => {
        const lamports = await computeMemePendingLamports(conn, pk);
        pendingByMeme.set(pk, lamports);
      }),
    );

    // Per-backing pending = (user.amount_sol / meme.current_backing_sol) * meme_total_pending * BACKER_SHARE
    const backingsWithPending = (backings || []).map((b) => {
      const meme = b.memes as any;
      const subPk = meme?.creator_subescrow_pubkey as string | null;
      const totalLamports = subPk ? pendingByMeme.get(subPk) ?? 0 : 0;
      const totalSol = totalLamports * LAMPORTS_TO_SOL;
      const memeTotalBacking = Number(meme?.current_backing_sol || 0);
      const userShareFrac = memeTotalBacking > 0
        ? Number(b.amount_sol || 0) / memeTotalBacking
        : 0;
      const pending = totalSol * BACKER_SHARE * userShareFrac;
      return {
        meme_id: b.meme_id,
        name: meme?.name,
        symbol: meme?.symbol,
        backing_amount: b.amount_sol,
        claimable: Number(b.claimable_fees_sol || 0),
        claimed: Number(b.total_claimed_sol || 0),
        pending,
      };
    });

    // Calculate totals
    const backerClaimable = backings?.reduce((sum, b) => sum + Number(b.claimable_fees_sol || 0), 0) || 0;
    const backerClaimed = backings?.reduce((sum, b) => sum + Number(b.total_claimed_sol || 0), 0) || 0;
    const backerPending = backingsWithPending.reduce((sum, b) => sum + b.pending, 0);
    const creatorClaimable = creatorMemes?.reduce((sum, m) => sum + Number(m.creator_claimable_fees_sol || 0), 0) || 0;
    const creatorClaimed = creatorMemes?.reduce((sum, m) => sum + Number(m.creator_total_claimed_sol || 0), 0) || 0;

    return NextResponse.json({
      wallet,
      backer_rewards: {
        claimable: backerClaimable,
        pending: backerPending,
        total_claimed: backerClaimed,
        tokens: backingsWithPending,
      },
      creator_rewards: {
        claimable: creatorClaimable,
        total_claimed: creatorClaimed,
        tokens: creatorMemes?.map((m) => ({
          meme_id: m.id,
          name: m.name,
          symbol: m.symbol,
          claimable: Number(m.creator_claimable_fees_sol || 0),
          claimed: Number(m.creator_total_claimed_sol || 0),
        })) || [],
      },
      total_claimable: backerClaimable + creatorClaimable,
      total_pending: backerPending,
      total_claimed: backerClaimed + creatorClaimed,
    });
  } catch (error) {
    console.error('Get rewards error:', error);
    return NextResponse.json(
      { error: 'Failed to get rewards' },
      { status: 500 }
    );
  }
}
