'use client';

// The RHC hero — the SOL LandingHero verbatim: same chip row, same
// typewriter headline + amber breathing glow, same stat tiles, same CTA.
// Only the words and the data source differ (stats read straight from
// the chain — no backend to lie, no counter to row-cap).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CampaignRow, fmtEth } from '@/lib/rhc';

const HEADLINE_PARTS = [
  { text: 'Pool the raise. ', color: 'var(--foreground)' },
  { text: 'Own the float.', color: 'var(--accent)' },
  { text: ' Earn the fees.', color: 'var(--foreground)' },
] as const;
const HEADLINE_FULL = HEADLINE_PARTS.map((p) => p.text).join('');
const TYPE_DURATION_MS = 2800;

export function RhcHero({ rows }: { rows: CampaignRow[] | null }) {
  const [typedCount, setTypedCount] = useState<number>(0);

  // Typewriter — identical mechanics to the SOL hero (ease-out raf,
  // reduced-motion skip, Strict Mode-safe cleanup).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTypedCount(HEADLINE_FULL.length);
      return;
    }
    const total = HEADLINE_FULL.length;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / TYPE_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 2);
      setTypedCount(Math.floor(eased * total));
      if (progress < 1) raf = requestAnimationFrame(tick);
      else setTypedCount(total);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const typingDone = typedCount >= HEADLINE_FULL.length;

  type PartRender = { typed: string; untyped: string; color: string };
  const parts: PartRender[] = [];
  let consumed = 0;
  for (const part of HEADLINE_PARTS) {
    const remaining = Math.max(0, typedCount - consumed);
    parts.push({ typed: part.text.slice(0, remaining), untyped: part.text.slice(remaining), color: part.color });
    consumed += part.text.length;
  }
  let caretAfter = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].typed.length > 0) { caretAfter = i; break; }
  }

  const pooled = rows ? rows.reduce((s, r) => s + r.totalRaised, 0n) : null;
  const backers = rows ? rows.reduce((s, r) => s + Number(r.backerCount), 0) : null;
  const launched = rows ? rows.filter((r) => r.launched).length : null;

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

      {/* Headline — typewriter, then static + breathing glow. Untyped
          chars render transparent so layout never jumps. */}
      <h1
        aria-label={HEADLINE_FULL}
        className={`mt-6 sm:mt-8 max-w-4xl font-mono font-semibold uppercase leading-[1.05] tracking-tight ${typingDone ? 'hero-headline-glow' : ''}`}
        style={{ fontSize: 'clamp(1.75rem, 5vw, 3.5rem)' }}
      >
        {parts.map((p, i) => (
          <span key={i}>
            {p.typed && <span style={{ color: p.color }}>{p.typed}</span>}
            {!typingDone && i === caretAfter && (
              <span aria-hidden className="hero-caret" style={{ color: 'var(--accent)' }}>▌</span>
            )}
            {p.untyped && <span style={{ color: 'transparent' }} aria-hidden>{p.untyped}</span>}
          </span>
        ))}
      </h1>

      {/* Subtext — the protocol hook */}
      <p className="mt-5 sm:mt-6 max-w-2xl font-mono uppercase tracking-[0.15em] text-[var(--muted)]"
         style={{ fontSize: 'clamp(0.875rem, 1.4vw, 1rem)' }}>
        <span className="text-[var(--accent-gold)]">Ownerless contracts</span> enforce every promise.
      </p>

      {/* Live stats */}
      <div className="mt-10 sm:mt-14 w-full max-w-4xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-6 sm:gap-x-6">
          <Stat value={pooled !== null ? fmtEth(pooled, 2) : '…'} unit="ETH" label="Pooled" color="var(--accent)" />
          <Stat value={backers !== null ? String(backers) : '…'} unit="" label="Backers" color="var(--success)" />
          <Stat value={launched !== null ? String(launched) : '…'} unit="" label="Launched" color="var(--accent-gold)" />
          <Stat value={rows ? String(rows.length) : '…'} unit="" label="Campaigns" color="var(--foreground)" />
        </div>
      </div>

      {/* Primary CTA */}
      <div className="mt-12 sm:mt-16">
        <Link href="/rhc/create" className="btn-primary inline-flex items-center gap-2">
          [&gt;] Submit Token
        </Link>
      </div>

      <style jsx>{`
        .hero-caret {
          display: inline-block;
          margin-left: 0.05em;
          animation: caret-blink 1s steps(1) infinite;
        }
        @keyframes caret-blink {
          0%, 50%   { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .hero-headline-glow {
          animation: headline-pulse 5s ease-in-out infinite;
        }
        @keyframes headline-pulse {
          0%, 100% {
            text-shadow:
              0 0 14px rgba(255, 157, 0, 0.55),
              0 0 32px rgba(255, 157, 0, 0.30);
          }
          50% {
            text-shadow:
              0 0 22px rgba(255, 157, 0, 0.80),
              0 0 50px rgba(255, 157, 0, 0.45);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-caret, .hero-headline-glow { animation: none; }
          .hero-headline-glow {
            text-shadow:
              0 0 18px rgba(255, 157, 0, 0.65),
              0 0 38px rgba(255, 157, 0, 0.35);
          }
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
