import { NextResponse } from 'next/server';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { rhcPublicClient, robinhoodChain, proofBurnerAbi, PROOF_BURNER, PROOF_BURNER_LIVE } from '@/lib/rhc';

// The flywheel feed: the burner's counters, $PROOF supply vs the dead
// address, and the last burns as a tape. Cached 15s at the edge so the
// panel is cheap for visitors. Every number is read from the chain.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
const logClient = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 25_000 }) });
const burnedEvent = parseAbiItem('event Burned(uint256 ethIn, uint256 tokensBurned, bool viaCurve)');
const erc20 = [
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export interface FlywheelFeed {
  live: boolean;
  burner?: `0x${string}`; token?: `0x${string}`;
  pulled?: string; spent?: string; burnedByFlywheel?: string; pending?: string;
  supply?: string; dead?: string; // all $PROOF ever burned, by anyone (dead-address balance)
  burns?: { tx: `0x${string}`; ethIn: string; tokens: string; ts: number | null; viaCurve: boolean }[];
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
    const [supply, dead] = await rhcPublicClient.multicall({
      contracts: [
        { address: token, abi: erc20, functionName: 'totalSupply' },
        { address: token, abi: erc20, functionName: 'balanceOf', args: [DEAD] },
      ],
      allowFailure: false,
    }) as [bigint, bigint];
    const logs = await logClient.getLogs({ address: PROOF_BURNER, event: burnedEvent, fromBlock: 0n, toBlock: 'latest' }).catch(() => []);
    const last = logs.slice(-12).reverse();
    const blocks = [...new Set(last.map((l) => l.blockNumber))];
    const ts = new Map<bigint, number>();
    await Promise.all(blocks.map(async (bn) => { try { const b = await rhcPublicClient.getBlock({ blockNumber: bn }); ts.set(bn, Number(b.timestamp)); } catch { /* null */ } }));
    const body: FlywheelFeed = {
      live: true, burner: PROOF_BURNER, token,
      pulled: pulled.toString(), spent: spent.toString(), burnedByFlywheel: burned.toString(), pending: pending.toString(),
      supply: supply.toString(), dead: dead.toString(),
      burns: last.filter((l) => (l.args.tokensBurned ?? 0n) > 0n).map((l) => ({
        tx: l.transactionHash, ethIn: (l.args.ethIn ?? 0n).toString(), tokens: (l.args.tokensBurned ?? 0n).toString(),
        ts: ts.get(l.blockNumber) ?? null, viaCurve: !!l.args.viaCurve,
      })),
    };
    return NextResponse.json(body, { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=60' } });
  } catch (e) {
    return NextResponse.json({ live: true, error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
