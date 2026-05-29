'use client';

import { useEffect, useRef } from 'react';

/**
 * Cursor-reactive particle field with multiple presets. Canvas-based,
 * one render path, behavior varies by preset config.
 *
 * Presets (see PRESETS below):
 *   default — 100 amber dots, gentle attract + burst, faint constellation
 *   dense   — 200 smaller dots, tighter network, more populated feel
 *   sparse  — 50 larger dots, lots of breathing room, longer link reach
 *   nebula  — 150 soft glowy dots, gold mix, slow attract, no lines
 *   swirl   — 100 dots with tangential rotation force → orbit around cursor
 */

export type ParticlePreset =
  | 'default'
  | 'dense'
  | 'extra-dense'
  | 'sparse'
  | 'nebula'
  | 'swirl'
  | 'extra-dense-swirl';

interface PresetConfig {
  count: number;
  attractRadius: number;
  attractForce: number;
  repelRadius: number;
  repelStrength: number;
  cursorSpeedThreshold: number;
  friction: number;
  maxSpeed: number;
  drift: number;
  linkRadius: number;       // 0 = no constellation lines
  linkAlpha: number;
  particleSize: number;
  particleColor: string;    // base rgba (alpha controls opacity)
  particleGlow?: boolean;   // soft halo around each particle
  tangentialForce?: number; // for swirl/orbit
  secondaryColor?: string;  // for color mix (nebula)
}

const PRESETS: Record<ParticlePreset, PresetConfig> = {
  default: {
    count: 100,
    attractRadius: 260, attractForce: 0.006,
    repelRadius: 110, repelStrength: 0.6,
    cursorSpeedThreshold: 6,
    friction: 0.94, maxSpeed: 2.4, drift: 0.012,
    linkRadius: 110, linkAlpha: 0.18,
    particleSize: 1.3, particleColor: 'rgba(255, 175, 50, 0.7)',
  },
  dense: {
    count: 200,
    attractRadius: 220, attractForce: 0.005,
    repelRadius: 90, repelStrength: 0.5,
    cursorSpeedThreshold: 5,
    friction: 0.94, maxSpeed: 2.2, drift: 0.010,
    linkRadius: 70, linkAlpha: 0.14,
    particleSize: 1.0, particleColor: 'rgba(255, 175, 50, 0.65)',
  },
  'extra-dense': {
    count: 350,
    attractRadius: 320, attractForce: 0.011,
    repelRadius: 95, repelStrength: 0.55,
    cursorSpeedThreshold: 6,
    friction: 0.94, maxSpeed: 2.4, drift: 0.008,
    linkRadius: 55, linkAlpha: 0.10,
    particleSize: 0.9, particleColor: 'rgba(255, 175, 50, 0.6)',
  },
  sparse: {
    count: 50,
    attractRadius: 320, attractForce: 0.008,
    repelRadius: 140, repelStrength: 0.7,
    cursorSpeedThreshold: 7,
    friction: 0.93, maxSpeed: 2.6, drift: 0.014,
    linkRadius: 180, linkAlpha: 0.22,
    particleSize: 2.0, particleColor: 'rgba(255, 175, 50, 0.8)',
    particleGlow: true,
  },
  nebula: {
    count: 140,
    attractRadius: 300, attractForce: 0.003,
    repelRadius: 100, repelStrength: 0.4,
    cursorSpeedThreshold: 8,
    friction: 0.96, maxSpeed: 1.8, drift: 0.008,
    linkRadius: 0, linkAlpha: 0,
    particleSize: 2.4, particleColor: 'rgba(255, 157, 0, 0.55)',
    secondaryColor: 'rgba(255, 210, 100, 0.55)',
    particleGlow: true,
  },
  swirl: {
    count: 100,
    attractRadius: 280, attractForce: 0.005,
    repelRadius: 100, repelStrength: 0.5,
    cursorSpeedThreshold: 6,
    friction: 0.93, maxSpeed: 2.6, drift: 0.012,
    linkRadius: 90, linkAlpha: 0.15,
    particleSize: 1.4, particleColor: 'rgba(255, 175, 50, 0.7)',
    tangentialForce: 0.008,
  },
  'extra-dense-swirl': {
    count: 350,
    attractRadius: 240, attractForce: 0.004,
    repelRadius: 90, repelStrength: 0.45,
    cursorSpeedThreshold: 6,
    friction: 0.94, maxSpeed: 2.4, drift: 0.008,
    linkRadius: 55, linkAlpha: 0.10,
    particleSize: 0.95, particleColor: 'rgba(255, 175, 50, 0.65)',
    tangentialForce: 0.007,
  },
};

