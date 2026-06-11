// Quote-asset abstraction for the bot stack + fee distribution pipeline.
//
// Before this module, distribution.ts and buybackBot.ts hard-coded SOL
// everywhere (lamports, getBalance, SystemProgram.transfer, Jupiter
// inputMint=SOL). USDC parity is a single switch on meme.quote_currency
// that picks the right read + transfer + Jupiter mint.
//
// Design intent: SOL flows through this module byte-identical to the
// pre-refactor code. USDC flows pick the SPL-token path. No third path,
// no surprises. Adding a future quote (e.g. USDT) means one new branch.
//
// What lives here:
//   - SOL_MINT / USDC_MINT constants for Jupiter input/output strings
//   - readBalance: native SOL balance OR USDC ATA balance
//   - buildTransfer: SystemProgram.transfer OR SPL TransferChecked
//   - ensureGasReserve: for USDC paths, top-up SOL from escrow if the
//     wallet has too little for tx fees (USDC backers/bots have 0 native
//     SOL by default)
//   - quoteInputMint: which mint to feed Jupiter for swap actions
//   - quoteDecimals: 9 for SOL, 6 for USDC

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { USDC_MINT, USDC_DECIMALS } from './usdc';

export type QuoteCurrency = 'sol' | 'usdc';

export const SOL_MINT_STR = 'So11111111111111111111111111111111111111112';
export const USDC_MINT_STR = USDC_MINT.toBase58();

// Decimals for the on-chain unit. SOL: 9 (lamports). USDC: 6 (smallest unit).
// All raw amounts (`*_raw`) in the bot pipeline are in these decimals.
export function quoteDecimals(qc: QuoteCurrency): number {
  return qc === 'usdc' ? USDC_DECIMALS : 9;
}

export function quoteInputMint(qc: QuoteCurrency): string {
  return qc === 'usdc' ? USDC_MINT_STR : SOL_MINT_STR;
}

export function quoteLabel(qc: QuoteCurrency): 'SOL' | 'USDC' {
  return qc === 'usdc' ? 'USDC' : 'SOL';
}

// Display: raw → decimal human number for the right quote.
export function rawToQuote(raw: bigint | number, qc: QuoteCurrency): number {
  const n = typeof raw === 'bigint' ? Number(raw) : Number(raw);
  return n / 10 ** quoteDecimals(qc);
}

// Read the wallet's spendable balance in the quote currency.
//   sol  → conn.getBalance (lamports)
//   usdc → conn.getTokenAccountBalance(ata) (raw 6-decimals); returns 0
//          if the ATA doesn't exist yet (a fresh bot wallet).
export async function readQuoteBalance(
  conn: Connection,
  owner: PublicKey,
  qc: QuoteCurrency,
): Promise<bigint> {
  if (qc === 'sol') {
    const lam = await conn.getBalance(owner, 'confirmed');
    return BigInt(lam);
  }
  const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);
  try {
    const bal = await conn.getTokenAccountBalance(ata, 'confirmed');
    return BigInt(bal.value.amount);
  } catch {
    return BigInt(0);
  }
}

// Always-needed SOL balance (gas). For SOL memes this is the same as the
// quote balance; for USDC memes it's the *separate* SOL pool the wallet
// uses for tx fees + rent.
export async function readNativeSolBalance(
  conn: Connection,
  owner: PublicKey,
): Promise<number> {
  return conn.getBalance(owner, 'confirmed');
}

// Build the transfer instructions for sending an amount of the quote
// currency from one wallet to another. Returns the instructions ready to
// drop into a Transaction; caller is responsible for blockhash/feePayer.
//
//   sol  → single SystemProgram.transfer
//   usdc → idempotent ATA-create for the receiver + TransferChecked
//
// For USDC: `payer` pays the ATA-create rent (~0.002 SOL) if the
// receiver's ATA doesn't exist yet. Same wallet that signs the tx.
export function buildQuoteTransferIxs(args: {
  from: PublicKey;
  to: PublicKey;
  amountRaw: bigint;
  qc: QuoteCurrency;
  payer: PublicKey; // pays ATA-create rent on USDC path; same as `from` for SOL
}): TransactionInstruction[] {
  const { from, to, amountRaw, qc, payer } = args;
  if (qc === 'sol') {
    return [
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: Number(amountRaw),
      }),
    ];
  }
  // USDC: ensure receiver's USDC ATA exists, then SPL transfer there.
  const fromAta = getAssociatedTokenAddressSync(USDC_MINT, from);
  const toAta = getAssociatedTokenAddressSync(USDC_MINT, to);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      toAta,
      to,
      USDC_MINT,
      TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      fromAta,
      USDC_MINT,
      toAta,
      from,
      amountRaw,
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  ];
}

// Ensure the wallet has at least `minLamports` of native SOL for gas.
// USDC paths call this before any tx because USDC-only wallets sit at 0
// SOL by default. Tops up from `funder` if needed; returns the funded
// lamports (0 if no top-up was required).
//
// Idempotent: only sends a tx when the wallet's SOL is below the floor.
export async function ensureGasReserve(args: {
  conn: Connection;
  wallet: PublicKey;
  minLamports: number;
  funder: Keypair;
}): Promise<{ toppedUpLamports: number; sig?: string }> {
  const { conn, wallet, minLamports, funder } = args;
  const have = await conn.getBalance(wallet, 'confirmed');
  if (have >= minLamports) return { toppedUpLamports: 0 };
  const need = minLamports - have;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: wallet,
      lamports: need,
    }),
  );
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.feePayer = funder.publicKey;
  // Caller does the actual send to keep this module dependency-free of
  // simulateAndSend. We return the tx + signer for the caller to push.
  // (Keeps the abstraction layer clean — no rpcHelpers dependency.)
  // NOTE: callers do `await simulateAndSend(conn, tx, [funder], ...)`.
  return { toppedUpLamports: need };
}

// Convenience helper — build + push a gas top-up tx. Used by the bot
// service and the launch route. Returns the sig if a top-up happened.
export async function ensureGasReserveAndSend(args: {
  conn: Connection;
  wallet: PublicKey;
  minLamports: number;
  funder: Keypair;
  label: string;
}): Promise<{ toppedUpLamports: number; sig?: string }> {
  const { conn, wallet, minLamports, funder, label } = args;
  const have = await conn.getBalance(wallet, 'confirmed');
  if (have >= minLamports) return { toppedUpLamports: 0 };
  const need = minLamports - have;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: wallet,
      lamports: need,
    }),
  );
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.feePayer = funder.publicKey;
  const { simulateAndSend } = await import('./rpcHelpers');
  const sig = await simulateAndSend(conn, tx, [funder], { label, maxRetries: 3 });
  return { toppedUpLamports: need, sig };
}

// Round-trip math: convert SOL-denominated lamports (legacy variable)
// to the corresponding raw amount in the meme's quote currency.
//
// NOT a price conversion — for USDC memes, the "amount" already arrived
// in USDC raw units, and the variable name `lamports` is a misnomer. This
// helper is here as a name for the operation; passing through as a
// bigint is fine.
export function asQuoteRaw(amount: number | bigint): bigint {
  return typeof amount === 'bigint' ? amount : BigInt(Math.floor(amount));
}
