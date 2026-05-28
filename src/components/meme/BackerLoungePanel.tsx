'use client';

import type { Meme } from '@/types/database';

// Public-facing "Holder Drop" card. Shown to non-creators (holders,
// random visitors, prospective backers) once a Keycard gate exists.
// Creators see the BackerVaultManager panel instead — they don't need
// to "unlock" their own vault.
//
// The drop is a token-gated content slot the creator can update anytime:
// alpha, whitelist codes, holder-only links, surprise drops. Holders
// sign once with their wallet to see whatever's inside right now.

export function BackerLoungePanel({ meme, isCreator = false }: { meme: Meme; isCreator?: boolean }) {
  if (!meme.keycard_gate_url) return null;
  // Creator sees the dedicated manager panel below — no need for the
  // public "unlock" view on their own meme.
  if (isCreator) return null;

  const lastUpdated = meme.keycard_synced_at
    ? new Date(meme.keycard_synced_at).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : null;

  return (
    <div className="border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            ${meme.symbol} HOLDER DROP
          </div>
          <div className="text-sm font-mono text-[var(--foreground)] mt-0.5">
            Token-gated content from the creator
          </div>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] border border-[var(--accent-gold)]/40 px-2 py-1">
          KEYCARD
        </div>
      </div>

      <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
        Hold any amount of ${meme.symbol} to unlock the latest drop — could be alpha, a whitelist code,
        a private link, a Zoom invite, anything. Updated anytime by the creator.
        {lastUpdated && (
          <>
            {' '}
            <span className="text-[var(--foreground)]">Last updated {lastUpdated}.</span>
          </>
        )}
      </p>

      <a
        href={meme.keycard_gate_url}
        target="_blank"
        rel="noreferrer"
        className="block text-center py-2 px-3 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors text-xs font-mono uppercase tracking-wider"
      >
        UNLOCK LATEST DROP →
      </a>
    </div>
  );
}
