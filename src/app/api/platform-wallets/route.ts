import { NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

// Public-facing transparency endpoint: lists every wallet Proof Launch
// operates on-chain, with live SOL balance + role. Nothing here is
// secret — these are all addresses backers + creators interact with
// today (creation fees go to escrow, trading fees go to platform fee,
// daily airdrops come from holder rewards, buybacks accumulate creator
// fees from $PROOF itself).
//
// The point is trust: "here's what we own and what each wallet does"
// is a stronger signal than asking people to take it on faith.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';

interface Wallet {
  key: string;
  label: string;
  role: string;
  address: string;
  balanceSol: number;
  solscanUrl: string;
}

function deriveAddressFromSecret(b58: string | undefined): string | null {
  if (!b58) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(b58)).publicKey.toBase58();
  } catch {
    return null;
  }
}

export async function GET() {
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpc, 'confirmed');

  // Pull addresses. Prefer public-address envs where they exist;
  // derive from private-key envs as fallback. Never returns a key
  // value — derived addresses only.
  const escrowAddr =
    process.env.NEXT_PUBLIC_ESCROW_WALLET
    ?? deriveAddressFromSecret(process.env.ESCROW_WALLET_PRIVATE_KEY)
    ?? null;
  const platformAddr = process.env.PLATFORM_WALLET_ADDRESS ?? null;
  const holderRewardsAddr = process.env.HOLDER_REWARDS_WALLET_ADDRESS ?? null;
  const buybackAddr = process.env.NEXT_PUBLIC_PROOF_BUYBACK_WALLET ?? null;

  const spec: Array<{ key: string; label: string; role: string; address: string | null }> = [
    {
      key: 'escrow',
      label: 'Platform Escrow',
      role: 'Receives token-submission fees. Pays for recovery operations (refunds, sweeps). The wallet creators send the 0.02 SOL submission fee to.',
      address: escrowAddr,
    },
    {
      key: 'platform_fee',
      label: 'Platform Fee Wallet',
      role: 'Collects the 10% platform cut of trading fees from every launched token, on every trade. Funds platform operations + the PROOF holder airdrop loop.',
      address: platformAddr,
    },
    {
      key: 'holder_rewards',
      label: 'Holder Rewards',
      role: 'Pays daily SOL airdrops to $PROOF holders pro-rata (direct + Streamflow-locked balances). PDA-filtered with the same denylist Jito and MNDE use.',
      address: holderRewardsAddr,
    },
    {
      key: 'proof_buyback',
      label: 'PROOF Buyback',
      role: 'Accumulates trading-fee revenue from $PROOF token itself (the platform token is also a Pump.fun launch). Periodically sweeps onward to Holder Rewards so accumulations don\'t sit idle.',
      address: buybackAddr,
    },
  ];

  // Fetch balances for whatever resolved.
  const live: Wallet[] = [];
  for (const w of spec) {
    if (!w.address) continue;
    let balanceSol = 0;
    try {
      const lam = await conn.getBalance(new PublicKey(w.address));
      balanceSol = lam / LAMPORTS_PER_SOL;
    } catch {
      // Address present but balance read failed — show 0 rather than skip the row.
    }
    live.push({
      key: w.key,
      label: w.label,
      role: w.role,
      address: w.address,
      balanceSol,
      solscanUrl: `https://solscan.io/account/${w.address}`,
    });
  }

  return new NextResponse(JSON.stringify({
    wallets: live,
    proofMint: PROOF_MINT,
    proofMintSolscanUrl: `https://solscan.io/token/${PROOF_MINT}`,
    asOf: new Date().toISOString(),
  }), {
    headers: {
      'content-type': 'application/json',
      // Cache 30s edge + serve-stale-while-revalidate to keep modal snappy
      // and not hammer the RPC. Balances drift slowly enough for users.
      'cache-control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=120',
    },
  });
}
