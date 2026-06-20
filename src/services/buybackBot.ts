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
import BN from 'bn.js';
import {
  PumpAmmSdk,
  OnlinePumpAmmSdk,
  canonicalPumpPoolPda,
} from '@pump-fun/pump-swap-sdk';
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
// Per-recipient floor. Solana rejects transfers that leave the
// destination account below rent-exempt minimum (890,880 lamports for
// a 0-byte system account). If the destination doesn't yet exist on
// chain, the transfer must fund it past rent-exempt or the whole tx
// fails (InsufficientFundsForRent) — taking the entire batch (typically
// 18 recipients) down with it. Pre-2026-06-15 this was 50_000 which
// fell well below rent-exempt; partial bot runs were the visible
// symptom. 1_000_000 (0.001 SOL) sits comfortably above rent-exempt +
// the tx fee floor; recipients whose share is smaller get skipped as
// dust (the value would have been less than the tx fee anyway).
const MIN_SOL_RECIPIENT_LAMPORTS = 1_000_000;  // 0.001 SOL (rent-exempt 890_880 + buffer)
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
  // Quote currency of the meme's raise + DBC pool. SOL memes operate
  // identically to today; USDC memes read the bot wallet's USDC ATA
  // balance, top up SOL gas from escrow, and use USDC as the Jupiter
  // swap input. Defaults to 'sol' for legacy rows pre-053.
  quote_currency?: 'sol' | 'usdc' | null;
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
  // Optional bot lifetime cutoff (migration 055). NULL = run forever.
  // Once expired, the buyback cron skips this row and the fee-
  // delegation path stops routing new fees to its wallet.
  expires_at: string | null;
}

