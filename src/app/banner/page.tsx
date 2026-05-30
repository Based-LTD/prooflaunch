'use client';

const AMBER = '#ff9d00';
const BG = '#0a0a0a';
const MUTED = '#5a5a52';
const FG = '#e8e6df';
const FONT = "'IBM Plex Mono', ui-monospace, monospace";

// One-page brand assets gallery. Shows the new profile pic alongside
// every banner variant so the team can pick the combo in one tab.
// All banner variants except the main are served as PNGs via their
// /banner/<name>/route.tsx ImageResponse endpoints — embed as <img>.

const BANNER_VARIANTS = [
  { slug: 'horizon',  label: 'Horizon',  desc: 'Single thin horizon line + subliminal dawn glow. Most minimal — perfect for overlaying the new P/L profile pic.' },
  { slug: 'gradient', label: 'Gradient', desc: 'Abstract gradient. Quiet, no text.' },
  { slug: 'staff',    label: 'Staff',    desc: 'Minimal staff design.' },
  { slug: 'waveform', label: 'Waveform', desc: 'Subtle waveform pattern.' },
];

// Clean, self-rendered profile pic (no AI watermark, brand-locked colors).
// /profile is a Next.js ImageResponse route → PNG. Original Gemini ref
// kept below for side-by-side comparison.
const PROFILE_SRC = '/profile';
const PROFILE_REF_SRC = '/images/Gemini_Generated_Image_1hmdi21hmdi21hmd.jpg';

// Compact card per banner / asset.
function AssetCard({ title, url, desc, children }: {
  title: string; url: string; desc?: string; children: React.ReactNode;
}) {
  return (
    <section className="border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-mono uppercase tracking-tight text-base">{title}</h3>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:underline"
        >
          {url} ↗
        </a>
      </div>
      {desc && (
        <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">{desc}</p>
      )}
      <div className="bg-black">{children}</div>
      <p className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-widest">
        right-click → Save image as…
      </p>
    </section>
  );
}

export default function BannerPage() {
  return (
    <div className="min-h-screen p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">
          // BRAND_ASSETS
        </div>
        <h1 className="text-2xl font-mono uppercase tracking-tight">Brand assets</h1>
        <p className="text-sm text-[var(--muted)] mt-2 font-mono leading-relaxed">
          Profile pic + every X banner variant in one place. All banner variants
          render at 1500×500 (X spec). The minimal ones are designed to be overlaid
          with the new P/L profile pic — pick whichever vibe.
        </p>
      </div>

      {/* Profile pic — our clean self-rendered version */}
      <AssetCard
        title="Profile Pic · /profile · 1024×1024 PNG"
        url={PROFILE_SRC}
        desc="Our brand mark, no AI watermark. Right-click → Save image as → upload to X profile. Auto-matches the favicon and the brand orange (#ff9d00)."
      >
        <div className="flex items-center justify-center bg-black p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={PROFILE_SRC}
            alt="Profile pic"
            style={{ width: 256, height: 256, display: 'block' }}
          />
        </div>
      </AssetCard>

      {/* Reference (the Gemini original we matched against) — keep here
          so you can side-by-side and confirm the new one matches the vibe. */}
      <AssetCard
        title="Reference (Gemini, with watermark) — for comparison only"
        url={PROFILE_REF_SRC}
        desc="The original AI-generated reference. Has a sparkle watermark bottom-right. Don't upload this — use /profile above."
      >
        <div className="flex items-center justify-center bg-black p-6 opacity-60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={PROFILE_REF_SRC}
            alt="Reference"
            style={{ width: 256, height: 256, display: 'block' }}
          />
        </div>
      </AssetCard>

      {/* Section: banners */}
      <div className="border-l-2 border-[var(--accent)] pl-3 mt-8">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          // X_BANNERS · 1500×500
        </div>
        <h2 className="text-lg font-mono uppercase tracking-tight">Banner variants</h2>
      </div>

      {/* Main banner — downloadable PNG via /banner-image so it's
          right-click-saveable. Preview shows the live React render. */}
      <AssetCard
        title="Main banner — Proof/Launch wordmark"
        url="/banner-image"
        desc="The current banner: chrome + centered wordmark + tagline + corner brackets. Right-click → Save image as → upload to X."
      >
        <div className="bg-black overflow-hidden" style={{ width: 750, height: 250 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/banner-image"
            alt="Main banner"
            width={750}
            height={250}
            style={{ display: 'block' }}
          />
        </div>
      </AssetCard>

      {/* Clean variants — already logo-free, just abstract backgrounds */}
      {BANNER_VARIANTS.map((v) => (
        <AssetCard
          key={v.slug}
          title={v.label}
          url={`/banner/${v.slug}`}
          desc={v.desc}
        >
          <div className="bg-black overflow-hidden" style={{ width: 750, height: 250 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/banner/${v.slug}`}
              alt={v.label}
              width={750}
              height={250}
              style={{ display: 'block' }}
            />
          </div>
        </AssetCard>
      ))}

      <div className="text-center pt-6 pb-12 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
        // END
      </div>
    </div>
  );
}
