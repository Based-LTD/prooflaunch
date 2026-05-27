'use client';

// Modernized starfield — designed to look expensive.
//
// Differences vs the basic /demo/glass-starfield:
//   1. Mouse parallax — entire field shifts ±4% based on cursor,
//      eased toward target (no jitter). Apple/Linear-level alive feel.
//   2. Drifting vanishing point — Lissajous pattern (sin/cos with
//      relatively prime periods), so it never repeats exactly. Reads
//      as a slow banking spacecraft, not symmetric tunnel.
//   3. Bokeh halos on close stars — gradient-filled radial bloom
//      around each star whose depthFactor > 0.72. Photographic.
//   4. Depth-graded color — single gold hue family, but FAR stars
//      sit at deep amber, MID at gold, NEAR at cream. Atmospheric
//      perspective like real space photography.
//   5. Variable speed (breathing) — ±15% sin modulation on a slow
//      ~20s cycle. Organic, not mechanical.
//   6. DPR-aware canvas — sharp on Retina, capped at 1.5x for perf.
//   7. Rare cream-white sparkles (~4% of stars) for visual variety
//      without breaking the gold discipline.

import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  z: number;
  isSparkle: boolean;
}

const FAR_COLOR  = { r: 204, g: 102, b: 0   }; // #cc6600 deep amber
const MID_COLOR  = { r: 255, g: 157, b: 0   }; // #ff9d00 gold
const NEAR_COLOR = { r: 255, g: 220, b: 170 }; // soft cream
const SPARKLE    = { r: 255, g: 255, b: 240 }; // cream-white

function lerpColor(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function depthColor(depthFactor: number, isSparkle: boolean) {
  if (isSparkle) return SPARKLE;
  return depthFactor < 0.5
    ? lerpColor(FAR_COLOR, MID_COLOR, depthFactor * 2)
    : lerpColor(MID_COLOR, NEAR_COLOR, (depthFactor - 0.5) * 2);
}

function createStars(count: number, maxZ: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random() * maxZ,
      isSparkle: Math.random() < 0.04,
    });
  }
  return stars;
}

