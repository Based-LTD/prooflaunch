import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function AppleIcon() {
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
          border: '6px solid #ff9d00',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Plex',
          fontSize: 84,
          color: '#ff9d00',
          letterSpacing: '-0.04em',
        }}
      >
        P<span style={{ opacity: 0.55, margin: '0 4px' }}>/</span>L
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    }
  );
}
