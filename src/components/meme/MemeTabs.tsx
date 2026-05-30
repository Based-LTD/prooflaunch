'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import { MemeChat } from '@/components/MemeChat';
import { BackersList } from '@/components/BackersList';
import { GenesisBackerRoster } from '@/components/GenesisBackerRoster';
import { BuybackBotPanel } from '@/components/meme/BuybackBotPanel';
import { LaunchVisibilityPanel } from '@/components/meme/LaunchVisibilityPanel';
import { BackerVaultManager } from '@/components/meme/BackerVaultManager';
import { ClaimRewards } from '@/components/ClaimRewards';
import type { Meme } from '@/types/database';

// Dashboard / control-center for a single meme. Replaces the previous
// stack of standalone panels (BuybackBotPanel, LaunchVisibilityPanel,
// BackerVaultManager, ClaimRewards, distribute-retry, etc.) with one
// tabbed container. Each tab is conditionally visible:
//   - backers   (always) — roster / GenesisBackerRoster post-launch
//   - bots      (any bot exists) — programmable tokenomics panel
//   - chat      (always)
//   - rewards   (post-launch + creator or backer)
//   - creator   (creator-only) — visibility, vault manager, manual retries
//   - trust     (always) — pool wallet + mint inspection
//   - overview  (always, last) — how the launch works
type TabKey = 'backers' | 'bots' | 'chat' | 'rewards' | 'creator' | 'trust' | 'overview';

// Use the same shape BackersList consumes.
interface Backing {
  id: string;
  backer_wallet: string;
  amount_sol: number;
  created_at: string;
  deposit_tx?: string;
  status?: string;
}

interface Props {
  meme: Meme;
  backings: Backing[];
  backerCount: number;
  isLaunched: boolean;
  isProving: boolean;
  isCreator: boolean;
  isBacker: boolean;
  publicKeyB58?: string;
  canWithdraw: boolean;
  onWithdraw: (wallet: string) => void;
  withdrawing: boolean;
  withdrawStatus: string | null;
  chatCount?: number;
  // Creator-tab actions (optional; only used when isCreator).
  distributing?: boolean;
  distributeStatus?: string | null;
  onDistribute?: () => void;
  hasPendingBackings?: boolean;
}

