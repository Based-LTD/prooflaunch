import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const AMBER = '#ff9d00';
const BG = '#0a0a0a';
const MUTED = '#5a5a52';
const FG = '#e8e6df';

export async function GET() {
  const fontData = await fetch(
    new URL('../IBMPlexMono-SemiBold.woff', import.meta.url)
  ).then((r) => r.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: BG,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Plex',
          color: FG,
          position: 'relative',
        }}
      >
        {/* Top status bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 32px',
            borderBottom: `1px solid ${MUTED}`,
            fontSize: 16,
            color: MUTED,
            letterSpacing: '0.2em',
            height: 44,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 10, height: 10, background: '#00d97e', display: 'flex' }} />
            <span>MAINNET · LIVE</span>
          </div>
          <span style={{ color: AMBER }}>// PROOF_LAUNCH.SYS</span>
        </div>

        {/* Center body */}
        <div
          style={{
            flex: 1,
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
              border: `7px solid ${AMBER}`,
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
                display: 'flex',
              }}
            >
              P<span style={{ opacity: 0.55, margin: '0 4px' }}>/</span>L
            </div>
          </div>

          {/* Wordmark + tagline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                fontSize: 18,
                color: MUTED,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                display: 'flex',
              }}
            >
              &gt; SYSTEM
            </div>
            <div
              style={{
                fontSize: 92,
                color: FG,
                letterSpacing: '-0.02em',
                lineHeight: 1,
                textTransform: 'uppercase',
                display: 'flex',
              }}
            >
              Proof<span style={{ color: AMBER }}>/</span>Launch
            </div>
            <div
              style={{
                fontSize: 24,
                color: MUTED,
                marginTop: 8,
                display: 'flex',
              }}
            >
              The proving grounds for tokens
            </div>
          </div>
        </div>

        {/* Bottom status bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 32px',
            borderTop: `1px solid ${MUTED}`,
            fontSize: 16,
            color: MUTED,
            letterSpacing: '0.2em',
            height: 44,
          }}
        >
          <span>SLOTS · BACKERS · LAUNCH</span>
          <span style={{ color: AMBER }}>prooflaunch.fun</span>
        </div>
      </div>
    ),
    {
      width: 1500,
      height: 500,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    }
  );
}
