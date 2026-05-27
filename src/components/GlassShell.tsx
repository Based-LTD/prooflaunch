'use client';

import { usePathname } from 'next/navigation';
import { VideoBackground } from '@/components/demo/VideoBackground';
import { NebulaShaderBackground } from '@/components/demo/NebulaShaderBackground';
import { PageDim } from '@/components/PageDim';

/**
 * Glass shell — wraps the entire site with the glass+video skin.
 *
 * Why a client component: usePathname() lets us SKIP this wrapper on
 * /demo/* routes that have their own bg setups (avoids double-mounting
 * a video element). For every other route, this provides:
 *
 *   - A persistent VideoBackground that does NOT re-mount during
 *     in-app navigation (because GlassShell sits in the root layout
 *     above the page-level routing). Click /  →  /meme/[id]  →  /submit
 *     and the video keeps playing seamlessly — no reload, no restart.
 *   - The .glass-skin class scope, which overrides --card / --border
 *     CSS variables so every terminal card across the site renders as
 *     amber-tinted frosted glass (rules live in globals.css).
 *   - Mobile fallback: shader nebula instead of video (32MB MP4 is too
 *     heavy for mobile bandwidth — visually similar, gradient-style).
 *
 * Banner/OG-image routes are server-rendered and don't go through this
 * client wrapper anyway, so they keep their solid backgrounds.
 */
export function GlassShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Demo routes manage their own backgrounds. Skip the wrapper so we
  // don't stack two video elements or double-blur.
  const skipShell = pathname?.startsWith('/demo') ?? false;

  if (skipShell) {
    return <>{children}</>;
  }

  return (
    <div className="glass-skin relative min-h-screen">
      {/* Desktop: HD video bg. Tuned for "video is visible but text stays
          readable" — videoOpacity higher than Clyde's 0.65 starting point
          per user feedback ("I lost the video"). */}
      <div className="hidden md:block">
        <VideoBackground
          // Motion-interpolated 60fps re-encode of grok-bg.mp4.
          // The original was 24fps which can't divide evenly into 60Hz
          // displays — caused visible 3:2 pulldown judder at any
          // playback rate. This file: 1428x1440, 60fps locked, 4.8MB
          // (vs 32MB original), bit-perfect cadence on 60Hz + 120Hz.
          // Original `/grok-bg.mp4` retained as fallback.
          src="/grok-bg-smooth.mp4"
          playbackRate={1.0}
          videoOpacity={0.85}     /* was 0.65 — more video visible per user */
          brightness={0.9}        /* was 0.85 — slight bump */
          saturation={0.95}
          dim={0.25}              /* was 0.4 — less darkening overlay */
          blur={0}
          vignette={true}
        />
      </div>

      {/* Mobile: shader nebula (gradient-style, no autoplay/bandwidth
          concerns). Visually consistent with the video direction. */}
      <div className="block md:hidden">
        <NebulaShaderBackground />
      </div>

      {/* Scroll-driven dim overlay — invisible on the landing hero,
          fades in past the fold, full-on for every non-home route.
          Keeps the video as ambient atmosphere instead of competing
          with form/board content. */}
      <PageDim />

      {children}
    </div>
  );
}
