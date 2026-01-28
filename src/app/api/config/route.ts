import { NextResponse } from 'next/server';
import { getEscrowAddress, getEscrowBalance } from '@/services/pumpfun';

// GET /api/config - Get platform configuration
export async function GET() {
  try {
    const escrowAddress = getEscrowAddress();
    const escrowBalance = await getEscrowBalance();

    return NextResponse.json({
      escrow_address: escrowAddress,
      escrow_balance_sol: escrowBalance,
      platform_fee_bps: 200, // 2%
      min_backing_sol: 0.01,
      submission_fee_sol: 0.05,
      rpc_url: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    });
  } catch (error) {
    console.error('Config error:', error);
    return NextResponse.json(
      { error: 'Failed to get config' },
      { status: 500 }
    );
  }
}
