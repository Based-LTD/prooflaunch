// USDC-flavored counterparts to the SOL backing / withdraw / refund
// primitives. Strictly additive: SOL flows in pumpfun.ts + the backing
// route are byte-identical to today; this module is only invoked when
// meme.quote_currency === 'usdc'.
//
// Why a separate file: pumpfun.ts is 3000+ lines of pump-specific SOL
// logic and we don't want to thread quote-currency branches through it.
// Helpers here mirror the shape of verifyPoolDeposit / refundBacker /
// withdraw so call sites stay symmetric — just swap the function based
// on quote_currency.

import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  Signer,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';

// USDC mainnet mint (Circle-issued).
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const USDC_DECIMALS = 6;

// Display label for a meme's quote currency. Centralized so every
// UI surface that shows a backing amount or pool total reads the
// same canonical 'SOL' / 'USDC' string.
export type QuoteCurrency = 'sol' | 'usdc';
export function quoteLabel(quoteCurrency: QuoteCurrency | string | null | undefined): 'SOL' | 'USDC' {
  return quoteCurrency === 'usdc' ? 'USDC' : 'SOL';
}

// Helper: raw USDC amount → lamport-equivalent integer (6 decimals).
export function usdcToRaw(amount: number): bigint {
  // Avoid float drift by rounding via Math.round on the multiplied value.
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}
export function rawToUsdc(raw: bigint | number | string): number {
  const n = typeof raw === 'bigint' ? Number(raw) : Number(raw);
  return n / 10 ** USDC_DECIMALS;
}

// Derive a wallet's canonical USDC ATA. The ATA is owned by the wallet
// and holds the wallet's USDC balance. Same address for the same owner
// — `getAssociatedTokenAddressSync` is pure derivation, no RPC.
export function getUsdcAta(owner: PublicKey, allowOwnerOffCurve = false): PublicKey {
  return getAssociatedTokenAddressSync(USDC_MINT, owner, allowOwnerOffCurve, TOKEN_PROGRAM_ID);
}

// ── BACKING — verify ─────────────────────────────────────────────────
//
// A USDC backing tx must contain an SPL Token transfer of the expected
// amount FROM the backer's USDC ATA TO the pool wallet's USDC ATA. The
// transfer can be either:
//   - createTransferCheckedInstruction (preferred; encodes decimals)
//   - createTransferInstruction         (still valid, no decimal check)
// Either way the on-chain effect is the same: balance moves between
// token accounts owned by the right wallets. We compare the pre/post
// token balances reported by tx.meta to verify the delta.
//
// Mirrors pumpfun.verifyPoolDeposit's contract: returns true iff the
// pool received approximately `expectedAmount` USDC from the named
// backer wallet. Tolerance bands match the SOL flow (1% sender, 3%
// pool — covers rounding + any optional ATA-create rent the backer
// might have paid in the same tx).

export async function verifyPoolUsdcDeposit(
  conn: Connection,
  signature: string,
  expectedAmount: number,
  backerWallet: string,
  poolWallet: string,
): Promise<boolean> {
  try {
    // Same retry shape as verifyPoolDeposit — RPC nodes can lag confirmed.
    let tx = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      tx = await conn.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (tx && tx.meta) break;
    }
    if (!tx || !tx.meta) {
      console.log('verifyPoolUsdcDeposit: tx not found');
      return false;
    }

    const backerPub = new PublicKey(backerWallet);
    const poolPub = new PublicKey(poolWallet);
    const expectedRaw = usdcToRaw(expectedAmount);
    const expectedFloor = (expectedRaw * BigInt(97)) / BigInt(100); // 3% tolerance for ATA-create rent etc.

    // postTokenBalances / preTokenBalances are arrays of { accountIndex,
    // mint, owner, uiTokenAmount } entries. Match by (mint=USDC, owner=
    // poolWallet) and compute the delta.
    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];
    const usdcStr = USDC_MINT.toBase58();

    const findEntry = (
      entries: typeof pre,
      owner: PublicKey,
    ) => entries.find((e) => e.mint === usdcStr && e.owner === owner.toBase58());

    const poolPre = findEntry(pre, poolPub);
    const poolPost = findEntry(post, poolPub);
    const backerPre = findEntry(pre, backerPub);
    const backerPost = findEntry(post, backerPub);

    // Pool MUST appear in post-balances (created or pre-existing). If
    // the pool's USDC ATA didn't exist pre-tx, poolPre is undefined and
    // we treat it as 0.
    if (!poolPost) {
      console.log('verifyPoolUsdcDeposit: pool USDC ATA absent in postTokenBalances');
      return false;
    }
    const poolPreRaw = BigInt(poolPre?.uiTokenAmount.amount ?? String(0));
    const poolPostRaw = BigInt(poolPost.uiTokenAmount.amount);
    const poolDelta = poolPostRaw - poolPreRaw;
    if (poolDelta < expectedFloor) {
      console.log(
        `verifyPoolUsdcDeposit: pool received ${poolDelta} raw, expected >= ${expectedFloor}`,
      );
      return false;
    }

    // Backer MUST have decreased by a comparable amount (we don't require
    // exact match because the backer may have paid ATA rent in the same
    // tx). If the backer's USDC ATA didn't exist pre-tx that's invalid —
    // they couldn't have funded the transfer.
    if (!backerPre) {
      console.log('verifyPoolUsdcDeposit: backer had no USDC ATA pre-tx');
      return false;
    }
    const backerPreRaw = BigInt(backerPre.uiTokenAmount.amount);
    const backerPostRaw = BigInt(backerPost?.uiTokenAmount.amount ?? '0');
    const backerDelta = backerPreRaw - backerPostRaw;
    if (backerDelta < expectedFloor) {
      console.log(
        `verifyPoolUsdcDeposit: backer spent ${backerDelta} raw, expected >= ${expectedFloor}`,
      );
      return false;
    }

    return true;
  } catch (e) {
    console.error('verifyPoolUsdcDeposit failed:', e);
    return false;
  }
}

