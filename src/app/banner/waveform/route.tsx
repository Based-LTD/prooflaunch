import { ImageResponse } from 'next/og';

// Banner B — WAVEFORM
// A single thin audio waveform horizon across the canvas. Computed
// from sum of sinusoids + small high-freq term so it reads as an
// actual recording, not perfect math. Pure black bg, soft white
// stroke. Music identity at a glance, totally abstract.

export const runtime = 'edge';

const W = 1500;
const H = 500;
const STROKE = 1.5;
const CENTER_Y = H / 2;
const AMP = 90; // max vertical amplitude
const POINTS = 320;

function amplitudeAt(x: number): number {
  // x in [0, 1]
  // Sum of a few sinusoids + a small high-freq term for texture
  return (
    Math.sin(x * Math.PI * 6) * 0.45 +
    Math.sin(x * Math.PI * 13 + 1.2) * 0.22 +
    Math.sin(x * Math.PI * 29 + 0.4) * 0.10 +
    Math.sin(x * Math.PI * 71 + 2.1) * 0.04 +
    // Slight envelope so the wave swells toward the right (asymmetric, more interesting)
    Math.sin(x * Math.PI) * 0.05
  ) * (0.5 + 0.5 * Math.sin(x * Math.PI)); // envelope: quieter at edges
}

export async function GET() {
  const points: string[] = [];
  for (let i = 0; i <= POINTS; i++) {
    const x = i / POINTS;
    const px = x * W;
    const py = CENTER_Y + amplitudeAt(x) * AMP;
    points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  const pathPoints = points.join(' ');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#000',
          display: 'flex',
        }}
      >
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <polyline
            points={pathPoints}
            fill="none"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={STROKE}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { width: W, height: H }
  );
}
