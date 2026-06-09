import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL,
  TransactionMessage, ComputeBudgetProgram, SystemProgram, Transaction,
} from '@solana/web3.js';
import {
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';
import { KNOWN_PDA_PROGRAMS } from '@/lib/holderFilter';
import { simulateAndSend, adaptivePriorityFeeIx, assertQuoteFresh } from '@/lib/rpcHelpers';

// Per-meme buyback bot — Phase A: programmable tokenomics primitives.
//
// The bot wallet accumulates SOL via fee-delegation in collectAndCreditFees
// (when meme has buyback_bot_enabled + fee_pct > 0, that % of the backer
// pool is transferred to the bot wallet on chain). This cron drains the
// bot wallet's on-chain SOL balance and executes the creator-chosen
// action. Six actions are wired:
//
//   burn                      — swap SOL→token, burnChecked the result
//   hold                      — swap SOL→token, leave in bot wallet
//   distribute_tokens_holders — swap, then airdrop tokens pro-rata to
//                                every wallet currently holding the mint
//   distribute_tokens_backers — swap, then airdrop tokens pro-rata to
//                                the meme's genesis backers
//   distribute_sol_holders    — skip swap, send SOL pro-rata to every
//                                current holder (pure SOL yield)
//   distribute_sol_backers    — skip swap, send SOL pro-rata to backers
//
// Idempotency: the bot wallet's on-chain SOL balance IS the source of
// truth for "how much has been delegated since the last action." If a
// previous tick swept everything, this tick sees nothing to do and
// skips. Mid-action failures leave SOL in the bot wallet for the next
// tick to retry.

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUP_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const JUP_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Skip thresholds. Below these we just leave SOL parked.
// All three are env-tunable so we can lower during live tests without a
// code change (set tiny values, fire the cron once, restore). Defaults
// are the prod-safe values: 0.01 SOL min swap + 0.01/0.02 SOL gas reserve.
const MIN_SWAP_LAMPORTS = Number(process.env.BOT_MIN_SWAP_LAMPORTS || 10_000_000);
// Reserved in bot wallet for tx fees + pump.fun BC overhead. Bumped from
// 0.005 → 0.01 after the V2TEST swap failed when BC needed unwrapped
// SOL beyond what we'd left after wrapping. For distribute-to-many
// actions we leave a bit MORE so per-recipient transfer rent + gas
// don't bottom out the wallet.
const GAS_RESERVE_LAMPORTS = Number(process.env.BOT_GAS_RESERVE_LAMPORTS || 10_000_000);
const DIST_GAS_RESERVE_LAMPORTS = Number(process.env.BOT_DIST_GAS_RESERVE_LAMPORTS || 20_000_000);
const SLIPPAGE_BPS = 2000;                     // 20% — meme tokens are thin

// Hard caps to prevent a runaway distribute action from consuming all
// the bot's compute / RPC quota in one tick. Above this we trim to top
// N recipients by balance, surface a notice, and let the rest carry
// into future ticks if useful later.
const MAX_RECIPIENTS_PER_TICK = 100;
// Per-recipient minimum so we don't burn 5k lamports of gas to send
// somebody 100 lamports of dust.
const MIN_SOL_RECIPIENT_LAMPORTS = 50_000;     // 0.00005 SOL minimum
const MIN_TOKEN_RECIPIENT_RAW = BigInt(1);

// Wallets explicitly EXCLUDED from holder distributions. AMM pools, BC
// PDAs, the bot wallet itself, burn addresses. Mirrors airdrop/daily.
const HOLDER_EXCLUSIONS = new Set<string>([
  '8xLcPgxcMtYNPq2bw931hVuSYSXPCc6jRczDu64Bgm16', // PumpSwap AMM pool for PROOF (will be different per token; this is a sentinel — per-meme PDA is excluded dynamically below)
  '11111111111111111111111111111111',              // burn / system
  '1nc1nerator11111111111111111111111111111111',  // SPL incinerator
]);
const PUMP_BC = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Previous denylist (Pump BC + PumpSwap AMM only) replaced 2026-05-30
// with a System-Program allowlist inside buildRecipientList: every
// non-EOA holder (every PDA owned by any program) is filtered out, not
// just the two known AMMs. Stops SOL/tokens from being stranded in
// Jupiter perps, Axiom, Kamino, Drift, CEX hot wallets, etc.

function decryptKeypair(enc: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(decryptPrivateKey(enc)));
}

