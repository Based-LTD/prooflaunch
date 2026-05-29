import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { SolanaStreamClient, ICluster } from '@streamflow/stream';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Constants needed to compute the meme's current on-chain creator-vault
// balance (powers the Genesis Backer Roster's "Pending" column).
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/**
 * Read the meme's current on-chain creator-vault balance in lamports
 * (BC + AMM combined). Pre-P2 memes return 0 — their fees route to
 * shared escrow as platform revenue, not backer-distributable.
 */
async function readVaultLamports(conn: Connection, subEscrowPubkey: string | null): Promise<number> {
  if (!subEscrowPubkey) return 0;
  try {
    const subPk = new PublicKey(subEscrowPubkey);
    const [bcVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), subPk.toBuffer()],
      PUMP_PROGRAM_ID,
    );
    const [ammAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator_vault'), subPk.toBuffer()],
      PUMP_AMM_PROGRAM_ID,
    );
    const ammWsolAta = await getAssociatedTokenAddress(WSOL_MINT, ammAuthority, true);
    const [bcBal, ammAtaInfo] = await Promise.all([
      conn.getBalance(bcVault),
      conn.getAccountInfo(ammWsolAta),
    ]);
    let ammWsolLamports = 0;
    if (ammAtaInfo) {
      ammWsolLamports = Number(ammAtaInfo.data.readBigUInt64LE(64));
    }
    return bcBal + ammWsolLamports;
  } catch {
    return 0;
  }
}

