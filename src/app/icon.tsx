import { ImageResponse } from 'next/og';

// 32×32 favicon. Matches /profile (the X profile pic) exactly so the
// brand mark is consistent across browser tab, iOS home screen, X, etc.
// White P + orange / + white L on black, no border.
//
// Satori (ImageResponse) is a Yoga/flex subset of CSS — each glyph is
// its own flex item, no inline-block.

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

const BG     = '#0a0a0a';
const FG     = '#ffffff';
const ACCENT = '#ff9d00';

export default async function Icon() {
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
          fontSize: 18,
          letterSpacing: '-0.06em',
          fontWeight: 600,
          // Tight line-height so the visible glyph optically centers
          // (default lineHeight includes font's descender padding).
          lineHeight: 0.72,
        }}
      >
        <div style={{ display: 'flex', color: FG }}>P</div>
        <div style={{ display: 'flex', color: ACCENT, margin: '0 -1px' }}>/</div>
        <div style={{ display: 'flex', color: FG }}>L</div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    },
  );
}
