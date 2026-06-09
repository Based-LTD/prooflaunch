'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Landing hero — text-only, no wordmark, no video.
 *
 * Stack (top → bottom):
 *   1. MAINNET · LIVE · v0.2.0 status chip
 *   2. Headline — types out terminal-style on each mount (2.8s ease-out),
 *      then settles + a slow amber glow breathes underneath
 *   3. Subtext — the $PROOF earnings hook
 *   4. Live stats (4 tiles)
 *   5. SUBMIT TOKEN CTA
 */

interface LandingStats {
  burnedProof: number;
  distributedSol: number;
  backersCount: number;
  launchedCount: number;
}

const fmtCompact = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  if (n >= 100) return Math.round(n).toString();
  return n.toFixed(2);
};

const fmtSol = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
};

const fmtInt = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return '—';
  return Math.round(n).toLocaleString();
};

const HEADLINE_PARTS = [
  { text: 'Shared ', color: 'var(--foreground)' },
  { text: 'Token', color: 'var(--accent)' },
  { text: ' Launches. Equal entry. Shared trading fees.', color: 'var(--foreground)' },
] as const;
const HEADLINE_FULL = HEADLINE_PARTS.map((p) => p.text).join('');
const TYPE_DURATION_MS = 2800;

export function LandingHero() {
  const [stats, setStats] = useState<LandingStats | null>(null);
  const [typedCount, setTypedCount] = useState<number>(0);

  useEffect(() => {
    fetch('/api/landing/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStats(d))
      .catch(() => {/* silent — placeholders render */});
  }, []);

  // Typewriter — runs on every mount (incl. client-side nav back to /).
  // Cleanup cancels the raf so React's Strict Mode double-invoke can't
  // leak a stuck animation. Skips entirely under prefers-reduced-motion.
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
      // Ease-out so the tail slows like a typist finishing a thought.
      const eased = 1 - Math.pow(1 - progress, 2);
      const n = Math.floor(eased * total);
      setTypedCount(n);
      if (progress < 1) raf = requestAnimationFrame(tick);
      else setTypedCount(total);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const typingDone = typedCount >= HEADLINE_FULL.length;

  // Build TWO halves per part: typed-so-far (colored) and not-yet-typed
  // (transparent). The transparent half holds layout space so nothing
  // below jumps as the headline reveals. The caret sits at the boundary.
  type PartRender = { typed: string; untyped: string; color: string; partIdx: number };
  const parts: PartRender[] = [];
  let consumed = 0;
  for (let i = 0; i < HEADLINE_PARTS.length; i++) {
    const part = HEADLINE_PARTS[i];
    const remaining = Math.max(0, typedCount - consumed);
    const typed = part.text.slice(0, remaining);
    const untyped = part.text.slice(remaining);
    parts.push({ typed, untyped, color: part.color, partIdx: i });
    consumed += part.text.length;
  }
  // The caret goes after the LAST part that has typed chars (or the
  // very first part if nothing typed yet).
  let caretAfter = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].typed.length > 0) { caretAfter = i; break; }
  }

  return (
    <section className="w-full flex flex-col items-center text-center py-10 sm:py-16 px-4">
      {/* MAINNET · LIVE · v0.2.0 — system chip */}
      <div className="inline-flex items-center gap-3 text-[10px] sm:text-xs font-mono uppercase tracking-[0.3em] text-[var(--muted)]">
        <span className="w-1.5 h-1.5 bg-[var(--success)] inline-block pulse-glow" aria-hidden />
        <span>MAINNET</span>
        <span className="opacity-50">·</span>
        <span>LIVE</span>
        <span className="opacity-50">·</span>
        <span>V0.2.0</span>
      </div>

      {/* Headline — typewriter on first load, then static + breathing
          glow. Layout-stable: untyped chars render with transparent
          color so the full headline always occupies its final height +
          width. Caret sits at the typed/untyped boundary. */}
      <h1
        aria-label={HEADLINE_FULL}
        className={`mt-6 sm:mt-8 max-w-4xl font-mono font-semibold uppercase leading-[1.05] tracking-tight ${typingDone ? 'hero-headline-glow' : ''}`}
        style={{ fontSize: 'clamp(1.75rem, 5vw, 3.5rem)' }}
      >
        {parts.map((p, i) => (
          <span key={i}>
            {p.typed && <span style={{ color: p.color }}>{p.typed}</span>}
            {/* Caret sits between the typed and untyped portions of the
                last part that has typed chars. */}
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
        <span className="text-[var(--accent-gold)]">$PROOF</span> is the access token for the protocol.
      </p>

      {/* Live stats */}
      <div className="mt-10 sm:mt-14 w-full max-w-4xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-6 sm:gap-x-6">
          <Stat
            value={stats ? fmtCompact(stats.burnedProof) : '…'}
            unit="$PROOF"
            label="Burned"
            color="var(--status-down)"
          />
          <Stat
            value={stats ? fmtSol(stats.distributedSol) : '…'}
            unit="SOL"
            label="Distributed"
            color="var(--success)"
          />
          <Stat
            value={stats ? fmtInt(stats.backersCount) : '…'}
            unit=""
            label="Backers"
            color="var(--accent)"
          />
          <Stat
            value={stats ? fmtInt(stats.launchedCount) : '…'}
            unit=""
            label="Launched"
            color="var(--accent-gold)"
          />
        </div>
      </div>

      {/* Primary CTA */}
      <div className="mt-12 sm:mt-16">
        <Link href="/submit" className="btn-primary inline-flex items-center gap-2">
          [&gt;] Submit Token
        </Link>
      </div>

      <style jsx>{`
        /* Caret blink during typing. */
        .hero-caret {
          display: inline-block;
          margin-left: 0.05em;
          animation: caret-blink 1s steps(1) infinite;
        }
        @keyframes caret-blink {
          0%, 50%   { opacity: 1; }
          51%, 100% { opacity: 0; }
        }

        /* Amber breathing glow on the finished headline. Two stacked
           shadows (close + wide) give the glow real depth, matching the
           old wordmark treatment scaled down for body-size text. */
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

function Stat({
  value,
  unit,
  label,
  color,
}: {
  value: string;
  unit?: string;
  label: string;
  color: string;
}) {
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
          <span
            className="text-[var(--muted)] ml-1.5"
            style={{ fontSize: 'clamp(0.7rem, 1.2vw, 0.875rem)' }}
          >
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
