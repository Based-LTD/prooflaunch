'use client';

// The creator's other launches — the SOL page's CreatorPastLaunches.
// Read from the same board snapshot the /rhc list uses, so it costs no
// extra RPC. A first-time deployer is said out loud; a repeat one gets
// their record, launched or not, one line each.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { parseRows, fmtEth, explorerUrl, type CampaignRow } from '@/lib/rhc';

export function CreatorLaunches({ creator, exclude }: { creator: `0x${string}`; exclude: `0x${string}` }) {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/rhc/campaigns').then((r) => r.text()).then((t) => {
      if (!live) return;
      setRows(parseRows(t).filter((r) => r.creator.toLowerCase() === creator.toLowerCase() && r.address.toLowerCase() !== exclude.toLowerCase()));
    }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [creator, exclude]);

  const status = (r: CampaignRow) =>
    r.launched ? 'launched' : r.cancelled ? 'cancelled' : r.refundable ? 'refunding' : Number(r.deadline) * 1000 < Date.now() ? 'expired' : 'raising';

  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{'// '}CREATOR</span>
        <a href={explorerUrl(creator)} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-[var(--muted)] hover:text-[var(--accent)]">
          {creator.slice(0, 6)}…{creator.slice(-4)} ↗
        </a>
      </div>
      <div className="p-4">
        {rows === null ? (
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] animate-pulse">checking history…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs font-mono text-[var(--muted)]">First launch from this wallet on ProofLaunch.</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-mono text-[var(--muted)]">{rows.length} other launch{rows.length === 1 ? '' : 'es'} by this wallet:</p>
            {rows.slice(0, 8).map((r) => (
              <Link key={r.address} href={`/rhc/campaign/${r.address}`} className="flex items-center justify-between gap-3 text-xs font-mono border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 hover:border-[var(--accent)]">
                <span className="truncate"><span className="text-[var(--accent)]">${r.symbol}</span> <span className="text-[var(--muted)]">{r.name}</span></span>
                <span className="shrink-0 text-[10px] uppercase tracking-widest text-[var(--muted)]">
                  {status(r)} · {fmtEth(r.totalRaised, 3)} · {r.backerCount.toString()} backer{r.backerCount === 1n ? '' : 's'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
