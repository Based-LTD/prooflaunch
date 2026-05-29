'use client';

import { useEffect, useState } from 'react';
import type { Meme } from '@/types/database';

// Public-facing badge for memes that enabled the per-meme buyback bot.
// Shows the configured action, the bot wallet address (so anyone can audit
// on Solscan), totals, and the most recent run. Returns null when the bot
// is not enabled — the panel never adds noise to non-bot tokens.
//
// Bot wallet is system-controlled but transparent: the address is public,
// every swap + burn/hold tx is on-chain, and the meme_buybacks table is
// public-read RLS. The brand story is "every buyback is provable, on-chain,
// from THIS address."

const ACTION_LABELS: Record<string, { label: string; tag: string; tone: string }> = {
  burn:                        { label: 'BURN',              tag: 'Deflationary', tone: 'var(--status-down)' },
  hold:                        { label: 'HOLD',              tag: 'Treasury',     tone: 'var(--accent-gold)' },
  distribute_tokens_holders:   { label: 'TOKENS → HOLDERS',  tag: 'Loyalty',      tone: 'var(--accent)' },
  distribute_tokens_backers:   { label: 'TOKENS → BACKERS',  tag: 'OG reward',    tone: 'var(--accent)' },
  distribute_sol_holders:      { label: 'SOL → HOLDERS',     tag: 'Yield',        tone: 'var(--success)' },
  distribute_sol_backers:      { label: 'SOL → BACKERS',     tag: 'OG yield',     tone: 'var(--success)' },
  // Legacy enum values — surface the same way but tagged as such.
  distribute_holders:          { label: 'TOKENS → HOLDERS',  tag: 'Legacy',       tone: 'var(--accent)' },
  distribute_backers:          { label: 'TOKENS → BACKERS',  tag: 'Legacy',       tone: 'var(--accent)' },
};

interface BuybackRow {
  executed_at: string;
  action: string;
  status: 'completed' | 'partial' | 'failed';
  sol_spent_lamports: string;
  tokens_acted_raw: string;
  swap_tx: string | null;
  action_tx: string | null;
}

export function BuybackBotPanel({ meme }: { meme: Meme }) {
  const [recent, setRecent] = useState<BuybackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!meme.buyback_bot_enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/buyback/recent?meme_id=${meme.id}&limit=5`);
        if (!r.ok) { setLoading(false); return; }
        const j = await r.json();
        if (cancelled) return;
        setRecent(Array.isArray(j.rows) ? j.rows : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [meme.id, meme.buyback_bot_enabled]);

  if (!meme.buyback_bot_enabled || !meme.buyback_bot_action) return null;

  const a = ACTION_LABELS[meme.buyback_bot_action] ?? { label: meme.buyback_bot_action.toUpperCase(), tag: '', tone: 'var(--muted)' };
  const totalSol = Number(meme.buyback_bot_total_sol_spent || 0);

  return (
    <div className="border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            BUYBACK BOT
          </div>
          <div className="text-sm font-mono font-semibold mt-0.5" style={{ color: a.tone }}>
            {a.label}
          </div>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          {a.tag}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono border-t border-[var(--border)] pt-2">
        <div className="text-[var(--muted)]">Total SOL spent</div>
        <div className="text-[var(--foreground)] text-right">{totalSol.toFixed(4)} SOL</div>
        <div className="text-[var(--muted)]">Last run</div>
        <div className="text-[var(--foreground)] text-right">
          {meme.buyback_bot_last_run_at
            ? new Date(meme.buyback_bot_last_run_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
            : 'pending first run'}
        </div>
      </div>

      {meme.buyback_bot_wallet && (
        <div className="text-[10px] font-mono text-[var(--muted)] border-t border-[var(--border)] pt-2 break-all">
          Bot wallet:{' '}
          <a
            href={`https://solscan.io/account/${meme.buyback_bot_wallet}`}
            target="_blank" rel="noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            {meme.buyback_bot_wallet}
          </a>
        </div>
      )}

      {!loading && recent.length > 0 && (
        <div className="border-t border-[var(--border)] pt-2 space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            Recent runs
          </div>
          {recent.map((r, i) => {
            const sol = Number(r.sol_spent_lamports) / 1e9;
            const tx = r.action_tx || r.swap_tx;
            return (
              <div key={i} className="text-[11px] font-mono flex items-center justify-between gap-2">
                <span className="text-[var(--muted)]">
                  {new Date(r.executed_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <span className="text-[var(--foreground)]">{sol.toFixed(4)} SOL</span>
                <span className={
                  r.status === 'completed' ? 'text-[var(--success)]'
                  : r.status === 'partial' ? 'text-[var(--accent-gold)]'
                  : 'text-[var(--error)]'
                }>
                  {r.status}
                </span>
                {tx && (
                  <a
                    href={`https://solscan.io/tx/${tx}`}
                    target="_blank" rel="noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    tx
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
