import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { OnlinePumpSdk, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
export async function POST(r: NextRequest) {
  const s = process.env.CRON_SECRET;
  if (s && r.headers.get('authorization') !== `Bearer ${s}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const conn = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!, 'confirmed');
    const online = new OnlinePumpSdk(conn);
    const global = await online.fetchGlobal();
    let feeConfig = null; try { feeConfig = await online.fetchFeeConfig(); } catch {}
    const out: Record<string, unknown> = {};
    for (const sol of [0.01, 0.03, 0.1, 1]) {
      const lamports = new BN(Math.floor(sol * 1e9).toString());
      const wNull = getBuyTokenAmountFromSolAmount({ global, feeConfig: null, mintSupply: null, bondingCurve: null, amount: lamports });
      const wFc = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: lamports });
      out[`${sol}SOL`] = { feeConfigNull: wNull.toString(), withFeeConfig: wFc.toString() };
    }
    return NextResponse.json(out);
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'fail', stack: e instanceof Error ? e.stack : undefined }, { status: 500 }); }
}
