import { ImageResponse } from 'next/og';

// Banner D — GRADIENT (pure mood)
// Two soft warm light blooms drifting in deep black. No content,
// no text, no lines. The visual equivalent of a held breath.
// Pairs well with a B&W profile photo — both stay monochrome but
// the banner has a quiet warmth that reads as human, not corporate.

export const runtime = 'edge';

const W = 1500;
const H = 500;

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
        {/* Left bloom — soft warm white, very low intensity */}
        <div
          style={{
            position: 'absolute',
            top: '-15%',
            left: '-5%',
            width: '60%',
            height: '130%',
            background:
              'radial-gradient(ellipse at center, rgba(255, 245, 230, 0.13) 0%, rgba(255, 245, 230, 0.04) 35%, transparent 65%)',
            display: 'flex',
          }}
        />
        {/* Right bloom — even quieter, offset for asymmetry */}
        <div
          style={{
            position: 'absolute',
            bottom: '-25%',
            right: '5%',
            width: '50%',
            height: '120%',
            background:
              'radial-gradient(ellipse at center, rgba(255, 250, 240, 0.08) 0%, rgba(255, 250, 240, 0.025) 40%, transparent 70%)',
            display: 'flex',
          }}
        />
      </div>
    ),
    { width: W, height: H }
  );
}
