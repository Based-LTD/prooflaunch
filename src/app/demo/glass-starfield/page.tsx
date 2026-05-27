'use client';

// DEMO A4 — Glass cards over STARFIELD hyperspace.
// Same glass cards as /demo/glass, but bg is the classic Win95-style
// starfield screensaver — 200 stars in 3D space, perspective-projected
// to screen, with hyperspace streak trails. Forward motion (toward the
// viewer) is fundamentally different from pumptracks' lateral drift.
// Gold/amber/cream palette with rare white sparkles, vignette around
// the edges so cards stay the focus.

import Link from 'next/link';
import { StarfieldBackground } from '@/components/demo/StarfieldBackground';

const SAMPLE = [
  { name: 'The Proof Coin', symbol: 'PROOF', status: 'LIVE', backing: '8.4', slots: '24/24', accent: 'success' as const },
  { name: 'Test Meme', symbol: 'TEST', status: 'LIVE', backing: '5.0', slots: '8/8', accent: 'success' as const },
  { name: 'Proving Round', symbol: 'PRVE', status: 'BACKING', backing: '3.2', slots: '12/24', accent: 'accent' as const },
];

export default function GlassStarfieldDemo() {
  return (
    <>
      <StarfieldBackground />

      <style jsx global>{`
        @keyframes amberPulse {
          0%, 100% { box-shadow: 0 0 12px rgba(255, 157, 0, 0.4), 0 0 24px rgba(255, 157, 0, 0.18); }
          50%      { box-shadow: 0 0 18px rgba(255, 157, 0, 0.65), 0 0 36px rgba(255, 157, 0, 0.28); }
        }
        @keyframes dotBlink {
          0%, 50%, 100% { opacity: 1; }
          25%, 75%      { opacity: 0.3; }
        }
        .glass-card {
          background: rgba(10, 10, 10, 0.45);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 157, 0, 0.25);
          transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;
        }
        .glass-card:hover {
          border-color: rgba(255, 157, 0, 0.55);
          box-shadow: 0 0 24px rgba(255, 157, 0, 0.25), 0 0 48px rgba(255, 157, 0, 0.12);
          transform: translateY(-2px);
        }
        .glass-cta {
          background: rgba(255, 157, 0, 0.12);
          border: 1px solid #ff9d00;
          color: #ffb84d;
          text-shadow: 0 0 8px rgba(255, 157, 0, 0.6);
          box-shadow: 0 0 14px rgba(255, 157, 0, 0.35), inset 0 0 12px rgba(255, 157, 0, 0.08);
          transition: all 200ms ease;
        }
        .glass-cta:hover {
          background: rgba(255, 157, 0, 0.22);
          box-shadow: 0 0 24px rgba(255, 157, 0, 0.6), inset 0 0 16px rgba(255, 157, 0, 0.15);
          transform: scale(1.02);
        }
        .glass-cta-secondary {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: rgba(255, 255, 255, 0.85);
          transition: all 200ms ease;
        }
        .glass-cta-secondary:hover {
          border-color: rgba(255, 157, 0, 0.55);
          color: #ffb84d;
        }
        .live-dot { animation: dotBlink 2s ease-in-out infinite; }
        .amber-pulse { animation: amberPulse 3s ease-in-out infinite; }
      `}</style>

      <div className="relative min-h-screen text-white font-mono">
        {/* Demo notice */}
        <div className="absolute top-3 right-3 text-[10px] font-mono uppercase tracking-widest text-[#ff9d00]/70 z-50">
          DEMO_A4 · GLASS + STARFIELD
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-20 space-y-12">
          {/* HERO */}
          <section className="text-center pt-8 sm:pt-16">
            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.35em] text-[#ff9d00]/80 mb-6">
              <span className="w-1.5 h-1.5 bg-[#ff9d00] live-dot" />
              MAINNET · LIVE
            </div>

            <h1
              className="text-4xl sm:text-6xl md:text-7xl font-bold uppercase tracking-tight leading-[0.95] mb-4"
              style={{
                color: '#ffb84d',
                textShadow: '0 0 24px rgba(255, 157, 0, 0.7), 0 0 48px rgba(255, 157, 0, 0.3)',
              }}
            >
              Launch infrastructure
              <br />
              <span style={{ color: '#ff9d00' }}>for token teams.</span>
            </h1>

            <p className="text-base sm:text-lg text-white/75 max-w-2xl mx-auto mt-6 leading-relaxed">
              Build, back, and earn from token launches. Used by serious teams.
              <br />
              Open to backers via the Proving Grounds.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
              <Link
                href="/docs"
                className="glass-cta amber-pulse px-8 py-3 uppercase tracking-[0.2em] text-sm"
              >
                Read the Docs
              </Link>
              <Link
                href="/submit"
                className="glass-cta-secondary px-8 py-3 uppercase tracking-[0.2em] text-sm"
              >
                Launch a Token →
              </Link>
            </div>
          </section>

          {/* METRICS */}
          <section className="grid grid-cols-3 gap-3 sm:gap-5">
            {[
              { label: 'TOTAL BACKED', value: '47.8 SOL', glow: '#ff9d00' },
              { label: 'GENESIS BACKERS', value: '186', glow: '#ffb84d' },
              { label: 'LIVE TOKENS', value: '12', glow: '#00d97e' },
            ].map((m) => (
              <div key={m.label} className="glass-card p-5 sm:p-7">
                <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.25em] text-white/55 mb-2">
                  {m.label}
                </div>
                <div
                  className="text-2xl sm:text-4xl font-bold tracking-tight"
                  style={{ color: m.glow, textShadow: `0 0 16px ${m.glow}66` }}
                >
                  {m.value}
                </div>
              </div>
            ))}
          </section>

          {/* TOKEN CARDS */}
          <section className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs uppercase tracking-[0.35em] text-white/55">
                // PROVING_GROUNDS
              </h2>
              <Link href="#" className="text-[10px] uppercase tracking-[0.25em] text-[#ff9d00]/70 hover:text-[#ffb84d]">
                View all →
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
              {SAMPLE.map((t) => {
                const isLive = t.status === 'LIVE';
                const accentColor = isLive ? '#00d97e' : '#ff9d00';
                return (
                  <div key={t.symbol} className="glass-card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <span
                        className="text-[9px] uppercase tracking-[0.25em] px-2 py-1 border"
                        style={{
                          borderColor: accentColor,
                          color: accentColor,
                          textShadow: `0 0 8px ${accentColor}80`,
                        }}
                      >
                        {t.status}
                      </span>
                      <span className="text-xs text-white/45 tracking-wider">{t.slots}</span>
                    </div>

                    <div className="text-xl font-bold text-white mb-1 truncate">{t.name}</div>
                    <div className="text-sm text-[#ff9d00]/80 mb-5 tracking-wider">${t.symbol}</div>

                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-2xl font-bold"
                        style={{ color: '#ffb84d', textShadow: '0 0 12px rgba(255, 157, 0, 0.4)' }}
                      >
                        {t.backing}
                      </span>
                      <span className="text-xs uppercase tracking-widest text-white/45">SOL backed</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* FOOTER STRIP */}
          <section className="glass-card p-5 flex flex-wrap items-center justify-between gap-3 text-[10px] uppercase tracking-[0.3em] text-white/55">
            <span>SLOTS · BACKERS · LAUNCH</span>
            <span className="text-[#ff9d00]" style={{ textShadow: '0 0 8px rgba(255, 157, 0, 0.6)' }}>
              prooflaunch.fun
            </span>
          </section>
        </div>
      </div>
    </>
  );
}
