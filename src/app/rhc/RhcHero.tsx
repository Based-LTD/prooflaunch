'use client';

// The RHC hero — the SOL LandingHero's chip row, glow headline, stat
// tiles and CTA, with the flywheel as the content. The headline is one
// short line (no typewriter); the four tiles are the burn, read from the
// chain through /api/rhc/flywheel; zeros before $PLAUNCH launches.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PROOF_BURNER_LIVE, V8_LIVE } from '@/lib/rhc';
import type { FlywheelFeed } from '../api/rhc/flywheel/route';

const tok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export function RhcHero() {
  const [f, setF] = useState<FlywheelFeed | null>(null);
  useEffect(() => {
    if (!PROOF_BURNER_LIVE) return;
    let live = true;
    const load = async () => { try { const r = await fetch('/api/rhc/flywheel', { cache: 'no-store' }); const j = await r.json(); if (live && j.live && j.dead) setF(j); } catch { /* keep last */ } };
    void load(); const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const n = (s?: string) => (s ? Number(s) / 1e18 : 0);
  // ETH tiles count every burn of $PLAUNCH — the v8 burner AND the token's
  // own campaign coin-burn leg — so they agree with the dead-address count.
  const dead = n(f?.dead), supply = n(f?.supply), spent = n(f?.spent) + n(f?.coinBurnSpent), pending = n(f?.pending) + n(f?.coinBurnOwed);
  const pct = supply > 0 ? (dead / supply) * 100 : 0;
  const ready = PROOF_BURNER_LIVE && !!f;

  return (
    <section className="w-full flex flex-col items-center text-center py-10 sm:py-16 px-4">
      {/* MAINNET · ROBINHOOD CHAIN · v0.3.0 — system chip */}
      <div className="inline-flex items-center gap-3 text-[10px] sm:text-xs font-mono uppercase tracking-[0.3em] text-[var(--muted)]">
        <span className="w-1.5 h-1.5 bg-[var(--success)] inline-block pulse-glow" aria-hidden />
        <span>MAINNET</span>
        <span className="opacity-50">·</span>
        <span className="text-[var(--accent-gold)]">ROBINHOOD CHAIN</span>
        <span className="opacity-50">·</span>
        <span>V0.3.0</span>
      </div>

      {/* Headline — one line, the breathing glow */}
      <h1 className="mt-6 sm:mt-8 max-w-4xl font-mono font-semibold uppercase leading-[1.05] tracking-tight hero-headline-glow"
        style={{ fontSize: 'clamp(1.75rem, 5vw, 3.5rem)' }}>
        <span style={{ color: 'var(--foreground)' }}>Pooled </span>
        <span style={{ color: 'var(--accent)' }}>token launches.</span>
      </h1>
      <p className="mt-5 sm:mt-6 max-w-2xl font-mono uppercase tracking-[0.15em] text-[var(--muted)]"
         style={{ fontSize: 'clamp(0.875rem, 1.4vw, 1rem)' }}>
        {V8_LIVE ? 'Every trade burns' : 'Built so every trade burns'} <span className="text-[var(--accent-gold)]">$PLAUNCH</span>.
      </p>

      {/* What this is, in plain words. The first thing a stranger reads. */}
      <p className="mt-6 max-w-2xl text-sm sm:text-base leading-relaxed text-[var(--foreground)]/85">
        ProofLaunch is a launchpad where a group funds a token together. Seats fill, then one transaction
        creates the token and buys it for every seat at the same price. From then on, every trade of that
        token pays its backers a share of the fees, in ETH or tokenized stock, for as long as it trades.
        The contracts have no owner, so nobody can change the deal.
      </p>

      {/* The same thing as a picture: three steps, one line. */}
      <div className="mt-8 w-full max-w-3xl grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-0 text-left">
        {[
          ['1', 'Seats fill', 'Backers deposit ETH. Anyone can withdraw until launch.'],
          ['2', 'One transaction launches', 'Token created and bought for every seat at once. Same block, same price.'],
          ['3', 'Every trade pays backers', 'Trading fees flow to the seat holders. Claim any time, no lockup on the claim.'],
        ].map(([n, title, desc], i) => (
          <div key={n} className={`relative border border-[var(--border)] bg-[var(--card)] px-4 py-3 ${i > 0 ? 'sm:border-l-0' : ''}`}>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[var(--accent)] text-lg leading-none">{n}</span>
              <span className="font-mono uppercase tracking-widest text-[11px] text-[var(--foreground)]">{title}</span>
            </div>
            <p className="mt-1.5 text-xs text-[var(--muted)] leading-snug">{desc}</p>
            {i < 2 && <span aria-hidden className="hidden sm:block absolute -right-2 top-1/2 -translate-y-1/2 text-[var(--accent)] text-sm z-10 bg-[var(--card)]">→</span>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] font-mono uppercase tracking-widest text-[var(--muted)]">
        <Link href="/rhc/docs" className="text-[var(--accent)] hover:text-[var(--accent-hover)]">How it works →</Link>
        <span className="opacity-50 mx-2">·</span>
        <Link href="/rhc/flywheel" className="text-[var(--accent)] hover:text-[var(--accent-hover)]">The flywheel →</Link>
      </p>

      {/* The flywheel, in the hero's stat tiles */}
      <div className="mt-10 sm:mt-14 w-full max-w-4xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-6 sm:gap-x-6">
          <Stat value={ready ? tok(dead) : '0'} unit="$PLAUNCH" label="Burned" color="var(--accent-gold)" />
          <Stat value={ready ? pct.toFixed(3) : '0.000'} unit="%" label="Of supply gone" color="var(--accent-gold)" />
          <Stat value={ready ? spent.toFixed(3) : '0'} unit="ETH" label="Burned into $PLAUNCH" color="var(--accent)" />
          <Stat value={ready ? pending.toFixed(3) : '0'} unit="ETH" label="Waiting to burn" color="var(--success)" />
        </div>
        <div className="mt-4 text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--muted)]">
          <span className="text-[var(--accent-gold)]">30%</span> of every launch&apos;s creator tax{!V8_LIVE && ', from the flywheel factory onward'} buys and burns $PLAUNCH
        </div>
      </div>

      {/* Primary CTA */}
      <div className="mt-12 sm:mt-16">
        <Link href="/rhc/create" className="btn-primary inline-flex items-center gap-2">
          [&gt;] Submit Token
        </Link>
      </div>

      <style jsx>{`
        .hero-headline-glow { animation: headline-pulse 5s ease-in-out infinite; }
        @keyframes headline-pulse {
          0%, 100% { text-shadow: 0 0 14px rgba(255, 157, 0, 0.55), 0 0 32px rgba(255, 157, 0, 0.30); }
          50% { text-shadow: 0 0 22px rgba(255, 157, 0, 0.80), 0 0 50px rgba(255, 157, 0, 0.45); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-headline-glow { animation: none; text-shadow: 0 0 18px rgba(255, 157, 0, 0.65), 0 0 38px rgba(255, 157, 0, 0.35); }
        }
      `}</style>
    </section>
  );
}

// The SOL hero's Stat tile, verbatim.
function Stat({ value, unit, label, color }: { value: string; unit?: string; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="font-mono font-semibold leading-none tabular-nums"
        style={{
          color,
          fontSize: 'clamp(1.5rem, 3.5vw, 2.5rem)',
          textShadow: `0 0 20px ${color.replace('var(', 'rgba(').replace(')', ', 0.15)')}`,
        }}
      >
        {value}
        {unit && (
          <span className="text-[var(--muted)] ml-1.5" style={{ fontSize: 'clamp(0.7rem, 1.2vw, 0.875rem)' }}>
            {unit}
          </span>
        )}
      </div>
      <div className="mt-2 text-[10px] sm:text-xs font-mono uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}
