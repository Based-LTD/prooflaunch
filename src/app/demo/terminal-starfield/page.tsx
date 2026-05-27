'use client';

// DEMO A5 — Terminal cards + STARFIELD + glass hover effects.
// Blend of the existing site's terminal voice and the alive feeling
// from the glass demos. Cards keep their signature shape (square
// corners, // LABEL header strips, bordered pill statuses, mono
// type, [>] bracket buttons) BUT:
//   • Become translucent so the starfield shows through
//   • Get backdrop-blur for proper glass refraction
//   • Hover lights the border amber, adds soft glow, lifts 1-2px
//   • Headline gets a subtle amber text-shadow (not full neon)
// The intent: existing brand recognition stays intact, page comes
// alive without losing its engineering voice.

import Link from 'next/link';
import { StarfieldBackground } from '@/components/demo/StarfieldBackground';

const SAMPLE = [
  { name: 'The Proof Coin', symbol: 'PROOF', status: 'LIVE',    backing: '8.4', slots: '24/24', accent: '#00d97e' },
  { name: 'Test Meme',      symbol: 'TEST',  status: 'LIVE',    backing: '5.0', slots: '8/8',   accent: '#00d97e' },
  { name: 'Proving Round',  symbol: 'PRVE',  status: 'BACKING', backing: '3.2', slots: '12/24', accent: '#ff9d00' },
];