// Direct PumpSwap AMM swap (SOL → token) — Jupiter-independent.
//
// Used as a fallback when Jupiter's quote or swap endpoints return
// NO_ROUTES_FOUND / MARKET_NOT_FOUND, which happens for 5min-multi-hour
// windows after a token graduates from pump.fun's bonding curve to
// PumpSwap. Jupiter's quote and swap sub-services warm up at different
// rates and can be stuck for the same `ammKey` for a long time.
// PumpSwap-direct knows the pool by deterministic PDA, builds the buy
// instructions itself, and signs/sends — no aggregator hop.
//
// Returns the swap tx signature on success, or { error } if the pool
// doesn't exist (token still on bonding curve) or the swap simulates
// invalid (price moved past slippage, etc.).
async function swapViaPumpSwap(
  conn: Connection,
  botKp: Keypair,
  mintAddress: string,
  lamports: number,
): Promise<{ ok: true; sig: string } | { ok: false; error: string }> {
  try {
    const mint = new PublicKey(mintAddress);
    const poolKey = canonicalPumpPoolPda(mint);
    const poolInfo = await conn.getAccountInfo(poolKey);
    if (!poolInfo) {
      return { ok: false, error: 'pumpswap pool not found (token not graduated yet)' };
    }
    const onlineSdk = new OnlinePumpAmmSdk(conn);
    const offlineSdk = new PumpAmmSdk();
    const state = await onlineSdk.swapSolanaState(poolKey, botKp.publicKey);
    // SLIPPAGE_BPS is expressed in basis points; PumpSwap SDK takes a
    // 0..1 fraction. 2000 bps → 0.20.
    const slippage = SLIPPAGE_BPS / 10_000;
    const ixs = await offlineSdk.buyQuoteInput(state, new BN(lamports), slippage);
    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
      ...ixs,
    );
    tx.feePayer = botKp.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: 'pumpswap-buy' });
    const conf = await conn.confirmTransaction(sig, 'confirmed');
    // `confirmTransaction` resolves when the tx LANDS in a slot, even
    // when the program reverted. The error lives in conf.value.err.
    // Without this check, slippage failures on the swap (PumpSwap error
    // 6004 ExceededSlippage etc.) would report ok=true with a sig that
    // moved zero tokens. Caller logs a phantom-success row.
    if (conf.value.err) throw new Error(`pumpswap buy tx reverted: ${JSON.stringify(conf.value.err)}`);
    return { ok: true, sig };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
    .select('id, meme_id, action, fee_pct, bot_wallet, encrypted_bot_key, destination_wallet, total_sol_spent, total_tokens_acted, expires_at')
    .eq('id', botId)
    .single();
  if (botErr || !bot) return { ok: false, memeId: '', error: 'bot not found' };
  const b = bot as BotRow;

  const { data: meme, error: memeErr } = await supabase
    .from('memes')
    .select('id, symbol, mint_address, status, quote_currency')
    .eq('id', b.meme_id)
    .single();
  if (memeErr || !meme) return { ok: false, botId: b.id, memeId: b.meme_id, error: 'meme not found' };
  const m = meme as MemeRow;

  if (m.status !== 'live')    return { ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, skipped: `not live (status=${m.status})` };
  if (!m.mint_address)        return { ok: false, botId: b.id, memeId: m.id, symbol: m.symbol, error: 'mint_address missing on live meme' };

  // Migration 055 — bot lifetime cutoff. Once expired the cron skips
  // the row entirely; the fee-delegation path (distribution.ts) also
  // stops routing new fees so the bot wallet's last balance stays put.
  // NULL expires_at = run forever (default).
  if (b.expires_at && Date.parse(b.expires_at) <= Date.now()) {
    return { ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, action: b.action,
      skipped: `bot expired at ${b.expires_at}` };
  }

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

  // Quote currency drives ALL the dispatch from here. SOL memes:
  // balance = native SOL, usable = balance - gas reserve. USDC memes:
  // balance = bot's USDC ATA, gas comes from a SOL top-up from escrow,
  // usable = full USDC ATA balance.
  const qc: 'sol' | 'usdc' = m.quote_currency === 'usdc' ? 'usdc' : 'sol';

  // For swap-based actions, gas reserve is 0.01 SOL (BC overhead).
  // For distribution actions, we leave 0.02 because per-recipient tx
  // fees add up across multiple txes. USDC paths use these as the SOL
  // top-up target (USDC bots hold 0 SOL by default; we fund just enough
  // to cover this tick).
  const isDistribute = action !== 'burn' && action !== 'hold';
  const gasReserve = isDistribute ? DIST_GAS_RESERVE_LAMPORTS : GAS_RESERVE_LAMPORTS;

  let usableLamports: number;
  if (qc === 'usdc') {
    // Top up native SOL for tx fees (idempotent — only if short).
    try {
      const { ensureGasReserveAndSend } = await import('@/lib/quoteAsset');
      await ensureGasReserveAndSend({
        conn, wallet: botKp.publicKey, minLamports: gasReserve,
        funder: loadEscrow(), label: `usdc-bot-gas:${b.id}`,
      });
    } catch (e) {
      return { ok: false, botId: b.id, memeId: m.id, symbol: m.symbol, action,
        error: `usdc bot gas top-up failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    // Read USDC ATA balance — that's the actionable amount.
    const { readQuoteBalance } = await import('@/lib/quoteAsset');
    const usdcRaw = await readQuoteBalance(conn, botKp.publicKey, 'usdc');
    usableLamports = Number(usdcRaw);
    // Min-swap threshold for USDC: prod default 10M lamports = 0.01 SOL.
    // For USDC raw (6 decimals), use BOT_MIN_SWAP_USDC_RAW (default 100_000 = 0.1 USDC).
    const minUsdcRaw = Number(process.env.BOT_MIN_SWAP_USDC_RAW || 100_000);
    if (usableLamports < minUsdcRaw) {
      return { ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, action,
        skipped: `bot wallet USDC ${usableLamports} raw below action threshold (need ${minUsdcRaw} raw / ${minUsdcRaw / 1e6} USDC)` };
    }
  } else {
    const balance = await conn.getBalance(botKp.publicKey);
    usableLamports = balance - gasReserve;
    if (usableLamports < MIN_SWAP_LAMPORTS) {
      return { ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, action, skipped: `bot wallet balance ${balance} below action threshold (need ${MIN_SWAP_LAMPORTS + gasReserve} lamports)` };
    }
  }

  // ── Quote-only distribute actions skip the swap entirely ─────────
  // Action names stay 'distribute_sol_*' / 'donate_sol' for back-compat,
  // but for USDC memes they distribute/donate USDC.
  if (action === 'distribute_sol_holders' || action === 'distribute_sol_backers') {
    return executeSolDistribute(supabase, m, b, botKp, conn, action, usableLamports, qc);
  }

  // ── POOL_FEEDER: pre-grad accumulates, post-grad deploys LP ───────
  // Only viable AFTER the bonding curve graduates to a real AMM
  // (PumpSwap for Pump.fun, DAMM v2 for Meteora). Pre-grad behavior is
  // "wait" — funds stay in the bot wallet, logged as a no-op tick.
  if (action === 'feed_lp') {
    return executeFeedLp(supabase, m, b, botKp, conn, usableLamports, qc);
  }

  // ── DONATE_SOL: skip swap, send the quote currency to destination ─
  if (action === 'donate_sol') {
    return executeDonateSol(supabase, m, b, botKp, conn, usableLamports, qc);
  }

  // ── Swap branch (burn / hold / token-distribute) ──────────────────
  // Jupiter input mint switches to USDC for USDC memes; swap math is
  // identical (input raw → output raw token).
  //
  // tokensBoughtThisRun (delta) vs actualTokensRaw (snapshot):
  //   - actualTokensRaw = ATA balance AFTER swap. Used by BURN — burns
  //     whatever's in the wallet, including any leftover from a prior
  //     failed-downstream run. Safety-net behavior preserved on purpose.
  //   - tokensBoughtThisRun = (post - pre) ATA balance = strictly the
  //     swap delta. Used by HOLD + token-distribute so the DB row's
  //     tokens_acted_raw column is a per-run delta (not a snapshot of
  //     cumulative holdings). Fixes the audit drift surfaced 2026-06-19:
  //     meme_bots.total_tokens_acted summed snapshots, wildly inflating.
  let actualTokensRaw: bigint;
  let tokensBoughtThisRun: bigint;
  let tokenProgramId: PublicKey;
  let tokenDecimals: number;
  // Hoisted so the PumpSwap fallback block in the catch can see it.
  let preSwapBal: bigint = BigInt(0);
  // Initialized inside the try block (Jupiter path) or the catch block
  // (PumpSwap fallback path). Either way the success path assigns it
  // before downstream code uses it; we explicitly type as
  // string | undefined so TS can flow-check the "did the swap happen"
  // null guard below.
  let swapTx: string | undefined;
  try {
    const { quoteInputMint } = await import('@/lib/quoteAsset');
    const inputMint = quoteInputMint(qc);
    const quoteUrl = `${JUP_QUOTE_URL}?inputMint=${inputMint}&outputMint=${m.mint_address}&amount=${usableLamports}&slippageBps=${SLIPPAGE_BPS}`;
    // Pre-swap ATA snapshot so we can compute the delta after the swap.
    // Errors here (e.g. ATA not yet created) collapse to 0 — first-ever
    // run on a token will have no pre-balance.
    const mintPubEarly = new PublicKey(m.mint_address);
    const mintAccEarly = await conn.getAccountInfo(mintPubEarly);
    const tokenProgEarly = mintAccEarly?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const ataEarly = getAssociatedTokenAddressSync(mintPubEarly, botKp.publicKey, false, tokenProgEarly);
    try {
      const preInfo = await conn.getTokenAccountBalance(ataEarly);
      preSwapBal = BigInt(preInfo.value.amount);
    } catch { /* ATA missing — treat as 0 */ }
    // Jupiter's index lags reality at two known points in a token's
    // lifecycle:
    //   - For ~30-60min after launch (token on bonding curve)
    //     → intermittent TOKEN_NOT_TRADABLE
    //   - For ~5-30min after bond (token moves curve → PumpSwap AMM)
    //     → NO_ROUTES_FOUND and MARKET_NOT_FOUND while jup's quote
    //       and swap sub-services warm up at different rates
    // Retry these transient classes a few times before failing the
    // bot; other errors (network, server, slippage) propagate.
    let quote: { error?: string; contextSlot?: number; context_slot?: number; [k: string]: unknown } | null = null;
    const MAX_QUOTE_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_QUOTE_ATTEMPTS; attempt++) {
      const qres = await fetch(quoteUrl);
      const bodyText = await qres.text();
      if (qres.ok) {
        quote = JSON.parse(bodyText);
        if (quote && !quote.error) break;
      }
      const transient = /TOKEN_NOT_TRADABLE|not tradable|NO_ROUTES_FOUND|No routes found/i.test(bodyText);
      if (!transient || attempt === MAX_QUOTE_ATTEMPTS) {
        throw new Error(`jupiter quote ${qres.status}: ${bodyText}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!quote) throw new Error('jupiter quote: no quote returned');
    // SOL-031: reject the quote if its contextSlot lags the current slot.
    // Stale routes ship worse fills or trigger slippage failures at swap time.
    await assertQuoteFresh(conn, quote);

    // Post-bond gap: Jupiter's quote endpoint and swap endpoint warm
    // up at different rates for a freshly-bonded AMM market. Quote may
    // succeed while swap returns MARKET_NOT_FOUND for the very same
    // ammKey. Retry the swap step too for the same transient classes.
    let swapBody: string | null = null;
    const MAX_SWAP_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_SWAP_ATTEMPTS; attempt++) {
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
      swapBody = await sres.text();
      if (sres.ok) break;
      const transient = /MARKET_NOT_FOUND|Market .* not found|NO_ROUTES_FOUND/i.test(swapBody);
      if (!transient || attempt === MAX_SWAP_ATTEMPTS) {
        throw new Error(`jupiter swap ${sres.status}: ${swapBody}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!swapBody) throw new Error('jupiter swap: no body returned');
    const { swapTransaction } = JSON.parse(swapBody);
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
    tokensBoughtThisRun = actualTokensRaw - preSwapBal;
    if (actualTokensRaw === BigInt(0)) throw new Error('swap confirmed but ATA balance is 0');
    if (tokensBoughtThisRun <= BigInt(0)) throw new Error('swap confirmed but no new tokens added (post-balance ≤ pre-balance)');
  } catch (jupiterErr) {
    const errMsg = jupiterErr instanceof Error ? jupiterErr.message : String(jupiterErr);
    // PumpSwap direct fallback. If Jupiter exhausted retries on a
    // route/market lookup error AND we're on the SOL quote path AND
    // the token has a PumpSwap pool (graduated), swap directly. This
    // makes graduated tokens immune to Jupiter index outages.
    const jupiterStuck = /NO_ROUTES_FOUND|MARKET_NOT_FOUND|No routes found|Market .* not found/i.test(errMsg);
    let fallbackErr: string | null = null;
    if (jupiterStuck && qc === 'sol') {
      console.log(`[bot ${b.id}] Jupiter exhausted (${errMsg.slice(0, 100)}). Trying PumpSwap direct.`);
      const fb = await swapViaPumpSwap(conn, botKp, m.mint_address, usableLamports);
      if (fb.ok) {
        swapTx = fb.sig;
        // Re-read mint info + ATA balance after the successful direct swap.
        try {
          const mintPub = new PublicKey(m.mint_address);
          const mintAcc = await conn.getAccountInfo(mintPub);
          if (!mintAcc) throw new Error('mint account not found after swap');
          tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
          const mintInfo = await getMint(conn, mintPub, 'confirmed', tokenProgramId);
          tokenDecimals = mintInfo.decimals;
          const ata = getAssociatedTokenAddressSync(mintPub, botKp.publicKey, false, tokenProgramId);
          const ataBal = await conn.getTokenAccountBalance(ata);
          actualTokensRaw = BigInt(ataBal.value.amount);
          tokensBoughtThisRun = actualTokensRaw - preSwapBal;
          if (actualTokensRaw === BigInt(0)) throw new Error('pumpswap swap confirmed but ATA balance is 0');
          if (tokensBoughtThisRun <= BigInt(0)) throw new Error('pumpswap swap confirmed but no new tokens added');
        } catch (postSwapErr) {
          fallbackErr = `pumpswap post-swap: ${postSwapErr instanceof Error ? postSwapErr.message : String(postSwapErr)}`;
        }
      } else {
        fallbackErr = `pumpswap fallback: ${fb.error}`;
      }
    }
    // Bail if either the swap itself failed OR the post-swap state
    // read failed. Otherwise the four typed locals would be partially
    // assigned and downstream burn/distribute logic would crash.
    if (!swapTx || fallbackErr) {
      const finalErr = fallbackErr ? `jupiter: ${errMsg.slice(0, 200)} | ${fallbackErr.slice(0, 200)}` : `jupiter: ${errMsg}`;
      await supabase.from('meme_buybacks').insert({
        meme_id: m.id, bot_id: b.id, action, sol_spent_lamports: usableLamports.toString(),
        tokens_bought_raw: '0', tokens_acted_raw: '0',
        status: 'failed', error: `swap: ${finalErr}`,
      });
      await supabase.from('meme_bots').update({ last_run_at: new Date().toISOString() }).eq('id', b.id);
      return { ok: false, botId: b.id, memeId: m.id, symbol: m.symbol, action, error: `swap failed: ${finalErr}` };
    }
  }
  // After the catch block: TS can't prove the locals are assigned via
  // the fallback path. We just returned if anything's missing, so a
  // non-null assertion is safe here.
  actualTokensRaw = actualTokensRaw!;
  tokensBoughtThisRun = tokensBoughtThisRun!;
  tokenProgramId = tokenProgramId!;
  tokenDecimals = tokenDecimals!;
  swapTx = swapTx!;

  // Dispatch the action on the bought tokens.
  // BURN gets the snapshot (burns everything in wallet, including any
  // leftover from a prior failed downstream — safety net).
  // HOLD + token-distribute get the per-run delta so the DB column
  // tracks "what was acted on this run" instead of a cumulative
  // snapshot (which created phantom totals on lifetime sums).
  if (action === 'burn') {
    return executeBurn(supabase, m, b, botKp, conn, action, actualTokensRaw, tokenProgramId, tokenDecimals, usableLamports, swapTx);
  }
  if (action === 'hold') {
    return executeHold(supabase, m, b, tokensBoughtThisRun, action, usableLamports, swapTx);
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

// ── DONATE QUOTE ───────────────────────────────────────────────────
// Skip swap. Send the bot's usable quote currency straight to the
// committed destination wallet (set at submit, immutable). One tx, one
// recipient, no batching. Branches SOL vs USDC via buildQuoteTransferIxs.
async function executeDonateSol(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection,
  usableLamports: number,
  qc: 'sol' | 'usdc' = 'sol',
): Promise<BuybackResult> {
  const action: BotAction = 'donate_sol';
  if (!b.destination_wallet) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'donate_sol: destination_wallet missing');
  }
  let destPk: PublicKey;
  try { destPk = new PublicKey(b.destination_wallet); }
  catch { return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, `donate_sol: invalid destination ${b.destination_wallet}`); }

  try {
    const { buildQuoteTransferIxs } = await import('@/lib/quoteAsset');
    // SOL-030: adaptive priority fee.
    const priorityIx = await adaptivePriorityFeeIx(conn, { fallback: 50_000 });
    const tx = new Transaction().add(priorityIx);
    for (const ix of buildQuoteTransferIxs({
      from: botKp.publicKey,
      to: destPk,
      amountRaw: BigInt(usableLamports),
      qc,
      payer: botKp.publicKey,
    })) tx.add(ix);
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = botKp.publicKey;
    // SOL-029: simulate before send.
    const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: `donate_${qc}` });
    const conf = await conn.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) throw new Error(`donate_${qc} tx failed: ${JSON.stringify(conf.value.err)}`);
    return finalize(
      supabase, m, b, action,
      usableLamports,     // quote raw spent
      BigInt(0),          // tokens bought (none)
      BigInt(0),          // tokens acted (none)
      undefined,          // swap tx (none)
      sig,                // action tx = the transfer
      undefined, 1,       // 1 recipient (the destination)
      undefined,
    );
  } catch (e) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, `donate_${qc}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── DISTRIBUTE QUOTE (no swap) ─────────────────────────────────────
// Name stays 'distribute_sol_*' for back-compat. For USDC memes this
// distributes USDC via SPL TransferChecked. SOL memes use the original
// SystemProgram.transfer path.
async function executeSolDistribute(
  supabase: SupabaseClient, m: MemeRow, b: BotRow,
  botKp: Keypair, conn: Connection,
  action: BotAction, usableLamports: number,
  qc: 'sol' | 'usdc' = 'sol',
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

  // Pro-rata allocation. weights are unitless — sum normalizes.
  const totalWeight = recipients.list.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'total weight 0');
  }

  const { buildQuoteTransferIxs } = await import('@/lib/quoteAsset');

  // USDC: each idempotent ATA-create + SPL TransferChecked is ~2 ix, so
  // fewer recipients per tx than SOL's single transfer. 6 keeps us under
  // the tx size limit safely (12 ix per tx).
  // SOL: 18 fits within the size limit. Min-recipient floor for USDC is
  // 1000 raw = 0.001 USDC; for SOL it's the legacy 50_000 lamports.
  const transfersPerTx = qc === 'usdc' ? 6 : 18;
  const minRecipientRaw = qc === 'usdc' ? 1000 : MIN_SOL_RECIPIENT_LAMPORTS;

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
      if (share < minRecipientRaw) continue; // skip dust
      for (const ix of buildQuoteTransferIxs({
        from: botKp.publicKey,
        to: new PublicKey(r.wallet),
        amountRaw: BigInt(share),
        qc,
        payer: botKp.publicKey, // bot wallet pays ATA-create rent on USDC path
      })) tx.add(ix);
      txTotal += share;
      batchHasAny = true;
    }
    if (!batchHasAny) continue;
    try {
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      tx.feePayer = botKp.publicKey;
      // SOL-029: simulate before send.
      const sig = await simulateAndSend(conn, tx, [botKp], { maxRetries: 3, label: `distribute_${qc}:${i}` });
      const conf = await conn.confirmTransaction(sig, 'confirmed');
      if (conf.value.err) throw new Error(`distribute_${qc} batch ${i} reverted: ${JSON.stringify(conf.value.err)}`);
      sigs.push(sig);
      actualSent += txTotal;
      // Count actual transfers, not raw ix count (USDC has 2 ix per recipient).
      credited += batch.filter((r) => Math.floor((usableLamports * r.weight) / totalWeight) >= minRecipientRaw).length;
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
      const conf = await conn.confirmTransaction(sig, 'confirmed');
      if (conf.value.err) throw new Error(`distribute_tokens batch ${i} reverted: ${JSON.stringify(conf.value.err)}`);
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
      const conf = await conn.confirmTransaction(sig, 'confirmed');
      if (conf.value.err) throw new Error(`recovery-distribute batch ${i} reverted: ${JSON.stringify(conf.value.err)}`);
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
  qc: 'sol' | 'usdc' = 'sol',
): Promise<BuybackResult> {
  const action: BotAction = 'feed_lp';

  if (!m.mint_address) {
    return finalizePartial(supabase, m, b, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'feed_lp: mint_address missing');
  }

  // USDC LP feed (DAMM v2 USDC/token pair) is a separate code path from
  // SOL LP feed (PumpSwap SOL/token or DAMM v2 SOL/token). The actual
  // deposit calls are platform-specific and not yet wired for USDC. For
  // now log + no-op so SOL bots keep working and USDC bots accumulate.
  if (qc === 'usdc') {
    await supabase
      .from('meme_bots')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', b.id);
    return {
      ok: true, botId: b.id, memeId: m.id, symbol: m.symbol, action,
      skipped: 'feed_lp USDC: DAMM v2 USDC/token deposit not yet wired (USDC stays in bot wallet, compounds)',
    };
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

