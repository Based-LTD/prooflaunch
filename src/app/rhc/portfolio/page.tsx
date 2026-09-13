'use client';

// Your RHC positions — mirrors the SOL /portfolio role: every campaign
// you've backed, with claim state at a glance.
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { fetchAllCampaigns, CampaignRow, fmtEth } from '@/lib/rhc';
import { RhcHeader, CampaignCard, ConnectButton } from '../components';

export default function RhcPortfolioPage() {
  const { address: me, isConnected } = useAccount();
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setRows(null);
    fetchAllCampaigns(me)
      .then((r) => setRows(r.filter((c) => c.myContribution > 0n)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [me]);

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <RhcHeader />
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-3 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// '}YOUR POSITIONS
          </span>
        </div>
        <div className="p-3">
          {!isConnected && (
            <div className="py-8 text-center space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                {'> '}Connect your wallet to see your positions
              </p>
              <ConnectButton />
            </div>
          )}
          {isConnected && error && (
            <p className="text-xs font-mono text-[var(--error)]">CHAIN READ FAILED: {error}</p>
          )}
          {isConnected && !rows && !error && (
            <p className="text-xs font-mono text-[var(--muted)] animate-pulse py-6 text-center">reading chain…</p>
          )}
          {rows && rows.length === 0 && (
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] py-6 text-center">
              no positions yet — back a campaign from the board
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows?.map((r) => (
              <CampaignCard
                key={r.address}
                r={r}
                footer={
                  <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                    <span className="text-[var(--muted)]">
                      your stake: <span className="text-[var(--foreground)]">{fmtEth(r.myContribution, 3)} ETH</span>
                    </span>
                    {r.launched && (
                      <span className={r.myTokensClaimed ? 'text-[var(--success)]' : 'text-[var(--accent)]'}>
                        {r.myTokensClaimed ? '✓ claimed' : 'claim ready'}
                      </span>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
