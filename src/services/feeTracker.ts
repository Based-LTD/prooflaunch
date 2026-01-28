import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const ESCROW_WALLET = process.env.NEXT_PUBLIC_ESCROW_WALLET || 'CEGgJZF6AXGkj3BBTmmhagudwU9FKscMB25RJM5iwFYY';

// Pump.fun fee program - this is the program that sends creator fees
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export interface FeeTransaction {
  signature: string;
  mintAddress: string;
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
          mintAddress: feeInfo.mintAddress,
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
 * Extract pump.fun fee info from a transaction
 * Returns the mint address and fee amount if this is a creator fee tx
 */
function extractPumpFunFee(
  tx: ParsedTransactionWithMeta,
  escrowWallet: string
): { mintAddress: string; amountSol: number } | null {
  const instructions = tx.transaction.message.instructions;
  const innerInstructions = tx.meta?.innerInstructions || [];

  // Look for transfers to escrow
  let transferAmount = 0;
  let mintAddress: string | null = null;

  // Check account keys for token mint (pump.fun includes mint in the accounts)
  const accountKeys = tx.transaction.message.accountKeys;

  // Look through all instructions for SOL transfer to escrow
  for (const ix of instructions) {
    if ('parsed' in ix && ix.parsed?.type === 'transfer') {
      const info = ix.parsed.info;
      if (info.destination === escrowWallet) {
        transferAmount = info.lamports / 1e9;
      }
    }
  }

  // Also check inner instructions
  for (const inner of innerInstructions) {
    for (const ix of inner.instructions) {
      if ('parsed' in ix && ix.parsed?.type === 'transfer') {
        const info = ix.parsed.info;
        if (info.destination === escrowWallet) {
          transferAmount += info.lamports / 1e9;
        }
      }
    }
  }

  // Try to find the token mint from the transaction
  // Pump.fun transactions typically have the mint as one of the accounts
  for (const account of accountKeys) {
    const pubkey = typeof account === 'string' ? account : account.pubkey.toBase58();
    // Token mints on pump.fun end with "pump"
    if (pubkey.endsWith('pump') && pubkey.length === 44) {
      mintAddress = pubkey;
      break;
    }
  }

  // If we found a transfer and a mint, this is likely a fee transaction
  if (transferAmount > 0 && mintAddress) {
    return { mintAddress, amountSol: transferAmount };
  }

  // Small SOL amounts (< 0.1 SOL) going to escrow are likely fees, not backings
  if (transferAmount > 0 && transferAmount < 0.1) {
    // Try to identify mint from logs or other means
    const logs = tx.meta?.logMessages || [];
    for (const log of logs) {
      // Look for mint address in logs
      const match = log.match(/([A-HJ-NP-Za-km-z1-9]{32,44}pump)/);
      if (match) {
        mintAddress = match[1];
        break;
      }
    }

    if (mintAddress) {
      return { mintAddress, amountSol: transferAmount };
    }
  }

  return null;
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