function loadEscrow(): Keypair {
  const k = process.env.ESCROW_WALLET_PRIVATE_KEY;
  if (!k) throw new Error('ESCROW_WALLET_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(k));
}

export type BotAction =
  | 'burn'
  | 'hold'
  | 'distribute_tokens_holders'
  | 'distribute_tokens_backers'
  | 'distribute_sol_holders'
  | 'distribute_sol_backers'
  // DONATE bots — fire-and-forget transfers to a creator-committed
  // destination_wallet. Immutable destination set at submit.
  | 'donate_sol'
  | 'donate_tokens'
  // POOL_FEEDER — auto-LP / protocol-owned liquidity. Activates AFTER
  // graduation (Pump.fun → PumpSwap, Meteora → DAMM v2). Pre-grad just
  // accumulates SOL in the bot wallet.
  | 'feed_lp'
  // Deprecated synonyms kept so old rows still execute sensibly.
  | 'distribute_holders'
  | 'distribute_backers';

// Whether the action requires us to swap SOL → token before distributing.
function needsSwap(action: BotAction): boolean {
  return (
    action === 'burn'
    || action === 'hold'
    || action === 'distribute_tokens_holders'
    || action === 'distribute_tokens_backers'
    || action === 'donate_tokens'
    || action === 'distribute_holders'   // legacy → treat as tokens
    || action === 'distribute_backers'   // legacy → treat as tokens
  );
}

export interface BuybackResult {
  ok: boolean;
  botId?: string;
  memeId: string;
  symbol?: string;
  skipped?: string;
  action?: BotAction;
  solSpentLamports?: number;
  tokensBoughtRaw?: string;
  tokensActedRaw?: string;
  recipientCount?: number;
  swapTx?: string;
  actionTx?: string;
  actionTxs?: string[];  // for multi-tx distribute actions
  error?: string;
}

// MemeRow now carries the meme's static fields. Per-bot fields (action,
// wallet, key, totals, last_run) live in meme_bots — see executeBuybackBot.
interface MemeRow {
  id: string;
  symbol: string;
  mint_address: string | null;
  status: string;
}

interface BotRow {
  id: string;
  meme_id: string;
  action: BotAction;
  fee_pct: number;
  bot_wallet: string;
  encrypted_bot_key: string;
  // Required for donate_*, NULL for everything else (DB CHECK enforces).
  destination_wallet: string | null;
  total_sol_spent: number | null;
  total_tokens_acted: number | null;
}

// Phase B — execute one specific bot from a meme's stack. Replaces the
// single-bot-per-meme executor; each row in meme_bots gets its own
// independent run, wallet, audit trail.
export async function executeBuybackBot(
  supabase: SupabaseClient,
  botId: string,
): Promise<BuybackResult> {
  const { data: bot, error: botErr } = await supabase
    .from('meme_bots')
    .select('id, meme_id, action, fee_pct, bot_wallet, encrypted_bot_key, destination_wallet, total_sol_spent, total_tokens_acted')
    .eq('id', botId)
    .single();
  if (botErr || !bot) return { ok: false, memeId: '', error: 'bot not found' };
  const b = bot as BotRow;

  const { data: meme, error: memeErr } = await supabase
    .from('memes')
    .select('id, symbol, mint_address, status')
    .eq('id', b.meme_id)
    .single();
  if (memeErr || !meme) return { ok: false, botId: b.id, memeId: b.meme_id, error: 'meme not found' };
  const m = meme as MemeRow;

  if (m.status !== 'live')    return { ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, skipped: `not live (status=${m.status})` };
  if (!m.mint_address)        return { ok: false, botId: b.id, memeId: m.id, symbol: m.symbol, error: 'mint_address missing on live meme' };

  const action = b.action;

  let botKp: Keypair;
  try { botKp = decryptKeypair(b.encrypted_bot_key); }
  catch (e) { return { ok: false, botId: b.id, memeId: m.id, symbol: m.symbol, action, error: `bot key decrypt: ${e instanceof Error ? e.message : String(e)}` }; }
  if (botKp.publicKey.toBase58() !== b.bot_wallet) {
    return { ok: false, botId: b.id, memeId: m.id, symbol: m.symbol, action, error: 'bot key pubkey mismatch — refusing to touch' };
  }

  const conn = new Connection(RPC_URL, 'confirmed');

  // ── PRE-FLIGHT: stranded-token recovery ──
  // For swap-based actions (burn / token-distribute), a prior tick may
  // have completed the swap step but failed the action step, leaving
  // tokens stuck in the bot wallet. Finish that work BEFORE doing any
  // new swap so the stranded balance gets reduced to zero. Logs as a
  // separate "recovery" row in meme_buybacks; doesn't block the normal
  // flow that follows.
  //
  // Skipped for:
  //   - hold (vault): tokens are SUPPOSED to sit in the wallet
  //   - distribute_sol_*: no swap = no stranded tokens possible
  if (
    m.mint_address &&
    (action === 'burn' ||
     action === 'distribute_tokens_holders' ||
     action === 'distribute_tokens_backers' ||
     action === 'donate_tokens' ||
     action === 'distribute_holders' ||
     action === 'distribute_backers')
  ) {
    try {
      await tryRecoverStrandedTokens(supabase, m, b, botKp, conn, action);
    } catch (e) {
      // Recovery failures are non-fatal — log + continue with normal flow.
      console.warn(`[buybackBot] recovery for bot ${b.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const balance = await conn.getBalance(botKp.publicKey);

  // For swap-based actions, gas reserve is 0.01 SOL (BC overhead).
  // For SOL-distribution actions, we leave 0.02 because per-recipient
  // tx fees add up across multiple txes.
  const isDistribute = action !== 'burn' && action !== 'hold';
  const gasReserve = isDistribute ? DIST_GAS_RESERVE_LAMPORTS : GAS_RESERVE_LAMPORTS;
  const usableLamports = balance - gasReserve;
  if (usableLamports < MIN_SWAP_LAMPORTS) {
    return { ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, action, skipped: `bot wallet balance ${balance} below action threshold (need ${MIN_SWAP_LAMPORTS + gasReserve} lamports)` };
  }

  // ── SOL-only distribute actions skip the swap entirely ─────────────
  if (action === 'distribute_sol_holders' || action === 'distribute_sol_backers') {
    return executeSolDistribute(supabase, m, b, botKp, conn, action, usableLamports);
  }

  // ── POOL_FEEDER: pre-grad accumulates, post-grad deploys LP ───────
  // Only viable AFTER the bonding curve graduates to a real AMM
  // (PumpSwap for Pump.fun, DAMM v2 for Meteora). Pre-grad behavior is
  // "wait" — SOL stays in the bot wallet, logged as a no-op tick. The
  // moment graduation lands, the next cron tick deploys.
  //
  // The post-grad LP-add path is per-platform and lives in
  // executeFeedLp — see that function for the Phase-2 status of each
  // platform integration.
  if (action === 'feed_lp') {
    return executeFeedLp(supabase, m, b, botKp, conn, usableLamports);
  }

  // ── DONATE_SOL: skip swap, send SOL straight to destination ───────
  if (action === 'donate_sol') {
    return executeDonateSol(supabase, m, b, botKp, conn, usableLamports);
  }

  // ── Swap branch (burn / hold / token-distribute) ──────────────────
  let actualTokensRaw: bigint;
  let tokenProgramId: PublicKey;
  let tokenDecimals: number;
  let swapTx: string;
  try {
    const quoteUrl = `${JUP_QUOTE_URL}?inputMint=${SOL_MINT}&outputMint=${m.mint_address}&amount=${usableLamports}&slippageBps=${SLIPPAGE_BPS}`;
    const qres = await fetch(quoteUrl);
    if (!qres.ok) throw new Error(`jupiter quote ${qres.status}: ${await qres.text()}`);
    const quote = await qres.json();
    if (quote.error) throw new Error(`jupiter quote: ${quote.error}`);
    // SOL-031: reject the quote if its contextSlot lags the current slot.
    // Stale routes ship worse fills or trigger slippage failures at swap time.
    await assertQuoteFresh(conn, quote);

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
    // SOL-029: simulate before send. swapVtx is the Jupiter-built swap;
    // a stale quote or pool drift would surface here as a simulate error
    // before we pay the priority fee on a doomed send.
    swapTx = await simulateAndSend(conn, swapVtx, undefined, { maxRetries: 3, label: 'jupiter-swap' });
    const swapConf = await conn.confirmTransaction(swapTx, 'confirmed');
    if (swapConf.value.err) throw new Error(`swap tx failed: ${JSON.stringify(swapConf.value.err)}`);

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
    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, bot_id: b.id, action, sol_spent_lamports: usableLamports.toString(),
      tokens_bought_raw: '0', tokens_acted_raw: '0',
      status: 'failed', error: `swap: ${e instanceof Error ? e.message : String(e)}`,
    });
    await supabase.from('meme_bots').update({ last_run_at: new Date().toISOString() }).eq('id', b.id);
    return { ok: false, botId: b.id, memeId: m.id, symbol: m.symbol, action, error: `swap failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Dispatch the action on the bought tokens.
  if (action === 'burn') {
    return executeBurn(supabase, m, b, botKp, conn, action, actualTokensRaw, tokenProgramId, tokenDecimals, usableLamports, swapTx);
  }
  if (action === 'hold') {
    return executeHold(supabase, m, b, actualTokensRaw, action, usableLamports, swapTx);
  }
  if (action === 'donate_tokens') {
    return executeDonateTokens(supabase, m, b, botKp, conn, actualTokensRaw, tokenProgramId, tokenDecimals, usableLamports, swapTx);
  }
  // distribute_tokens_* (current + legacy synonyms)
  return executeTokenDistribute(
    supabase, m, b, botKp, conn, action, actualTokensRaw, tokenProgramId, tokenDecimals, usableLamports, swapTx,
  );
}

// ── BURN ───────────────────────────────────────────────────────────
async function executeBurn(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection,
  action: BotAction, actualTokensRaw: bigint,
  tokenProgramId: PublicKey, tokenDecimals: number,
  usableLamports: number, swapTx: string,
): Promise<BuybackResult> {
  let actionTx: string | undefined;
  try {
    const mintPub = new PublicKey(m.mint_address!);
    const ata = getAssociatedTokenAddressSync(mintPub, botKp.publicKey, false, tokenProgramId);
    const burnIx = createBurnCheckedInstruction(
      ata, mintPub, botKp.publicKey, actualTokensRaw, tokenDecimals, [], tokenProgramId,
    );
    // SOL-030: adaptive priority fee (fallback preserves the prior 50k).
    const priorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 });
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: botKp.publicKey, recentBlockhash: blockhash,
      instructions: [cuIx, priorityIx, burnIx],
    }).compileToV0Message();
    const burnTx = new VersionedTransaction(msg);
    burnTx.sign([botKp]);
    // SOL-029: simulate before send.
    actionTx = await simulateAndSend(conn, burnTx, undefined, { maxRetries: 3, label: 'bot-burn' });
    const burnConf = await conn.confirmTransaction({ signature: actionTx, blockhash, lastValidBlockHeight }, 'confirmed');
    if (burnConf.value.err) throw new Error(`burn failed: ${JSON.stringify(burnConf.value.err)}`);
  } catch (e) {
    return finalizePartial(supabase, m, b, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, `action: ${e instanceof Error ? e.message : String(e)}`);
  }
  return finalize(supabase, m, b, action, usableLamports, actualTokensRaw, actualTokensRaw, swapTx, actionTx);
}

