'use client';

import { Loader2, ExternalLink, Copy, Check, Clock, RefreshCw, Lock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Meme } from '@/types/database';

// All four status branches in one component because they share the same
// visual slot on the page. Each branch renders its own primary action
// loud and centered, with secondary details below. Keeps the action
// above the fold no matter what state the meme is in.

interface BackingProps {
  variant: 'backing';
  meme: Meme;
  backerCount: number;
  totalBackingSol: number;
  slotsRemaining: number;
  totalSlots: number;
  timeRemaining: string;
  minBacking: number;
  amount: string;
  setAmount: (s: string) => void;
  onPledge: () => void;
  backing: boolean;
  backingStatus: string | null;
  backingPaused: boolean;
  connected: boolean;
  projectedSharePct: number;
  // List of confirmed backer wallets — used to compute the team-vs-open
  // slot breakdown when the launch has reserved slots. Computed
  // upstream from the realtime backings hook + allowlist fetch.
  backerWallets?: string[];
  allowlistWallets?: string[];
}

interface FundedProps {
  variant: 'funded';
  meme: Meme;
  totalSlots: number;
  totalBackingSol: number;
  isCreator: boolean;
  isLaunching: boolean;
  launching: boolean;
  launchStatus: string | null;
  onLaunch: () => void;
  onResetWindow: () => void;       // creator-only — extends launch window 48h
  resetting: boolean;
  resetStatus: string | null;
  connected: boolean;
}

interface LiveProps {
  variant: 'live';
  meme: Meme;
  myBacking?: {
    amount_sol: number | string;
    status?: string;
    claim_tx?: string;
    claim_tokens?: string | number;
  } | null;
}

type Props = BackingProps | FundedProps | LiveProps;

export const MemeActionPanel: React.FC<Props> = (props) => {
  if (props.variant === 'live') return <LivePanel {...props} />;
  if (props.variant === 'funded') return <FundedPanel {...props} />;
  return <BackingPanel {...props} />;
};

