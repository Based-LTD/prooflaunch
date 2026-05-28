import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL,
  TransactionMessage, ComputeBudgetProgram, SystemProgram, Transaction,
} from '@solana/web3.js';
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';

// Per-meme buyback bot executor (Phase 3).
//
// Bot model: the creator opts in at submit time. When enabled, the meme's
// `creator_claimable_fees_sol` is treated as the bot's purse — instead of
// the creator personally claiming, the bot drains it periodically and:
//
//   1) Wires the SOL from shared escrow → bot wallet
//   2) Swaps SOL → meme token via Jupiter (PumpSwap route)
//   3) Executes the creator-chosen action on the bought tokens:
//        burn               → SPL burnChecked (works for Token / Token-2022)
//        hold               → leaves them in the bot wallet
//        distribute_holders → "Phase 3.1 — not wired yet" (logs skip, no-op)
//        distribute_backers → "Phase 3.1 — not wired yet" (logs skip, no-op)
//
// Audit: every successful run writes a row to meme_buybacks. Failures
// either write a 'failed' row or skip silently (when nothing to do).
//
// Idempotency: the creator_claimable_fees_sol field is the on-chain truth
// of "what the bot has earned." Atomic optimistic-lock UPDATE pattern from
// /api/fees/claim — drains-to-zero, reverts on any downstream failure.

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const ESCROW_PRIVATE_KEY = process.env.ESCROW_WALLET_PRIVATE_KEY;
const JUP_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const JUP_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const BURN_ADDRESS = '1nc1nerator11111111111111111111111111111111'; // SPL incinerator (PDA-derived, no key)

// Skip thresholds. Below these we just leave SOL parked — sub-cent swaps
// are pure tx-fee burn and tank the metrics. 0.01 SOL ≈ $1.50 at $150/SOL.
const MIN_CLAIM_LAMPORTS = 10_000_000;        // 0.01 SOL
const SLIPPAGE_BPS = 2000;                     // 20% — meme tokens are thin
const GAS_RESERVE_LAMPORTS = 5_000_000;        // 0.005 SOL reserved in bot wallet for tx fees

function loadEscrow(): Keypair {
  if (!ESCROW_PRIVATE_KEY) throw new Error('ESCROW_WALLET_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(ESCROW_PRIVATE_KEY));
}
function decryptKeypair(enc: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(decryptPrivateKey(enc)));
}

export interface BuybackResult {
  ok: boolean;
  memeId: string;
  symbol?: string;
  skipped?: string;
  action?: 'burn' | 'hold' | 'distribute_holders' | 'distribute_backers';
  solSpentLamports?: number;
  tokensBoughtRaw?: string;
  tokensActedRaw?: string;
  claimTx?: string;
  swapTx?: string;
  actionTx?: string;
  error?: string;
}

interface MemeRow {
  id: string;
  symbol: string;
  mint_address: string | null;
  status: string;
  buyback_bot_enabled: boolean;
  buyback_bot_action: 'burn' | 'hold' | 'distribute_holders' | 'distribute_backers' | null;
  buyback_bot_wallet: string | null;
  encrypted_buyback_bot_key: string | null;
  creator_claimable_fees_sol: number | null;
  creator_total_claimed_sol: number | null;
  buyback_bot_total_sol_spent: number | null;
  buyback_bot_total_tokens_acted: number | null;
}

