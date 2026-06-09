import { ImageResponse } from 'next/og';

// X banner as a downloadable 1500×500 PNG. Matches the live /banner page
// render exactly — but as a real image file so creators can right-click →
// "Save image as" to upload to X. The previous version still rendered the
// boxed P/L mark; this one drops the box (the profile pic carries the mark)
// and uses the centered left-aligned wordmark layout.

export const runtime = 'edge';

const AMBER = '#ff9d00';
const BG    = '#0a0a0a';
const MUTED = '#5a5a52';
const FG    = '#e8e6df';

export async function GET() {
  const fontData = await fetch(
    new URL('../IBMPlexMono-SemiBold.woff', import.meta.url),
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

        {/* Center body — wordmark column, left-aligned, centered as a unit */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 80px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
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
              Shared Token Launches. Equal entry. Shared trading fees.
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

        {/* Corner brackets — all four corners for symmetry */}
        <div style={{ position: 'absolute', top: 60,    left: 32,  width: 16, height: 16, borderTop:    `2px solid ${AMBER}`, borderLeft:  `2px solid ${AMBER}`, display: 'flex' }} />
        <div style={{ position: 'absolute', top: 60,    right: 32, width: 16, height: 16, borderTop:    `2px solid ${AMBER}`, borderRight: `2px solid ${AMBER}`, display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: 60, left: 32,  width: 16, height: 16, borderBottom: `2px solid ${AMBER}`, borderLeft:  `2px solid ${AMBER}`, display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: 60, right: 32, width: 16, height: 16, borderBottom: `2px solid ${AMBER}`, borderRight: `2px solid ${AMBER}`, display: 'flex' }} />
      </div>
    ),
    {
      width: 1500,
      height: 500,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    },
  );
}
