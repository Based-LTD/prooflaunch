import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default async function Icon() {
  const fontData = await fetch(
    new URL('./IBMPlexMono-SemiBold.woff', import.meta.url)
  ).then((r) => r.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0a0a',
          border: '2px solid #ff9d00',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Plex',
          fontSize: 14,
          color: '#ff9d00',
          letterSpacing: '-0.04em',
        }}
      >
        P<span style={{ opacity: 0.55, margin: '0 1px' }}>/</span>L
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    }
  );
}