export async function executeBuybackForMeme(
  supabase: SupabaseClient,
  memeId: string,
): Promise<BuybackResult> {
  const { data: meme, error: memeErr } = await supabase
    .from('memes')
    .select(`id, symbol, mint_address, status,
             buyback_bot_enabled, buyback_bot_action,
             buyback_bot_wallet, encrypted_buyback_bot_key,
             creator_claimable_fees_sol, creator_total_claimed_sol,
             buyback_bot_total_sol_spent, buyback_bot_total_tokens_acted`)
    .eq('id', memeId)
    .single();
  if (memeErr || !meme) return { ok: false, memeId, error: 'meme not found' };
  const m = meme as MemeRow;

  if (!m.buyback_bot_enabled) return { ok: true, memeId, skipped: 'bot not enabled' };
  if (m.status !== 'live')    return { ok: true, memeId, symbol: m.symbol, skipped: `not live (status=${m.status})` };
  if (!m.mint_address)        return { ok: false, memeId, symbol: m.symbol, error: 'mint_address missing on live meme' };
  if (!m.buyback_bot_wallet || !m.encrypted_buyback_bot_key)
    return { ok: false, memeId, symbol: m.symbol, error: 'bot wallet missing despite enabled flag' };
  if (!m.buyback_bot_action)  return { ok: false, memeId, symbol: m.symbol, error: 'bot action missing' };

  const action = m.buyback_bot_action;
  const observed = Number(m.creator_claimable_fees_sol || 0);
  const observedLamports = Math.floor(observed * LAMPORTS_PER_SOL);
  if (observedLamports < MIN_CLAIM_LAMPORTS) {
    return { ok: true, memeId, symbol: m.symbol, action, skipped: `below threshold (${observed.toFixed(6)} SOL)` };
  }

  // Step 1: atomic drain of creator_claimable_fees_sol (optimistic lock).
  const oldTotalClaimed = Number(m.creator_total_claimed_sol || 0);
  const { data: drained, error: drainErr } = await supabase
    .from('memes')
    .update({
      creator_claimable_fees_sol: 0,
      creator_total_claimed_sol: oldTotalClaimed + observed,
    })
    .eq('id', m.id)
    .eq('creator_claimable_fees_sol', observed)
    .select('id');
  if (drainErr) return { ok: false, memeId, symbol: m.symbol, action, error: `drain failed: ${drainErr.message}` };
  if (!drained || drained.length === 0) {
    return { ok: true, memeId, symbol: m.symbol, action, skipped: 'concurrent claim drained first' };
  }

  // From here on, restoreOnFail() must be called on any failure path so we
  // don't strand the creator's accrued SOL.
  const restoreOnFail = async (whyError: string) => {
    await supabase
      .from('memes')
      .update({
        creator_claimable_fees_sol: observed,
        creator_total_claimed_sol: oldTotalClaimed,
      })
      .eq('id', m.id);
    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, action, sol_spent_lamports: observedLamports.toString(),
      tokens_bought_raw: '0', tokens_acted_raw: '0',
      status: 'failed', error: whyError,
    });
  };

  // Step 2: send SOL from escrow → bot wallet (less the TX fee that escrow will pay).
  const conn = new Connection(RPC_URL, 'confirmed');
  let escrow: Keypair, botKp: Keypair;
  try {
    escrow = loadEscrow();
    botKp = decryptKeypair(m.encrypted_buyback_bot_key);
  } catch (e) {
    await restoreOnFail(`keypair load: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, memeId, symbol: m.symbol, action, error: 'key load failed' };
  }
  if (botKp.publicKey.toBase58() !== m.buyback_bot_wallet) {
    await restoreOnFail('bot key pubkey mismatch');
    return { ok: false, memeId, symbol: m.symbol, action, error: 'bot key pubkey mismatch' };
  }

  let claimTx: string;
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrow.publicKey,
        toPubkey: botKp.publicKey,
        lamports: observedLamports,
      })
    );
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.feePayer = escrow.publicKey;
    claimTx = await conn.sendTransaction(tx, [escrow]);
    await conn.confirmTransaction(claimTx, 'confirmed');
  } catch (e) {
    await restoreOnFail(`escrow→bot transfer: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, memeId, symbol: m.symbol, action, error: 'escrow transfer failed' };
  }

  // Step 3: distribute_* not wired in MVP — log skip (SOL is in bot wallet,
  // so on next cron tick the action might be flipped to burn/hold and used).
  if (action === 'distribute_holders' || action === 'distribute_backers') {
    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, action, sol_spent_lamports: observedLamports.toString(),
      tokens_bought_raw: '0', tokens_acted_raw: '0',
      claim_tx: claimTx, status: 'partial',
      notes: 'Phase 3.1: distribute action not wired yet. SOL parked in bot wallet pending implementation.',
    });
    await supabase.from('memes').update({ buyback_bot_last_run_at: new Date().toISOString() }).eq('id', m.id);
    return { ok: true, memeId, symbol: m.symbol, action, claimTx, skipped: 'distribute_* action pending Phase 3.1 — SOL parked in bot wallet' };
  }

  // Step 4: swap SOL → meme token via Jupiter (PumpSwap route).
  // Reserve a little SOL for the action tx (burn/transfer) gas.
  const swapLamports = observedLamports - GAS_RESERVE_LAMPORTS;
  if (swapLamports <= 0) {
    await restoreOnFail('claim amount below gas reserve');
    return { ok: false, memeId, symbol: m.symbol, action, error: 'below gas reserve' };
  }

  let actualTokensRaw: bigint;
  let tokenProgramId: PublicKey;
  let tokenDecimals: number;
  let swapTx: string;
  try {
    const quoteUrl = `${JUP_QUOTE_URL}?inputMint=${SOL_MINT}&outputMint=${m.mint_address}&amount=${swapLamports}&slippageBps=${SLIPPAGE_BPS}`;
    const qres = await fetch(quoteUrl);
    if (!qres.ok) throw new Error(`jupiter quote ${qres.status}: ${await qres.text()}`);
    const quote = await qres.json();
    if (quote.error) throw new Error(`jupiter quote: ${quote.error}`);

    const sres = await fetch(JUP_SWAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: botKp.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    if (!sres.ok) throw new Error(`jupiter swap ${sres.status}: ${await sres.text()}`);
    const { swapTransaction } = await sres.json();
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const swapVtx = VersionedTransaction.deserialize(txBuf);
    swapVtx.sign([botKp]);
    swapTx = await conn.sendTransaction(swapVtx, { skipPreflight: false, maxRetries: 3 });
    const swapConf = await conn.confirmTransaction(swapTx, 'confirmed');
    if (swapConf.value.err) throw new Error(`swap tx failed: ${JSON.stringify(swapConf.value.err)}`);

    // Read actual amount received — slippage may have shaved off some.
    // Detect which token program owns the mint (Token vs Token-2022).
    const mintPub = new PublicKey(m.mint_address);
    const mintAcc = await conn.getAccountInfo(mintPub);
    if (!mintAcc) throw new Error('mint account not found after swap');
    tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const mintInfo = await getMint(conn, mintPub, 'confirmed', tokenProgramId);
    tokenDecimals = mintInfo.decimals;
    const ata = getAssociatedTokenAddressSync(mintPub, botKp.publicKey, false, tokenProgramId);
    const ataBal = await conn.getTokenAccountBalance(ata);
    actualTokensRaw = BigInt(ataBal.value.amount);
    if (actualTokensRaw === BigInt(0)) throw new Error('swap confirmed but ATA balance is 0');
  } catch (e) {
    // Swap failed. SOL is in bot wallet — we don't restore creator_claimable
    // (that would double-credit). Log partial: SOL accumulates in bot wallet
    // and next cron tick will retry the swap with the bigger pile.
    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, action, sol_spent_lamports: swapLamports.toString(),
      tokens_bought_raw: '0', tokens_acted_raw: '0',
      claim_tx: claimTx, status: 'failed',
      error: `swap: ${e instanceof Error ? e.message : String(e)}`,
    });
    await supabase.from('memes').update({ buyback_bot_last_run_at: new Date().toISOString() }).eq('id', m.id);
    return { ok: false, memeId, symbol: m.symbol, action, claimTx, error: `swap failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Step 5: action.
  let actionTx: string | undefined;
  let actedRaw = actualTokensRaw;
  try {
    if (action === 'burn') {
      const mintPub = new PublicKey(m.mint_address);
      const ata = getAssociatedTokenAddressSync(mintPub, botKp.publicKey, false, tokenProgramId);
      const burnIx = createBurnCheckedInstruction(
        ata, mintPub, botKp.publicKey, actualTokensRaw, tokenDecimals, [], tokenProgramId,
      );
      const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
      const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 });
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({
        payerKey: botKp.publicKey, recentBlockhash: blockhash,
        instructions: [cuIx, priorityIx, burnIx],
      }).compileToV0Message();
      const burnTx = new VersionedTransaction(msg);
      burnTx.sign([botKp]);
      actionTx = await conn.sendTransaction(burnTx, { skipPreflight: false, maxRetries: 3 });
      const burnConf = await conn.confirmTransaction({ signature: actionTx, blockhash, lastValidBlockHeight }, 'confirmed');
      if (burnConf.value.err) throw new Error(`burn failed: ${JSON.stringify(burnConf.value.err)}`);
    } else if (action === 'hold') {
      // No-op — tokens stay in bot wallet.
      actedRaw = actualTokensRaw;
    }
  } catch (e) {
    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, action, sol_spent_lamports: swapLamports.toString(),
      tokens_bought_raw: actualTokensRaw.toString(), tokens_acted_raw: '0',
      claim_tx: claimTx, swap_tx: swapTx, status: 'partial',
      error: `action: ${e instanceof Error ? e.message : String(e)}`,
    });
    await supabase.from('memes').update({ buyback_bot_last_run_at: new Date().toISOString() }).eq('id', m.id);
    return { ok: false, memeId, symbol: m.symbol, action, claimTx, swapTx, error: `action failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Step 6: audit row + rollup stats.
  await supabase.from('meme_buybacks').insert({
    meme_id: m.id, action,
    sol_spent_lamports: swapLamports.toString(),
    tokens_bought_raw: actualTokensRaw.toString(),
    tokens_acted_raw:  actedRaw.toString(),
    claim_tx: claimTx, swap_tx: swapTx, action_tx: actionTx,
    status: 'completed',
  });
  const newSolSpent = Number(m.buyback_bot_total_sol_spent || 0) + (swapLamports / LAMPORTS_PER_SOL);
  const newTokensActed = Number(m.buyback_bot_total_tokens_acted || 0) + Number(actedRaw);
  await supabase
    .from('memes')
    .update({
      buyback_bot_last_run_at: new Date().toISOString(),
      buyback_bot_total_sol_spent: newSolSpent,
      buyback_bot_total_tokens_acted: newTokensActed,
    })
    .eq('id', m.id);

  return {
    ok: true, memeId, symbol: m.symbol, action,
    solSpentLamports: swapLamports,
    tokensBoughtRaw: actualTokensRaw.toString(),
    tokensActedRaw: actedRaw.toString(),
    claimTx, swapTx, actionTx,
  };
}

export async function runBuybackBotsForAllLive(
  supabase: SupabaseClient,
): Promise<BuybackResult[]> {
  const { data: memes } = await supabase
    .from('memes')
    .select('id')
    .eq('buyback_bot_enabled', true)
    .eq('status', 'live');
  const out: BuybackResult[] = [];
  for (const m of memes || []) {
    try {
      const r = await executeBuybackForMeme(supabase, m.id);
      out.push(r);
    } catch (e) {
      out.push({ ok: false, memeId: m.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// Reference: BURN_ADDRESS is unused for SPL burns (we use burnChecked which
// destroys supply directly), but kept exported for future "transfer to
// incinerator" flows in distribute_* actions.
export { BURN_ADDRESS };
