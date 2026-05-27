'use client';

// Live activity stream — faint scrolling columns of (mocked, for the
// demo) on-chain activity. Three columns at varied positions/speeds
// for parallax. In a real build this would subscribe to actual
// Proof Launch events; here it's hardcoded representative content.
// The bg also has a soft radial wash so the cards still feel warm.

const ITEMS = [
  '> BACKING +0.5 SOL · slot 7 · PROOF',
  '> DISTRIBUTION 6.23 SOL → 3 slots · PROOF',
  '> BACKING +1.2 SOL · slot 12 · PRVE',
  '> LAUNCH PROOF · all 24 slots filled',
  '> BACKING +0.25 SOL · slot 18 · TEST',
  '> FEE CLAIM 0.034 SOL · wallet 7xKz…',
  '> NEW SUBMISSION · GMEME · creator EsA8…',
  '> SLOT FILLED · 18/24 · PROOF',
  '> HOLDER AIRDROP 0.138 SOL → rewards pool',
  '> WALLET CONNECTED · 9aB2…',
  '> BACKING +2.0 SOL · slot 1 · PRVE',
  '> EXPIRED · GMEME · refunding backers',
  '> BACKING +0.1 SOL · slot 23 · PROOF',
  '> DISTRIBUTION 0.76 SOL → slot 1 · PROOF',
  '> NEW SUBMISSION · FTHATN · creator 5q5D…',
  '> BACKING +0.8 SOL · slot 4 · PROOF',
  '> SLOT FILLED · 24/24 · PROOF',
  '> HOLDER AIRDROP 0.07 SOL → rewards pool',
];

// Tripled so the scroll-by-33.333% loop reads as seamless
const REPEATED = [...ITEMS, ...ITEMS, ...ITEMS];

export const ActivityStreamBackground = () => (
  <>
    <style>{`
      @keyframes pl-stream-up {
        from { transform: translateY(0); }
        to   { transform: translateY(-33.333%); }
      }
      .pl-stream-col {
        position: absolute;
        top: 0;
        font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;
        font-size: 11px;
        color: #ff9d00;
        line-height: 2.6;
        white-space: nowrap;
        will-change: transform;
      }
      .pl-stream-col > span { display: block; }
      @media (prefers-reduced-motion: reduce) {
        .pl-stream-col { animation: none !important; }
      }
    `}</style>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: -1,
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    >
      {/* Soft radial wash so glass cards have warm bg behind them */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(255,157,0,0.10) 0%, transparent 50%), radial-gradient(ellipse at 50% 100%, rgba(204,102,0,0.07) 0%, transparent 50%)',
        }}
      />

      {/* Three columns at varied positions + speeds for parallax */}
      <div
        className="pl-stream-col"
        style={{
          left: '3%',
          opacity: 0.08,
          animation: 'pl-stream-up 70s linear infinite',
        }}
      >
        {REPEATED.map((item, i) => (
          <span key={`L${i}`}>{item}</span>
        ))}
      </div>

      <div
        className="pl-stream-col"
        style={{
          left: '40%',
          opacity: 0.06,
          animation: 'pl-stream-up 95s linear infinite',
          animationDelay: '-22s',
        }}
      >
        {REPEATED.map((item, i) => (
          <span key={`C${i}`}>{item}</span>
        ))}
      </div>

      <div
        className="pl-stream-col"
        style={{
          right: '3%',
          opacity: 0.08,
          animation: 'pl-stream-up 80s linear infinite',
          animationDelay: '-38s',
        }}
      >
        {REPEATED.map((item, i) => (
          <span key={`R${i}`}>{item}</span>
        ))}
      </div>
    </div>
  </>
);
