import { ImageResponse } from 'next/og';

// Banner A — STAFF
// Five horizontal music-staff lines spanning the canvas.
// Pure black bg, soft white lines (40% opacity). No text, no clef.
// Music identity rendered as pure typography — the most restrained
// musician banner possible. Reads as cool through absence.

export const runtime = 'edge';

const W = 1500;
const H = 500;
const LINE_OPACITY = 0.50;
const STAFF_GAP = 32; // px between lines — true staff proportions
const SIDE_MARGIN = 120;

export async function GET() {
  const cy = H / 2; // staff vertically centered
  const lineYs = [
    cy - STAFF_GAP * 2,
    cy - STAFF_GAP,
    cy,
    cy + STAFF_GAP,
    cy + STAFF_GAP * 2,
  ];

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
        {lineYs.map((y, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: y,
              left: SIDE_MARGIN,
              width: W - SIDE_MARGIN * 2,
              height: 1,
              background: `rgba(255, 255, 255, ${LINE_OPACITY})`,
              display: 'flex',
            }}
          />
        ))}
      </div>
    ),
    { width: W, height: H }
  );
}
