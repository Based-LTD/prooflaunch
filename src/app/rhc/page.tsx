'use client';

// Campaign list — house style: MemeCard-pattern shells, section headers
// with the "// LABEL" convention, CSS-variable palette throughout.
// Reads the chain directly; no backend, no indexer.
import { useEffect, useState } from 'react';
import Link from 'next/link';
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
            }) as unknown as [
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
    <div className="max-w-6xl mx-auto pb-8">
      <RhcHeader />

      <div className="border border-[var(--border)] bg-[var(--card)]">
        {/* Column header — same convention as the Proving board */}
        <div className="border-b border-[var(--border)] px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// '}CAMPAIGNS
          </span>
          <Link
            href="/rhc/create"
            className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
          >
            + Create
          </Link>
        </div>

        <div className="p-3 space-y-3">
          {error && (
            <p className="text-xs font-mono text-[var(--error)] border border-[var(--error)]/40 bg-[var(--error)]/5 p-3">
              CHAIN READ FAILED: {error} — refresh to retry
            </p>
          )}
          {!rows && !error && (
            <p className="text-xs font-mono text-[var(--muted)] animate-pulse py-6 text-center">
              reading robinhood chain…
            </p>
          )}
          {rows && rows.length === 0 && (
            <p className="text-xs font-mono text-[var(--muted)] py-6 text-center">
              No campaigns yet —{' '}
              <Link href="/rhc/create" className="text-[var(--accent)] hover:text-[var(--accent-hover)]">
                create the first
              </Link>
            </p>
          )}

          {rows?.map((r) => {
            const pct = r.goal > 0n ? Number((r.totalRaised * 100n) / r.goal) : 0;
            return (
              <Link key={r.address} href={`/rhc/campaign/${r.address}`} className="block">
                <div className="border border-[var(--border)] bg-[var(--background)] hover:border-[var(--accent)] transition-colors">
                  <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
                      ${r.symbol}
                    </span>
                    <StatusPill {...r} />
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm text-[var(--foreground)] truncate">{r.name}</span>
                      <span className="font-mono text-xs text-[var(--muted)] shrink-0">
                        <span className="text-[var(--foreground)]">{fmtEth(r.totalRaised, 3)}</span>
                        {' / '}{fmtEth(r.goal, 3)} ETH
                      </span>
                    </div>
                    <div className="mt-2 h-1 bg-[var(--border)]">
                      <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      <span>{r.backerCount.toString()} backer{r.backerCount === 1n ? '' : 's'}</span>
                      <span>
                        {r.launched ? 'LIVE' : `ends ${new Date(Number(r.deadline) * 1000).toLocaleDateString()}`}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
        90% of creator fees → backers · 7% platform · 3% holder rewards — immutable per campaign ·
        the platform never holds funds
      </p>
    </div>
  );
}