// ── BACKING — build (client-side) ────────────────────────────────────
//
// Build the unsigned backing tx the backer's wallet adapter will sign.
// Includes an idempotent ATA-create for the pool's USDC ATA (so the
// first USDC backer to a meme pays the ~0.002 SOL rent that creates
// the pool's ATA — same pattern Pump.fun uses for first-buy ATA setup).
//
// Caller is responsible for setting recentBlockhash + feePayer and
// passing the tx through signMessage / signTransaction.

export function buildUsdcBackingTx(args: {
  backer: PublicKey;
  pool: PublicKey;
  amount: number; // USDC, decimal — e.g. 100 for $100
}): Transaction {
  const { backer, pool, amount } = args;
  const backerAta = getUsdcAta(backer);
  const poolAta = getUsdcAta(pool);

  const tx = new Transaction();
  // Idempotent: if pool's USDC ATA already exists, this is a no-op.
  // Backer pays rent (~0.00203 SOL) for the first-create case.
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      backer,
      poolAta,
      pool,
      USDC_MINT,
      TOKEN_PROGRAM_ID,
    ),
  );
  // TransferChecked enforces decimals server-side — wallet adapters
  // surface a clearer "transfer 100 USDC" simulation than the legacy
  // Transfer ix would.
  tx.add(
    createTransferCheckedInstruction(
      backerAta,
      USDC_MINT,
      poolAta,
      backer,
      usdcToRaw(amount),
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  return tx;
}

// ── WITHDRAW / REFUND — server-side ──────────────────────────────────
//
// Pool wallet sends USDC back to a backer's wallet. Used by both:
//   - pre-launch withdraw (backer changes their mind, 2% fee in SOL
//     model; for USDC we mirror the same 2% as a USDC haircut)
//   - automatic refund (slot deadline missed, full amount back)
//
// Idempotent ATA-create on the destination so a backer who closed
// their USDC ATA between back time and refund time doesn't strand
// the funds. Pool wallet pays the rent (~0.002 SOL).

export interface SendUsdcResult {
  ok: boolean;
  signature?: string;
  error?: string;
}

export async function sendUsdcFromPool(args: {
  conn: Connection;
  poolKp: Keypair;
  destOwner: PublicKey;
  amount: number;
  label?: string;
}): Promise<SendUsdcResult> {
  try {
    const { conn, poolKp, destOwner, amount, label } = args;
    const poolAta = getUsdcAta(poolKp.publicKey);
    const destAta = getUsdcAta(destOwner);

    const tx = new Transaction();
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        poolKp.publicKey,
        destAta,
        destOwner,
        USDC_MINT,
        TOKEN_PROGRAM_ID,
      ),
    );
    tx.add(
      createTransferCheckedInstruction(
        poolAta,
        USDC_MINT,
        destAta,
        poolKp.publicKey,
        usdcToRaw(amount),
        USDC_DECIMALS,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = poolKp.publicKey;

    // Lazy import keeps the rpcHelpers module out of the public-bundle
    // call graph when only the client-side buildUsdcBackingTx is used.
    const { simulateAndSend } = await import('./rpcHelpers');
    const signers: Signer[] = [poolKp];
    const signature = await simulateAndSend(conn, tx, signers, {
      maxRetries: 3,
      label: label ?? 'usdc-send-from-pool',
    });
    return { ok: true, signature };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
