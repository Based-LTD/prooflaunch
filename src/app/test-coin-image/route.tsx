import { ImageResponse } from 'next/og';

export const runtime = 'edge';

// 1:1 square test-coin image — 1024x1024, terminal aesthetic, clearly marked TEST
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
          background: '#0a0a0a',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Plex',
          position: 'relative',
        }}
      >
        {/* Top status strip */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '36px 44px',
            borderBottom: '2px solid #2a2a2a',
            fontSize: 30,
            letterSpacing: '0.18em',
            color: '#5a5a52',
            textTransform: 'uppercase',
          }}
        >
          <span>// TEST_TOKEN</span>
          <span style={{ color: '#00d97e', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 18, height: 18, background: '#00d97e', display: 'flex' }} />
            DEVNET
          </span>
        </div>

        {/* Center ticker */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: 44,
              color: '#5a5a52',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              display: 'flex',
              marginBottom: 20,
            }}
          >
            &gt; not_real
          </div>
          <div
            style={{
              fontSize: 280,
              color: '#ff9d00',
              letterSpacing: '-0.04em',
              lineHeight: 1,
              display: 'flex',
            }}
          >
            $TEST
          </div>
          <div
            style={{
              marginTop: 28,
              border: '3px solid #ff9d00',
              padding: '10px 28px',
              fontSize: 36,
              color: '#ff9d00',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              display: 'flex',
            }}
          >
            DO NOT BUY
          </div>
        </div>

        {/* Bottom strip */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '36px 44px',
            borderTop: '2px solid #2a2a2a',
            fontSize: 28,
            letterSpacing: '0.18em',
            color: '#5a5a52',
            textTransform: 'uppercase',
          }}
        >
          <span>PROOF/LAUNCH</span>
          <span style={{ color: '#ff9d00' }}>SANDBOX</span>
        </div>
      </div>
    ),
    {
      width: 1024,
      height: 1024,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    }
  );
}
