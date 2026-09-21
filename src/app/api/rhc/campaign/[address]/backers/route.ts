import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, isAddress, parseAbiItem } from 'viem';
import {
  rhcPublicClient, robinhoodChain, campaignAbi, campaignV3Abi, campaignV4Abi, splitterAbi, erc20Abi, RHC_WETH,
} from '@/lib/rhc';

// The backer roster — the SOL page's BackersList + GenesisBackerRoster,
// read straight off the campaign contract. The contract keeps only a
// per-wallet mapping (no enumeration), so the wallet list comes from its
// Deposited events; every number after that is a live view read, never
// a replayed event, so withdraws and claims can't drift the roster.
//
// Post-launch this is the "who is still in" surface: each genesis
// wallet's live token balance against what the raise allocated it, plus
// the fees it has pulled and what is waiting for it in the splitter.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Logs need history. The official gateway is the only public RPC that
// serves historical logs (publicnode paywalls the archive, ordofi caps per
// block). One address + one topic is a handful of logs — safe from genesis,
// the same scan the receipt tools run.
const logClient = createPublicClient({
  chain: robinhoodChain,
  transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 25_000 }),
});

// v1/v2 campaigns emit the 3-field event, v3 (factory v5+) adds the bucket.
// Different topic0, same meaning; ask for both.
const depositEvents = [
  parseAbiItem('event Deposited(address indexed backer, uint256 amount, uint256 totalRaised)'),
  parseAbiItem('event Deposited(address indexed backer, uint256 amount, uint256 totalRaised, uint8 bucket)'),
];

const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;

export interface RosterBacker {
  wallet: `0x${string}`;
  contribution: string;   // quote units (wei for ETH raises)
  bucket: number;         // 0 unknown/none · 1 public · 2 reserved (team)
  deposits: number;
  firstBlock: string;
  firstTs: number | null; // unix seconds
  lockUntil: number;      // unix seconds; 0 = no lock (v8 campaigns only)
  // post-launch only
  allocation: string;     // tokens the raise allotted this wallet (18 dp)
  tokensClaimed: boolean;
  tokenBalance: string;   // live wallet balance of the launched token
  feesClaimed: string;    // wei pulled from the splitter so far
  feesPending: string;    // wei waiting in the splitter
}