export const StarfieldExpensiveBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[] | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const mouseRef = useRef({ tx: 0, ty: 0, x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const STAR_COUNT = 280;          // ↑ density so motion is always visible
    const MAX_Z = 1.7;
    const MIN_Z = 0.05;
    const BASE_SPEED = 0.012;        // ↑ 2.2x — was barely perceptible before
    const STREAK_FRAMES = 3.5;       // streak = motion blur over N frames
    const FOCAL = 0.7;
    const MOUSE_PARALLAX = 0.11;     // ↑ ~3x — cursor now meaningfully steers
    const MOUSE_EASE = 0.055;        // slightly snappier follow
    const ROLL_AMPLITUDE = 0.045;    // ~2.6° slow camera roll
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      // Setting canvas.width resets context state — re-apply scale
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);
      if (!starsRef.current) {
        starsRef.current = createStars(STAR_COUNT, MAX_Z);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const onMouseMove = (e: MouseEvent) => {
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      mouseRef.current.tx = (e.clientX / w) * 2 - 1;
      mouseRef.current.ty = (e.clientY / h) * 2 - 1;
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      // Single static frame — no listeners, no loop
      const stars = starsRef.current!;
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      const focalPx = Math.max(w, h) * FOCAL;
      ctx.clearRect(0, 0, w, h);
      for (const star of stars) {
        const sx = w / 2 + (star.x / star.z) * focalPx;
        const sy = h / 2 + (star.y / star.z) * focalPx;
        const depth = 1 - star.z / MAX_Z;
        const color = depthColor(depth, star.isSparkle);
        ctx.beginPath();
        ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
        ctx.globalAlpha = Math.min(1, depth * 1.2);
        ctx.arc(sx, sy, 0.5 + depth * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return () => window.removeEventListener('resize', resize);
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true });

    let animationId = 0;
    let frame = 0;

    const animate = () => {
      const stars = starsRef.current;
      if (!stars) {
        animationId = requestAnimationFrame(animate);
        return;
      }
      const w = sizeRef.current.w;
      const h = sizeRef.current.h;
      const focalPx = Math.max(w, h) * FOCAL;

      // Ease smoothed mouse toward target (no jitter)
      mouseRef.current.x += (mouseRef.current.tx - mouseRef.current.x) * MOUSE_EASE;
      mouseRef.current.y += (mouseRef.current.ty - mouseRef.current.y) * MOUSE_EASE;

      // Drifting vanishing point — Lissajous, larger amplitude so the
      // horizon visibly banks. Periods prime-ish so it never repeats.
      const t = frame * 0.001;
      const driftX = Math.sin(t * 0.7)  * 0.14 + Math.cos(t * 0.31) * 0.06;
      const driftY = Math.cos(t * 0.5)  * 0.10 + Math.sin(t * 0.27) * 0.045;

      // Final vanishing point: center + drift + mouse parallax
      const vpx = w / 2 + (driftX + mouseRef.current.x * MOUSE_PARALLAX) * w / 2;
      const vpy = h / 2 + (driftY + mouseRef.current.y * MOUSE_PARALLAX) * h / 2;

      // Slow camera roll — rotates entire field around the vanishing
      // point. Period ~60s, amplitude ~2.6°. Subliminal but unmistakable
      // when comparing against a non-rotated version.
      const roll = Math.sin(t * 0.1) * ROLL_AMPLITUDE;

      // Breathing speed — wider ±30% range, faster cycle (~14s)
      const speed = BASE_SPEED * (0.85 + Math.sin(t * 0.45) * 0.30);

      ctx.clearRect(0, 0, w, h);

      // Apply camera roll once for the whole frame
      ctx.save();
      ctx.translate(vpx, vpy);
      ctx.rotate(roll);
      ctx.translate(-vpx, -vpy);

      for (const star of stars) {
        const screenX = vpx + (star.x / star.z) * focalPx;
        const screenY = vpy + (star.y / star.z) * focalPx;
        // Longer streak — multi-frame extrapolation for visible trail
        const prevZ = Math.min(MAX_Z, star.z + speed * STREAK_FRAMES);
        const prevScreenX = vpx + (star.x / prevZ) * focalPx;
        const prevScreenY = vpy + (star.y / prevZ) * focalPx;

        const depthFactor = 1 - star.z / MAX_Z;
        const size = 0.4 + depthFactor * 2.8;
        const opacity = Math.min(1, depthFactor * 1.3);
        const color = depthColor(depthFactor, star.isSparkle);
        const colorStr = `rgb(${color.r},${color.g},${color.b})`;

        // Streak (hyperspace motion trail) — longer + slightly more opaque
        ctx.beginPath();
        ctx.strokeStyle = colorStr;
        ctx.globalAlpha = opacity * 0.65;
        ctx.lineWidth = size * 0.6;
        ctx.lineCap = 'round';
        ctx.moveTo(prevScreenX, prevScreenY);
        ctx.lineTo(screenX, screenY);
        ctx.stroke();

        // Bokeh halo — now on the closest 40% (threshold 0.60), more
        // visible. Radial gradient gives the soft out-of-focus look.
        if (depthFactor > 0.60) {
          const t = (depthFactor - 0.60) / 0.40; // 0..1
          const haloSize = size * (3 + t * 14);
          const haloOpacity = opacity * 0.22 * t;
          const grd = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, haloSize);
          grd.addColorStop(0,   `rgba(${color.r},${color.g},${color.b},${haloOpacity})`);
          grd.addColorStop(0.5, `rgba(${color.r},${color.g},${color.b},${haloOpacity * 0.45})`);
          grd.addColorStop(1,   `rgba(${color.r},${color.g},${color.b},0)`);
          ctx.fillStyle = grd;
          ctx.globalAlpha = 1;
          ctx.fillRect(screenX - haloSize, screenY - haloSize, haloSize * 2, haloSize * 2);
        }

        // Star head with soft shadow glow
        ctx.beginPath();
        ctx.fillStyle = colorStr;
        ctx.globalAlpha = opacity;
        ctx.shadowBlur = star.isSparkle ? 14 : 7;
        ctx.shadowColor = colorStr;
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        // Advance toward camera
        star.z -= speed;
        if (star.z < MIN_Z) {
          star.z = MAX_Z;
          star.x = (Math.random() - 0.5) * 2;
          star.y = (Math.random() - 0.5) * 2;
          star.isSparkle = Math.random() < 0.04;
        }
      }

      ctx.restore(); // end camera roll transform

      frame++;
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(animationId);
    };
  }, []);

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
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      {/* Premium vignette — slightly stronger than basic starfield to
          deepen the "looking into space" sensation around the edges. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 30%, rgba(10,10,10,0.65) 90%)',
        }}
      />
    </div>
  );
};
