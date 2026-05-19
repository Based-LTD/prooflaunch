import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const ESCROW_WALLET = process.env.NEXT_PUBLIC_ESCROW_WALLET || 'CEGgJZF6AXGkj3BBTmmhagudwU9FKscMB25RJM5iwFYY';

// Pump.fun fee program - this is the program that sends creator fees
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export interface FeeTransaction {
  signature: string;
  // Every 44-char base58 account key in the tx. The caller resolves the
  // real mint by matching these against KNOWN live-meme mint addresses
  // in our DB — deterministic and suffix-agnostic. The old code assumed
  // pump.fun mints end in "pump"; our pooled vanity mints end in "pooL",
  // so that assumption silently dropped every pooled coin's fees.
  candidateMints: string[];
  amountSol: number;
  timestamp: number;
}

/**
 * Get recent transactions to the escrow wallet that look like pump.fun creator fees
 */
export async function getRecentFeeTransactions(
  afterSignature?: string,
  limit = 100
): Promise<FeeTransaction[]> {
  const connection = new Connection(RPC_URL, 'confirmed');
  const escrowPubkey = new PublicKey(ESCROW_WALLET);

  // Get recent signatures
  const signatures = await connection.getSignaturesForAddress(escrowPubkey, {
    limit,
    until: afterSignature,
  });

  const feeTransactions: FeeTransaction[] = [];

  // Process each transaction
  for (const sig of signatures) {
    try {
      const tx = await connection.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) continue;

      // Look for SOL transfers to escrow from pump.fun program
      const feeInfo = extractPumpFunFee(tx, escrowPubkey.toBase58());
      if (feeInfo) {
        feeTransactions.push({
          signature: sig.signature,
          candidateMints: feeInfo.candidateMints,
          amountSol: feeInfo.amountSol,
          timestamp: sig.blockTime || Date.now() / 1000,
        });
      }
    } catch (err) {
      console.error(`Error processing tx ${sig.signature}:`, err);
    }
  }

  return feeTransactions;
}

/**
 * Extract a pump.fun creator-fee inflow to escrow.
 *
 * Returns the SOL amount plus EVERY 44-char base58 pubkey referenced by
 * the tx (account keys + anything that shape-matches in the logs). The
 * caller resolves the real mint by intersecting these candidates with
 * our DB's known live-meme mint addresses — deterministic, can't
 * mis-attribute, and works regardless of vanity suffix. (The old code
 * hard-required a "pump" suffix and silently dropped every "pooL" coin.)
 */
const BASE58_44 = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
function extractPumpFunFee(
  tx: ParsedTransactionWithMeta,
  escrowWallet: string
): { candidateMints: string[]; amountSol: number } | null {
  const instructions = tx.transaction.message.instructions;
  const innerInstructions = tx.meta?.innerInstructions || [];

  let transferAmount = 0;

  for (const ix of instructions) {
    if ('parsed' in ix && ix.parsed?.type === 'transfer') {
      const info = ix.parsed.info;
      if (info.destination === escrowWallet) transferAmount = info.lamports / 1e9;
    }
  }
  for (const inner of innerInstructions) {
    for (const ix of inner.instructions) {
      if ('parsed' in ix && ix.parsed?.type === 'transfer') {
        const info = ix.parsed.info;
        if (info.destination === escrowWallet) transferAmount += info.lamports / 1e9;
      }
    }
  }

  if (transferAmount <= 0) return null;

  // Collect ALL plausible pubkeys (no suffix assumption). The caller
  // matches these against known live mints, so over-collecting is safe.
  const candidates = new Set<string>();
  for (const account of tx.transaction.message.accountKeys) {
    const pk = typeof account === 'string' ? account : account.pubkey.toBase58();
    if (BASE58_44.test(pk)) candidates.add(pk);
  }
  for (const log of tx.meta?.logMessages || []) {
    for (const m of log.matchAll(/[1-9A-HJ-NP-Za-km-z]{43,44}/g)) {
      if (BASE58_44.test(m[0])) candidates.add(m[0]);
    }
  }

  return { candidateMints: [...candidates], amountSol: transferAmount };
}

// Platform takes 10% of trading fees for sustainability
const PLATFORM_FEE_CUT = 0.10;

/**
 * Distribute fees to backers for a specific token
 * Called after processing new fee transactions
 *
 * Distribution:
 * - Platform keeps 10% for sustainability
 * - All backers (including creator if they backed) split the remaining 90% proportionally
 *
 * Note: Creators are treated equally to other backers - no special cut.
 * To receive trading fees, creators must back their own meme like everyone else.
 */
export function calculateFeeDistribution(
  totalFeeSol: number,
  backers: Array<{ wallet: string; backingAmount: number }>
): {
  platformAmount: number;
  backerAmounts: Array<{ wallet: string; amount: number }>;
} {
  // Platform takes 10% cut first
  const platformAmount = totalFeeSol * PLATFORM_FEE_CUT;

  // All backers split the remaining 90% proportionally based on backing amount
  const backerPoolAmount = totalFeeSol - platformAmount;

  // Calculate total backing to get each backer's percentage
  const totalBacking = backers.reduce((sum, b) => sum + b.backingAmount, 0);

  // Distribute to backers proportionally
  const backerAmounts = backers.map((backer) => ({
    wallet: backer.wallet,
    amount: totalBacking > 0 ? (backer.backingAmount / totalBacking) * backerPoolAmount : 0,
  }));

  return { platformAmount, backerAmounts };
}
