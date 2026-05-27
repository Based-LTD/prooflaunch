'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Full-screen dim overlay sandwiched between the video background and
 * the page content. Lets the video read at full strength on the
 * landing hero, then fades in to "mute" the video everywhere else.
 *
 * Behaviour:
 *   - On `/` (landing): opacity scales 0 → MAX_DIM as the user scrolls
 *     from the top down to 60% of one viewport height. Past that point
 *     the overlay is fully on. So the hero looks crisp; the proving
 *     grounds section (and everything below) sees a heavily muted
 *     video that reads as a subtle texture, not a focal point.
 *   - On every other route (`/submit`, `/meme/[id]`, `/portfolio`, …):
 *     dim is full on from first paint. Those pages don't have a hero
 *     to showcase the video, so the video sits behind the glass cards
 *     as ambient atmosphere only.
 *
 * Perf note: scroll updates mutate the overlay's `opacity` style
 * directly via ref instead of going through React state. This avoids
 * a re-render + reconciliation pass on every scroll frame, which would
 * otherwise interrupt the video decode/paint pipeline and cause
 * visible judder. The overlay element itself is composited (`opacity`
 * is one of the cheapest properties to animate), so mutations stay on
 * the GPU compositor thread.
 *
 * z-index sits at -1, same as VideoBackground, but rendered AFTER it
 * in DOM order — ties resolve to DOM order, so this paints on top of
 * the video and below the (auto-z) page content.
 */

const MAX_DIM = 0.7;          // black overlay alpha when fully on
const FADE_VH = 0.6;          // dim hits MAX_DIM at this fraction of one viewport
const HOME_PATH = '/';

export function PageDim() {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isHome = pathname === HOME_PATH;

    if (!isHome) {
      // Off-landing routes: lock to full dim, no listener.
      el.style.opacity = String(MAX_DIM);
      return;
    }

    // On the landing route: drive opacity from scroll via direct DOM
    // mutation. rAF-throttled so we update at most once per frame.
    let frame = 0;
    const compute = () => {
      const y = window.scrollY;
      const vh = window.innerHeight || 800;
      const t = Math.min(1, Math.max(0, y / (vh * FADE_VH)));
      el.style.opacity = String(t * MAX_DIM);
      frame = 0;
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(compute);
    };

    compute();                          // sync initial state (handles scroll restoration)
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        // Solid black — the visible dim level is controlled by
        // `opacity` so updates stay on the compositor thread.
        background: '#080808',
        // Initial opacity 0 — the effect immediately syncs to the
        // correct value (full on off-home, scroll-driven on home).
        opacity: 0,
        willChange: 'opacity',
      }}
    />
  );
}
