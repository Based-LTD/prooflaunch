import { ImageResponse } from 'next/og';

// Banner C — HORIZON
// Single thin line at the lower-third with subtle warmth bleeding
// in from below-right (like dawn). Contemplative, almost nothing.
// Maximum cool through minimum content.

export const runtime = 'edge';

const W = 1500;
const H = 500;
const HORIZON_Y = Math.round(H * 0.66);

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#000',
          display: 'flex',
          position: 'relative',
        }}
      >
        {/* Soft warm glow from below-right (subliminal dawn) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background:
              'radial-gradient(ellipse at 75% 95%, rgba(255, 248, 235, 0.12) 0%, transparent 45%)',
            display: 'flex',
          }}
        />
        {/* The horizon line — fades at both edges, sharp in middle */}
        <div
          style={{
            position: 'absolute',
            top: HORIZON_Y,
            left: 0,
            width: '100%',
            height: 1,
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 25%, rgba(255,255,255,0.55) 75%, transparent 100%)',
            display: 'flex',
          }}
        />
      </div>
    ),
    { width: W, height: H }
  );
}