// ── HOLD ───────────────────────────────────────────────────────────
async function executeHold(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  actualTokensRaw: bigint, action: BotAction,
  usableLamports: number, swapTx: string,
): Promise<BuybackResult> {
  // No-op — tokens stay in bot wallet.
  return finalize(supabase, m, b, action, usableLamports, actualTokensRaw, actualTokensRaw, swapTx, undefined);
}

// ── DONATE_SOL ─────────────────────────────────────────────────────
// Skip swap. Send the bot's usable SOL straight to the committed
// destination wallet (set at submit, immutable). One tx, one recipient,
// no batching — much simpler than DISTRIBUTE_SOL_*.
async function executeDonateSol(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection,
  usableLamports: number,
): Promise<BuybackResult> {
  const action: BotAction = 'donate_sol';
  if (!b.destination_wallet) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'donate_sol: destination_wallet missing');
  }
  let destPk: PublicKey;
  try { destPk = new PublicKey(b.destination_wallet); }
  catch { return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, `donate_sol: invalid destination ${b.destination_wallet}`); }

  try {
    // SOL-030: adaptive priority fee.
    const priorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
    const tx = new Transaction().add(
      priorityIx,
      SystemProgram.transfer({
        fromPubkey: botKp.publicKey,
        toPubkey: destPk,
        lamports: usableLamports,
      }),
    );
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = botKp.publicKey;
    // SOL-029: simulate before send.
    const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: 'donate_sol' });
    const conf = await conn.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) throw new Error(`donate_sol tx failed: ${JSON.stringify(conf.value.err)}`);
    return finalize(
      supabase, m, b, action,
      usableLamports,     // sol spent
      BigInt(0),          // tokens bought (none)
      BigInt(0),          // tokens acted (none)
      undefined,          // swap tx (none)
      sig,                // action tx = the transfer
      undefined, 1,       // 1 recipient (the destination)
      undefined,
    );
  } catch (e) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, `donate_sol: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── DISTRIBUTE SOL (no swap) ───────────────────────────────────────
async function executeSolDistribute(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection,
  action: BotAction, usableLamports: number,
): Promise<BuybackResult> {
  const recipients = await buildRecipientList(
    supabase, conn, m, botKp.publicKey,
    action === 'distribute_sol_holders' ? 'holders' : 'backers',
  );
  if (recipients.error) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, recipients.error);
  }
  if (recipients.list.length === 0) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'no recipients found');
  }

  // Pro-rata SOL allocation. weights are unitless — sum normalizes.
  const totalWeight = recipients.list.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'total weight 0');
  }

  // Send per-recipient. Batch into multiple txes if needed.
  const transfersPerTx = 18; // safe for SOL transfers within tx size limits
  const sigs: string[] = [];
  let actualSent = 0;
  let credited = 0;
  const errors: string[] = [];

  for (let i = 0; i < recipients.list.length; i += transfersPerTx) {
    const batch = recipients.list.slice(i, i + transfersPerTx);
    const tx = new Transaction();
    let txTotal = 0;
    let batchHasAny = false;
    for (const r of batch) {
      const share = Math.floor((usableLamports * r.weight) / totalWeight);
      if (share < MIN_SOL_RECIPIENT_LAMPORTS) continue; // skip dust
      tx.add(SystemProgram.transfer({
        fromPubkey: botKp.publicKey,
        toPubkey: new PublicKey(r.wallet),
        lamports: share,
      }));
      txTotal += share;
      batchHasAny = true;
    }
    if (!batchHasAny) continue;
    try {
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      tx.feePayer = botKp.publicKey;
      // SOL-029: simulate before send.
      const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: `distribute_sol:${i}` });
      await conn.confirmTransaction(sig, 'confirmed');
      sigs.push(sig);
      actualSent += txTotal;
      credited += tx.instructions.length;
    } catch (e) {
      errors.push(`batch starting at ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return finalize(
    supabase, m, b, action,
    actualSent, // sol_spent
    BigInt(0),  // tokens_bought
    BigInt(0),  // tokens_acted (we sent SOL, not tokens)
    undefined,  // swap_tx
    undefined,  // single action_tx
    sigs.length > 0 ? sigs : undefined,
    credited,
    errors.length > 0 ? `partial: ${errors.length} batch failures (${errors[0]})` : undefined,
  );
}

