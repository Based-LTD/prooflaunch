'use client';

import type { Meme } from '@/types/database';

// Renders the "Backer Lounge" card on the meme detail page once a
// Keycard gate has been created for this meme. Hidden until the cron
// fires and writes meme.keycard_gate_url. Visible to EVERYONE (not just
// backers/holders) — the gate itself does the access check when they
// click through.
//
// Brand: every funded Proof Launch token ships with a holder lounge on
// day one. Zero work for the creator, real utility for backers.

export function BackerLoungePanel({ meme }: { meme: Meme }) {
  if (!meme.keycard_gate_url) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            BACKER LOUNGE
          </div>
          <div className="text-sm font-mono text-[var(--foreground)] mt-0.5">
            Holder-only chat &amp; updates
          </div>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] border border-[var(--accent-gold)]/40 px-2 py-1">
          KEYCARD
        </div>
      </div>

      <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
        Any wallet holding ${meme.symbol} can enter. Connect, sign once,
        and you&apos;re in. Access checked live against your on-chain balance.
      </p>

      <a
        href={meme.keycard_gate_url}
        target="_blank"
        rel="noreferrer"
        className="block text-center py-2 px-3 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors text-xs font-mono uppercase tracking-wider"
      >
        ENTER LOUNGE →
      </a>
    </div>
  );
}
