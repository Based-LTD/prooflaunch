'use client';

// Plays an MP4/WebM as a full-bleed background. Designed to sit
// quietly behind glass cards as ambient motion rather than fight
// them for attention.
//
// Defaults:
//   • Slowed to 0.55x playback for calm atmosphere
//   • Permanent soft blur (3px) pushes it into the background
//   • Heavier dim overlay (0.55) so cards stay crisp
//   • Edge vignette stays
//
// The video loops natively. Most well-crafted AI clips already
// start/end on similar frames; the soft blur additionally smooths
// any minor seam by killing high-frequency detail across the cut.

import { useEffect, useRef } from 'react';

interface Props {
  /** Path under /public — defaults to /grok-bg.mp4 */
  src?: string;
  /** Dim overlay opacity 0-1. Higher = cards more readable, video more muted. */
  dim?: number;
  /** Constant CSS blur in px. 0 = HD sharp (default). Use sparingly. */
  blur?: number;
  /** Video element opacity 0-1. Lower = video recedes into bg. */
  videoOpacity?: number;
  /** Brightness 0-2 (1 = normal). Lower = darker video without blanket dim. */
  brightness?: number;
  /** Saturation 0-2 (1 = normal). Lower = less color-aggressive. */
  saturation?: number;
  /** Playback rate (1 = normal). Lower = slower, calmer. */
  playbackRate?: number;
  /** Show edge vignette (default true) */
  vignette?: boolean;
}

export const VideoBackground: React.FC<Props> = ({
  src = '/grok-bg.mp4',
  dim = 0.40,
  blur = 0,
  videoOpacity = 0.65,
  brightness = 0.85,
  saturation = 0.9,
  playbackRate = 0.55,
  vignette = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Apply playback rate once we know the video is loadable. Setting
    // it before canplay can be overridden by the load process.
    const apply = () => {
      try { v.playbackRate = playbackRate; } catch {}
    };
    if (v.readyState >= 1) apply();
    else v.addEventListener('loadedmetadata', apply, { once: true });

    // Try to play (browsers may block autoplay even when muted)
    v.play().catch(() => {});

    return () => {
      v.removeEventListener('loadedmetadata', apply);
    };
  }, [playbackRate]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: -1,
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: blur > 0
            ? 'translate(-50%, -50%) scale(1.06)' // compensate for blur edge softness
            : 'translate(-50%, -50%)',
          // Sharp HD by default. Brightness + saturation push the video
          // back without softening detail (a "different approach" than
          // blur for reducing prominence).
          filter: `brightness(${brightness}) saturate(${saturation})${blur > 0 ? ` blur(${blur}px)` : ''}`,
          opacity: videoOpacity,
          willChange: 'transform, filter, opacity',
        }}
      />
      {/* Dim overlay — tunable */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `rgba(10, 10, 10, ${dim})`,
        }}
      />
      {/* Edge vignette */}
      {vignette && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at center, transparent 30%, rgba(10,10,10,0.50) 90%)',
          }}
        />
      )}
    </div>
  );
};
