'use client';

// Launched tokens on RHC — mirrors the SOL /launched page's role.
import { useEffect, useState } from 'react';
import { fetchAllCampaigns, CampaignRow } from '@/lib/rhc';
import { RhcHeader, CampaignCard } from '../components';

export default function RhcLaunchedPage() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllCampaigns()
      .then((r) => setRows(r.filter((c) => c.launched)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <RhcHeader />
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-3 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// '}LAUNCHED
          </span>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {error && <p className="text-xs font-mono text-[var(--error)]">CHAIN READ FAILED: {error}</p>}
          {!rows && !error && (
            <p className="text-xs font-mono text-[var(--muted)] animate-pulse py-6">reading chain…</p>
          )}
          {rows && rows.length === 0 && (
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] py-6">
              nothing launched yet
            </p>
          )}
          {rows?.map((r) => <CampaignCard key={r.address} r={r} />)}
        </div>
      </div>
    </div>
  );
}
