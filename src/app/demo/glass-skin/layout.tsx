import type { ReactNode } from 'react';
import { VideoBackground } from '@/components/demo/VideoBackground';
import { NebulaShaderBackground } from '@/components/demo/NebulaShaderBackground';

/**
 * Glass-skin demo wrapper.
 *
 * Strategy: render the REAL homepage (or any /demo/glass-skin/* page)
 * UNCHANGED, but apply a glass treatment via CSS variable overrides on
 * the .glass-skin class. The whole site reads --card / --border / etc.
 * so the override propagates to every terminal card without touching
 * components.
 *
 * Background: video on desktop, shader nebula on mobile (per user call —
 * 32MB video would tank mobile load times).
 *
 * The Navbar separately auto-engages its own glass mode on /demo/* paths
 * (see Navbar.tsx — pathname.startsWith('/demo')).
 */
export default function GlassSkinLayout({ children }: { children: ReactNode }) {
  return (
    <div className="glass-skin relative min-h-screen">
      {/* Desktop: HD video bg */}
      <div className="hidden md:block">
        <VideoBackground
          src="/grok-bg.mp4"
          playbackRate={0.55}
          videoOpacity={0.65}
          brightness={0.85}
          saturation={0.9}
          dim={0.4}
          blur={0}
          vignette={true}
        />
      </div>

      {/* Mobile: shader nebula (no video to keep mobile load fast) */}
      <div className="block md:hidden">
        <NebulaShaderBackground />
      </div>

      {children}
    </div>
  );
}
