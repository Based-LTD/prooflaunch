'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Trophy } from 'lucide-react';

// First-visit contest banner. Announces the 5 SOL bounty for the first
// community-launched token on prooflaunch to bond on pump.fun. Shown
// once per browser via localStorage; users can dismiss and it stays
// dismissed unless the CONTEST_KEY constant bumps.
//
// Bump CONTEST_KEY when the contest changes (new prize, new rules,
// new dates). All prior dismissals are invalidated and existing users
// see the new popup once on their next visit.

const CONTEST_KEY = 'contest-popup-2026-07-06-v1';

export function ContestPopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Show only on first visit + only client-side (SSR renders nothing).
    // 800ms delay so the landing page has time to paint — the popup is
    // an intentional interruption, not a page-load flash.
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(CONTEST_KEY)) return;
    const t = setTimeout(() => setOpen(true), 800);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CONTEST_KEY, new Date().toISOString());
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="contest-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[var(--background)]/80"
        style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      />

      {/* Glass card */}
      <div
        className="relative w-full max-w-md border border-[var(--accent-gold)]/40 bg-[var(--card)]/90 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      >
        {/* Header */}
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-[var(--accent-gold)]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
              {'// CONTEST'}
            </span>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Prize hero */}
          <div className="text-center space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              First to bond (rug-proof) wins
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold text-[var(--accent-gold)] tracking-tight">
              5 SOL
            </div>
            <div className="text-xs font-mono text-[var(--foreground)]/85 leading-relaxed">
              First community-launched token on prooflaunch to bond wins — as long as it&apos;s still above bond mcap 24h later.
            </div>
          </div>

          {/* Rules */}
          <div className="space-y-2 border-t border-[var(--border)] pt-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
              {'// RULES'}
            </div>
            <ul className="text-[11px] font-mono text-[var(--foreground)]/85 leading-relaxed space-y-1.5">
              <li className="flex gap-2">
                <span className="text-[var(--accent-gold)] flex-shrink-0">→</span>
                <span>Launch via prooflaunch atomic launch</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent-gold)] flex-shrink-0">→</span>
                <span>Must bond</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent-gold)] flex-shrink-0">→</span>
                <span>Must still be trading above bond mcap 24h after bonding — anti-rug snapshot</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--accent-gold)] flex-shrink-0">→</span>
                <span>First rug-proof bond wins</span>
              </li>
            </ul>
            <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]/80 pt-2 text-center">
              (Founder launches excluded)
            </div>
          </div>

          {/* CTA */}
          <div className="space-y-2">
            <Link
              href="/submit"
              onClick={dismiss}
              className="block w-full text-center py-3 bg-[var(--accent-gold)] hover:opacity-90 text-[#0a0a0a] font-mono font-bold uppercase tracking-widest text-sm transition-opacity"
            >
              [▶] Start Your Launch
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="w-full text-center py-2 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
