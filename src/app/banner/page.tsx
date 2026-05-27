'use client';

const AMBER = '#ff9d00';
const BG = '#0a0a0a';
const MUTED = '#5a5a52';
const FG = '#e8e6df';
const FONT = "'IBM Plex Mono', ui-monospace, monospace";

// X banner: 1500x500
function BannerLarge() {
  return (
    <div
      style={{
        width: 1500,
        height: 500,
        background: BG,
        position: 'relative',
        fontFamily: FONT,
        color: FG,
        overflow: 'hidden',
      }}
    >
      {/* Top status bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 40,
          borderBottom: `1px solid ${MUTED}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          fontSize: 13,
          color: MUTED,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 8, height: 8, background: '#00d97e', display: 'inline-block' }} />
          <span>MAINNET · LIVE</span>
        </div>
        <span style={{ color: AMBER }}>// PROOF_LAUNCH.SYS</span>
      </div>

      {/* Bottom status bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 40,
          borderTop: `1px solid ${MUTED}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          fontSize: 13,
          color: MUTED,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
        }}
      >
        <span>SLOTS · BACKERS · LAUNCH</span>
        <span style={{ color: AMBER }}>prooflaunch.fun</span>
      </div>

      {/* Center content */}
      <div
        style={{
          position: 'absolute',
          inset: '40px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 80px',
          gap: 56,
        }}
      >
        {/* P/L mark */}
        <div
          style={{
            width: 200,
            height: 200,
            border: `6px solid ${AMBER}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 108,
              color: AMBER,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              fontWeight: 600,
            }}
          >
            P<span style={{ opacity: 0.55, margin: '0 4px' }}>/</span>L
          </div>
        </div>

        {/* Wordmark + tagline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              fontSize: 16,
              color: MUTED,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
            }}
          >
            &gt; SYSTEM
          </div>
          <div
            style={{
              fontSize: 88,
              color: FG,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            Proof<span style={{ color: AMBER }}>/</span>Launch
          </div>
          <div
            style={{
              fontSize: 22,
              color: MUTED,
              marginTop: 6,
            }}
          >
            The proving grounds for tokens
          </div>
        </div>
      </div>

      {/* Corner brackets - top right */}
      <div
        style={{
          position: 'absolute',
          top: 56,
          right: 32,
          width: 16,
          height: 16,
          borderTop: `2px solid ${AMBER}`,
          borderRight: `2px solid ${AMBER}`,
        }}
      />
      {/* Corner brackets - bottom right */}
      <div
        style={{
          position: 'absolute',
          bottom: 56,
          right: 32,
          width: 16,
          height: 16,
          borderBottom: `2px solid ${AMBER}`,
          borderRight: `2px solid ${AMBER}`,
        }}
      />
    </div>
  );
}

// Half-scale preview
function BannerPreview() {
  return (
    <div style={{ transform: 'scale(0.5)', transformOrigin: 'top left', width: 1500, height: 500 }}>
      <BannerLarge />
    </div>
  );
}

export default function BannerPage() {
  return (
    <div className="min-h-screen p-8 space-y-12">
      <div className="border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">
          // X_BANNER.PREVIEW
        </div>
        <h1 className="text-2xl font-mono uppercase tracking-tight">X Banner</h1>
        <p className="text-sm text-[var(--muted)] mt-3 font-mono">
          1500 × 500px. Right-click the full size below to save, or take a screenshot.
        </p>
      </div>

      {/* Half-scale preview */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-3">
          50% Preview (750 × 250)
        </div>
        <div style={{ width: 750, height: 250, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <BannerPreview />
        </div>
      </div>

      {/* Full size */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-3">
          Full size (1500 × 500) — right-click to save
        </div>
        <div style={{ border: '1px solid var(--border)', display: 'inline-block', overflow: 'auto', maxWidth: '100%' }}>
          <BannerLarge />
        </div>
      </div>
    </div>
  );
}
