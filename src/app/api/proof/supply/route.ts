import { Connection, PublicKey } from '@solana/web3.js';
import { NextResponse } from 'next/server';

// Live circulating supply endpoint for the PROOF token. Submitted to Jupiter
// (and other listing services) as the canonical source-of-truth.
//
// Returns { circulatingSupply, maxSupply, decimals, mint } in the schema
// Jupiter Verify expects: { circulatingSupply: number }. Reads on-chain via
// getTokenSupply so it's always accurate — no manual maintenance needed.
//
// PROOF is a fixed-supply token (mint authority renounced at pump.fun launch).
// circulatingSupply ≈ maxSupply at all times, with sub-1k token dust diffs
// from bonding-curve → AMM graduation rounding.

const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const MAX_SUPPLY = 1_000_000_000;
const DECIMALS = 6;

// Cache 60s so we don't hammer RPC if Jupiter polls hard
export const revalidate = 60;

export async function GET() {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json(
      { error: 'RPC not configured' },
      { status: 500 },
    );
  }
  try {
    const conn = new Connection(rpcUrl, 'confirmed');
    const supply = await conn.getTokenSupply(new PublicKey(PROOF_MINT));
    const circulating = Number(supply.value.uiAmount);
    return NextResponse.json(
      {
        circulatingSupply: circulating,
        maxSupply: MAX_SUPPLY,
        decimals: DECIMALS,
        mint: PROOF_MINT,
        source: 'on-chain getTokenSupply via Solana RPC',
      },
      {
        headers: {
          // Reasonable cache for downstream consumers (Jupiter, CoinGecko, etc.)
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch supply' },
      { status: 500 },
    );
  }
}
