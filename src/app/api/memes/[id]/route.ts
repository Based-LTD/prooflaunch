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

    // The view predates the pooled model and doesn't expose the pooled
    // columns the client needs. Pull just the safe ones from the base
    // table (NOT encrypted_pool_key) and merge them in.
    const { data: poolFields } = await supabase
      .from('memes')
      .select('pool_wallet, pool_token_balance, creator_subescrow_pubkey, mint_address')
      .eq('id', id)
      .single();

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