export default function TerminalStarfieldDemo() {
  return (
    <>
      <StarfieldBackground />

      <style jsx global>{`
        @keyframes ts-blink {
          0%, 50%, 100% { opacity: 1; }
          25%, 75%      { opacity: 0.25; }
        }
        .ts-card {
          background: rgba(12, 12, 12, 0.55);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.10);
          transition: border-color 200ms ease, box-shadow 220ms ease, transform 200ms ease;
        }
        .ts-card:hover {
          border-color: rgba(255, 157, 0, 0.55);
          box-shadow: 0 0 22px rgba(255, 157, 0, 0.22), 0 0 44px rgba(255, 157, 0, 0.10);
          transform: translateY(-2px);
        }
        .ts-card-head {
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding: 0.5rem 1rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          font-size: 10px;
          font-family: 'IBM Plex Mono', ui-monospace, monospace;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.55);
        }
        .ts-btn {
          font-family: 'IBM Plex Mono', ui-monospace, monospace;
          font-size: 13px;
          letter-spacing: 0.05em;
          padding: 0.75rem 1.25rem;
          border: 1px solid;
          background: rgba(12, 12, 12, 0.55);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          transition: all 200ms ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          text-decoration: none;
        }
        .ts-btn-primary {
          border-color: #ff9d00;
          color: #ffb84d;
          text-shadow: 0 0 8px rgba(255, 157, 0, 0.5);
          box-shadow: 0 0 14px rgba(255, 157, 0, 0.30), inset 0 0 10px rgba(255, 157, 0, 0.07);
        }
        .ts-btn-primary:hover {
          background: rgba(255, 157, 0, 0.10);
          box-shadow: 0 0 24px rgba(255, 157, 0, 0.55), inset 0 0 14px rgba(255, 157, 0, 0.13);
          transform: translateY(-1px);
        }
        .ts-btn-secondary {
          border-color: rgba(255, 255, 255, 0.18);
          color: rgba(255, 255, 255, 0.80);
        }
        .ts-btn-secondary:hover {
          border-color: rgba(255, 157, 0, 0.55);
          color: #ffb84d;
        }
        .ts-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.2rem 0.55rem;
          border: 1px solid;
          font-size: 10px;
          font-family: 'IBM Plex Mono', ui-monospace, monospace;
          letter-spacing: 0.20em;
          text-transform: uppercase;
        }
        .ts-live-dot { animation: ts-blink 2s ease-in-out infinite; }
      `}</style>

      <div className="relative min-h-screen text-white" style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}>
        {/* Demo notice */}
        <div className="absolute top-3 right-3 text-[10px] uppercase tracking-widest text-white/45 z-50">
          DEMO_A5 · TERMINAL + STARFIELD
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-5">
          {/* HERO — terminal card with header strip + starfield showing through */}
          <div className="ts-card">
            <div className="ts-card-head">
              <span>// PROOF_LAUNCH.SYS // PROVING_GROUNDS</span>
              <span className="flex items-center gap-2">
                <span className="ts-live-dot w-1.5 h-1.5 bg-[#ff9d00] inline-block" />
                <span className="text-[#ff9d00]">[ACTIVE]</span>
              </span>
            </div>

            <div className="p-6 sm:p-10">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/55 mb-3">
                &gt; SYSTEM
              </div>

              <h1
                className="text-3xl sm:text-5xl md:text-6xl font-semibold uppercase tracking-tight leading-[1.05]"
                style={{
                  color: '#ffb84d',
                  textShadow: '0 0 18px rgba(255, 157, 0, 0.45)',
                }}
              >
                Launch infrastructure<br />
                <span style={{ color: '#ff9d00' }}>for token teams.</span>
                <span
                  className="inline-block w-3 sm:w-4 h-7 sm:h-10 ml-2 ts-live-dot"
                  style={{ background: '#ff9d00', verticalAlign: 'middle' }}
                />
              </h1>

              {/* Action layer — preserves the Prove/Launch/Earn brand DNA */}
              <div className="mt-5 sm:mt-6 pt-4 sm:pt-5 border-t border-white/10">
                <p className="text-lg sm:text-xl md:text-2xl uppercase tracking-tight font-semibold">
                  <span style={{ color: '#ff9d00', textShadow: '0 0 10px rgba(255,157,0,0.5)' }}>Prove</span>.{' '}
                  <span style={{ color: '#ffb84d', textShadow: '0 0 10px rgba(255,184,77,0.5)' }}>Launch</span>.{' '}
                  <span style={{ color: '#00d97e', textShadow: '0 0 10px rgba(0,217,126,0.5)' }}>Earn</span>.
                </p>
              </div>

              <div className="mt-5 space-y-1.5 text-sm sm:text-base text-white/80 leading-relaxed">
                <p>
                  <span className="text-white/50">&gt;</span> Back a token{' '}
                  <span className="text-[#ff9d00]">→</span> buy the first supply + earn from its trades.
                </p>
                <p>
                  <span className="text-white/50">&gt;</span> Hold{' '}
                  <span className="text-[#ffb84d]">$PROOF</span>{' '}
                  <span className="text-[#ff9d00]">→</span> earn from every launch on the platform.
                </p>
              </div>

              <div className="mt-6 flex flex-col sm:flex-row gap-2.5 sm:gap-3">
                <Link href="/docs" className="ts-btn ts-btn-primary">[?] Read Docs</Link>
                <Link href="/submit" className="ts-btn ts-btn-secondary">[&gt;] Launch a Token</Link>
                <Link href="/roadmap" className="ts-btn ts-btn-secondary">[→] Roadmap</Link>
              </div>
            </div>
          </div>

          {/* METRICS — terminal card with divided cells */}
          <div className="ts-card">
            <div className="ts-card-head">
              <span>// LIVE_METRICS</span>
            </div>
            <div className="grid grid-cols-3 divide-x divide-white/10">
              {[
                { label: 'TOTAL_BACKED',    value: '47.8 SOL', color: '#ff9d00' },
                { label: 'GENESIS_BACKERS', value: '186',      color: '#ffb84d' },
                { label: 'LIVE_TOKENS',     value: '12',       color: '#00d97e' },
              ].map((m) => (
                <div key={m.label} className="p-5 sm:p-6">
                  <div className="text-[10px] uppercase tracking-widest text-white/45 mb-2">
                    {m.label}
                  </div>
                  <div
                    className="text-2xl sm:text-3xl font-semibold tracking-tight"
                    style={{ color: m.color, textShadow: `0 0 12px ${m.color}55` }}
                  >
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* TOKEN CARDS — each a terminal card with its own header */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[10px] uppercase tracking-widest text-white/55">
                // PROVING_GROUNDS // 3 ACTIVE
              </span>
              <Link href="#" className="text-[10px] uppercase tracking-widest text-[#ff9d00]/80 hover:text-[#ffb84d]">
                [→] View all
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
              {SAMPLE.map((t) => (
                <div key={t.symbol} className="ts-card">
                  <div className="ts-card-head">
                    <span
                      className="ts-pill"
                      style={{ borderColor: t.accent, color: t.accent, textShadow: `0 0 6px ${t.accent}80` }}
                    >
                      {t.status === 'LIVE' && <span className="ts-live-dot w-1 h-1 inline-block" style={{ background: t.accent }} />}
                      {t.status}
                    </span>
                    <span className="text-white/45">{t.slots}</span>
                  </div>

                  <div className="p-5">
                    <div className="text-lg font-semibold text-white truncate">{t.name}</div>
                    <div className="text-sm text-[#ff9d00]/80 mb-5 tracking-wider">${t.symbol}</div>

                    <div className="flex items-baseline gap-2 pt-3 border-t border-white/8">
                      <span
                        className="text-2xl font-semibold"
                        style={{ color: '#ffb84d', textShadow: '0 0 10px rgba(255,157,0,0.4)' }}
                      >
                        {t.backing}
                      </span>
                      <span className="text-xs uppercase tracking-widest text-white/45">SOL backed</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer strip */}
          <div className="ts-card">
            <div className="ts-card-head">
              <span>SLOTS · BACKERS · LAUNCH</span>
              <span className="text-[#ff9d00]" style={{ textShadow: '0 0 8px rgba(255,157,0,0.5)' }}>
                prooflaunch.fun
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