// GET /api/memes/[id] - Get a single meme with backings + on-chain enrichment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerClient();

    // Get meme with stats. memes_with_stats is a curated VIEW that
    // intentionally omits sensitive columns (encrypted_pool_key) — never
    // switch this to the base `memes` table or that key leaks to clients.
    const { data: meme, error: memeError } = await supabase
      .from('memes_with_stats')
      .select('*')
      .eq('id', id)
      .single();

    if (memeError) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // The view's `SELECT m.*` cached its column list when the view was
    // created — columns added in later migrations don't auto-flow.
    // Pull the SAFE public ones from the base table and merge them in.
    // NEVER add encrypted_pool_key, encrypted_creator_subescrow_key,
    // encrypted_buyback_bot_key, or keycard_admin_url to this list.
    // NEVER add encrypted_pool_key, encrypted_creator_subescrow_key,
    // encrypted_buyback_bot_key, or keycard_admin_url to this select.
    const { data: poolFields } = await supabase
      .from('memes')
      .select('pool_wallet, pool_token_balance, creator_subescrow_pubkey, mint_address, fee_distribution_mode, fee_preset, fee_backer_pct, fee_holder_rewards_pct, fee_platform_pct, fee_burn_pct, fee_charity_pct, fee_charity_wallet, buyback_bot_enabled, buyback_bot_action, buyback_bot_wallet, buyback_bot_fee_pct, buyback_bot_last_run_at, buyback_bot_total_sol_spent, buyback_bot_total_tokens_acted, max_backing_sol, reserved_slots, keycard_gate_id, keycard_gate_url, keycard_synced_at')
      .eq('id', id)
      .single();

    // Phase B — bot stack (programmable tokenomics). Public-safe columns
    // only — NEVER select encrypted_bot_key. The meme_bots table is the
    // source of truth post-Phase-B; legacy memes.buyback_bot_* columns
    // remain populated for backward compat with single-bot stacks.
    const { data: botsRows } = await supabase
      .from('meme_bots')
      .select('id, slot_order, action, fee_pct, bot_wallet, label, last_run_at, total_sol_spent, total_tokens_acted, created_at')
      .eq('meme_id', id)
      .order('slot_order', { ascending: true });

    // Get backings for this meme. Now includes both 'confirmed' (still
    // pre-launch) AND 'distributed' (post-launch holdings) so the meme
    // detail page can show its Genesis Backer Roster post-launch.
    // Withdrawn/refunded backings are excluded.
    type BackingRow = {
      id: string;
      meme_id: string;
      backer_wallet: string;
      amount_sol: number;
      status: string;
      created_at: string;
      claim_tokens: string | number | null;
      claim_tx: string | null;
      claimed_at: string | null;
      tokens_received: string | number | null;
      claimable_fees_sol: number | null;
      total_claimed_sol: number | null;
      slot_number: number;
      current_tokens?: string;
      locked_tokens?: string;
    };
    const { data: rawBackings, error: backingsError } = await supabase
      .from('backings')
      .select(
        'id, meme_id, backer_wallet, amount_sol, status, created_at, ' +
          'claim_tokens, claim_tx, claimed_at, tokens_received, ' +
          'claimable_fees_sol, total_claimed_sol, slot_number'
      )
      .eq('meme_id', id)
      .in('status', ['confirmed', 'distributed'])
      .order('slot_number', { ascending: true });
    const backings = (rawBackings as unknown as BackingRow[] | null) ?? [];

    if (backingsError) {
      console.error('Backings fetch error:', backingsError);
    }

    // For launched memes: enrich distributed backings with their current
    // on-chain token balance (so the UI can compute and show hold %).
    // Also read the meme's current creator-vault balance so the client
    // can compute each backer's live "Pending" share without making
    // additional RPC calls.
    let vaultLamports = 0;
    let enrichedBackings = backings || [];
    const mintAddress = poolFields?.mint_address;
    if (meme.status === 'live' && mintAddress) {
      const conn = new Connection(RPC_URL, 'confirmed');
      const mintPk = new PublicKey(mintAddress);

      // Determine token program (Token-2022 vs SPL)
      let tokenProgram = TOKEN_PROGRAM_ID;
      try {
        const mintInfo = await conn.getAccountInfo(mintPk);
        if (mintInfo?.owner?.equals(TOKEN_2022_PROGRAM_ID)) {
          tokenProgram = TOKEN_2022_PROGRAM_ID;
        }
      } catch {}

      // Read every distributed backer's current ATA balance in parallel,
      // plus the meme-level vault balance. One Promise.all batch.
      const distributedBackings = backings.filter(b => b.status === 'distributed');
      const ataPromises = distributedBackings.map(async (b) => {
        try {
          const ata = await getAssociatedTokenAddress(
            mintPk,
            new PublicKey(b.backer_wallet),
            true,
            tokenProgram,
          );
          const info = await conn.getAccountInfo(ata);
          if (!info) return { id: b.id, current_tokens: '0' };
          // amount is at bytes 64..72 in both SPL Token and Token-2022 account layouts
          const amount = info.data.readBigUInt64LE(64);
          return { id: b.id, current_tokens: amount.toString() };
        } catch {
          return { id: b.id, current_tokens: '0' };
        }
      });

      // Streamflow detection: for each distributed backer, find streams
      // where they're the sender of a lock for this mint, and sum the
      // current escrow-vault balance of each. Counts as part of their
      // "hold" so a creator who locked tokens (Streamflow self-vest)
      // doesn't read as "dumped" in the Genesis Backer Roster.
      const streamClient = new SolanaStreamClient(
        RPC_URL,
        ICluster.Mainnet,
        'confirmed',
      );
      const lockedPromises = distributedBackings.map(async (b) => {
        try {
          const streams = await streamClient.searchStreams({
            mint: mintAddress,
            sender: b.backer_wallet,
          });
          if (!streams || streams.length === 0) return { id: b.id, locked_tokens: '0' };
          // For each stream, the live "still locked" amount = the
          // escrow-vault token-account balance. Withdrawn tokens
          // decrement this balance automatically when claimed.
          const vaultBalances = await Promise.all(
            streams.map(async (s) => {
              try {
                // escrowTokens may be PublicKey or string — normalize
                const escrowTokensRaw = (s.account as any)?.escrowTokens;
                if (!escrowTokensRaw) return BigInt(0);
                const escrowPk = typeof escrowTokensRaw === 'string'
                  ? new PublicKey(escrowTokensRaw)
                  : new PublicKey(escrowTokensRaw.toBase58 ? escrowTokensRaw.toBase58() : escrowTokensRaw);
                const info = await conn.getAccountInfo(escrowPk);
                if (!info) return BigInt(0);
                return info.data.readBigUInt64LE(64);
              } catch {
                return BigInt(0);
              }
            }),
          );
          const totalLocked = vaultBalances.reduce((s, x) => s + x, BigInt(0));
          return { id: b.id, locked_tokens: totalLocked.toString() };
        } catch {
          return { id: b.id, locked_tokens: '0' };
        }
      });

      const [ataResults, lockedResults, vaultLamportsResult] = await Promise.all([
        Promise.all(ataPromises),
        Promise.all(lockedPromises),
        readVaultLamports(conn, poolFields?.creator_subescrow_pubkey ?? null),
      ]);

      const currentByBackingId = new Map(ataResults.map(r => [r.id, r.current_tokens]));
      const lockedByBackingId = new Map(lockedResults.map(r => [r.id, r.locked_tokens]));
      enrichedBackings = backings.map((b) =>
        b.status === 'distributed'
          ? {
              ...b,
              current_tokens: currentByBackingId.get(b.id) ?? '0',
              locked_tokens: lockedByBackingId.get(b.id) ?? '0',
            }
          : b
      );
      vaultLamports = vaultLamportsResult;
    }

    return NextResponse.json({
      meme: {
        ...meme,
        pool_wallet: poolFields?.pool_wallet ?? null,
        pool_token_balance: poolFields?.pool_token_balance ?? null,
        creator_subescrow_pubkey: poolFields?.creator_subescrow_pubkey ?? null,
        fee_distribution_mode: poolFields?.fee_distribution_mode ?? 'legacy_flat',
        // Phase 2 — fee distribution
        fee_preset: poolFields?.fee_preset ?? null,
        fee_backer_pct: poolFields?.fee_backer_pct ?? null,
        fee_holder_rewards_pct: poolFields?.fee_holder_rewards_pct ?? null,
        fee_platform_pct: poolFields?.fee_platform_pct ?? null,
        fee_burn_pct: poolFields?.fee_burn_pct ?? null,
        fee_charity_pct: poolFields?.fee_charity_pct ?? null,
        fee_charity_wallet: poolFields?.fee_charity_wallet ?? null,
        // Phase 5 — buyback bot (fee-delegation model)
        buyback_bot_enabled: poolFields?.buyback_bot_enabled ?? false,
        buyback_bot_action: poolFields?.buyback_bot_action ?? null,
        buyback_bot_wallet: poolFields?.buyback_bot_wallet ?? null,
        buyback_bot_fee_pct: poolFields?.buyback_bot_fee_pct ?? 0,
        buyback_bot_last_run_at: poolFields?.buyback_bot_last_run_at ?? null,
        buyback_bot_total_sol_spent: poolFields?.buyback_bot_total_sol_spent ?? 0,
        buyback_bot_total_tokens_acted: poolFields?.buyback_bot_total_tokens_acted ?? 0,
        // Phase B — bot stack. Empty array for legacy / no-bot memes;
        // populated for any meme that has rows in meme_bots.
        bots: botsRows ?? [],
        // Phase 3.5 — team-fairness cap
        max_backing_sol: poolFields?.max_backing_sol ?? null,
        // Phase 7 — reserved slots
        reserved_slots: poolFields?.reserved_slots ?? 0,
        // Phase 4 — Keycard backer lounge (NEVER include keycard_admin_url)
        keycard_gate_id: poolFields?.keycard_gate_id ?? null,
        keycard_gate_url: poolFields?.keycard_gate_url ?? null,
        keycard_synced_at: poolFields?.keycard_synced_at ?? null,
        vault_lamports: vaultLamports,
        backings: enrichedBackings,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
