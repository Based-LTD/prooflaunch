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
const MIN_SWAP_LAMPORTS = 10_000_000;          // 0.01 SOL min to bother swapping/distributing
// Reserved in bot wallet for tx fees + pump.fun BC overhead. Bumped from
// 0.005 → 0.01 after the V2TEST swap failed when BC needed unwrapped
// SOL beyond what we'd left after wrapping. For distribute-to-many
// actions we leave a bit MORE so per-recipient transfer rent + gas
// don't bottom out the wallet.
const GAS_RESERVE_LAMPORTS = 10_000_000;
const DIST_GAS_RESERVE_LAMPORTS = 20_000_000;  // 0.02 SOL when distributing
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
    || action === 'distribute_holders'   // legacy → treat as tokens
    || action === 'distribute_backers'   // legacy → treat as tokens
  );
}

export interface BuybackResult {
  ok: boolean;
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

interface MemeRow {
  id: string;
  symbol: string;
  mint_address: string | null;
  status: string;
  buyback_bot_enabled: boolean;
  buyback_bot_action: BotAction | null;
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

  let botKp: Keypair;
  try { botKp = decryptKeypair(m.encrypted_buyback_bot_key); }
  catch (e) { return { ok: false, memeId, symbol: m.symbol, action, error: `bot key decrypt: ${e instanceof Error ? e.message : String(e)}` }; }
  if (botKp.publicKey.toBase58() !== m.buyback_bot_wallet) {
    return { ok: false, memeId, symbol: m.symbol, action, error: 'bot key pubkey mismatch — refusing to touch' };
  }

  const conn = new Connection(RPC_URL, 'confirmed');
  const balance = await conn.getBalance(botKp.publicKey);

  // For swap-based actions, gas reserve is 0.01 SOL (BC overhead).
  // For SOL-distribution actions, we leave 0.02 because per-recipient
  // tx fees add up across multiple txes.
  const isDistribute = action !== 'burn' && action !== 'hold';
  const gasReserve = isDistribute ? DIST_GAS_RESERVE_LAMPORTS : GAS_RESERVE_LAMPORTS;
  const usableLamports = balance - gasReserve;
  if (usableLamports < MIN_SWAP_LAMPORTS) {
    return { ok: true, memeId, symbol: m.symbol, action, skipped: `bot wallet balance ${balance} below action threshold (need ${MIN_SWAP_LAMPORTS + gasReserve} lamports)` };
  }

