'use client';

// DEMO B — Modern tech aesthetic (Linear / Stripe / Vercel lineage).
// Goal: signal "real product, real infrastructure, real company" via
// restraint. No glow, no animation, no neon. Color used sparingly to
// punctuate, not decorate.
//
// Design moves:
//   • Static very-subtle radial gradient bg (no canvas, no movement)
//   • Glass cards but quiet — translucent dark, hairline border, soft shadow
//   • Sans-serif body, mono ONLY for data/numbers (tech-product convention)
//   • Hover: hairline border slightly intensifies + tiny shadow lift
//   • Strong type hierarchy: huge headline, much smaller everything else
//   • Tons of whitespace
// Sample content matches /demo/glass exactly for fair comparison.

import Link from 'next/link';

const SAMPLE = [
  { name: 'The Proof Coin', symbol: 'PROOF', status: 'Live',     backing: '8.4', slots: '24 / 24', up: true },
  { name: 'Test Meme',      symbol: 'TEST',  status: 'Live',     backing: '5.0', slots: '8 / 8',   up: true },
  { name: 'Proving Round',  symbol: 'PRVE',  status: 'Backing',  backing: '3.2', slots: '12 / 24', up: false },
];

export default function TechDemo() {
  return (
    <>
      <style jsx global>{`
        .tech-bg {
          background:
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255, 157, 0, 0.08) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 50% 100%, rgba(255, 157, 0, 0.04) 0%, transparent 60%),
            #0a0a0a;
        }
        .tech-card {
          background: rgba(20, 20, 20, 0.55);
          backdrop-filter: blur(20px) saturate(140%);
          -webkit-backdrop-filter: blur(20px) saturate(140%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          transition: border-color 220ms ease, transform 220ms ease, box-shadow 220ms ease;
        }
        .tech-card:hover {
          border-color: rgba(255, 255, 255, 0.16);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          transform: translateY(-1px);
        }
        .tech-cta-primary {
          background: #ff9d00;
          color: #0a0a0a;
          border-radius: 8px;
          font-weight: 600;
          transition: background 180ms ease, transform 180ms ease;
        }
        .tech-cta-primary:hover {
          background: #ffb84d;
          transform: translateY(-1px);
        }
        .tech-cta-secondary {
          background: transparent;
          color: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 8px;
          font-weight: 500;
          transition: border-color 180ms ease, background 180ms ease;
        }
        .tech-cta-secondary:hover {
          border-color: rgba(255, 255, 255, 0.4);
          background: rgba(255, 255, 255, 0.04);
        }
        .tech-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.25rem 0.625rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 500;
        }
        .tech-pill-live {
          background: rgba(0, 217, 126, 0.1);
          color: #00d97e;
          border: 1px solid rgba(0, 217, 126, 0.25);
        }
        .tech-pill-backing {
          background: rgba(255, 157, 0, 0.1);
          color: #ffb84d;
          border: 1px solid rgba(255, 157, 0, 0.25);
        }
        .mono-num {
          font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;
          font-feature-settings: 'tnum';
        }
      `}</style>

      <div className="tech-bg min-h-screen text-white" style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}>
        {/* Demo notice */}
        <div className="absolute top-3 right-3 text-[10px] font-mono uppercase tracking-widest text-white/40 z-50">
          DEMO_B · TECH
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-20 space-y-20">
          {/* HERO */}
          <section className="pt-16 sm:pt-28">
            <div className="inline-flex items-center gap-2 px-3 py-1 border border-white/10 rounded-full text-xs text-white/70 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00d97e]" />
              Mainnet · Live · v1.0
            </div>

            <h1 className="text-5xl sm:text-7xl md:text-8xl font-semibold tracking-tight leading-[0.95] mb-6">
              Launch infrastructure
              <br />
              <span className="text-white/55">for token teams.</span>
            </h1>

            <p className="text-lg sm:text-xl text-white/65 max-w-2xl leading-relaxed">
              Build, back, and earn from token launches. Used by serious teams.
              Open to backers via the Proving Grounds.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mt-10">
              <Link href="/docs" className="tech-cta-primary px-6 py-3 inline-flex items-center justify-center text-sm">
                Read the docs →
              </Link>
              <Link href="/submit" className="tech-cta-secondary px-6 py-3 inline-flex items-center justify-center text-sm">
                Launch a token
              </Link>
            </div>
          </section>

          {/* METRICS */}
          <section className="grid grid-cols-3 gap-3 sm:gap-4">
            {[
              { label: 'Total backed',     value: '47.8',  unit: 'SOL' },
              { label: 'Genesis backers',  value: '186',   unit: '' },
              { label: 'Live tokens',      value: '12',    unit: '' },
            ].map((m) => (
              <div key={m.label} className="tech-card p-6 sm:p-8">
                <div className="text-xs text-white/45 mb-3">{m.label}</div>
                <div className="flex items-baseline gap-2">
                  <span className="mono-num text-3xl sm:text-5xl font-semibold tracking-tight text-white">
                    {m.value}
                  </span>
                  {m.unit && <span className="text-sm text-white/40">{m.unit}</span>}
                </div>
              </div>
            ))}
          </section>

          {/* TOKEN CARDS */}
          <section>
            <div className="flex items-end justify-between mb-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-1">Proving Grounds</h2>
                <p className="text-sm text-white/55">Live token launches from teams shipping right now.</p>
              </div>
              <Link href="#" className="text-sm text-white/65 hover:text-white">
                View all →
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
              {SAMPLE.map((t) => (
                <div key={t.symbol} className="tech-card p-6">
                  <div className="flex items-center justify-between mb-5">
                    <span className={`tech-pill ${t.status === 'Live' ? 'tech-pill-live' : 'tech-pill-backing'}`}>
                      {t.status === 'Live' && <span className="w-1.5 h-1.5 rounded-full bg-[#00d97e]" />}
                      {t.status}
                    </span>
                    <span className="mono-num text-xs text-white/45">{t.slots}</span>
                  </div>

                  <div className="text-lg font-semibold text-white mb-1 truncate">{t.name}</div>
                  <div className="mono-num text-sm text-white/55 mb-6">${t.symbol}</div>

                  <div className="flex items-baseline gap-2 pt-4 border-t border-white/8">
                    <span className="mono-num text-2xl font-semibold text-white">{t.backing}</span>
                    <span className="text-xs text-white/45">SOL backed</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* FOOTER */}
          <section className="pt-8 border-t border-white/8 flex flex-wrap items-center justify-between gap-3 text-sm text-white/45">
            <span>© 2026 Proof Launch</span>
            <span>prooflaunch.fun</span>
          </section>
        </div>
      </div>
    </>
  );
}
