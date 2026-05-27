import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

// Lightweight read-only endpoint for the submit UI:
// GET /api/memes/submission-cost?wallet=<creator_wallet>
// → { fee_sol: number, free: boolean, threshold_tokens: number, your_balance_tokens: number }
//
// Used to show "Free for you (PROOF holder)" badge on the submit form before
// the user signs anything. Does NOT replace the auth-time check in POST.

const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const CREATION_FEE_SOL = 0.02;
const FREE_SUBMISSION_THRESHOLD_TOKENS = Number(
  process.env.PROOF_FREE_SUBMISSION_MIN_TOKENS || '500000',
);

export async function GET(request: NextRequest) {
  const wallet = new URL(request.url).searchParams.get('wallet');

  // Without a wallet, return the standard fee + threshold so the UI can
  // still render "Pay 0.02 SOL — or hold 500k PROOF for free"
  if (!wallet) {
    return NextResponse.json({
      fee_sol: CREATION_FEE_SOL,
      free: false,
      threshold_tokens: FREE_SUBMISSION_THRESHOLD_TOKENS,
      your_balance_tokens: null,
    });
  }

  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json(
      { error: 'RPC not configured' },
      { status: 500 },
    );
  }

  try {
    const owner = new PublicKey(wallet);
    const mint = new PublicKey(PROOF_MINT);
    const conn = new Connection(rpcUrl, 'confirmed');
    const accts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    const balance = accts.value.reduce(
      (sum: number, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0),
      0,
    );
    const free = balance >= FREE_SUBMISSION_THRESHOLD_TOKENS;
    return NextResponse.json({
      fee_sol: free ? 0 : CREATION_FEE_SOL,
      free,
      threshold_tokens: FREE_SUBMISSION_THRESHOLD_TOKENS,
      your_balance_tokens: balance,
    });
  } catch (e) {
    // Fail-closed for UI clarity: show the fee
    return NextResponse.json({
      fee_sol: CREATION_FEE_SOL,
      free: false,
      threshold_tokens: FREE_SUBMISSION_THRESHOLD_TOKENS,
      your_balance_tokens: null,
      error: e instanceof Error ? e.message : 'rpc_error',
    });
  }
}
