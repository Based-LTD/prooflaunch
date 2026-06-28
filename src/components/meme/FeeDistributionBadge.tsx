'use client';

import type { Meme } from '@/types/database';

/**
 * Small read-only chip showing the fee distribution split a token uses.
 * Renders only when the meme has fee_preset configured (Phase 2 onward).
 * Legacy memes (PROOF, etc.) have NULL config and this returns null —
 * they display nothing, since their distribution is hardcoded.
 *
 * Purpose: backers can see EXACTLY where trading fees go before they
 * commit SOL. Part of the PROOF transparency story.
 */

const PRESET_NAMES: Record<string, string> = {
  standard: 'STANDARD',
  community_first: 'COMMUNITY FIRST',
  deflationary: 'DEFLATIONARY',
  charity_aligned: 'CHARITY ALIGNED',
  custom: 'CUSTOM',
};

export function FeeDistributionBadge({ meme }: { meme: Meme }) {
  if (!meme.fee_preset) return null;

  const presetName = PRESET_NAMES[meme.fee_preset] ?? meme.fee_preset.toUpperCase();
  const slices: Array<{ label: string; value: number; color: string }> = [
    { label: 'Backers',  value: meme.fee_backer_pct ?? 0,         color: 'var(--accent)' },
    { label: 'Holders',  value: meme.fee_holder_rewards_pct ?? 0, color: 'var(--accent-gold)' },
    { label: 'Platform', value: meme.fee_platform_pct ?? 0,       color: 'var(--muted)' },
    { label: 'Burn',     value: meme.fee_burn_pct ?? 0,           color: 'var(--status-down)' },
    { label: 'Charity',  value: meme.fee_charity_pct ?? 0,        color: 'var(--success)' },
  ].filter((s) => s.value > 0);

  // Holder-rewards distribution remains paused pending an engagement-claim
  // mechanism (the daily $PROOF holder airdrop is the auto-push surface
  // this gates). Backer claims are active; creators claim normally.
  const hasPausedHolderSurface = (meme.fee_holder_rewards_pct ?? 0) > 0;

  return (
    <div className="border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            FEE DISTRIBUTION
          </div>
          <div className="text-sm font-mono font-semibold text-[var(--accent)] mt-0.5">
            {presetName}
          </div>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          set at launch · immutable
        </div>
      </div>

      {hasPausedHolderSurface && (
        <div className="border border-[var(--accent-gold)]/40 bg-[var(--accent-gold)]/5 px-3 py-2 text-[11px] font-mono leading-relaxed text-[var(--foreground)]/85">
          <span className="text-[var(--accent-gold)] font-semibold">HOLDER REWARDS PAUSED</span> —
          The $PROOF holder share continues to accrue in HOLDER_REWARDS_WALLET. Distribution resumes when the engagement-claim mechanism ships (see <a href="/roadmap" className="text-[var(--accent)] underline">roadmap</a>). Backer + creator shares claim normally.
        </div>
      )}

      {/* Visual split bar */}
      <div className="flex h-3 border border-[var(--border)] overflow-hidden">
        {slices.map((s) => (
          <div
            key={s.label}
            style={{ width: `${s.value}%`, background: s.color }}
            title={`${s.label}: ${s.value}%`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-[11px] font-mono">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="w-2 h-2 inline-block flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[var(--muted)]">{s.label}</span>
            <span className="text-[var(--foreground)] ml-auto">{s.value}%</span>
          </div>
        ))}
      </div>

      {meme.fee_charity_pct && meme.fee_charity_pct > 0 && meme.fee_charity_wallet && (
        <div className="text-[10px] font-mono text-[var(--muted)] border-t border-[var(--border)] pt-2 break-all">
          Charity wallet: {meme.fee_charity_wallet}
        </div>
      )}
    </div>
  );
}
