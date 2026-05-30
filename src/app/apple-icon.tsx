import { ImageResponse } from 'next/og';

// 180×180 apple touch icon. Matches /profile (the X profile pic) and
// /icon (the favicon) exactly so the brand mark is consistent across
// every surface. White P + orange / + white L on black, no border.

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const BG     = '#0a0a0a';
const FG     = '#ffffff';
const ACCENT = '#ff9d00';

export default async function AppleIcon() {
  const fontData = await fetch(
    new URL('./IBMPlexMono-SemiBold.woff', import.meta.url),
  ).then((r) => r.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: BG,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Plex',
          fontSize: 100,
          letterSpacing: '-0.06em',
          fontWeight: 600,
          // Tight line-height so the visible glyph optically centers
          // (default lineHeight includes font's descender padding).
          lineHeight: 0.72,
        }}
      >
        <div style={{ display: 'flex', color: FG }}>P</div>
        <div style={{ display: 'flex', color: ACCENT, margin: '0 -4px' }}>/</div>
        <div style={{ display: 'flex', color: FG }}>L</div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    },
  );
}
