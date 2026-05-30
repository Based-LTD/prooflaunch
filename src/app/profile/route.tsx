import { ImageResponse } from 'next/og';

// Profile pic / brand mark renderer. GET /profile returns a clean
// 1024×1024 PNG of the P/L mark — drop straight into X profile, Telegram,
// Discord, anywhere. No AI watermark. Brand colors locked to the same
// vars as the rest of the site (--accent #ff9d00 + --background #0a0a0a).
//
// Structure mirrors /icon.tsx so favicon + profile pic are visually
// consistent: white P + orange / + white L. The slash is full-opacity
// brand-orange here (vs the icon which dims it to 0.55) because at
// profile-pic scale the dim version reads as washed-out.

export const runtime = 'edge';

const W = 1024;
const H = 1024;
const BG     = '#0a0a0a';
const FG     = '#ffffff';
const ACCENT = '#ff9d00';

export async function GET() {
  const fontData = await fetch(
    new URL('../IBMPlexMono-SemiBold.woff', import.meta.url),
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
          fontSize: 540,
          letterSpacing: '-0.06em',
          fontWeight: 600,
          // Tight line-height shrinks the flex line-box so the centered
          // visible glyph sits at the true optical center. Default lineHeight
          // includes the font's descender area (empty space below the baseline
          // for letters like g/p/q) which pushed the P/L mark down visually.
          lineHeight: 0.72,
        }}
      >
        {/* Each glyph is its own flex item — Satori is a Yoga/flex
            subset of CSS and doesn't support inline-block. No extra
            margin / skew on the slash — it renders at its natural width
            and natural slant, identical to the banner's inline slash. */}
        <div style={{ display: 'flex', color: FG }}>P</div>
        <div style={{ display: 'flex', color: ACCENT }}>/</div>
        <div style={{ display: 'flex', color: FG }}>L</div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [{ name: 'Plex', data: fontData, weight: 600, style: 'normal' }],
    },
  );
}
