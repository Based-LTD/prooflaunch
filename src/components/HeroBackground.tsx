'use client';

import { ParticleField, type ParticlePreset } from './ParticleField';

/**
 * Three lightweight backlight variants. All CSS, no canvas, no video.
 *
 *   aurora    — blurred amber/gold radials + 6s gentle pulse on one.
 *               GPU-composited (opacity + transform). Premium, alive.
 *   spotlight — single soft radial centered on the hero region.
 *               Targeted, smallest visual surface, doesn't reach board.
 *   mesh      — same gradients as aurora but completely static + a
 *               SVG noise overlay for film-grain texture. Quietest.
 *
 * Mounted fixed inset-0 z-[-1] so it sits behind all content without
 * affecting layout. pointer-events:none so it never intercepts clicks.
 */

export type BgVariant =
  | 'none'
  | 'aurora'
  | 'spotlight'
  | 'mesh'
  | 'p-default'
  | 'p-dense'
  | 'p-xdense'
  | 'p-sparse'
  | 'p-nebula'
  | 'p-swirl'
  | 'p-xdense-swirl';

const PARTICLE_VARIANTS: Record<string, ParticlePreset> = {
  'p-default':       'default',
  'p-dense':         'dense',
  'p-xdense':        'extra-dense',
  'p-sparse':        'sparse',
  'p-nebula':        'nebula',
  'p-swirl':         'swirl',
  'p-xdense-swirl':  'extra-dense-swirl',
};

export function HeroBackground({ variant }: { variant: BgVariant }) {
  if (variant === 'none') return null;

  if (variant in PARTICLE_VARIANTS) {
    return <ParticleField preset={PARTICLE_VARIANTS[variant]} />;
  }

  if (variant === 'aurora') {
    return (
      <div aria-hidden className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-[var(--background)]">
        {/* Top-left amber */}
        <div
          className="absolute rounded-full"
          style={{
            top: '-15%', left: '-10%', width: '60vw', height: '60vw',
            background: 'radial-gradient(closest-side, rgba(255,157,0,0.28), rgba(255,157,0,0) 70%)',
            filter: 'blur(60px)',
            animation: 'bg-pulse 6s ease-in-out infinite',
            willChange: 'opacity, transform',
          }}
        />
        {/* Bottom-right gold */}
        <div
          className="absolute rounded-full"
          style={{
            bottom: '-15%', right: '-10%', width: '55vw', height: '55vw',
            background: 'radial-gradient(closest-side, rgba(255,200,80,0.18), rgba(255,200,80,0) 70%)',
            filter: 'blur(80px)',
          }}
        />
        {/* Center deep amber, very subtle */}
        <div
          className="absolute rounded-full left-1/2 top-1/3 -translate-x-1/2"
          style={{
            width: '70vw', height: '40vw',
            background: 'radial-gradient(ellipse at center, rgba(255,120,0,0.10), rgba(255,120,0,0) 70%)',
            filter: 'blur(70px)',
          }}
        />
        <style jsx>{`
          @keyframes bg-pulse {
            0%, 100% { opacity: 0.85; transform: scale(1); }
            50%      { opacity: 1;    transform: scale(1.06); }
          }
          @media (prefers-reduced-motion: reduce) {
            div[style*="animation"] { animation: none !important; }
          }
        `}</style>
      </div>
    );
  }

  if (variant === 'spotlight') {
    return (
      <div aria-hidden className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-[var(--background)]">
        {/* Single soft radial centered on the hero region (~30% from top) */}
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            top: '5%', width: '80vw', height: '60vh', maxHeight: '600px',
            background: 'radial-gradient(ellipse at center, rgba(255,157,0,0.22), rgba(255,157,0,0.08) 40%, rgba(255,157,0,0) 70%)',
            filter: 'blur(50px)',
          }}
        />
      </div>
    );
  }

  // mesh — static aurora + film grain
  return (
    <div aria-hidden className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-[var(--background)]">
      <div
        className="absolute rounded-full"
        style={{
          top: '-15%', left: '-10%', width: '60vw', height: '60vw',
          background: 'radial-gradient(closest-side, rgba(255,157,0,0.22), rgba(255,157,0,0) 70%)',
          filter: 'blur(70px)',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          bottom: '-15%', right: '-10%', width: '55vw', height: '55vw',
          background: 'radial-gradient(closest-side, rgba(255,200,80,0.18), rgba(255,200,80,0) 70%)',
          filter: 'blur(80px)',
        }}
      />
      {/* Film grain — inline SVG noise, tiled, very low opacity */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.12,
          mixBlendMode: 'overlay',
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
          backgroundSize: '200px 200px',
        }}
      />
    </div>
  );
}
