// Defensive Solana RPC helpers — Jelleo SOL-029/030/031 compliance.
//
// SOL-029 · simulateAndSend
//   Wrap a send with `connection.simulateTransaction(...)` first; abort
//   if the simulate returns an error. Reverts get caught BEFORE we pay
//   the priority fee, and a live bot/keeper doesn't desync from prod
//   state because a malformed instruction got accepted blind.
//
//   Note: launch paths in pumpfun.ts that explicitly set
//   `skipPreflight: true` are time-sensitive bonding-curve interactions
//   where simulate adds latency that can stale the curve state itself.
//   Those sites are tracked as Phase B and use direct `sendTransaction`
//   for now — see the // SOL-029-EXEMPT comments there.
//
// SOL-030 · getAdaptivePriorityFee
//   Replaces hardcoded `microLamports: <literal>` with a fee-market
//   read. Hardcoded fees underpay during congestion (tx never lands)
//   or overpay when calm. We query `getRecentPrioritizationFees`,
//   take the user-specified percentile (default 75th), clamp to a
//   sane min/max band, and fall back to the supplied literal on
//   any RPC failure — so the worst case is current behavior.
//
// SOL-031 · assertQuoteFresh
//   Jupiter quote responses include `contextSlot` (the slot they
//   were computed at). Pool state moves slot-by-slot; consuming a
//   quote that's older than ~30 slots (~12s) can ship a worse fill
//   or a tx that fails slippage. This helper checks the drift and
//   throws if stale — caller refetches.

import {
  Connection, PublicKey, Keypair, Signer,
  Transaction, VersionedTransaction,
  SendOptions, TransactionInstruction, ComputeBudgetProgram,
} from '@solana/web3.js';

// ── SOL-029 ────────────────────────────────────────────────────────

export interface SimulateAndSendOptions extends SendOptions {
  // Label used in error messages so logs identify the call site.
  label?: string;
  // Skip the simulate step. Use ONLY for Phase B launch-path sites
  // where bonding-curve latency makes simulate counterproductive.
  // Setting this to true preserves blind-send behavior; the only
  // reason this flag exists is to keep ALL sends going through one
  // helper for consistent retry semantics.
  skipSimulate?: boolean;
}

export class SimulateRevertError extends Error {
  constructor(public label: string, public simErr: unknown, public logs: string[] | null) {
    super(
      `simulate-before-send rejected${label ? ` [${label}]` : ''}: ` +
      JSON.stringify(simErr) +
      (logs && logs.length ? `\nlogs:\n${logs.join('\n')}` : '')
    );
    this.name = 'SimulateRevertError';
  }
}

// Single helper for both legacy + versioned txns. Simulates first,
// throws SimulateRevertError on failure, otherwise sends. Returns the
// signature.
export async function simulateAndSend(
  conn: Connection,
  tx: Transaction | VersionedTransaction,
  signers?: Signer[],
  opts: SimulateAndSendOptions = {},
): Promise<string> {
  const { label, skipSimulate, ...sendOpts } = opts;

  if (!skipSimulate) {
    // Sign first so simulate sees the same byte sequence we'll send.
    // For legacy Transaction with signers, web3.js's sendTransaction
    // would sign on send — we mirror that here so simulate is honest.
    if (tx instanceof Transaction && signers && signers.length > 0) {
      // partialSign is idempotent if already signed.
      tx.partialSign(...signers);
    }
    // VersionedTransaction is always pre-signed by the caller.

    const simRes = tx instanceof VersionedTransaction
      ? await conn.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: false })
      : await conn.simulateTransaction(tx);

    if (simRes.value.err) {
      throw new SimulateRevertError(label ?? '', simRes.value.err, simRes.value.logs ?? null);
    }
  }

  // For VersionedTransaction, signers arg is ignored by sendTransaction.
  if (tx instanceof VersionedTransaction) {
    return conn.sendTransaction(tx, sendOpts);
  }
  return conn.sendTransaction(tx, signers ?? [], sendOpts);
}

// ── SOL-030 ────────────────────────────────────────────────────────

