import { ImageResponse } from 'next/og';

export const runtime = 'edge';

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
          border: '14px solid #ff9d00',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Plex',
          fontSize: 188,
          color: '#ff9d00',
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}
      >
        P<span style={{ opacity: 0.55, margin: '0 8px' }}>/</span>L
      </div>
    ),
    {
      width: 400,
      height: 400,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    }
  );
}
