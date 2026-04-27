import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Proof Launch — Community-Curated Meme Coin Launchpad';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0a0f',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* Glow accents */}
        <div
          style={{
            position: 'absolute',
            top: -250,
            left: -250,
            width: 700,
            height: 700,
            background: '#8b5cf6',
            opacity: 0.35,
            borderRadius: '50%',
            filter: 'blur(160px)',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -250,
            right: -250,
            width: 700,
            height: 700,
            background: '#06b6d4',
            opacity: 0.3,
            borderRadius: '50%',
            filter: 'blur(160px)',
            display: 'flex',
          }}
        />

        {/* Logo + wordmark row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 140,
              height: 140,
              background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
              borderRadius: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="92"
              height="92"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
            </svg>
          </div>
          <div
            style={{
              fontSize: 120,
              fontWeight: 800,
              backgroundImage: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
              backgroundClip: 'text',
              color: 'transparent',
              letterSpacing: -3,
              display: 'flex',
            }}
          >
            Proof Launch
          </div>
        </div>

        {/* Subhead */}
        <div
          style={{
            fontSize: 36,
            color: '#a3a3a3',
            display: 'flex',
            marginTop: 16,
          }}
        >
          The proving grounds for meme coins
        </div>

        {/* Bottom URL */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            fontSize: 24,
            color: '#737373',
            letterSpacing: 1,
            display: 'flex',
          }}
        >
          prooflaunch.fun
        </div>
      </div>
    ),
    { ...size }
  );
}
