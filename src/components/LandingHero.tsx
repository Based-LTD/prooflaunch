'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Full-viewport landing hero — the new front door.
 *
 * Layout: brand mark up top (small line), then huge "PROOF LAUNCH"
 * centered, then the 5-stat live ticker, then the scroll/CTA cluster
 * at the bottom. Everything is text-only (no glass cards) so the
 * video background reads at full glory — the cards-as-frosted-glass
 * pattern lives in the proving grounds section below.
 *
 * The CTA + chevron both smooth-scroll to #proving-grounds. The two
 * affordances exist because some users won't intuit scrolling on a
 * full-bleed hero; the button reassures, the chevron animates.
 *
 * Stats come from /api/landing/stats (single round-trip, all five at
 * once). Each metric renders even if others 0-out so a partial outage
 * doesn't leave the hero looking broken.
 */

interface LandingStats {
  burnedProof: number;
  distributedSol: number;
  backersCount: number;
  launchedCount: number;
  // marketCapUsd is still returned by the API but unused here —
  // we dropped to 4 stats for visual rhythm. Leaving the API field
  // in place avoids a route change for this UI cleanup; reinstate
  // a 5th tile if a future ticker variant wants it.
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

function scrollToBoard() {
  document.getElementById('proving-grounds')?.scrollIntoView({ behavior: 'smooth' });
}

export function LandingHero() {
  const [stats, setStats] = useState<LandingStats | null>(null);
  const [gatedCounts, setGatedCounts] = useState<{ stealth: number; spectator: number } | null>(null);

  useEffect(() => {
    // Fire-and-forget: if it fails, hero shows "—" placeholders rather than spinners.
    fetch('/api/landing/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStats(d))
      .catch(() => {/* silent */});

    // Gated launch counts — powers the "stealth in progress" widget.
    // Silent fail-soft: widget just doesn't render if API is down.
    fetch('/api/landing/visibility-counts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setGatedCounts(d))
      .catch(() => {/* silent */});
  }, []);

  return (
    <section
      // Full viewport minus the 24px top-bar + 56px navbar (= 80px chrome).
      // Using min-h-[calc(100vh-80px)] instead of h-screen lets short
      // viewports still scroll naturally if the ticker wraps.
      //
      // Full-bleed escape: parent <main> caps at max-w-7xl (1280px). On
      // wide desktops the wordmark scales to ~11rem and its full width
      // (≈1267px) exceeds the padded container, clipping the right edge.
      // The w-screen + left-1/2 + -translate-x-1/2 trio breaks the
      // section out of the max-width parent so it spans the actual
      // viewport — no clipping at any breakpoint.
      //
      // overflow-x-clip: the wordmark's blurred halo (.hero-glow) extends
      // inset:-25% past the text box. On narrow viewports that spill can
      // trigger horizontal page scroll. Clipping x-only here keeps the
      // halo visible vertically while preventing the side-scroll bug.
      className="relative left-1/2 -translate-x-1/2 w-screen min-h-[calc(100vh-80px)] flex flex-col items-center justify-center px-4 sm:px-6 py-12 overflow-x-clip"
    >
      {/* SYSTEM line — anchors the brand mark in the same monospace
          chrome the navbar uses. Tiny, deliberate. */}
      <div className="text-[10px] sm:text-xs font-mono uppercase tracking-[0.4em] text-[var(--muted)] mb-6 sm:mb-8 flex items-center gap-3">
        <span className="w-1.5 h-1.5 bg-[var(--success)] inline-block pulse-glow" aria-hidden />
        <span>MAINNET · LIVE</span>
        <span className="opacity-50">·</span>
        <span>v0.2.0</span>
      </div>

      {/* PROOF / LAUNCH wordmark — display-scale. Same font + casing
          as the navbar brand mark, ~6-8x larger.
          • -webkit-text-stroke paints a thin black edge along each
            letterform — etches the wordmark out of the bg so the
            amber glow has a hard line to bleed around (neon-signage
            feel) rather than washing into the cream fill.
          • Static text-shadow provides the close-in halo (no animation
            → no per-frame paint).
          • The pulsing wider halo lives on the absolute `.hero-glow`
            sibling behind the text. Animating opacity + transform on a
            pre-blurred radial-gradient stays on the GPU compositor —
            zero paint cost per frame — so the video next to it doesn't
            judder. Animating text-shadow directly DOES force a repaint
            of the whole text region every frame; that's what caused
            the visible video stutter when this pulse first shipped. */}
      <div className="hero-wordmark-wrap relative inline-block">
        <span className="hero-glow" aria-hidden />
        <h1
          className="relative font-mono font-semibold uppercase tracking-tight leading-[0.95] text-center"
          style={{
            // Sized to fit "Proof/Launch" (12 chars × ~0.6em width per
            // char in IBM Plex Mono semibold) inside the section's
            // px-4 padding on phones as narrow as 320px. Old formula
            // (14vw, min 3.5rem) overflowed on 390-430px phones,
            // pushing the slash and final "h" off the viewport edge.
            // Desktop cap (11rem) unchanged — same max display size.
            fontSize: 'clamp(2.25rem, 11.5vw, 11rem)',
            WebkitTextStroke: '1.5px #0a0a0a',
            textShadow: '0 0 18px rgba(255, 157, 0, 0.55), 0 0 40px rgba(255, 157, 0, 0.25)',
          }}
        >
          <span className="text-[var(--foreground)]">Proof</span>
          <span className="text-[var(--accent)]">/</span>
          <span className="text-[var(--foreground)]">Launch</span>
        </h1>
      </div>

      {/* One-liner subtitle — same copy as the action layer in the
          proving grounds hero, brand-anchored. */}
      <p className="mt-4 sm:mt-5 font-mono uppercase tracking-[0.2em] text-sm sm:text-base text-center">
        <span className="text-[var(--accent)]">Prove</span>
        <span className="text-[var(--muted)]">.</span>{' '}
        <span className="text-[var(--accent-gold)]">Launch</span>
        <span className="text-[var(--muted)]">.</span>{' '}
        <span className="text-[var(--success)]">Earn</span>
        <span className="text-[var(--muted)]">.</span>
      </p>

      {/* Live ticker — 4 stats. Clean 2x2 on mobile, 4-up on desktop.
          Big numbers, tiny labels — readout aesthetic. No cards: text
          floats over the video for maximum "demo reel" energy. */}
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

      {/* Internal/spectator widget — appears only when gated launches
          are actively in progress. Aggregate-only, no identifying info
          per the PROOF transparency-on-its-own-timeline framing. */}
      {gatedCounts && (gatedCounts.stealth > 0 || gatedCounts.spectator > 0) && (
        <div className="mt-8 sm:mt-10 flex flex-wrap items-center justify-center gap-3 text-[10px] sm:text-xs font-mono uppercase tracking-[0.2em] text-[var(--muted)]">
          {gatedCounts.stealth > 0 && (
            <span className="inline-flex items-center gap-2 border border-[var(--accent-gold)]/40 bg-[var(--accent-gold)]/5 px-3 py-1.5">
              <span className="w-1.5 h-1.5 bg-[var(--accent-gold)] inline-block pulse-glow" aria-hidden />
              <span className="text-[var(--accent-gold)]">{gatedCounts.stealth}</span>
              <span>internal launch{gatedCounts.stealth === 1 ? '' : 'es'} in progress</span>
            </span>
          )}
          {gatedCounts.spectator > 0 && (
            <span className="inline-flex items-center gap-2 border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-3 py-1.5">
              <span className="w-1.5 h-1.5 bg-[var(--accent)] inline-block pulse-glow" aria-hidden />
              <span className="text-[var(--accent)]">{gatedCounts.spectator}</span>
              <span>invite-only launch{gatedCounts.spectator === 1 ? '' : 'es'} live</span>
            </span>
          )}
        </div>
      )}

      {/* CTA + scroll affordance. Two affordances on purpose: the
          button labels the action, the chevron animates the gesture.
          Both go to the same anchor. */}
      <div className="mt-12 sm:mt-16 flex flex-col items-center gap-4">
        <button
          onClick={scrollToBoard}
          className="btn-primary inline-flex items-center gap-2 group"
        >
          Enter Proving Grounds
          <ChevronDown className="w-4 h-4 transition-transform group-hover:translate-y-0.5" />
        </button>
        <button
          onClick={scrollToBoard}
          aria-label="Scroll to proving grounds"
          className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors animate-bounce-slow"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
      </div>

      {/* Custom slower bounce — Tailwind's default is too fast/jittery for
          a hero affordance. 2s feels intentional, not impatient.

          hero-pulse-glow: subtle 4s breathe on the wordmark's amber halo.
          Three text-shadow layers (close + mid + far) give the glow real
          depth instead of a single flat ring. The pulse range is tight
          (45% → 70% alpha at peak) so it reads as "alive" not "blinking". */}
      <style jsx>{`
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(8px); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 2s ease-in-out infinite;
        }

        /* Wider pulsing amber halo. The blur (and gradient) are
           rasterized ONCE when the layer is created; the animation
           only changes opacity + transform, both of which are
           composited on the GPU without triggering paint. Result: a
           pulsing glow that doesn't compete with the video decoder. */
        .hero-glow {
          position: absolute;
          /* Spill the glow well past the text box so the blur edge
             feathers out instead of clipping at the wrap boundary. */
          inset: -25%;
          z-index: -1;
          pointer-events: none;
          background: radial-gradient(
            ellipse at center,
            rgba(255, 157, 0, 0.55) 0%,
            rgba(255, 157, 0, 0.18) 40%,
            rgba(255, 157, 0, 0) 70%
          );
          filter: blur(28px);
          will-change: opacity, transform;
          animation: hero-glow-pulse 4s ease-in-out infinite;
        }
        @keyframes hero-glow-pulse {
          0%, 100% { opacity: 0.65; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.06); }
        }
        /* Honor reduced-motion: hold at the brighter steady state. */
        @media (prefers-reduced-motion: reduce) {
          .hero-glow {
            animation: none;
            opacity: 0.85;
            transform: scale(1.03);
          }
        }
      `}</style>
    </section>
  );
}

// Single stat block. Value gets the bold display size; unit + label sit
// underneath in mono caps so each row reads as a Bloomberg-style readout.
function Stat({
  value,
  unit,
  label,
  color,
  spanMobile,
}: {
  value: string;
  unit?: string;
  label: string;
  color: string;
  spanMobile?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center text-center ${
        spanMobile ? 'col-span-2 sm:col-span-1' : ''
      }`}
    >
      <div
        className="font-mono font-semibold leading-none tabular-nums"
        style={{
          color,
          fontSize: 'clamp(1.75rem, 4vw, 2.75rem)',
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
