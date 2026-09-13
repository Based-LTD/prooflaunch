'use client';

// RHC home — the same three-column board as the SOL Proving page:
// BACKING (raising now) | FUNDED (goal met, awaiting launch) | LIVE.
// Same site, different chain.
import { useEffect, useState } from 'react';
import { fetchAllCampaigns, CampaignRow } from '@/lib/rhc';
import { RhcHeader, BoardColumn } from './components';

export default function RhcBoardPage() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllCampaigns()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const backing = (rows || []).filter(r => !r.launched && !r.cancelled && r.totalRaised < r.goal && now < r.deadline);
  const funded = (rows || []).filter(r => !r.launched && !r.cancelled && r.totalRaised >= r.goal);
  const live = (rows || []).filter(r => r.launched);

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <RhcHeader />

      {error && (
        <p className="text-xs font-mono text-[var(--error)] border border-[var(--error)]/40 bg-[var(--error)]/5 p-3 mb-4">
          CHAIN READ FAILED: {error} — refresh to retry
        </p>
      )}
      {!rows && !error && (
        <p className="text-xs font-mono text-[var(--muted)] animate-pulse py-8 text-center">
          reading robinhood chain…
        </p>
      )}

      {rows && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BoardColumn label="BACKING" icon="◎" items={backing} empty="no open raises — create one" />
          <BoardColumn label="FUNDED" icon="◈" items={funded} empty="none awaiting launch" />
          <BoardColumn label="LIVE" icon="▲" items={live} empty="none live yet" />
        </div>
      )}

      <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
        90% of creator fees → backers · 7% platform · 3% holder rewards — immutable per campaign ·
        the platform never holds funds
      </p>
    </div>
  );
}
