'use client';

import { usePathname } from 'next/navigation';
import { HeroBackground } from './HeroBackground';

/**
 * Site shell. Pairs the frosted-glass card skin (glass-skin class +
 * globals.css rules that override --card / --border so terminal cards
 * render as amber-tinted glass) with the X-DENSE cursor-reactive
 * particle field as the always-on backlight.
 *
 * Previously hosted a 30MB video bg — stripped 2026-05-29 in favor of
 * the much lighter canvas particle field (~1% CPU, no decoder).
 *
 * /demo/* routes bring their own backgrounds and skip this wrapper.
 */
export function GlassShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skipShell = pathname?.startsWith('/demo') ?? false;
  if (skipShell) return <>{children}</>;
  return (
    <div className="glass-skin relative min-h-screen">
      <HeroBackground variant="p-xdense" />
      {children}
    </div>
  );
}
