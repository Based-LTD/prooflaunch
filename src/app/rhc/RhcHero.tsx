'use client';

// The RHC hero — mirrors the SOL LandingHero: mainnet chip row, big mono
// headline, subtext hook, live stat tickers, primary CTA. Stats read
// straight from the chain (no backend to lie, no counter to row-cap).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CampaignRow, fmtEth } from '@/lib/rhc';

function Stat({ value, unit, label, color }: { value: string; unit: string; label: string; color: string }) {
  return (
    <div className="text-center">
      <div className="font-mono font-semibold" style={{ fontSize: 'clamp(1.25rem, 2.6vw, 2rem)', color }}>
        {value}{unit && <span className="text-[0.55em] ml-1 opacity-80">{unit}</span>}
      </div>
      <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{label}</div>
    </div>
  );
}

export function RhcHero({ rows }: { rows: CampaignRow[] | null }) {
  const [dots, setDots] = useState('');
  useEffect(() => {
    if (rows) return;
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? '' : d + '.')), 400);
    return () => clearInterval(t);
  }, [rows]);

  const pooled = rows ? rows.reduce((s, r) => s + r.totalRaised, 0n) : null;
  const backers = rows ? rows.reduce((s, r) => s + Number(r.backerCount), 0) : null;
  const launched = rows ? rows.filter((r) => r.launched).length : null;

  return (
    <section className="flex flex-col items-center text-center pt-6 sm:pt-10 pb-10 sm:pb-14">
      {/* Status chip row — same convention as the SOL hero */}
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
          Mainnet
        </span>
        <span className="opacity-50">·</span>
        <span className="text-[var(--accent-gold)]">Robinhood Chain</span>
        <span className="opacity-50">·</span>
        <span>V0.1.0</span>
      </div>

      {/* Headline */}
      <h1
        className="mt-6 sm:mt-8 max-w-4xl font-mono font-semibold uppercase leading-[1.05] tracking-tight"
        style={{ fontSize: 'clamp(1.75rem, 5vw, 3.5rem)' }}
      >
        Pool the raise.{' '}
        <span className="text-[var(--accent)]">Own the float.</span>{' '}
        Earn the fees.
      </h1>

      {/* Subtext — the protocol hook */}
      <p
        className="mt-5 sm:mt-6 max-w-2xl font-mono uppercase tracking-[0.15em] text-[var(--muted)]"
        style={{ fontSize: 'clamp(0.875rem, 1.4vw, 1rem)' }}
      >
        <span className="text-[var(--accent-gold)]">Ownerless contracts</span> enforce every promise.
        Nobody holds your funds — not even us.
      </p>

      {/* Live stats */}
      <div className="mt-10 sm:mt-14 w-full max-w-4xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-6 sm:gap-x-6">
          <Stat
            value={pooled !== null ? fmtEth(pooled, 2) : dots || '…'}
            unit="ETH"
            label="Pooled"
            color="var(--accent)"
          />
          <Stat
            value={backers !== null ? String(backers) : dots || '…'}
            unit=""
            label="Backers"
            color="var(--success)"
          />
          <Stat
            value={launched !== null ? String(launched) : dots || '…'}
            unit=""
            label="Launched"
            color="var(--accent-gold)"
          />
          <Stat
            value={rows ? String(rows.length) : dots || '…'}
            unit=""
            label="Campaigns"
            color="var(--foreground)"
          />
        </div>
      </div>

      {/* Primary CTA */}
      <div className="mt-12 sm:mt-16">
        <Link href="/rhc/create" className="btn-primary inline-flex items-center gap-2">
          [&gt;] Submit Token
        </Link>
      </div>
    </section>
  );
}