// ── LIVE ────────────────────────────────────────────────────────────
// Dashboard-density version: one slim row — BUY button + contract chip.
// External links (dex/solscan/jup) + your allocation moved to their own
// dashboard grid cards so this stays a ~60px primary CTA ribbon.
const LivePanel: React.FC<LiveProps> = ({ meme }) => {
  const [copied, setCopied] = useState(false);
  const copy = (t: string) => {
    navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!meme.mint_address) return null;
  const tradeUrl = meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`;
  return (
    <div className="border border-[var(--success)] bg-[var(--card)] flex items-stretch">
      <a
        href={tradeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 text-center py-3 bg-[var(--success)] hover:opacity-90 text-[#0a0a0a] font-mono font-bold uppercase tracking-widest text-xs sm:text-sm transition-opacity flex items-center justify-center"
      >
        ▶ BUY ${meme.symbol} ON PUMP.FUN
      </a>
      <div className="flex items-center gap-2 px-3 border-l border-[var(--success)] bg-[var(--background)] min-w-0">
        <code className="text-[10px] sm:text-[11px] font-mono text-[var(--muted)] truncate max-w-[180px] sm:max-w-[260px]">
          {meme.mint_address.slice(0, 8)}…{meme.mint_address.slice(-6)}
        </code>
        <button
          onClick={() => copy(meme.mint_address!)}
          className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors shrink-0"
          aria-label="Copy mint address"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};


const ExternalChip: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[10px] font-mono uppercase tracking-widest transition-colors"
  >
    {children} <ExternalLink className="w-2.5 h-2.5" />
  </a>
);

// Pump.fun tokens are Token-2022 with 6 decimals. Match the existing
// formatting used elsewhere on the page so the on-chain numbers read
// the same across views.
const PUMP_TOKEN_DECIMALS = 6;
function formatTokens(raw: string | number | null | undefined): string {
  const n = Number(raw || 0) / 10 ** PUMP_TOKEN_DECIMALS;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ── FUNDED / LAUNCHING ───────────────────────────────────────────────
const FundedPanel: React.FC<FundedProps> = ({
  meme, totalSlots, totalBackingSol, isCreator, isLaunching, launching, launchStatus,
  onLaunch, onResetWindow, resetting, resetStatus, connected,
}) => {
  // Live-updating countdown to launch_deadline. Re-renders every second
  // when not loading. Once the deadline hits, the cron auto-refunds
  // backers — anyone viewing then sees a clear "expired" state.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadlineMs = meme.launch_deadline ? new Date(meme.launch_deadline).getTime() : null;
  const remainingMs = deadlineMs !== null ? deadlineMs - nowMs : null;
  const expired = remainingMs !== null && remainingMs <= 0;
  const lowTime = remainingMs !== null && remainingMs > 0 && remainingMs < 6 * 60 * 60 * 1000; // < 6h

  const fmtRemaining = (ms: number) => {
    if (ms <= 0) return 'expired';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="border border-[var(--accent-gold)] bg-[var(--card)]">
      <div className="border-b border-[var(--accent-gold)] px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
          {'// STATE: GOAL_REACHED'}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] pulse-glow">
          [!] READY
        </span>
      </div>
      <div className="p-4 sm:p-5 space-y-4">
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
            ALL {totalSlots} SLOTS FILLED · {totalBackingSol.toFixed(2)} SOL RAISED
          </div>
          <p className="text-xs font-mono text-[var(--muted)] mt-2">
            Token is ready to deploy on pump.fun.
          </p>
        </div>

        {/* Launch countdown — visible to everyone, signals creator engagement.
            Expired state shows refund-in-progress copy (next cron tick handles
            the actual refund, this just communicates the state). */}
        {deadlineMs !== null && (
          <div className={`border px-3 py-2.5 ${
            expired ? 'border-[var(--error)] bg-[var(--error)]/10'
            : lowTime ? 'border-[var(--warning)] bg-[var(--warning)]/10'
            : 'border-[var(--border)] bg-[var(--background)]'
          }`}>
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
              <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
                <Clock className="w-3 h-3" />
                {expired ? 'Launch window expired' : 'Creator must launch within'}
              </span>
              <span className={
                expired ? 'text-[var(--error)]'
                : lowTime ? 'text-[var(--warning)]'
                : 'text-[var(--accent-gold)]'
              }>
                {remainingMs !== null ? fmtRemaining(remainingMs) : '—'}
              </span>
            </div>
            {expired && (
              <p className="text-[11px] font-mono text-[var(--error)]/90 mt-1.5 leading-snug">
                &gt; Backers will be auto-refunded on the next cron tick (within 1 hour).
              </p>
            )}
            {!expired && !isCreator && (
              <p className="text-[10px] font-mono text-[var(--muted)] mt-1 leading-snug">
                &gt; Creator can extend this window by 48h to stay engaged.
              </p>
            )}
          </div>
        )}

        {isCreator ? (
          <>
            <button
              onClick={onLaunch}
              disabled={launching || isLaunching || expired}
              className="w-full py-4 sm:py-5 bg-[var(--accent-gold)] hover:opacity-90 text-[#0a0a0a] font-mono font-bold uppercase tracking-widest text-sm sm:text-base transition-opacity disabled:opacity-50"
            >
              {launching || isLaunching ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deploying…
                </span>
              ) : expired ? (
                <>LAUNCH WINDOW EXPIRED</>
              ) : (
                <>▶ LAUNCH TOKEN</>
              )}
            </button>
            {!expired && (
              <button
                onClick={onResetWindow}
                disabled={resetting || launching || isLaunching}
                className="w-full py-2.5 border border-[var(--border)] hover:border-[var(--accent-gold)] text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent-gold)] transition-colors disabled:opacity-50"
              >
                {resetting ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Resetting…
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center gap-2">
                    <RefreshCw className="w-3 h-3" />
                    Reset Window (+48h)
                  </span>
                )}
              </button>
            )}
          </>
        ) : (
          <div className="text-center py-3 text-[10px] font-mono text-[var(--muted)] border border-[var(--border)] uppercase tracking-widest">
            {connected ? '> Waiting for creator to launch…' : '> Connect wallet to view'}
          </div>
        )}

        {launchStatus && <StatusLine text={launchStatus} />}
        {resetStatus && <StatusLine text={resetStatus} />}
      </div>
    </div>
  );
};

// ── BACKING ──────────────────────────────────────────────────────────
const BackingPanel: React.FC<BackingProps> = ({
  meme,
  backerCount, totalBackingSol, slotsRemaining, totalSlots, timeRemaining,
  minBacking, amount, setAmount, onPledge, backing, backingStatus, backingPaused, connected,
  projectedSharePct, backerWallets, allowlistWallets,
}) => {
  const filled = backerCount;
  const slotsFull = slotsRemaining <= 0;

  // Allowlist-aware fill semantics. When reserved_slots > 0 and we
  // know who the backers + allowlisted wallets are, allowlisted
  // backings fill TEAM slots first (right side, gold squares) and
  // public backings fill OPEN slots (left side). Without these
  // inputs we fall back to the legacy "fill left-to-right" visual.
  const reservedSlotsCount = Number(meme.reserved_slots) || 0;
  const openSlotsCountLegacy = Math.max(0, (Number(meme.total_slots) || totalSlots) - reservedSlotsCount);
  const allowSetForVisual = new Set(allowlistWallets ?? []);
  const allowlistedBackingsForVisual = (backerWallets ?? []).filter((w) => allowSetForVisual.has(w)).length;
  const publicBackingsForVisual = (backerWallets?.length ?? 0) - allowlistedBackingsForVisual;
  const teamFilledForVisual = Math.min(allowlistedBackingsForVisual, reservedSlotsCount);
  const teamOverflowForVisual = Math.max(0, allowlistedBackingsForVisual - reservedSlotsCount);
  const openFilledForVisual = publicBackingsForVisual + teamOverflowForVisual;
  const canDisaggregate = reservedSlotsCount > 0
    && backerWallets !== undefined
    && allowlistWallets !== undefined
    && allowlistWallets.length > 0;

  // Launch Configuration v2 — visibility gating.
  // For stealth/spectator launches, check if the connected wallet is on
  // the backing_allowlist. If not, the backing UI is replaced with a
  // "restricted round" state.
  //
  // Phase 7 — reservation gating. When `reserved_slots > 0`, the
  // backing_allowlist also controls who can take the reserved slot
  // positions even on visibility=open launches. Public can still
  // back open slots until they fill; once filled, non-allowlisted
  // backers can't take a reserved slot (would strand SOL otherwise).
  const { publicKey } = useWallet();
  const visibility = meme.visibility ?? 'open';
  const isGated = visibility === 'stealth' || visibility === 'spectator';
  const reservedSlots = Number(meme.reserved_slots) || 0;
  const totalSlotsCount = Number(meme.total_slots) || totalSlots;
  const openSlotsCount = Math.max(0, totalSlotsCount - reservedSlots);
  const isTeamRound = reservedSlots > 0 && reservedSlots === totalSlotsCount;
  const hasReservedSlots = reservedSlots > 0;
  // Whether the allowlist check is needed for backing at all.
  const needsAllowlistCheck = isGated || hasReservedSlots;
  // Whether all open (non-reserved) slots are filled — used to gate
  // non-allowlisted backers from trying the API.
  //
  // When we can disaggregate (allowlist + backer wallets known), count
  // ONLY public-bucket fills against openSlotsCount; otherwise team
  // backings sitting in reserved slots wrongly "fill up" the open
  // bucket and gate public backers out prematurely. Legacy fallback
  // (no allowlist data) keeps the old totals comparison so non-
  // reservation launches behave identically.
  const allOpenSlotsFilled = canDisaggregate
    ? openFilledForVisual >= openSlotsCount
    : filled >= openSlotsCount;
  const cap = meme.max_backing_sol != null ? Number(meme.max_backing_sol) : null;

  // Eligibility state: 'open' | 'checking' | 'eligible' | 'not_eligible'
  const [eligibility, setEligibility] = useState<'open' | 'checking' | 'eligible' | 'not_eligible'>(
    needsAllowlistCheck ? 'checking' : 'open',
  );

  useEffect(() => {
    if (!needsAllowlistCheck) {
      setEligibility('open');
      return;
    }
    if (!publicKey) {
      // For gated launches: not connected = can't back. For reserved
      // launches: still allow rendering the open-slot path, the
      // backing handler will block at sign time if they hit a reserved.
      setEligibility(isGated ? 'not_eligible' : 'open');
      return;
    }
    setEligibility('checking');
    let cancelled = false;
    fetch(`/api/memes/${meme.id}/allowlist`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const wallets: string[] = (d?.allowlist || []).map((e: { wallet: string }) => e.wallet);
        const me = publicKey.toBase58();
        setEligibility(wallets.includes(me) ? 'eligible' : 'not_eligible');
      })
      .catch(() => {
        // Fail-closed only for fully-gated launches. For reservation-
        // only launches we let the user try (server still enforces).
        if (!cancelled) setEligibility(isGated ? 'not_eligible' : 'open');
      });
    return () => { cancelled = true; };
  }, [needsAllowlistCheck, isGated, publicKey, meme.id]);

  // Render the gated state instead of backing UI when:
  //  - visibility is stealth/spectator AND wallet is not eligible
  //  - OR it's a TEAM ROUND (all slots reserved) AND wallet not allowlisted
  //  - OR it's a hybrid reservation AND open slots are filled AND wallet not allowlisted
  const showGatedState =
    (isGated && (eligibility === 'not_eligible' || eligibility === 'checking'))
    || (isTeamRound && eligibility === 'not_eligible')
    || (hasReservedSlots && !isTeamRound && allOpenSlotsFilled && eligibility === 'not_eligible');

  return (
    <div className="border border-[var(--accent)] bg-[var(--card)]">
      <div className="border-b border-[var(--accent)] px-4 py-2 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          {'// BACK_THIS_TOKEN'}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
          <Clock className="w-3 h-3" /> {timeRemaining}
        </span>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Progress strip */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest mb-2">
            <span className="text-[var(--muted)]">SLOTS [{filled}/{totalSlots}]</span>
            <span className="text-[var(--accent)]">{slotsRemaining > 0 ? `${slotsRemaining} OPEN` : 'FULL'}</span>
            <span className="text-[var(--muted)]">{totalBackingSol.toFixed(2)} SOL</span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: totalSlots }).map((_, i) => {
              // For reservation launches, slots are split into open
              // (1..openSlotsCount) and reserved (the rest). Visually
              // tint the reserved positions amber-gold so backers see
              // the structure at a glance.
              const isReserved = hasReservedSlots && i >= openSlotsCount;
              // Fill semantics:
              //  - When we can disaggregate (allowlist + backers known),
              //    open positions fill left-to-right based on openFilledForVisual,
              //    reserved positions fill from openSlotsCount based on
              //    teamFilledForVisual. So an allowlisted creator backing
              //    correctly turns a GOLD reserved square solid, not an
              //    amber open square.
              //  - Legacy fallback (no allowlist data): plain left-to-right.
              const isFilled = canDisaggregate
                ? (isReserved
                    ? i < openSlotsCountLegacy + teamFilledForVisual
                    : i < openFilledForVisual)
                : i < filled;
              if (isFilled) {
                return (
                  <div
                    key={i}
                    className={`flex-1 h-3 ${isReserved ? 'bg-[var(--accent-gold)]' : 'bg-[var(--accent)]'}`}
                  />
                );
              }
              if (isReserved) {
                return <div key={i} className="flex-1 h-3 border border-[var(--accent-gold)] bg-[var(--accent-gold)]/10" />;
              }
              return <div key={i} className="flex-1 h-3 border border-[var(--accent)]" />;
            })}
          </div>

          {/* Color-keyed legend immediately under the bar. When the launch
              has reserved slots AND we can disaggregate, this is the ONE
              source of truth tying orange=OPEN and gold=TEAM to actual
              fill counts. Replaces the older second split-bar block. */}
          {hasReservedSlots && canDisaggregate && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono uppercase tracking-widest mt-2">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 bg-[var(--accent)]" />
                <span className="text-[var(--muted)]">OPEN</span>
                <span className="text-[var(--foreground)]">{openFilledForVisual}/{openSlotsCount}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 bg-[var(--accent-gold)]" />
                <span className="text-[var(--muted)]">TEAM</span>
                <span className="text-[var(--foreground)]">{teamFilledForVisual}/{reservedSlots}</span>
              </span>
            </div>
          )}
        </div>

        {/* Rules chip row — surfaces cap + reservation structure so
            backers see them upfront, not as error messages. */}
        {(cap !== null || hasReservedSlots) && (
          <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-widest">
            {cap !== null && (
              <span className="border border-[var(--border)] px-2 py-1 text-[var(--muted)]">
                Max <span className="text-[var(--foreground)]">{cap} SOL</span> per backer
              </span>
            )}
            {isTeamRound ? (
              <span className="border border-[var(--accent-gold)]/60 bg-[var(--accent-gold)]/5 px-2 py-1 text-[var(--accent-gold)]">
                TEAM ROUND · 0 PUBLIC SLOTS
              </span>
            ) : hasReservedSlots && (
              <span className="border border-[var(--accent)]/60 px-2 py-1 text-[var(--accent)]">
                {openSlotsCount} OPEN · {reservedSlots} RESERVED
              </span>
            )}
          </div>
        )}

        {showGatedState ? (
          <div className="border border-[var(--accent-gold)] bg-[var(--background)] p-5 space-y-3">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
              <Lock className="w-3 h-3" />
              {isTeamRound
                ? 'TEAM ROUND'
                : hasReservedSlots && allOpenSlotsFilled
                ? 'OPEN SLOTS FILLED'
                : visibility === 'stealth'
                ? 'INTERNAL ROUND'
                : 'RESTRICTED ROUND'}
            </div>
            <div className="text-xs font-mono text-[var(--foreground)] leading-relaxed">
              {isTeamRound
                ? `All ${totalSlotsCount} slots are reserved for declared wallets. Public can't back this launch — it's a transparent team round. Watch for liquidity on the secondary market post-launch.`
                : hasReservedSlots && allOpenSlotsFilled
                ? `All ${openSlotsCount} open slots are filled. The remaining ${reservedSlots} are reserved for the creator's allowlisted wallets.`
                : 'This launch is in a restricted backing round. Only approved wallets can back right now.'}
            </div>
            {!connected ? (
              <div className="text-[11px] font-mono text-[var(--muted)]">
                &gt; Connect your wallet to check eligibility
              </div>
            ) : eligibility === 'checking' ? (
              <div className="text-[11px] font-mono text-[var(--muted)] flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Checking eligibility…
              </div>
            ) : (
              <div className="text-[11px] font-mono text-[var(--muted)] leading-snug">
                &gt; Your connected wallet is not on the allowlist.
                {!hasReservedSlots && (
                  <>
                    <br />
                    &gt; The creator may flip this launch to open backing at any time. Once it does (or once the launch completes), full transparency is restored — that&apos;s the PROOF guarantee.
                  </>
                )}
              </div>
            )}
          </div>
        ) : !connected ? (
          <div className="border border-[var(--border)] bg-[var(--background)] p-5 text-center">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-1.5">
              [!] NO_WALLET
            </div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--muted)]">
              &gt; Connect a wallet to back this token
            </div>
          </div>
        ) : (
          <>
            {/* Amount input */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  &gt; Your Pledge (SOL)
                </label>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  Min: <span className="text-[var(--foreground)]">{minBacking}</span>
                </span>
              </div>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={minBacking.toString()}
                min={minBacking}
                step="0.1"
                className="w-full px-4 py-3 bg-[var(--background)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-xl sm:text-2xl font-mono font-semibold"
              />
              <div className="grid grid-cols-3 gap-2 mt-2">
                <PresetButton onClick={() => setAmount(String(minBacking))} label="Min" />
                <PresetButton onClick={() => setAmount(String(minBacking * 2))} label="2x" />
                <PresetButton onClick={() => setAmount(String(minBacking * 5))} label="5x" />
              </div>
            </div>

            {/* Primary action */}
            <button
              onClick={onPledge}
              disabled={!amount || Number(amount) <= 0 || backing || backingPaused || slotsFull}
              className="w-full py-4 sm:py-5 bg-[var(--accent)] hover:opacity-90 text-[#0a0a0a] font-mono font-bold uppercase tracking-widest text-sm sm:text-base transition-opacity disabled:opacity-40"
            >
              {backing ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Pledging…
                </span>
              ) : slotsFull ? (
                <>SLOTS FULL</>
              ) : (
                <>▶ BACK WITH {amount || '0'} SOL</>
              )}
            </button>

            {amount && Number(amount) > 0 && (
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] bg-[var(--background)] p-3">
                <span className="text-[var(--muted)]">
                  To pool: <span className="text-[var(--foreground)]">{Number(amount).toFixed(4)} SOL</span>
                  <span className="text-[var(--muted)]/70 ml-1">(no fee)</span>
                </span>
                <span className="text-[var(--muted)] sm:ml-auto">
                  Share: <span className="text-[var(--success)]">~{projectedSharePct.toFixed(1)}%</span>
                </span>
              </div>
            )}

            {backingStatus && <StatusLine text={backingStatus} />}
          </>
        )}
      </div>
    </div>
  );
};

const PresetButton: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    onClick={onClick}
    className="py-2 text-[11px] font-mono uppercase tracking-widest border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
  >
    [&gt;] {label}
  </button>
);

const StatusLine: React.FC<{ text: string }> = ({ text }) => {
  const cls = text.includes('Error')
    ? 'text-[var(--error)] border-[var(--error)]'
    : text.toLowerCase().includes('success') || text.toLowerCase().includes('launched')
    ? 'text-[var(--success)] border-[var(--success)]'
    : 'text-[var(--accent)] border-[var(--accent)]';
  return (
    <div className={`p-2.5 text-[11px] font-mono text-center uppercase tracking-widest border ${cls}`}>
      &gt; {text}
    </div>
  );
};