export function ParticleField({ preset = 'default' }: { preset?: ParticlePreset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfgRef = useRef(PRESETS[preset]);

  // Keep the preset config fresh if it changes (live preset swap).
  cfgRef.current = PRESETS[preset];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Allocate enough particles for the largest preset so swaps don't
    // need to re-init. Index 0..cfg.count is the "active" window.
    const MAX_PARTICLES = 400;
    const particles = Array.from({ length: MAX_PARTICLES }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      // Used by nebula to randomly pick between two colors per particle
      colorRoll: Math.random(),
      // Index used to stable-sample colorRoll regardless of preset switches
      _i: i,
    }));

    let mx = -1, my = -1;
    let cursorSpeed = 0;
    const onMove = (e: MouseEvent) => {
      if (mx >= 0) cursorSpeed = Math.hypot(e.clientX - mx, e.clientY - my);
      mx = e.clientX; my = e.clientY;
    };
    const onLeave = () => { mx = -1; my = -1; cursorSpeed = 0; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);

    let raf = 0;
    const tick = () => {
      const cfg = cfgRef.current;
      const active = Math.min(cfg.count, MAX_PARTICLES);

      ctx.clearRect(0, 0, width, height);

      const cursorPresent = mx >= 0;
      const burstingNow = cursorSpeed > cfg.cursorSpeedThreshold;
      cursorSpeed *= 0.85;

      for (let i = 0; i < active; i++) {
        const p = particles[i];
        if (cursorPresent) {
          const dx = mx - p.x;
          const dy = my - p.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < cfg.attractRadius * cfg.attractRadius) {
            const dist = Math.sqrt(distSq) || 1;
            if (burstingNow && dist < cfg.repelRadius) {
              const force = ((cfg.repelRadius - dist) / cfg.repelRadius) * cfg.repelStrength;
              p.vx -= (dx / dist) * force;
              p.vy -= (dy / dist) * force;
            } else {
              p.vx += (dx / dist) * cfg.attractForce;
              p.vy += (dy / dist) * cfg.attractForce;
              // Swirl: add tangential (perpendicular) force for orbit motion
              if (cfg.tangentialForce) {
                p.vx += (-dy / dist) * cfg.tangentialForce;
                p.vy += (dx / dist) * cfg.tangentialForce;
              }
            }
          } else {
            p.vx += (Math.random() - 0.5) * cfg.drift;
            p.vy += (Math.random() - 0.5) * cfg.drift;
          }
        } else {
          p.vx += (Math.random() - 0.5) * cfg.drift;
          p.vy += (Math.random() - 0.5) * cfg.drift;
        }

        const speed = Math.hypot(p.vx, p.vy);
        if (speed > cfg.maxSpeed) {
          p.vx = (p.vx / speed) * cfg.maxSpeed;
          p.vy = (p.vy / speed) * cfg.maxSpeed;
        }
        p.vx *= cfg.friction;
        p.vy *= cfg.friction;

        if (!reducedMotion) {
          p.x += p.vx;
          p.y += p.vy;
        }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;
      }

      // Constellation lines
      if (cfg.linkRadius > 0) {
        const linkSq = cfg.linkRadius * cfg.linkRadius;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < active; i++) {
          const a = particles[i];
          for (let j = i + 1; j < active; j++) {
            const b = particles[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dSq = dx * dx + dy * dy;
            if (dSq < linkSq) {
              const alpha = (1 - dSq / linkSq) * cfg.linkAlpha;
              ctx.strokeStyle = `rgba(255, 157, 0, ${alpha})`;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }

      // Particles (glow first, then dot on top — soft halo effect)
      if (cfg.particleGlow) {
        for (let i = 0; i < active; i++) {
          const p = particles[i];
          const color = cfg.secondaryColor && p.colorRoll > 0.5 ? cfg.secondaryColor : cfg.particleColor;
          const r = cfg.particleSize * 4;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          grad.addColorStop(0, color);
          grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (let i = 0; i < active; i++) {
        const p = particles[i];
        ctx.fillStyle = cfg.secondaryColor && p.colorRoll > 0.5 ? cfg.secondaryColor : cfg.particleColor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, cfg.particleSize, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, []); // intentionally empty — cfgRef makes preset swaps hot without re-init

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 z-[-1] pointer-events-none"
      style={{ background: 'var(--background)' }}
    />
  );
}