  // ── SOL-only distribute actions skip the swap entirely ─────────────
  if (action === 'distribute_sol_holders' || action === 'distribute_sol_backers') {
    return executeSolDistribute(supabase, m, botKp, conn, action, usableLamports);
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
      meme_id: m.id, action, sol_spent_lamports: usableLamports.toString(),
      tokens_bought_raw: '0', tokens_acted_raw: '0',
      status: 'failed', error: `swap: ${e instanceof Error ? e.message : String(e)}`,
    });
    await supabase.from('memes').update({ buyback_bot_last_run_at: new Date().toISOString() }).eq('id', m.id);
    return { ok: false, memeId, symbol: m.symbol, action, error: `swap failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Dispatch the action on the bought tokens.
  if (action === 'burn') {
    return executeBurn(supabase, m, botKp, conn, action, actualTokensRaw, tokenProgramId, tokenDecimals, usableLamports, swapTx);
  }
  if (action === 'hold') {
    return executeHold(supabase, m, actualTokensRaw, action, usableLamports, swapTx);
  }
  // distribute_tokens_* (current + legacy synonyms)
  return executeTokenDistribute(
    supabase, m, botKp, conn, action, actualTokensRaw, tokenProgramId, tokenDecimals, usableLamports, swapTx,
  );
}

// ── BURN ───────────────────────────────────────────────────────────
async function executeBurn(
  supabase: SupabaseClient, m: MemeRow, botKp: Keypair, conn: Connection,
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
  } catch (e) {
    return finalizePartial(supabase, m, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, `action: ${e instanceof Error ? e.message : String(e)}`);
  }
  return finalize(supabase, m, action, usableLamports, actualTokensRaw, actualTokensRaw, swapTx, actionTx);
}

// ── HOLD ───────────────────────────────────────────────────────────
async function executeHold(
  supabase: SupabaseClient, m: MemeRow,
  actualTokensRaw: bigint, action: BotAction,
  usableLamports: number, swapTx: string,
): Promise<BuybackResult> {
  // No-op — tokens stay in bot wallet.
  return finalize(supabase, m, action, usableLamports, actualTokensRaw, actualTokensRaw, swapTx, undefined);
}

// ── DISTRIBUTE SOL (no swap) ───────────────────────────────────────
async function executeSolDistribute(
  supabase: SupabaseClient, m: MemeRow, botKp: Keypair, conn: Connection,
  action: BotAction, usableLamports: number,
): Promise<BuybackResult> {
  const recipients = await buildRecipientList(
    supabase, conn, m, botKp.publicKey,
    action === 'distribute_sol_holders' ? 'holders' : 'backers',
  );
  if (recipients.error) {
    return finalizePartial(supabase, m, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, recipients.error);
  }
  if (recipients.list.length === 0) {
    return finalizePartial(supabase, m, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'no recipients found');
  }

  // Pro-rata SOL allocation. weights are unitless — sum normalizes.
  const totalWeight = recipients.list.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) {
    return finalizePartial(supabase, m, action, usableLamports, BigInt(0), undefined, undefined, undefined, undefined, 'total weight 0');
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
      const sig = await conn.sendTransaction(tx, [botKp], { maxRetries: 3 });
      await conn.confirmTransaction(sig, 'confirmed');
      sigs.push(sig);
      actualSent += txTotal;
      credited += tx.instructions.length;
    } catch (e) {
      errors.push(`batch starting at ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return finalize(
    supabase, m, action,
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
  supabase: SupabaseClient, m: MemeRow, botKp: Keypair, conn: Connection,
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
    return finalizePartial(supabase, m, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, recipients.error);
  }
  if (recipients.list.length === 0) {
    return finalizePartial(supabase, m, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, 'no recipients found');
  }

  const totalWeight = recipients.list.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) {
    return finalizePartial(supabase, m, action, usableLamports, actualTokensRaw, swapTx, undefined, undefined, undefined, 'total weight 0');
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
      const sig = await conn.sendTransaction(tx, [botKp], { maxRetries: 3 });
      await conn.confirmTransaction(sig, 'confirmed');
      sigs.push(sig);
    } catch (e) {
      errors.push(`batch ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return finalize(
    supabase, m, action, usableLamports, actualTokensRaw, actedRaw,
    swapTx, undefined,
    sigs.length > 0 ? sigs : undefined,
    credited,
    errors.length > 0 ? `partial: ${errors.length} batch failures (${errors[0]})` : undefined,
  );
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

    // Whale-exclusion heuristic: any holder >40% of total tracked
    // supply is almost certainly the AMM pool, a treasury wallet,
    // or some other system address — not a community holder we want
    // to reward. Without this, distributions on pump.fun tokens
    // (where the PumpSwap AMM pool holds ~99% of supply) would route
    // almost all the SOL/tokens to a liquidity pool wallet instead
    // of the actual community.
    const totalTracked = [...byOwner.values()].reduce((a, b) => a + b, BigInt(0));
    const whaleThreshold = totalTracked > BigInt(0)
      ? (totalTracked * BigInt(40)) / BigInt(100)
      : BigInt(0);

    // Convert to weighted list, sort desc, cap.
    const sorted = Array.from(byOwner.entries())
      .filter(([, bal]) => bal > BigInt(0) && bal <= whaleThreshold)
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
  supabase: SupabaseClient, m: MemeRow, action: BotAction,
  solSpentLamports: number,
  tokensBoughtRaw: bigint, tokensActedRaw: bigint,
  swapTx: string | undefined, actionTx: string | undefined,
  actionTxs?: string[],
  recipientCount?: number,
  notes?: string,
): Promise<BuybackResult> {
  const insertRow: Record<string, unknown> = {
    meme_id: m.id, action,
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

  const newSolSpent = Number(m.buyback_bot_total_sol_spent || 0) + (solSpentLamports / LAMPORTS_PER_SOL);
  const newTokensActed = Number(m.buyback_bot_total_tokens_acted || 0) + Number(tokensActedRaw);
  await supabase
    .from('memes')
    .update({
      buyback_bot_last_run_at: new Date().toISOString(),
      buyback_bot_total_sol_spent: newSolSpent,
      buyback_bot_total_tokens_acted: newTokensActed,
    })
    .eq('id', m.id);

  return {
    ok: true, memeId: m.id, symbol: m.symbol, action,
    solSpentLamports,
    tokensBoughtRaw: tokensBoughtRaw.toString(),
    tokensActedRaw:  tokensActedRaw.toString(),
    swapTx, actionTx: actionTx ?? actionTxs?.[0], actionTxs,
    recipientCount,
  };
}

async function finalizePartial(
  supabase: SupabaseClient, m: MemeRow, action: BotAction,
  solSpentLamports: number, tokensRaw: bigint,
  swapTx: string | undefined, actionTx: string | undefined,
  actionTxs: string[] | undefined,
  recipientCount: number | undefined,
  errorMsg: string,
): Promise<BuybackResult> {
  await supabase.from('meme_buybacks').insert({
    meme_id: m.id, action,
    sol_spent_lamports: solSpentLamports.toString(),
    tokens_bought_raw: tokensRaw.toString(),
    tokens_acted_raw:  '0',
    swap_tx: swapTx, action_tx: actionTx ?? (actionTxs?.[0] ?? null),
    status: 'partial',
    error: errorMsg,
  });
  await supabase.from('memes').update({ buyback_bot_last_run_at: new Date().toISOString() }).eq('id', m.id);
  return {
    ok: false, memeId: m.id, symbol: m.symbol, action,
    solSpentLamports, tokensBoughtRaw: tokensRaw.toString(),
    swapTx, actionTx, actionTxs, recipientCount,
    error: errorMsg,
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