export interface RosterResponse {
  campaign: `0x${string}`;
  launched: boolean;
  totalRaised: string;
  totalRaisedAtLaunch: string;
  tokensAtLaunch: string;
  hasBuckets: boolean;
  backers: RosterBacker[];
  left: `0x${string}`[];  // deposited once, withdrew everything before launch
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isAddress(address)) return NextResponse.json({ error: 'bad address' }, { status: 400 });
  const addr = address as `0x${string}`;
  try {
    const c = { address: addr, abi: campaignAbi } as const;
    const [launched, token, feeSplitter, totalRaised, totalRaisedAtLaunch, tokensAtLaunch] =
      await rhcPublicClient.multicall({
        contracts: [
          { ...c, functionName: 'launched' },
          { ...c, functionName: 'token' },
          { ...c, functionName: 'feeSplitter' },
          { ...c, functionName: 'totalRaised' },
          { ...c, functionName: 'totalRaisedAtLaunch' },
          { ...c, functionName: 'tokensAtLaunch' },
        ],
        allowFailure: false,
      }) as unknown as [boolean, `0x${string}`, `0x${string}`, bigint, bigint, bigint];

    // Generation probes: curve() ⇒ pons V2 (native-ETH fees); reservedSeats()
    // ⇒ v3 campaign with seat buckets.
    const isV4 = await rhcPublicClient.readContract({ ...c, functionName: 'curve' }).then(() => true).catch(() => false);
    const hasBuckets = await rhcPublicClient.readContract({ address: addr, abi: campaignV3Abi, functionName: 'reservedSeats' }).then(() => true).catch(() => false);
    const feeAsset = isV4 ? ZERO : RHC_WETH;

    const logs = await logClient.getLogs({ address: addr, events: depositEvents, fromBlock: 0n, toBlock: 'latest' });
    const seen = new Map<string, { wallet: `0x${string}`; firstBlock: bigint; deposits: number }>();
    for (const l of logs) {
      const b = (l.args as { backer?: `0x${string}` }).backer;
      if (!b) continue;
      const k = b.toLowerCase();
      const e = seen.get(k);
      if (e) e.deposits += 1;
      else seen.set(k, { wallet: b, firstBlock: l.blockNumber, deposits: 1 });
    }
    // Seat order = first deposit order (ties broken by log order, which is
    // already chronological).
    const wallets = [...seen.values()].sort((a, b) => (a.firstBlock < b.firstBlock ? -1 : a.firstBlock > b.firstBlock ? 1 : 0));

    // Live reads per wallet. allowFailure because seatBucket() only exists
    // on v3 campaigns and the splitter views differ across generations.
    const per = 7;
    const calls = wallets.flatMap((w) => [
      { ...c, functionName: 'contributionOf', args: [w.wallet] },
      { ...c, functionName: 'tokensClaimed', args: [w.wallet] },
      { address: addr, abi: campaignV3Abi, functionName: 'seatBucket', args: [w.wallet] },
      { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [w.wallet] },
      { address: feeSplitter, abi: splitterAbi, functionName: 'backerEntitlement', args: [w.wallet, feeAsset] },
      { address: feeSplitter, abi: splitterAbi, functionName: 'backerClaimed', args: [w.wallet, feeAsset] },
      { address: addr, abi: campaignV4Abi, functionName: 'lockUntil', args: [w.wallet] },
    ]);
    const res = wallets.length
      ? await rhcPublicClient.multicall({ contracts: calls as never, allowFailure: true })
      : [];
    const pick = <T,>(i: number, fallback: T): T => {
      const r = res[i] as { status: string; result?: unknown } | undefined;
      return r && r.status === 'success' && r.result !== undefined ? (r.result as T) : fallback;
    };

    // Timestamps for "in since" — one getBlock per distinct first-deposit
    // block, capped so an open raise with hundreds of backers can't turn
    // this into an RPC storm.
    const blocks = [...new Set(wallets.map((w) => w.firstBlock))].slice(0, 48);
    const tsByBlock = new Map<bigint, number>();
    await Promise.all(blocks.map(async (bn) => {
      try { const b = await rhcPublicClient.getBlock({ blockNumber: bn }); tsByBlock.set(bn, Number(b.timestamp)); } catch { /* leave null */ }
    }));

    const backers: RosterBacker[] = [];
    const left: `0x${string}`[] = [];
    wallets.forEach((w, i) => {
      const o = i * per;
      const contribution = pick<bigint>(o, 0n);
      if (contribution === 0n) { left.push(w.wallet); return; }
      const claimed = pick<boolean>(o + 1, false);
      const bucket = Number(pick<number>(o + 2, 0));
      const balance = launched && token !== ZERO ? pick<bigint>(o + 3, 0n) : 0n;
      const ent = launched ? pick<bigint>(o + 4, 0n) : 0n;
      const fc = launched ? pick<bigint>(o + 5, 0n) : 0n;
      const lockUntil = Number(pick<bigint>(o + 6, 0n));
      const allocation = launched && totalRaisedAtLaunch > 0n ? (tokensAtLaunch * contribution) / totalRaisedAtLaunch : 0n;
      backers.push({
        wallet: w.wallet,
        contribution: contribution.toString(),
        bucket,
        deposits: w.deposits,
        firstBlock: w.firstBlock.toString(),
        firstTs: tsByBlock.get(w.firstBlock) ?? null,
        lockUntil,
        allocation: allocation.toString(),
        tokensClaimed: claimed,
        tokenBalance: balance.toString(),
        feesClaimed: fc.toString(),
        feesPending: (ent > fc ? ent - fc : 0n).toString(),
      });
    });

    const body: RosterResponse = {
      campaign: addr, launched, hasBuckets,
      totalRaised: totalRaised.toString(),
      totalRaisedAtLaunch: totalRaisedAtLaunch.toString(),
      tokensAtLaunch: tokensAtLaunch.toString(),
      backers, left,
    };
    return NextResponse.json(body, {
      headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=60' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
