'use client';

// Fixed canvas particle field + radial gradient wash. Adapted from
// pumptracks' GridBackground component, retuned for Proof Launch's
// gold/amber palette. 80 particles drifting upward, two warm color
// tones, soft glow. zIndex:-1 so it sits behind all content.

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  size: number;
  speedY: number;
  opacity: number;
  color: string;
}

const COLORS = ['#ff9d00', '#ffb84d', '#cc6600']; // gold / warm amber / deep amber

function createParticles(width: number, height: number, count: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 0.5,
      speedY: Math.random() * 0.3 + 0.1,
      opacity: Math.random() * 0.5 + 0.2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }
  return particles;
}

export const ParticleBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[] | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particleCount = 80;

    const resizeCanvas = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);
      if (!particlesRef.current) {
        particlesRef.current = createParticles(w, h, particleCount);
      } else {
        for (const p of particlesRef.current) {
          if (p.x > w) p.x = Math.random() * w;
          if (p.y > h) p.y = Math.random() * h;
        }
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let animationId = 0;
    const animate = () => {
      const particles = particlesRef.current;
      if (!particles) {
        animationId = requestAnimationFrame(animate);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = 'rgba(10, 10, 10, 0.08)';
      ctx.fillRect(0, 0, w, h);

      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.shadowBlur = 12;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        p.y -= p.speedY;
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        p.x += Math.sin(p.y * 0.01) * 0.2;
      }
      animationId = requestAnimationFrame(animate);
    };

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: -1,
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
      {/* Two-stop radial wash — warm gold from top, deep amber from bottom */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(255, 157, 0, 0.14) 0%, transparent 50%), radial-gradient(ellipse at 50% 100%, rgba(204, 102, 0, 0.1) 0%, transparent 50%)',
        }}
      />
    </div>
  );
};