export const MemeTabs: React.FC<Props> = ({
  meme, backings, backerCount, isLaunched, isProving,
  isCreator, isBacker,
  publicKeyB58, canWithdraw, onWithdraw, withdrawing, withdrawStatus,
  chatCount,
  distributing, distributeStatus, onDistribute, hasPendingBackings,
}) => {
  void isProving; // kept for future status-specific defaults

  // Decide which tabs to surface. Bots only when this meme has any
  // (Phase B stack OR legacy single-bot). Rewards only post-launch and
  // only for participants. Creator only when caller is the creator.
  const hasBots = ((meme.bots?.length ?? 0) > 0) || !!meme.buyback_bot_enabled;
  const showRewards = isLaunched && (isCreator || isBacker);
  const tabs: { key: TabKey; label: string; count?: number | string }[] = [
    { key: 'backers', label: 'Backers', count: backerCount },
    ...(hasBots ? [{ key: 'bots' as TabKey, label: 'Bots', count: meme.bots?.length ?? 1 }] : []),
    { key: 'chat', label: 'Chat', count: chatCount },
    ...(showRewards ? [{ key: 'rewards' as TabKey, label: 'Rewards' }] : []),
    ...(isCreator ? [{ key: 'creator' as TabKey, label: 'Creator' }] : []),
    { key: 'trust', label: 'Trust' },
    { key: 'overview', label: 'How' },
  ];

  // Default to backers — social proof lands strongest. Creator with
  // pending distribution gets nudged to the creator tab where the
  // retry button lives.
  const defaultTab: TabKey = isCreator && hasPendingBackings ? 'creator' : 'backers';
  const [tab, setTab] = useState<TabKey>(defaultTab);

  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      {/* Tab nav */}
      <div className="border-b border-[var(--border)] flex overflow-x-auto">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative shrink-0 px-3 sm:px-4 py-3 text-[11px] font-mono uppercase tracking-widest transition-colors whitespace-nowrap ${
                active
                  ? 'text-[var(--accent)] bg-[var(--background)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              [ {t.label}{t.count !== undefined && t.count !== null ? ` ${t.count}` : ''} ]
              {active && (
                <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[var(--accent)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div className="p-4 sm:p-5">
        {tab === 'backers' && (
          isLaunched ? (
            <GenesisBackerRoster memeId={meme.id} />
          ) : (
            <BackersList
              backings={backings}
              totalBacking={Number(meme.current_backing_sol)}
              currentWallet={publicKeyB58}
              canWithdraw={canWithdraw}
              onWithdraw={onWithdraw}
              withdrawing={withdrawing}
              withdrawStatus={withdrawStatus}
            />
          )
        )}
        {tab === 'bots' && <BuybackBotPanel meme={meme} />}
        {tab === 'chat' && <MemeChat memeId={meme.id} />}
        {tab === 'rewards' && (
          <ClaimRewards memeId={meme.id} isCreator={isCreator} isBacker={isBacker} />
        )}
        {tab === 'creator' && (
          <CreatorTab
            meme={meme}
            isLaunched={isLaunched}
            distributing={distributing ?? false}
            distributeStatus={distributeStatus ?? null}
            onDistribute={onDistribute}
            hasPendingBackings={hasPendingBackings ?? false}
          />
        )}
        {tab === 'trust' && <TrustTab meme={meme} />}
        {tab === 'overview' && <OverviewTab meme={meme} isProving={isProving} />}
      </div>
    </div>
  );
};

// ── CREATOR ───────────────────────────────────────────────────────────
// All creator-only controls in one focused tab: launch visibility +
// allowlist (LaunchVisibilityPanel), backer-drop manager (BackerVaultManager),
// and a stragglers-distribution retry button when the cron has any
// `confirmed` backings still waiting for their tokens post-launch.
const CreatorTab: React.FC<{
  meme: Meme;
  isLaunched: boolean;
  distributing: boolean;
  distributeStatus: string | null;
  onDistribute?: () => void;
  hasPendingBackings: boolean;
}> = ({ meme, isLaunched, distributing, distributeStatus, onDistribute, hasPendingBackings }) => {
  return (
    <div className="space-y-4">
      {/* Stragglers retry — only when there are still pending backings */}
      {isLaunched && hasPendingBackings && onDistribute && (
        <div className="border border-[var(--warning)]/60 bg-[var(--background)] p-3 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
            {'// DISTRIBUTION_PENDING'}
          </div>
          <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
            Some backers are still pending. Auto-distribution will retry; nudge it manually here.
          </p>
          <button onClick={onDistribute} disabled={distributing} className="btn-primary w-full text-xs py-2">
            {distributing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Distributing…
              </span>
            ) : (
              '[▶] Retry Pending Distribution'
            )}
          </button>
          {distributeStatus && (
            <div className="p-2 text-[10px] font-mono text-center uppercase tracking-widest border border-[var(--accent)] text-[var(--accent)]">
              &gt; {distributeStatus}
            </div>
          )}
        </div>
      )}

      {/* Visibility + allowlist + team-fairness cap */}
      <LaunchVisibilityPanel
        memeId={meme.id}
        currentVisibility={(meme.visibility ?? 'open') as 'open' | 'stealth' | 'spectator'}
        creatorWallet={meme.creator_wallet}
        canEdit={meme.status === 'backing'}
        maxBackingSol={meme.max_backing_sol ?? null}
      />

      {/* Backer drop manager — keycard-gated lounge content. Self-hides
          until the gate exists. */}
      <BackerVaultManager meme={meme} isCreator={true} />
    </div>
  );
};

// ── OVERVIEW ─────────────────────────────────────────────────────────
const OverviewTab: React.FC<{ meme: Meme; isProving: boolean }> = ({ meme, isProving }) => {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-2">
          {'/// HOW_IT_WORKS'}
        </h3>
        <ol className="space-y-2 text-xs sm:text-sm font-mono text-[var(--muted)] leading-relaxed">
          <li className="flex gap-2">
            <span className="text-[var(--accent-gold)] font-semibold">1.</span>
            <span>Backers pledge SOL into {meme.total_slots} equal slots.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent-gold)] font-semibold">2.</span>
            <span>When all slots fill, the pool makes ONE atomic launch buy on pump.fun.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent-gold)] font-semibold">3.</span>
            <span>Every backer enters at the same price — no dev allocation, no sniper gap.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent-gold)] font-semibold">4.</span>
            <span>Tokens auto-distribute to each backer&apos;s wallet, proportional to their stake.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent-gold)] font-semibold">5.</span>
            <span>
              Trading fees flow back to backers forever — your share scales with how much $
              {meme.symbol} you still hold.
            </span>
          </li>
        </ol>
      </div>

      <div className="border-t border-[var(--border)] pt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
        <span>Backer fee share: <span className="text-[var(--success)]">{meme.backer_share_pct}%</span></span>
        <span>Creator fee: <span className="text-[var(--accent-gold)]">{meme.creator_fee_pct}%</span></span>
        <span>Distribution: <span className="text-[var(--accent)]">hold-weighted</span></span>
        {isProving && (
          <span>Withdraw fee: <span className="text-[var(--warning)]">2%</span></span>
        )}
      </div>
    </div>
  );
};

