import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Proof Launch — The Proving Grounds for Token Launches';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const AMBER = '#ff9d00';
const BG = '#0a0a0a';
const MUTED = '#5a5a52';
const FG = '#e8e6df';

export default async function OpenGraphImage() {
  const fontData = await fetch(
    new URL('./IBMPlexMono-SemiBold.woff', import.meta.url)
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
        {/* Status bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 40px',
            borderBottom: `1px solid ${MUTED}`,
            fontSize: 18,
            color: MUTED,
            letterSpacing: '0.15em',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 12, height: 12, background: '#00d97e', display: 'flex' }} />
            <span>MAINNET · LIVE</span>
          </div>
          <span style={{ color: AMBER }}>// PROOF_LAUNCH.SYS</span>
        </div>

        {/* Main body */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            padding: '0 80px',
            gap: 64,
          }}
        >
          {/* P/L mark */}
          <div
            style={{
              width: 240,
              height: 240,
              border: `8px solid ${AMBER}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 130,
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                fontSize: 22,
                color: MUTED,
                letterSpacing: '0.25em',
                textTransform: 'uppercase',
                display: 'flex',
              }}
            >
              &gt; SYSTEM
            </div>
            <div
              style={{
                fontSize: 96,
                color: FG,
                letterSpacing: '-0.02em',
                lineHeight: 1,
                textTransform: 'uppercase',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <span>Proof<span style={{ color: AMBER }}>/</span>Launch</span>
            </div>
            <div
              style={{
                fontSize: 28,
                color: MUTED,
                lineHeight: 1.4,
                marginTop: 8,
                display: 'flex',
              }}
            >
              The proving grounds for token launches
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 40px',
            borderTop: `1px solid ${MUTED}`,
            fontSize: 20,
            color: MUTED,
            letterSpacing: '0.15em',
          }}
        >
          <span>SLOTS · BACKERS · LAUNCH</span>
          <span style={{ color: AMBER }}>prooflaunch.fun</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    }
  );
}
