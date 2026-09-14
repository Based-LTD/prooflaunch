'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchWpRecent, WpVerdict, WP_TIER_COLOR } from '@/lib/walletproof';

export function WpRecent() {
  const [rows, setRows] = useState<WpVerdict[] | null>(null);
  useEffect(() => { fetchWpRecent(30).then(setRows); const id = setInterval(() => fetchWpRecent(30).then(setRows), 30_000); return () => clearInterval(id); }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-3 py-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{'// '}LATEST PONS LAUNCHES WITH TRADES</span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {rows.map((v) => {
          const color = WP_TIER_COLOR[v.tier];
          return (
            <Link key={v.curve} href={`/rhc/check?t=${v.token}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[var(--background)] transition-colors">
              <div className="min-w-0 flex items-center gap-2">
                <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border shrink-0" style={{ borderColor: `color-mix(in srgb, ${color} 60%, transparent)`, color, background: `color-mix(in srgb, ${color} 5%, transparent)` }}>{v.emoji} {v.label}</span>
                <span className="font-mono text-xs text-[var(--foreground)] truncate">{v.name || v.token.slice(0, 10)}</span>
                <span className="font-mono text-[10px] text-[var(--muted)] truncate">${v.symbol}</span>
              </div>
              <span className="font-mono text-[10px] text-[var(--muted)] shrink-0">{v.buyers.real} real · {Math.round(v.volume_eth.crew_share * 100)}% crew · {v.volume_eth.buy.toFixed(2)} ETH</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