// ── TRUST ────────────────────────────────────────────────────────────
const TrustTab: React.FC<{ meme: Meme }> = ({ meme }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const poolWallet = (meme as { pool_wallet?: string }).pool_wallet;
  const mint = meme.mint_address;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-1">
          {"/// DON'T_TRUST_VERIFY"}
        </h3>
        <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
          Everything that touches money is on-chain and inspectable. The pool wallet is the
          whole trust story: backers fund it, it makes one atomic launch buy, then it
          distributes tokens out.
        </p>
      </div>

      {poolWallet && (
        <div className="border border-[var(--border)] bg-[var(--background)] p-3">
          <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5">
            Pool wallet · backers fund here → launch buy → distributed out
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] sm:text-xs font-mono break-all">{poolWallet}</code>
            <button
              onClick={() => copy(poolWallet, 'pool')}
              className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors shrink-0"
              aria-label="Copy pool wallet"
            >
              {copied === 'pool' ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <a
              href={`https://solscan.io/account/${poolWallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[10px] font-mono uppercase tracking-widest transition-colors shrink-0"
            >
              Solscan <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      )}

      {mint && (
        <div className="border border-[var(--border)] bg-[var(--background)] p-3">
          <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5">
            Contract · check holders — spread across backers, no dev bag
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] sm:text-xs font-mono break-all">{mint}</code>
            <button
              onClick={() => copy(mint, 'mint')}
              className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors shrink-0"
              aria-label="Copy mint"
            >
              {copied === 'mint' ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <a
              href={`https://solscan.io/account/${mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[10px] font-mono uppercase tracking-widest transition-colors shrink-0"
            >
              Solscan <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      )}

      <div className="border-t border-[var(--border)] pt-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] space-y-1">
        <div>Trust score: <span className="text-[var(--accent)]">{meme.trust_score ?? '—'}/100</span></div>
        <div>Dev initial buy: <span className="text-[var(--foreground)]">{meme.dev_initial_buy_sol ?? 0} SOL</span></div>
        <div>Auto-refund on fail: <span className="text-[var(--success)]">{meme.auto_refund ? 'YES' : 'NO'}</span></div>
      </div>
    </div>
  );
};
