import { NextResponse } from 'next/server';
import { getEscrowAddress, getEscrowBalance } from '@/services/pumpfun';

// GET /api/config - Get platform configuration
export async function GET() {
  try {
    // Get escrow address first (this can fail if private key env is wrong)
    let escrowAddress: string;
    try {
      escrowAddress = getEscrowAddress();
    } catch (addrError) {
      console.error('Failed to get escrow address:', addrError);
      return NextResponse.json(
        { error: 'Escrow wallet not configured', details: String(addrError) },
        { status: 500 }
      );
    }

    // Balance is optional - don't fail if RPC is slow
    let escrowBalance = 0;
    try {
      escrowBalance = await getEscrowBalance();
    } catch (balanceError) {
      console.warn('Failed to get escrow balance:', balanceError);
      // Continue without balance - not critical
    }

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
      { error: 'Failed to get config', details: String(error) },
      { status: 500 }
    );
  }
}
