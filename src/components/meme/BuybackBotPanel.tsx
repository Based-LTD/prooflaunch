'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Meme, MemeBot } from '@/types/database';
import { VaultWithdrawModal } from './VaultWithdrawModal';

// Public-facing badge for memes that enabled the per-meme buyback bot
// stack. Phase B: renders ALL bots in the meme's stack, each with its
// own action / wallet / totals / last run. Returns null when the meme
// has no bots — never adds noise to non-bot tokens.
//
// Each bot wallet is system-controlled but transparent: the address is
// public, every swap + action tx is on-chain, and meme_buybacks is
// public-read RLS. The brand story is "every buyback is provable,
// on-chain, from THESE addresses."

const ACTION_LABELS: Record<string, { label: string; tag: string; tone: string; emoji: string }> = {
  burn:                        { label: 'BURN',              tag: 'Deflationary', tone: 'var(--status-down)', emoji: '🔥' },
  hold:                        { label: 'HOLD',              tag: 'Treasury',     tone: 'var(--accent-gold)', emoji: '🏦' },
  distribute_tokens_holders:   { label: 'TOKENS → HOLDERS',  tag: 'Loyalty',      tone: 'var(--accent)',      emoji: '🪙' },
  distribute_tokens_backers:   { label: 'TOKENS → BACKERS',  tag: 'OG reward',    tone: 'var(--accent)',      emoji: '🎯' },
  distribute_sol_holders:      { label: 'SOL → HOLDERS',     tag: 'Yield',        tone: 'var(--success)',     emoji: '💸' },
  distribute_sol_backers:      { label: 'SOL → BACKERS',     tag: 'OG yield',     tone: 'var(--success)',     emoji: '💰' },
  // Legacy enum values — surface the same way but tagged as such.
  distribute_holders:          { label: 'TOKENS → HOLDERS',  tag: 'Legacy',       tone: 'var(--accent)',      emoji: '🪙' },
  distribute_backers:          { label: 'TOKENS → BACKERS',  tag: 'Legacy',       tone: 'var(--accent)',      emoji: '🎯' },
};

interface BuybackRow {
  executed_at: string;
  action: string;
  status: 'completed' | 'partial' | 'failed';
  sol_spent_lamports: string;
  tokens_acted_raw: string;
  swap_tx: string | null;
  action_tx: string | null;
  bot_id: string | null;
}

// Synthesize a MemeBot-shaped record from the legacy single-bot columns
// on Meme. Lets pre-Phase-B memes (whose creators set up a single bot
// before the stack feature shipped) render through the same UI.
function legacyBotFromMeme(meme: Meme): MemeBot | null {
  if (!meme.buyback_bot_enabled || !meme.buyback_bot_action) return null;
  if (!meme.buyback_bot_wallet) return null;
  return {
    id: 'legacy',
    meme_id: meme.id,
    slot_order: 0,
    action: meme.buyback_bot_action as MemeBot['action'],
    fee_pct: meme.buyback_bot_fee_pct ?? 0,
    bot_wallet: meme.buyback_bot_wallet,
    // Legacy HOLD bots default to 'Vault' (matches the 042 backfill).
    label: meme.buyback_bot_action === 'hold' ? 'Vault' : null,
    last_run_at: meme.buyback_bot_last_run_at ?? null,
    total_sol_spent: meme.buyback_bot_total_sol_spent ?? 0,
    total_tokens_acted: meme.buyback_bot_total_tokens_acted ?? 0,
    created_at: meme.created_at,
  };
}

export function BuybackBotPanel({ meme }: { meme: Meme }) {
  const { publicKey } = useWallet();
  const [recent, setRecent] = useState<BuybackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawBot, setWithdrawBot] = useState<MemeBot | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const isCreator = publicKey?.toBase58() === meme.creator_wallet;

  // Prefer the stack from meme.bots (Phase B). Fall back to a synthesized
  // legacy bot built from the deprecated buyback_bot_* columns.
  const bots: MemeBot[] = (() => {
    if (meme.bots && meme.bots.length > 0) return meme.bots;
    const legacy = legacyBotFromMeme(meme);
    return legacy ? [legacy] : [];
  })();

  useEffect(() => {
    if (bots.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Pull more rows when there are multiple bots so each bot can
        // show a couple of its own recent runs.
        const limit = Math.min(5 * Math.max(1, bots.length), 30);
        const r = await fetch(`/api/buyback/recent?meme_id=${meme.id}&limit=${limit}`);
        if (!r.ok) { setLoading(false); return; }
        const j = await r.json();
        if (cancelled) return;
        setRecent(Array.isArray(j.rows) ? j.rows : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [meme.id, bots.length, refreshTick]);

  if (bots.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
        BUYBACK BOTS · {bots.length} ACTIVE
      </div>
      {bots.map((bot) => {
        const a = ACTION_LABELS[bot.action] ?? {
          label: bot.action.toUpperCase(),
          tag: '',
          tone: 'var(--muted)',
          emoji: '⚙',
        };
        const totalSol = Number(bot.total_sol_spent || 0);
        // For legacy bots (bot.id === 'legacy'), include all NULL bot_id
        // rows in addition to anything tagged with the synthetic id.
        const botRuns = recent.filter((r) =>
          bot.id === 'legacy' ? r.bot_id === null : r.bot_id === bot.id,
        );

        const isVault = bot.action === 'hold';
        return (
          <div key={bot.id} className="border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden>{a.emoji}</span>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    {bot.fee_pct}% OF TRADING FEES
                  </div>
                  <div className="text-sm font-mono font-semibold mt-0.5" style={{ color: a.tone }}>
                    {isVault && bot.label ? `${a.label} · ${bot.label}` : a.label}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  {a.tag}
                </div>
                {isVault && isCreator && bot.id !== 'legacy' && (
                  <button
                    type="button"
                    onClick={() => setWithdrawBot(bot)}
                    className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                  >
                    Withdraw
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono border-t border-[var(--border)] pt-2">
              <div className="text-[var(--muted)]">Total SOL spent</div>
              <div className="text-[var(--foreground)] text-right">{totalSol.toFixed(4)} SOL</div>
              <div className="text-[var(--muted)]">Last run</div>
              <div className="text-[var(--foreground)] text-right">
                {bot.last_run_at
                  ? new Date(bot.last_run_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                  : 'pending first run'}
              </div>
            </div>

            <div className="text-[10px] font-mono text-[var(--muted)] border-t border-[var(--border)] pt-2 break-all">
              Bot wallet:{' '}
              <a
                href={`https://solscan.io/account/${bot.bot_wallet}`}
                target="_blank" rel="noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                {bot.bot_wallet}
              </a>
            </div>

            {!loading && botRuns.length > 0 && (
              <div className="border-t border-[var(--border)] pt-2 space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  Recent runs
                </div>
                {botRuns.slice(0, 5).map((r, i) => {
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
      })}

      {withdrawBot && (
        <VaultWithdrawModal
          bot={withdrawBot}
          mintAddress={meme.mint_address ?? null}
          onClose={() => setWithdrawBot(null)}
          onSuccess={() => {
            // Force the buyback runs list to refetch so any audit-trail
            // row that lands appears immediately.
            setRefreshTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