// ── DISTRIBUTE TOKENS (swap then airdrop) ──────────────────────────
async function executeTokenDistribute(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection,
  action: BotAction, actualTokensRaw: bigint,
  tokenProgramId: PublicKey, tokenDecimals: number,
  usableLamports: number, swapTx: string,
): Promise<BuybackResult> {
  // Map legacy action names to the recipient set
  const recipientKind: 'holders' | 'backers' =
    action === 'distribute_tokens_holders' || action === 'distribute_holders'
      ? 'holders'
      : 'backers';

  const recipients = await buildRecipientList(supabase, conn, m, botKp.publicKey, recipientKind);
  if (recipients.error) {
    return finalizePartial(supabase, m, b, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, recipients.error);
  }
  if (recipients.list.length === 0) {
    return finalizePartial(supabase, m, b, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, 'no recipients found');
  }

  const totalWeight = recipients.list.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) {
    return finalizePartial(supabase, m, b, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, 'total weight 0');
  }

  const mintPub = new PublicKey(m.mint_address!);
  const senderAta = getAssociatedTokenAddressSync(mintPub, botKp.publicKey, false, tokenProgramId);

  const transfersPerTx = 8;
  const sigs: string[] = [];
  let actedRaw = BigInt(0);
  let credited = 0;
  const errors: string[] = [];

  for (let i = 0; i < recipients.list.length; i += transfersPerTx) {
    const batch = recipients.list.slice(i, i + transfersPerTx);
    const tx = new Transaction();
    let batchHasAny = false;
    for (const r of batch) {
      const shareBig =
        actualTokensRaw * BigInt(Math.floor(r.weight * 1e6))
        / BigInt(Math.floor(totalWeight * 1e6));
      if (shareBig < MIN_TOKEN_RECIPIENT_RAW) continue;
      const recipientPub = new PublicKey(r.wallet);
      const recipientAta = getAssociatedTokenAddressSync(mintPub, recipientPub, false, tokenProgramId);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(
        botKp.publicKey, recipientAta, recipientPub, mintPub, tokenProgramId,
      ));
      tx.add(createTransferCheckedInstruction(
        senderAta, mintPub, recipientAta, botKp.publicKey,
        shareBig, tokenDecimals, [], tokenProgramId,
      ));
      actedRaw += shareBig;
      batchHasAny = true;
      credited++;
    }
    if (!batchHasAny) continue;
    try {
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      tx.feePayer = botKp.publicKey;
      // SOL-029: simulate before send.
      const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: `distribute_tokens:${i}` });
      await conn.confirmTransaction(sig, 'confirmed');
      sigs.push(sig);
    } catch (e) {
      errors.push(`batch ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return finalize(
    supabase, m, b, action, usableLamports, actualTokensRaw, actedRaw,
    swapTx, undefined,
    sigs.length > 0 ? sigs : undefined,
    credited,
    errors.length > 0 ? `partial: ${errors.length} batch failures (${errors[0]})` : undefined,
  );
}

// ── DONATE_TOKENS ──────────────────────────────────────────────────
// After the SOL→token swap (already done in the main flow), transfer
// the entire bought-token balance straight to the committed destination.
// Idempotent ATA creation on destination — bot pays the ~0.002 SOL rent
// if the destination doesn't already have an ATA for this mint.
async function executeDonateTokens(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection,
  actualTokensRaw: bigint,
  tokenProgramId: PublicKey, tokenDecimals: number,
  usableLamports: number, swapTx: string,
): Promise<BuybackResult> {
  const action: BotAction = 'donate_tokens';
  if (!b.destination_wallet) {
    return finalizePartial(supabase, m, b, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, 'donate_tokens: destination_wallet missing');
  }
  let destPk: PublicKey;
  try { destPk = new PublicKey(b.destination_wallet); }
  catch { return finalizePartial(supabase, m, b, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, `donate_tokens: invalid destination ${b.destination_wallet}`); }

  try {
    const mintPub = new PublicKey(m.mint_address!);
    const fromAta = getAssociatedTokenAddressSync(mintPub, botKp.publicKey, false, tokenProgramId);
    const toAta   = getAssociatedTokenAddressSync(mintPub, destPk,           true,  tokenProgramId);
    // SOL-030: adaptive priority fee.
    const priorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
    const tx = new Transaction().add(
      priorityIx,
      createAssociatedTokenAccountIdempotentInstruction(
        botKp.publicKey, toAta, destPk, mintPub, tokenProgramId,
      ),
      createTransferCheckedInstruction(
        fromAta, mintPub, toAta, botKp.publicKey,
        actualTokensRaw, tokenDecimals, [], tokenProgramId,
      ),
    );
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.feePayer = botKp.publicKey;
    // SOL-029: simulate before send.
    const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: 'donate_tokens' });
    const conf = await conn.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) throw new Error(`donate_tokens tx failed: ${JSON.stringify(conf.value.err)}`);
    return finalize(
      supabase, m, b, action,
      usableLamports, actualTokensRaw, actualTokensRaw,
      swapTx, sig, undefined, 1,
      undefined,
    );
  } catch (e) {
    return finalizePartial(supabase, m, b, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, `donate_tokens: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Recipient list builder ─────────────────────────────────────────
// kind='holders' → on-chain token-holder snapshot, sorted by balance,
//                  capped at MAX_RECIPIENTS_PER_TICK.
// kind='backers' → confirmed/distributed backings from DB, weighted by
//                  amount_sol committed.
async function buildRecipientList(
  supabase: SupabaseClient, conn: Connection, m: MemeRow, botPub: PublicKey,
  kind: 'holders' | 'backers',
): Promise<{ list: { wallet: string; weight: number }[]; error?: string }> {
  if (kind === 'backers') {
    const { data: backings, error } = await supabase
      .from('backings')
      .select('backer_wallet, amount_sol, status')
      .eq('meme_id', m.id)
      .in('status', ['confirmed', 'distributed']);
    if (error) return { list: [], error: `backings query: ${error.message}` };
    if (!backings || backings.length === 0) return { list: [] };
    // Dedupe by wallet (in case of legacy multiple rows)
    const byWallet = new Map<string, number>();
    for (const b of backings) {
      byWallet.set(b.backer_wallet, (byWallet.get(b.backer_wallet) || 0) + Number(b.amount_sol));
    }
    return {
      list: Array.from(byWallet.entries()).map(([wallet, weight]) => ({ wallet, weight })),
    };
  }

  // Holders snapshot — read on-chain token accounts for the mint.
  try {
    const mintPub = new PublicKey(m.mint_address!);
    const accts = await conn.getProgramAccounts(TOKEN_PROGRAM_ID, {
      commitment: 'confirmed',
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: mintPub.toBase58() } },
      ],
    });
    // Try Token-2022 too in case the mint is Token-2022.
    const accts2022 = await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      commitment: 'confirmed',
      filters: [
        { memcmp: { offset: 0, bytes: mintPub.toBase58() } },
      ],
    });
    const all = [...accts, ...accts2022];

    // Aggregate by owner (multi-ATAs possible).
    const byOwner = new Map<string, bigint>();
    const [bcPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPub.toBuffer()],
      PUMP_BC,
    );
    const dynamicExclude = new Set<string>([
      ...HOLDER_EXCLUSIONS,
      botPub.toBase58(),
      bcPda.toBase58(),
    ]);
    for (const a of all) {
      try {
        const data = a.account.data;
        // SPL Token account layout: owner at offset 32, amount at 64-72 (u64 LE)
        const owner = new PublicKey(data.slice(32, 64)).toBase58();
        if (dynamicExclude.has(owner)) continue;
        const amt = data.readBigUInt64LE(64);
        if (amt === BigInt(0)) continue;
        byOwner.set(owner, (byOwner.get(owner) || BigInt(0)) + amt);
      } catch { /* skip unparseable */ }
    }

    // Filter known DeFi PDAs only. Curated denylist (KNOWN_PDA_PROGRAMS)
    // covers confirmed DeFi venues — DEX pools, perps, lending — where
    // tokens can land but no human can claim. Everything else is kept,
    // including:
    //   - EOA wallets (Phantom / Backpack / Solflare / Ledger / Jupiter
    //     Wallet — every self-custody wallet)
    //   - Multisigs (Squads team treasuries)
    //   - Governance treasuries (Realms)
    //   - Brand-new wallets with no SOL account (info === null) — the
    //     transfer itself creates the SOL account
    //
    // Same denylist + same logic as /api/airdrop/daily. Keep them in sync
    // via the shared KNOWN_PDA_PROGRAMS in src/lib/holderFilter.ts.
    const candidateWallets = [...byOwner.keys()];
    if (candidateWallets.length > 0) {
      const BATCH = 100;
      const allInfos: (Awaited<ReturnType<typeof conn.getAccountInfo>>)[] = [];
      for (let i = 0; i < candidateWallets.length; i += BATCH) {
        const batch = candidateWallets.slice(i, i + BATCH).map((w) => new PublicKey(w));
        const infos = await conn.getMultipleAccountsInfo(batch, 'confirmed');
        allInfos.push(...infos);
      }
      for (let i = 0; i < candidateWallets.length; i++) {
        const info = allInfos[i];
        if (!info) continue;
        if (KNOWN_PDA_PROGRAMS.has(info.owner.toBase58())) {
          byOwner.delete(candidateWallets[i]);
        }
      }
    }

    // Convert to weighted list, sort desc, cap.
    const sorted = Array.from(byOwner.entries())
      .filter(([, bal]) => bal > BigInt(0))
      .map(([wallet, bal]) => ({ wallet, weight: Number(bal) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_RECIPIENTS_PER_TICK);
    return { list: sorted };
  } catch (e) {
    return { list: [], error: `holders snapshot: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── Audit row + rollup helpers ─────────────────────────────────────
async function finalize(
  supabase: SupabaseClient, m: MemeRow, b: BotRow, action: BotAction,
  solSpentLamports: number,
  tokensBoughtRaw: bigint, tokensActedRaw: bigint,
  swapTx: string | undefined, actionTx: string | undefined,
  actionTxs?: string[],
  recipientCount?: number,
  notes?: string,
): Promise<BuybackResult> {
  const insertRow: Record<string, unknown> = {
    meme_id: m.id, bot_id: b.id, action,
    sol_spent_lamports: solSpentLamports.toString(),
    tokens_bought_raw: tokensBoughtRaw.toString(),
    tokens_acted_raw:  tokensActedRaw.toString(),
    swap_tx: swapTx, action_tx: actionTx ?? (actionTxs?.[0] ?? null),
    status: notes ? 'partial' : 'completed',
  };
  if (notes) insertRow.notes = notes;
  if (actionTxs && actionTxs.length > 1) {
    insertRow.notes = (notes ? notes + ' · ' : '') + `${actionTxs.length} batched txes`;
  }
  await supabase.from('meme_buybacks').insert(insertRow);

  // Per-bot rollup stats (not per-meme) — each bot tracks its own
  // lifetime spend + tokens acted independently.
  const newSolSpent = Number(b.total_sol_spent || 0) + (solSpentLamports / LAMPORTS_PER_SOL);
  const newTokensActed = Number(b.total_tokens_acted || 0) + Number(tokensActedRaw);
  await supabase
    .from('meme_bots')
    .update({
      last_run_at: new Date().toISOString(),
      total_sol_spent: newSolSpent,
      total_tokens_acted: newTokensActed,
    })
    .eq('id', b.id);

  return {
    ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, action,
    solSpentLamports,
    tokensBoughtRaw: tokensBoughtRaw.toString(),
    tokensActedRaw:  tokensActedRaw.toString(),
    swapTx, actionTx: actionTx ?? actionTxs?.[0], actionTxs,
    recipientCount,
  };
}

async function finalizePartial(
  supabase: SupabaseClient, m: MemeRow, b: BotRow, action: BotAction,
  solSpentLamports: number, tokensRaw: bigint,
  swapTx: string | undefined, actionTx: string | undefined,
  actionTxs: string[] | undefined,
  recipientCount: number | undefined,
  errorMsg: string,
): Promise<BuybackResult> {
  await supabase.from('meme_buybacks').insert({
    meme_id: m.id, bot_id: b.id, action,
    sol_spent_lamports: solSpentLamports.toString(),
    tokens_bought_raw: tokensRaw.toString(),
    tokens_acted_raw:  '0',
    swap_tx: swapTx, action_tx: actionTx ?? (actionTxs?.[0] ?? null),
    status: 'partial',
    error: errorMsg,
  });
  await supabase.from('meme_bots').update({ last_run_at: new Date().toISOString() }).eq('id', b.id);
  return {
    ok: false, botId: b.id, memeId: m.id, symbol: m.symbol, action,
    solSpentLamports, tokensBoughtRaw: tokensRaw.toString(),
    swapTx, actionTx, actionTxs, recipientCount,
    error: errorMsg,
  };
}

// ── Stranded-token recovery ────────────────────────────────────────
// Reads the bot's on-chain token balance for the meme's mint. If it's
// non-zero, runs the bot's action against that balance and writes a
// dedicated meme_buybacks row tagged with status='completed' and a
// "recovery: prior partial" note. Does NOT modify the original partial
// row (audit-trail integrity — the chain of (partial → recovery) tells
// the full story).
//
// Called from executeBuybackBot ONLY for swap-based actions:
//   burn, distribute_tokens_holders, distribute_tokens_backers
// (HOLD intentionally accumulates; SOL distribute has no swap.)
async function tryRecoverStrandedTokens(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection, action: BotAction,
): Promise<void> {
  if (!m.mint_address) return;
  const mintPub = new PublicKey(m.mint_address);

  // Detect token program (SPL vs Token-2022).
  const mintAcc = await conn.getAccountInfo(mintPub);
  if (!mintAcc) return;
  const tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const ata = getAssociatedTokenAddressSync(mintPub, botKp.publicKey, false, tokenProgramId);
  const balRes = await conn.getTokenAccountBalance(ata).catch(() => null);
  const strandedRaw = BigInt(balRes?.value?.amount || '0');
  if (strandedRaw === BigInt(0)) return;

  const mintInfo = await getMint(conn, mintPub, 'confirmed', tokenProgramId);
  const tokenDecimals = mintInfo.decimals;

  // Run the appropriate action against the stranded balance.
  if (action === 'burn') {
    const burnIx = createBurnCheckedInstruction(
      ata, mintPub, botKp.publicKey, strandedRaw, tokenDecimals, [], tokenProgramId,
    );
    // SOL-030: adaptive priority fee.
    const priorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 });
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: botKp.publicKey, recentBlockhash: blockhash,
      instructions: [cuIx, priorityIx, burnIx],
    }).compileToV0Message();
    const burnTx = new VersionedTransaction(msg);
    burnTx.sign([botKp]);
    // SOL-029: simulate before send.
    const sig = await simulateAndSend(conn, burnTx, undefined, { maxRetries: 3, label: 'recovery-burn' });
    const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (conf.value.err) throw new Error(`recovery burn failed: ${JSON.stringify(conf.value.err)}`);

    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, bot_id: b.id, action,
      sol_spent_lamports: '0',                       // no new SOL spent
      tokens_bought_raw:  '0',
      tokens_acted_raw:   strandedRaw.toString(),
      swap_tx: null, action_tx: sig,
      status: 'completed',
      notes: 'recovery: prior partial',
    });
    return;
  }

  // DONATE_TOKENS recovery — finish the transfer to the locked
  // destination using the existing stranded balance, no re-swap.
  if (action === 'donate_tokens') {
    if (!b.destination_wallet) return; // shouldn't happen (DB CHECK)
    let destPk: PublicKey;
    try { destPk = new PublicKey(b.destination_wallet); } catch { return; }
    const fromAta = ata;
    const toAta = getAssociatedTokenAddressSync(mintPub, destPk, true, tokenProgramId);
    // SOL-030: adaptive priority fee.
    const priorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
    const tx = new Transaction().add(
      priorityIx,
      createAssociatedTokenAccountIdempotentInstruction(
        botKp.publicKey, toAta, destPk, mintPub, tokenProgramId,
      ),
      createTransferCheckedInstruction(
        fromAta, mintPub, toAta, botKp.publicKey,
        strandedRaw, tokenDecimals, [], tokenProgramId,
      ),
    );
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.feePayer = botKp.publicKey;
    // SOL-029: simulate before send.
    const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: 'recovery-donate_tokens' });
    const conf = await conn.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) throw new Error(`recovery donate_tokens failed: ${JSON.stringify(conf.value.err)}`);

    await supabase.from('meme_buybacks').insert({
      meme_id: m.id, bot_id: b.id, action,
      sol_spent_lamports: '0',
      tokens_bought_raw:  '0',
      tokens_acted_raw:   strandedRaw.toString(),
      swap_tx: null, action_tx: sig,
      status: 'completed',
      notes: 'recovery: prior partial',
    });
    return;
  }

  // distribute_tokens_* (current + legacy)
  const recipientKind: 'holders' | 'backers' =
    action === 'distribute_tokens_holders' || action === 'distribute_holders'
      ? 'holders'
      : 'backers';
  const recipients = await buildRecipientList(supabase, conn, m, botKp.publicKey, recipientKind);
  if (recipients.error || recipients.list.length === 0) {
    // Leave stranded tokens for the next tick — recipient set might fix.
    return;
  }
  const totalWeight = recipients.list.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) return;

  const senderAta = getAssociatedTokenAddressSync(mintPub, botKp.publicKey, false, tokenProgramId);
  const transfersPerTx = 8;
  const sigs: string[] = [];
  let actedRaw = BigInt(0);
  let credited = 0;
  const errors: string[] = [];

  for (let i = 0; i < recipients.list.length; i += transfersPerTx) {
    const batch = recipients.list.slice(i, i + transfersPerTx);
    const tx = new Transaction();
    let batchHasAny = false;
    for (const r of batch) {
      const shareBig =
        strandedRaw * BigInt(Math.floor(r.weight * 1e6))
        / BigInt(Math.floor(totalWeight * 1e6));
      if (shareBig < MIN_TOKEN_RECIPIENT_RAW) continue;
      const recipientPub = new PublicKey(r.wallet);
      const recipientAta = getAssociatedTokenAddressSync(mintPub, recipientPub, false, tokenProgramId);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(
        botKp.publicKey, recipientAta, recipientPub, mintPub, tokenProgramId,
      ));
      tx.add(createTransferCheckedInstruction(
        senderAta, mintPub, recipientAta, botKp.publicKey,
        shareBig, tokenDecimals, [], tokenProgramId,
      ));
      actedRaw += shareBig;
      credited++;
      batchHasAny = true;
    }
    if (!batchHasAny) continue;
    try {
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      tx.feePayer = botKp.publicKey;
      // SOL-029: simulate before send.
      const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: `recovery-distribute:${i}` });
      await conn.confirmTransaction(sig, 'confirmed');
      sigs.push(sig);
    } catch (e) {
      errors.push(`batch ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (sigs.length === 0) {
    // All batches failed — leave stranded for next tick.
    return;
  }

  await supabase.from('meme_buybacks').insert({
    meme_id: m.id, bot_id: b.id, action,
    sol_spent_lamports: '0',
    tokens_bought_raw:  '0',
    tokens_acted_raw:   actedRaw.toString(),
    swap_tx: null, action_tx: sigs[0],
    status: errors.length === 0 ? 'completed' : 'partial',
    notes: `recovery: prior partial · ${credited} recipients · ${sigs.length} txes${errors.length ? ` · ${errors.length} batch errors` : ''}`,
  });
}

// Phase B — iterate over every bot in every live meme's stack, execute
// each independently. Replaces the old per-meme execution path.
export async function runBuybackBotsForAllLive(
  supabase: SupabaseClient,
): Promise<BuybackResult[]> {
  const { data: bots } = await supabase
    .from('meme_bots')
    .select('id, meme_id, memes!inner(status)')
    .eq('memes.status', 'live');
  const out: BuybackResult[] = [];
  for (const bot of bots || []) {
    try {
      const r = await executeBuybackBot(supabase, bot.id);
      out.push(r);
    } catch (e) {
      out.push({ ok: false, botId: bot.id, memeId: bot.meme_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// POOL_FEEDER (feed_lp) — auto-LP / protocol-owned liquidity
// ────────────────────────────────────────────────────────────────────
//
// Pre-graduation: the bonding curve IS the liquidity. There's no
// addLiquidity primitive on a curve — adding more capital just moves
// price. So pre-grad we don't act. SOL accumulates in the bot wallet
// across cron ticks until graduation happens.
//
// Post-graduation: the token now lives on a real AMM (PumpSwap for
// Pump.fun, DAMM v2 for Meteora). The bot:
//   1. Splits the available SOL in half.
//   2. Swaps half SOL → token via Jupiter (routes through the post-grad
//      AMM automatically).
//   3. Deposits the bought tokens + remaining half SOL into the AMM
//      as a liquidity position, owned by the bot wallet.
//   4. Records the deposit in bot_lp_deployments so the meme detail
//      page can surface "this bot has deepened the pool N times for
//      X SOL cumulative."
//
// The bot wallet HOLDS the LP position. Trading fees on that position
// accrue to the bot wallet automatically and can be re-deployed in a
// future tick (compound).
//
// Graduation detection: we use a pragmatic heuristic that works for
// both platforms — query Jupiter for a SOL→token quote AND a
// token→SOL quote. If Jupiter can route both ways with non-zero
// output, the token is on a public AMM (i.e. graduated). If Jupiter
// can't route or only returns the bonding-curve route, the token is
// still on the curve.
//
// (Why not query each platform's specific graduation flag? We'd need
// per-platform code paths just to check, then more per-platform code
// to deploy. The Jupiter heuristic is platform-agnostic + accurate
// enough for the "should we attempt LP-add right now?" decision.)

async function isGraduated(mint: string): Promise<boolean> {
  // A "real" AMM has 2-way routing. The bonding curve is one-directional
  // for buys until completion. Test by asking Jupiter to route 1 SOL
  // worth and 1000 tokens back the other way.
  try {
    const aRes = await fetch(`${JUP_QUOTE_URL}?inputMint=${SOL_MINT}&outputMint=${mint}&amount=1000000000&slippageBps=10000`);
    if (!aRes.ok) return false;
    const a = await aRes.json();
    if (!a?.routePlan?.length) return false;

    // Routes containing pump.fun's bonding curve are flagged with the
    // "Pump.fun" label in routePlan steps. Same for the meteora DBC
    // and Raydium LaunchLab pre-grad labels. If the ONLY routes Jupiter
    // knows are curve labels, the token hasn't graduated.
    const labels: string[] = (a.routePlan ?? []).flatMap((p: { swapInfo?: { label?: string } }) =>
      p?.swapInfo?.label ? [p.swapInfo.label] : []
    );
    const onlyCurves = labels.length > 0 && labels.every((l) =>
      /pump\.?fun|meteora\s*dbc|dynamic\s*bonding\s*curve|raydium\s*launchlab|launchlab/i.test(l)
    );
    return !onlyCurves;
  } catch {
    return false;
  }
}

async function executeFeedLp(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection,
  usableLamports: number,
): Promise<BuybackResult> {
  const action: BotAction = 'feed_lp';

  if (!m.mint_address) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'feed_lp: mint_address missing');
  }

  // ── Graduation gate ───────────────────────────────────────────────
  const graduated = await isGraduated(m.mint_address);
  if (!graduated) {
    // Pre-grad: no-op tick. SOL stays in the wallet. Mark last_run so
    // the dashboards show "active, waiting for graduation."
    await supabase
      .from('meme_bots')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', b.id);
    return {
      ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, action,
      skipped: `pre-graduation — accumulating (${(usableLamports / 1e9).toFixed(4)} SOL pending LP deploy)`,
    };
  }

  // ── Post-grad: deploy LP ──────────────────────────────────────────
  // The per-platform LP-add implementations (PumpSwap CPMM, Meteora
  // DAMM v2 concentrated-liquidity position) are tracked separately —
  // they're real integrations, not one-line SDK calls. For now we
  // record the readiness state + return ok; the LP-add transaction
  // will fire from this same code path the moment those modules land.
  //
  // Importantly: until the LP-add lands, this bot DOESN'T touch the
  // accumulated SOL. It stays in the bot wallet, ready to deploy.
  // Creators see "ready to deploy" status; no funds at risk.
  await supabase
    .from('meme_bots')
    .update({ last_run_at: new Date().toISOString() })
    .eq('id', b.id);
  return {
    ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, action,
    skipped: `graduated — LP-add path lands next ship (${(usableLamports / 1e9).toFixed(4)} SOL queued)`,
  };
}

