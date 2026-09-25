import { NextResponse } from 'next/server';
import { createPublicClient, http, parseAbi, parseAbiItem } from 'viem';
import { rhcPublicClient, robinhoodChain, proofBurnerAbi, campaignAbi, PROOF_BURNER, PROOF_BURNER_LIVE, POOLLAUNCH_FACTORY_V8, factoryV5Abi } from '@/lib/rhc';

// The flywheel feed: the burner's counters, $PROOF supply vs the dead
// address, every burn bucketed by day, which campaigns fed it, who cranked
// it, and the last burns as a table. All chain reads; block timestamps,
// tx senders and splitter→campaign names are cached in-process so the
// only cost per refresh is the new blocks. Edge-cached 15s.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
const logClient = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 25_000 }) });
const burnedEvent = parseAbiItem('event Burned(uint256 ethIn, uint256 tokensBurned, bool viaCurve)');
const pulledEvent = parseAbiItem('event Pulled(address indexed splitter, uint256 ethAmount)');
const createdEvent = parseAbiItem('event CampaignCreated(address indexed campaign, address indexed creator, address feeSplitter, uint256 goal, uint256 deadline, string symbol)');
const erc20 = [
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const splitterView = [{ type: 'function', name: 'campaign', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;

const tsCache = new Map<bigint, number>();
const fromCache = new Map<string, `0x${string}`>();
const nameCache = new Map<string, { campaign: `0x${string}`; symbol: string; name: string }>();

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export interface FlywheelBurn { tx: `0x${string}`; from: `0x${string}` | null; ethIn: string; tokens: string; ts: number | null; viaCurve: boolean; source?: 'flywheel' | 'coinLeg' }
export interface FlywheelFeed {
  live: boolean;
  burner?: `0x${string}`; token?: `0x${string}`;
  pulled?: string; spent?: string; burnedByFlywheel?: string; pending?: string;
  supply?: string; dead?: string;
  creationFees?: string;                                             // v8 campaigns created × the factory's creation fee
  direct?: string;                                                   // other ETH sent straight to the burner (seeds, forwarded legs)
  coinBurnSpent?: string;                                            // ETH $PLAUNCH's OWN campaign coin-burn leg has spent buying+burning $PLAUNCH
  coinBurnOwed?: string;                                             // ETH owed to that leg, uncranked — will burn $PLAUNCH on the next crank
  burnedByCoinLeg?: string;                                          // $PLAUNCH burned by that leg (the rest of `dead` beyond the flywheel)
  coinLeg?: `0x${string}`;                                           // its address
  daily?: { day: string; eth: string; tokens: string; count: number }[];
  feeders?: { splitter: `0x${string}`; campaign: `0x${string}`; symbol: string; name: string; eth: string; pulls: number }[];
  crankers?: { wallet: `0x${string}`; cranks: number }[];
  burns?: FlywheelBurn[];
  totalBurns?: number;
}

export async function GET() {
  if (!PROOF_BURNER_LIVE) return NextResponse.json({ live: false } satisfies FlywheelFeed, { headers: { 'cache-control': 'public, s-maxage=300' } });
  try {
    const c = { address: PROOF_BURNER, abi: proofBurnerAbi } as const;
    const [pulled, spent, burned, pending, token] = await rhcPublicClient.multicall({
      contracts: [
        { ...c, functionName: 'totalEthPulled' }, { ...c, functionName: 'totalEthSpent' },
        { ...c, functionName: 'totalTokensBurned' }, { ...c, functionName: 'pendingEth' }, { ...c, functionName: 'proofToken' },
      ],
      allowFailure: false,
    }) as unknown as [bigint, bigint, bigint, bigint, `0x${string}`];
    // $PLAUNCH's own campaign is v7 — its 30% coin-burn leg burns $PLAUNCH
    // too, outside the ProofBurner. The hero counts burned tokens from the
    // dead address (everything), so its ETH figures must include this leg
    // or the two tiles disagree by 7x. Found from the burner's campaign.
    let coinBurnSpent = 0n, coinBurnOwed = 0n, burnedByCoinLeg = 0n; let coinLeg: `0x${string}` | null = null;
    try {
      const legAbi = parseAbi(['function campaign() view returns (address)', 'function feeSplitter() view returns (address)', 'function legCount() view returns (uint256)', 'function legRecipients(uint256) view returns (address)', 'function legOwed(address,address) view returns (uint256)', 'function totalEthSpent() view returns (uint256)', 'function totalTokensBurned() view returns (uint256)']);
      const camp = await rhcPublicClient.readContract({ address: PROOF_BURNER, abi: legAbi, functionName: 'campaign' });
      const splitter = await rhcPublicClient.readContract({ address: camp, abi: legAbi, functionName: 'feeSplitter' });
      const n = Number(await rhcPublicClient.readContract({ address: splitter, abi: legAbi, functionName: 'legCount' }));
      for (let i = 0; i < n; i++) {
        const leg = await rhcPublicClient.readContract({ address: splitter, abi: legAbi, functionName: 'legRecipients', args: [BigInt(i)] });
        if (leg.toLowerCase() === PROOF_BURNER.toLowerCase()) continue;
        try {
          const burnedByLeg = await rhcPublicClient.readContract({ address: leg, abi: legAbi, functionName: 'totalTokensBurned' });
          void burnedByLeg; // a BurnLeg answers this; wallets and the platform leg revert
          coinBurnSpent = await rhcPublicClient.readContract({ address: leg, abi: legAbi, functionName: 'totalEthSpent' });
          burnedByCoinLeg = burnedByLeg; coinLeg = leg;
          coinBurnOwed = await rhcPublicClient.readContract({ address: splitter, abi: legAbi, functionName: 'legOwed', args: [leg, '0x0000000000000000000000000000000000000000'] });
          break;
        } catch { /* not a burn leg */ }
      }
    } catch { /* leave zeros */ }

    const [supply, dead] = await rhcPublicClient.multicall({
      contracts: [{ address: token, abi: erc20, functionName: 'totalSupply' }, { address: token, abi: erc20, functionName: 'balanceOf', args: [DEAD] }],
      allowFailure: false,
    }) as [bigint, bigint];

    // The token's own coin-burn leg emits the identical Burned event, so its
    // burns join every chart and list here; each row remembers its source.
    const [burnLogs, pullLogs, legLogs] = await Promise.all([
      logClient.getLogs({ address: PROOF_BURNER, event: burnedEvent, fromBlock: 0n, toBlock: 'latest' }).catch(() => []),
      logClient.getLogs({ address: PROOF_BURNER, event: pulledEvent, fromBlock: 0n, toBlock: 'latest' }).catch(() => []),
      coinLeg ? logClient.getLogs({ address: coinLeg, event: burnedEvent, fromBlock: 0n, toBlock: 'latest' }).catch(() => []) : Promise.resolve([]),
    ]);
    const real = [...burnLogs, ...legLogs]
      .filter((l) => (l.args.tokensBurned ?? 0n) > 0n)
      .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)));

    // timestamps (cached)
    const blocks = [...new Set(real.map((l) => l.blockNumber).filter((b) => !tsCache.has(b)))];
    await mapLimit(blocks, 6, async (bn) => { try { const b = await rhcPublicClient.getBlock({ blockNumber: bn }); tsCache.set(bn, Number(b.timestamp)); } catch { /* skip */ } });

    // daily buckets
    const byDay = new Map<string, { eth: bigint; tokens: bigint; count: number }>();
    for (const l of real) {
      const ts = tsCache.get(l.blockNumber); if (!ts) continue;
      const day = new Date(ts * 1000).toISOString().slice(0, 10);
      const d = byDay.get(day) ?? { eth: 0n, tokens: 0n, count: 0 };
      d.eth += l.args.ethIn ?? 0n; d.tokens += l.args.tokensBurned ?? 0n; d.count += 1; byDay.set(day, d);
    }
    const daily = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, d]) => ({ day, eth: d.eth.toString(), tokens: d.tokens.toString(), count: d.count }));

    // feeders: per splitter, resolved to its campaign's symbol (cached)
    const bySplitter = new Map<string, { eth: bigint; pulls: number }>();
    for (const l of pullLogs) {
      const s = (l.args.splitter as string).toLowerCase();
      const e = bySplitter.get(s) ?? { eth: 0n, pulls: 0 }; e.eth += l.args.ethAmount ?? 0n; e.pulls += 1; bySplitter.set(s, e);
    }
    const unresolved = [...bySplitter.keys()].filter((s) => !nameCache.has(s));
    await mapLimit(unresolved, 4, async (s) => {
      try {
        const camp = await rhcPublicClient.readContract({ address: s as `0x${string}`, abi: splitterView, functionName: 'campaign' });
        const meta = await rhcPublicClient.readContract({ address: camp, abi: campaignAbi, functionName: 'tokenMeta' }) as { name: string; symbol: string };
        nameCache.set(s, { campaign: camp, symbol: meta.symbol, name: meta.name });
      } catch { nameCache.set(s, { campaign: '0x0000000000000000000000000000000000000000', symbol: '?', name: s.slice(0, 10) }); }
    });
    const feeders = [...bySplitter.entries()].map(([s, e]) => ({ splitter: s as `0x${string}`, ...nameCache.get(s)!, eth: e.eth.toString(), pulls: e.pulls }))
      .sort((a, b) => (BigInt(a.eth) < BigInt(b.eth) ? 1 : -1)).slice(0, 12);

    // crankers + the last burns (senders cached)
    const last = real.slice(-60).reverse();
    await mapLimit(last.filter((l) => !fromCache.has(l.transactionHash)), 6, async (l) => {
      try { const tx = await rhcPublicClient.getTransaction({ hash: l.transactionHash }); fromCache.set(l.transactionHash, tx.from); } catch { /* skip */ }
    });
    const crankCount = new Map<string, number>();
    for (const l of last) { const f = fromCache.get(l.transactionHash); if (f) crankCount.set(f, (crankCount.get(f) ?? 0) + 1); }
    const crankers = [...crankCount.entries()].map(([wallet, cranks]) => ({ wallet: wallet as `0x${string}`, cranks })).sort((a, b) => b.cranks - a.cranks).slice(0, 8);
    const burns: FlywheelBurn[] = last.slice(0, 40).map((l) => ({
      tx: l.transactionHash, from: fromCache.get(l.transactionHash) ?? null,
      ethIn: (l.args.ethIn ?? 0n).toString(), tokens: (l.args.tokensBurned ?? 0n).toString(),
      ts: tsCache.get(l.blockNumber) ?? null, viaCurve: !!l.args.viaCurve,
      source: l.address.toLowerCase() === PROOF_BURNER.toLowerCase() ? 'flywheel' : 'coinLeg',
    }));

    // Creation fees are counted, not inferred: v8 campaigns created × the
    // factory's fee. Whatever else arrived without a Pulled event is ETH
    // someone sent the burner directly (launch-day seeds, forwarded legs).
    const received = spent + pending;
    let creationFees = 0n;
    try {
      const [fee, created] = await Promise.all([
        rhcPublicClient.readContract({ address: POOLLAUNCH_FACTORY_V8, abi: factoryV5Abi, functionName: 'creationFee' }) as Promise<bigint>,
        rhcPublicClient.getLogs({ address: POOLLAUNCH_FACTORY_V8, event: createdEvent, fromBlock: 0n, toBlock: 'latest' }),
      ]);
      creationFees = fee * BigInt(created.length);
    } catch { /* leave at 0; the direct figure absorbs it */ }
    const direct = received > pulled + creationFees ? received - pulled - creationFees : 0n;
    const body: FlywheelFeed = {
      live: true, burner: PROOF_BURNER, token,
      pulled: pulled.toString(), spent: spent.toString(), burnedByFlywheel: burned.toString(), pending: pending.toString(),
      supply: supply.toString(), dead: dead.toString(), creationFees: creationFees.toString(), direct: direct.toString(), coinBurnSpent: coinBurnSpent.toString(), coinBurnOwed: coinBurnOwed.toString(), burnedByCoinLeg: burnedByCoinLeg.toString(), coinLeg: coinLeg ?? undefined,
      daily, feeders, crankers, burns, totalBurns: real.length,
    };
    return NextResponse.json(body, { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=60' } });
  } catch (e) {
    return NextResponse.json({ live: true, error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