export interface AdaptivePriorityFeeOptions {
  // Hardcoded value to fall back to if the RPC read fails or returns
  // nothing useful. ALWAYS supply this — the original literal in the
  // call site you're replacing. Guarantees zero behavior regression.
  fallback: number;
  // Writable accounts to query the fee market for. Pass the keys
  // your tx will write to. Empty array queries the network-wide
  // baseline (still useful as a floor signal).
  writableAccounts?: PublicKey[];
  // Percentile of recent fees to take. 75 = "fast lane during normal
  // load." Higher = more aggressive. Default 75.
  percentile?: number;
  // Hard cap so adaptive can't blow up the wallet during a fee storm.
  // Default 2_000_000 µL — matches the highest hardcoded value in
  // the codebase pre-adoption (pumpfun.ts:3338).
  maxCap?: number;
  // Floor so we don't underpay if the network's currently sleepy.
  // Default = fallback (i.e. never go below what we used to pay).
  minFloor?: number;
}

export async function getAdaptivePriorityFee(
  conn: Connection,
  opts: AdaptivePriorityFeeOptions,
): Promise<number> {
  const {
    fallback,
    writableAccounts = [],
    percentile = 75,
    maxCap = 2_000_000,
    minFloor = fallback,
  } = opts;

  try {
    const fees = await conn.getRecentPrioritizationFees(
      writableAccounts.length > 0 ? { lockedWritableAccounts: writableAccounts } : undefined
    );
    if (!fees || fees.length === 0) return fallback;
    const sorted = fees
      .map((f) => f.prioritizationFee)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (sorted.length === 0) return fallback;
    const idx = Math.min(sorted.length - 1, Math.floor((percentile / 100) * sorted.length));
    const picked = sorted[idx];
    // Clamp to band. floor → cap.
    return Math.max(minFloor, Math.min(maxCap, picked));
  } catch {
    return fallback;
  }
}

// Convenience wrapper that returns the prebuilt ComputeBudget ix.
// Most call sites just want the ix — they don't care about the number.
export async function adaptivePriorityFeeIx(
  conn: Connection,
  opts: AdaptivePriorityFeeOptions,
): Promise<TransactionInstruction> {
  const microLamports = await getAdaptivePriorityFee(conn, opts);
  return ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
}

// ── SOL-031 ────────────────────────────────────────────────────────

// Default freshness window. Solana slots are ~400ms; 30 slots ≈ 12s.
// Jupiter quotes routed through high-volume pools drift faster than
// quiet ones, but 12s is a safe ceiling — failures past this point
// are nearly always slippage-related, not fundamental.
const DEFAULT_MAX_SLOT_DRIFT = 30;

export class StaleQuoteError extends Error {
  constructor(public drift: number, public contextSlot: number, public currentSlot: number) {
    super(
      `Jupiter quote stale: drift ${drift} slots ` +
      `(contextSlot ${contextSlot}, currentSlot ${currentSlot}). Refetch before swap.`
    );
    this.name = 'StaleQuoteError';
  }
}

// Throws StaleQuoteError if the quote is older than maxSlotDrift slots.
// Caller catches + refetches. Pass the Jupiter quote response (any
// shape with `contextSlot`); we tolerate snake_case `context_slot`
// too in case the API surface shifts.
export async function assertQuoteFresh(
  conn: Connection,
  quote: { contextSlot?: number; context_slot?: number },
  maxSlotDrift: number = DEFAULT_MAX_SLOT_DRIFT,
): Promise<void> {
  const contextSlot = quote.contextSlot ?? quote.context_slot;
  if (typeof contextSlot !== 'number') {
    // Quote shape doesn't expose contextSlot — can't check. Don't
    // block the swap; this is a heuristic, not a contract. (Logging
    // a warn here would be appropriate but we keep this lib pure.)
    return;
  }
  const currentSlot = await conn.getSlot('confirmed');
  const drift = currentSlot - contextSlot;
  if (drift > maxSlotDrift) {
    throw new StaleQuoteError(drift, contextSlot, currentSlot);
  }
}
