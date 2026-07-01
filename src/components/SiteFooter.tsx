'use client';

import Link from 'next/link';

// Sitewide footer with the interim participation disclaimer.
// Loud-enough to register, quiet-enough not to dominate. Links to the
// full /legal page. Renders on every public route (skipped on /demo
// via GlassShell, same as the rest of the chrome).

export function SiteFooter() {
  return (
    <footer className="mt-16 sm:mt-24 border-t border-[var(--border)] bg-[var(--background)]/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            <span className="text-[var(--accent)]">▮</span>
            <span>Proof<span className="text-[var(--accent)]">/</span>Launch</span>
            <span className="text-[var(--muted)]/60">·</span>
            <span>experimental protocol</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-widest">
            <Link href="/docs" className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
              Docs
            </Link>
            <Link href="/roadmap" className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
              Roadmap
            </Link>
            <Link href="/legal" className="text-[var(--accent-gold)] hover:text-[var(--accent)] transition-colors">
              Disclaimer
            </Link>
          </div>
        </div>


        <div className="text-[10px] sm:text-[11px] font-mono leading-relaxed text-[var(--muted)]/85 border border-[var(--border)] bg-[var(--card)]/40 p-3">
          <span className="text-[var(--accent-gold)] font-semibold">PARTICIPATION DISCLAIMER —</span>{' '}
          Proof Launch is an experimental, community-driven protocol. Nothing here is
          investment advice, a securities offering, or a solicitation. Tokens and
          on-chain activity carry substantial risk including total loss; you should
          have no expectation of profit from holding $PROOF, backing a launch, or
          participating in any program. Distributions are discretionary and may
          change or end at any time. You are responsible for compliance with the
          laws of your jurisdiction.{' '}
          <Link href="/legal" className="text-[var(--accent)] hover:underline">
            Read the full disclaimer →
          </Link>
        </div>
      </div>
    </footer>
  );
}
