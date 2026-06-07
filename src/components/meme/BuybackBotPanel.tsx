'use client';

import { useEffect, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Meme, MemeBot } from '@/types/database';
import { VaultWithdrawModal } from './VaultWithdrawModal';

// Dashboard-density buyback bot panel. One container, one tab per
// active bot, only the selected bot's body rendered below. Keeps the
// dashboard card height constant regardless of whether the meme has
// 1 or 6 bots.
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
  distribute_sol_holders:      { label: 'SOL → HOLDERS',     tag: 'Distribution', tone: 'var(--success)',     emoji: '💸' },
  distribute_sol_backers:      { label: 'SOL → BACKERS',     tag: 'Distribution', tone: 'var(--success)',     emoji: '💰' },
  donate_sol:                  { label: 'DONATE SOL',        tag: 'Commitment',   tone: 'var(--accent-gold)', emoji: '🎁' },
  donate_tokens:               { label: 'DONATE TOKENS',     tag: 'Commitment',   tone: 'var(--accent-gold)', emoji: '🎀' },
  // Legacy enum values — surface the same way but tagged as such.
  distribute_holders:          { label: 'TOKENS → HOLDERS',  tag: 'Legacy',       tone: 'var(--accent)',      emoji: '🪙' },
  distribute_backers:          { label: 'TOKENS → BACKERS',  tag: 'Legacy',       tone: 'var(--accent)',      emoji: '🎯' },
};

const DONATE_ACTIONS = new Set(['donate_sol', 'donate_tokens']);

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
  const bots: MemeBot[] = useMemo(() => {
    if (meme.bots && meme.bots.length > 0) return meme.bots;
    const legacy = legacyBotFromMeme(meme);
    return legacy ? [legacy] : [];
  }, [meme]);

  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  // Default to first bot once the list resolves; reset if the active bot
  // disappears (e.g. creator removed it from their stack).
  useEffect(() => {
    if (bots.length === 0) { setActiveBotId(null); return; }
    if (!activeBotId || !bots.find((b) => b.id === activeBotId)) {
      setActiveBotId(bots[0].id);
    }
  }, [bots, activeBotId]);

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

  const activeBot = bots.find((b) => b.id === activeBotId) ?? bots[0];
  const a = ACTION_LABELS[activeBot.action] ?? {
    label: activeBot.action.toUpperCase(),
    tag: '',
    tone: 'var(--muted)',
    emoji: '⚙',
  };
  const totalSol = Number(activeBot.total_sol_spent || 0);
  const botRuns = recent.filter((r) =>
    activeBot.id === 'legacy' ? r.bot_id === null : r.bot_id === activeBot.id,
  );
  const isVault = activeBot.action === 'hold';

  return (
    <div>
      {/* Tab row — one per applied bot */}
      <div className="flex flex-wrap gap-1 mb-3">
        {bots.map((bot) => {
          const meta = ACTION_LABELS[bot.action];
          const active = bot.id === activeBot.id;
          const tabLabel = bot.action === 'hold' && bot.label ? bot.label : meta?.label.split(' ')[0];
          return (
            <button
              key={bot.id}
              type="button"
              onClick={() => setActiveBotId(bot.id)}
              className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 border transition-colors flex items-center gap-1 ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/60'
              }`}
              title={meta?.label}
            >
              <span aria-hidden>{meta?.emoji}</span>
              <span>{tabLabel}</span>
              <span className="text-[var(--muted)]">{bot.fee_pct}%</span>
            </button>
          );
        })}
      </div>

      {/* Selected bot's body */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden>{a.emoji}</span>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                {activeBot.fee_pct}% OF TRADING FEES
              </div>
              <div className="text-sm font-mono font-semibold mt-0.5" style={{ color: a.tone }}>
                {isVault && activeBot.label ? `${a.label} · ${activeBot.label}` : a.label}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              {a.tag}
            </div>
            {isVault && isCreator && activeBot.id !== 'legacy' && (
              <button
                type="button"
                onClick={() => setWithdrawBot(activeBot)}
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
            {activeBot.last_run_at
              ? new Date(activeBot.last_run_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
              : 'pending first run'}
          </div>
        </div>

        <div className="text-[10px] font-mono text-[var(--muted)] border-t border-[var(--border)] pt-2 break-all">
          Bot wallet:{' '}
          <a
            href={`https://solscan.io/account/${activeBot.bot_wallet}`}
            target="_blank" rel="noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            {activeBot.bot_wallet}
          </a>
        </div>

        {/* DONATE bots: surface the committed destination wallet.
            Address is immutable — burning that visibility into the UI
            is the whole point of the commitment. */}
        {DONATE_ACTIONS.has(activeBot.action) && activeBot.destination_wallet && (
          <div className="text-[10px] font-mono text-[var(--muted)] border border-[var(--accent-gold)]/40 bg-[var(--accent-gold)]/5 p-2 break-all space-y-0.5">
            <div className="text-[var(--accent-gold)] uppercase tracking-widest font-semibold">
              ★ Destination · LOCKED
            </div>
            <a
              href={`https://solscan.io/account/${activeBot.destination_wallet}`}
              target="_blank" rel="noreferrer"
              className="text-[var(--accent-gold)] hover:underline"
            >
              {activeBot.destination_wallet}
            </a>
            <div className="text-[var(--muted)] italic">
              Every {activeBot.action === 'donate_sol' ? 'SOL' : 'token'} payout from this bot flows to this address. Immutable.
            </div>
          </div>
        )}

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

      {withdrawBot && (
        <VaultWithdrawModal
          bot={withdrawBot}
          mintAddress={meme.mint_address ?? null}
          onClose={() => setWithdrawBot(null)}
          onSuccess={() => {
            setRefreshTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
