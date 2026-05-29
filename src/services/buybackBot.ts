import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL,
  TransactionMessage, ComputeBudgetProgram,
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

// Per-meme buyback bot executor (Phase 5 — fee-delegation model).
//
// The bot wallet accumulates SOL via the fee-delegation path in
// collectAndCreditFees: when a meme has buyback_bot_enabled +
// buyback_bot_fee_pct > 0, that % of the backer pool is transferred
// to the bot wallet on chain at every fee-collection tick.
//
// This cron does the BUY side: read bot wallet's on-chain SOL balance,
// reserve gas, swap rest SOL → meme token via Jupiter (PumpSwap route),
// execute creator-chosen action on the bought tokens:
//   burn               → SPL burnChecked (Token or Token-2022)
//   hold               → leave in bot wallet (treasury)
//   distribute_holders → Phase 5.1 (not wired yet)
//   distribute_backers → Phase 5.1 (not wired yet)
//
// Idempotency: the bot wallet's on-chain balance IS the source of truth.
// If a previous tick swept everything, this tick sees nothing to do and
// skips. If a previous tick failed mid-swap, SOL stays in the bot wallet
// and the next tick picks it up.

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUP_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const JUP_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Skip thresholds. Below these we just leave SOL parked — sub-cent swaps
// are pure tx-fee burn and tank the metrics. 0.01 SOL ≈ $1.50 at $150/SOL.
const MIN_SWAP_LAMPORTS = 10_000_000;          // 0.01 SOL min to bother swapping
const GAS_RESERVE_LAMPORTS = 5_000_000;        // 0.005 SOL reserved in bot wallet for tx fees
const SLIPPAGE_BPS = 2000;                     // 20% — meme tokens are thin

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

  // Decrypt bot keypair + pubkey-match safety gate.
  let botKp: Keypair;
  try { botKp = decryptKeypair(m.encrypted_buyback_bot_key); }
  catch (e) { return { ok: false, memeId, symbol: m.symbol, action, error: `bot key decrypt: ${e instanceof Error ? e.message : String(e)}` }; }
  if (botKp.publicKey.toBase58() !== m.buyback_bot_wallet) {
    return { ok: false, memeId, symbol: m.symbol, action, error: 'bot key pubkey mismatch — refusing to touch' };
  }

  // Read bot wallet on-chain balance — the source of truth for "how much
  // has been delegated since the last swap." No more DB-side counters.
  const conn = new Connection(RPC_URL, 'confirmed');
  const balance = await conn.getBalance(botKp.publicKey);
  const swapLamports = balance - GAS_RESERVE_LAMPORTS;
  if (swapLamports < MIN_SWAP_LAMPORTS) {
    return { ok: true, memeId, symbol: m.symbol, action, skipped: `bot wallet balance ${balance} below swap threshold (need ${MIN_SWAP_LAMPORTS + GAS_RESERVE_LAMPORTS} lamports)` };
  }

  // distribute_* not wired yet (Phase 5.1) — log skip, SOL stays in bot
  // wallet. On next tick the action might be flipped to burn/hold and
  // get used.
  if (action === 'distribute_holders' || action === 'distribute_backers') {
    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, action, sol_spent_lamports: '0',
      tokens_bought_raw: '0', tokens_acted_raw: '0',
      status: 'partial',
      notes: 'Phase 5.1: distribute action not wired yet. SOL parked in bot wallet pending implementation.',
    });
    await supabase.from('memes').update({ buyback_bot_last_run_at: new Date().toISOString() }).eq('id', m.id);
    return { ok: true, memeId, symbol: m.symbol, action, skipped: 'distribute_* action pending Phase 5.1 — SOL parked in bot wallet' };
  }

  // Swap SOL → meme token via Jupiter.
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

    // Read actual amount received (slippage may shave some off).
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
    // Swap failed — SOL stays in bot wallet, next cron tick retries with
    // the same (or larger) pile.
    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, action, sol_spent_lamports: swapLamports.toString(),
      tokens_bought_raw: '0', tokens_acted_raw: '0',
      status: 'failed', error: `swap: ${e instanceof Error ? e.message : String(e)}`,
    });
    await supabase.from('memes').update({ buyback_bot_last_run_at: new Date().toISOString() }).eq('id', m.id);
    return { ok: false, memeId, symbol: m.symbol, action, error: `swap failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Action.
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
      actedRaw = actualTokensRaw;
    }
  } catch (e) {
    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, action, sol_spent_lamports: swapLamports.toString(),
      tokens_bought_raw: actualTokensRaw.toString(), tokens_acted_raw: '0',
      swap_tx: swapTx, status: 'partial',
      error: `action: ${e instanceof Error ? e.message : String(e)}`,
    });
    await supabase.from('memes').update({ buyback_bot_last_run_at: new Date().toISOString() }).eq('id', m.id);
    return { ok: false, memeId, symbol: m.symbol, action, swapTx, error: `action failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Audit row + rollup stats.
  await supabase.from('meme_buybacks').insert({
    meme_id: m.id, action,
    sol_spent_lamports: swapLamports.toString(),
    tokens_bought_raw: actualTokensRaw.toString(),
    tokens_acted_raw:  actedRaw.toString(),
    swap_tx: swapTx, action_tx: actionTx,
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
    swapTx, actionTx,
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
