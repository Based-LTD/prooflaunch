'use client';

// Campaign list — reads the chain directly, no backend, no indexer.
// At beta scale (few campaigns) a multicall per page load is nothing.
import { useEffect, useState } from 'react';
import {
  rhcPublicClient, POOLLAUNCH_FACTORY, factoryAbi, campaignAbi, fmtEth,
} from '@/lib/rhc';
import { RhcHeader, StatusPill } from './components';

interface Row {
  address: `0x${string}`;
  name: string;
  symbol: string;
  goal: bigint;
  totalRaised: bigint;
  backerCount: bigint;
  deadline: bigint;
  launched: boolean;
  cancelled: boolean;
  refundable: boolean;
}

export default function RhcListPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const count = await rhcPublicClient.readContract({
          address: POOLLAUNCH_FACTORY, abi: factoryAbi, functionName: 'campaignCount',
        });
        const addrs: `0x${string}`[] = [];
        for (let i = 0n; i < count; i++) {
          addrs.push(await rhcPublicClient.readContract({
            address: POOLLAUNCH_FACTORY, abi: factoryAbi, functionName: 'campaigns', args: [i],
          }));
        }
        const out: Row[] = [];
        for (const address of addrs) {
          const c = { address, abi: campaignAbi } as const;
          const [meta, goal, totalRaised, backerCount, deadline, launched, cancelled, refundable] =
            await rhcPublicClient.multicall({
              contracts: [
                { ...c, functionName: 'tokenMeta' },
                { ...c, functionName: 'goal' },
                { ...c, functionName: 'totalRaised' },
                { ...c, functionName: 'backerCount' },
                { ...c, functionName: 'deadline' },
                { ...c, functionName: 'launched' },
                { ...c, functionName: 'cancelled' },
                { ...c, functionName: 'refundable' },
              ],
              allowFailure: false,
            }) as [
              { name: string; symbol: string }, bigint, bigint, bigint, bigint, boolean, boolean, boolean
            ];
          out.push({
            address, name: meta.name, symbol: meta.symbol,
            goal, totalRaised, backerCount, deadline, launched, cancelled, refundable,
          });
        }
        setRows(out.reverse()); // newest first
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <RhcHeader />

      {error && (
        <p className="font-mono text-sm text-red-400 border border-red-500 p-4">
          chain read failed: {error} — refresh to retry
        </p>
      )}
      {!rows && !error && (
        <p className="font-mono text-sm text-neutral-500 animate-pulse">reading robinhood chain…</p>
      )}
      {rows && rows.length === 0 && (
        <p className="font-mono text-sm text-neutral-500">
          no campaigns yet — <a href="/rhc/create" className="text-orange-400 underline">create the first</a>
        </p>
      )}

      <div className="space-y-3">
        {rows?.map((r) => {
          const pct = r.goal > 0n ? Number((r.totalRaised * 100n) / r.goal) : 0;
          return (
            <a
              key={r.address}
              href={`/rhc/campaign/${r.address}`}
              className="block border border-neutral-700 p-4 hover:border-orange-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="font-mono">
                  <span className="text-orange-400 text-lg">${r.symbol}</span>
                  <span className="text-neutral-400 ml-3">{r.name}</span>
                </div>
                <StatusPill {...r} />
              </div>
              <div className="mt-3 flex items-center gap-6 font-mono text-xs text-neutral-400">
                <span>
                  <span className="text-neutral-200">{fmtEth(r.totalRaised)}</span> / {fmtEth(r.goal)} ETH
                </span>
                <span>{r.backerCount.toString()} backer{r.backerCount === 1n ? '' : 's'}</span>
                <span>
                  {r.launched ? 'live' : `deadline ${new Date(Number(r.deadline) * 1000).toLocaleString()}`}
                </span>
              </div>
              <div className="mt-2 h-1.5 bg-neutral-800">
                <div
                  className="h-full bg-orange-500"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </a>
          );
        })}
      </div>

      <p className="mt-10 font-mono text-xs text-neutral-600">
        90% of creator trading fees to backers · 7% platform · 3% holder rewards — immutable per
        campaign, enforced on-chain. The platform never holds funds.
      </p>
    </main>
  );
}
