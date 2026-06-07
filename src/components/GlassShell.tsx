'use client';

import { usePathname } from 'next/navigation';
import { HeroBackground } from './HeroBackground';
import { SiteFooter } from './SiteFooter';

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
 *
 * Footer with the interim participation disclaimer lives here so it
 * shows on every public route (and stays off /demo, same as the rest
 * of the chrome).
 */
export function GlassShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skipShell = pathname?.startsWith('/demo') ?? false;
  if (skipShell) return <>{children}</>;
  return (
    <div className="glass-skin relative min-h-screen flex flex-col">
      <HeroBackground variant="p-xdense" />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
