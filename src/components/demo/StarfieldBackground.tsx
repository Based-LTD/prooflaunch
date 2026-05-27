'use client';

// Starfield (hyperspace) — classic Win95-screensaver feel adapted for
// Proof Launch. Each "star" lives in 3D space (x, y in [-1,1], z is
// distance from camera). Each frame z decreases, perspective-projects
// to a screen position that spreads further from the vanishing point
// as the star approaches. Streak lines (previous screen position →
// current) give the hyperspace motion-blur effect.
//
// Palette: weighted gold/amber/cream with rare white sparkle. Soft
// radial vignette around the edge so content stays the focus.

import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  z: number;
  color: string;
}

const COLORS = ['#ff9d00', '#ffb84d', '#ffd699', '#ffffff'];
const COLOR_WEIGHTS = [0.45, 0.30, 0.18, 0.07];

function pickColor() {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < COLORS.length; i++) {
    acc += COLOR_WEIGHTS[i];
    if (r < acc) return COLORS[i];
  }
  return COLORS[0];
}

function createStars(count: number, maxZ: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random() * maxZ,
      color: pickColor(),
    });
  }
  return stars;
}

export const StarfieldBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[] | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const STAR_COUNT = 200;
    const MAX_Z = 1.6;
    const MIN_Z = 0.05;
    const SPEED = 0.0055;
    const FOCAL = 0.65;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);
      if (!starsRef.current) {
        starsRef.current = createStars(STAR_COUNT, MAX_Z);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    // Respect reduced-motion preference
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      // Draw a single static frame then return — no animation loop
      const stars = starsRef.current!;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const focalPx = Math.max(w, h) * FOCAL;
      ctx.clearRect(0, 0, w, h);
      for (const star of stars) {
        const sx = cx + (star.x / star.z) * focalPx;
        const sy = cy + (star.y / star.z) * focalPx;
        const depth = 1 - star.z / MAX_Z;
        ctx.beginPath();
        ctx.fillStyle = star.color;
        ctx.globalAlpha = Math.min(1, depth * 1.2);
        ctx.arc(sx, sy, 0.5 + depth * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return () => window.removeEventListener('resize', resize);
    }

    let animationId = 0;
    const animate = () => {
      const stars = starsRef.current;
      if (!stars) {
        animationId = requestAnimationFrame(animate);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const focalPx = Math.max(w, h) * FOCAL;

      ctx.clearRect(0, 0, w, h);

      for (const star of stars) {
        // Project current screen position
        const screenX = cx + (star.x / star.z) * focalPx;
        const screenY = cy + (star.y / star.z) * focalPx;

        // Project previous-frame position (one SPEED ago)
        const prevZ = Math.min(MAX_Z, star.z + SPEED);
        const prevScreenX = cx + (star.x / prevZ) * focalPx;
        const prevScreenY = cy + (star.y / prevZ) * focalPx;

        const depthFactor = 1 - star.z / MAX_Z; // 0 = far, 1 = close
        const size = 0.5 + depthFactor * 2.6;
        const opacity = Math.min(1, depthFactor * 1.3);

        // Streak line — hyperspace motion blur
        ctx.beginPath();
        ctx.strokeStyle = star.color;
        ctx.globalAlpha = opacity * 0.65;
        ctx.lineWidth = size * 0.7;
        ctx.lineCap = 'round';
        ctx.moveTo(prevScreenX, prevScreenY);
        ctx.lineTo(screenX, screenY);
        ctx.stroke();

        // Star head with soft glow
        ctx.beginPath();
        ctx.fillStyle = star.color;
        ctx.globalAlpha = opacity;
        ctx.shadowBlur = 6;
        ctx.shadowColor = star.color;
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        // Advance toward camera
        star.z -= SPEED;
        if (star.z < MIN_Z) {
          star.z = MAX_Z;
          star.x = (Math.random() - 0.5) * 2;
          star.y = (Math.random() - 0.5) * 2;
          star.color = pickColor();
        }
      }
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', resize);
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
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      />
      {/* Vignette so cards/content stay the focus and edges feel deeper */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 35%, rgba(10,10,10,0.55) 85%)',
        }}
      />
    </div>
  );
};
