'use client';

import { FC, useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { Coins, Loader2, Check, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';

// Smooth-rolling number that animates between value changes over ~800ms.
// Renders to 6 decimals, matching the SOL display elsewhere in the
// component. Used for both Claimable and Pending so backers actually
// SEE the value change instead of it jumping on each poll.
const TickingNumber: FC<{ value: number; decimals?: number }> = ({ value, decimals = 6 }) => {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const duration = 800;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);

  return <>{display.toFixed(decimals)}</>;
};

interface TokenReward {
  meme_id: string;
  name: string;
  symbol: string;
  claimable: number;
  claimed: number;
  pending?: number; // on-chain creator-vault share, next-cron-tick credit
}

interface RewardsData {
  wallet: string;
  backer_rewards: {
    claimable: number;
    pending?: number;
    total_claimed: number;
    tokens: TokenReward[];
  };
  creator_rewards: {
    claimable: number;
    total_claimed: number;
    tokens: TokenReward[];
  };
  total_claimable: number;
  total_pending?: number;
  total_claimed: number;
}

export const PortfolioRewards: FC = () => {
  const { connected, publicKey, signMessage } = useWallet();
  const [rewards, setRewards] = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ success: boolean; message: string; tx?: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Fetch user-specific rewards (claimable + on-chain pending). Polled
  // frequently (15s) so backers see their share of new pump trades tick
  // up into "Pending" in near-real-time.
  const fetchRewards = useCallback(async () => {
    if (!connected || !publicKey) {
      setRewards(null);
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`/api/fees/claim?wallet=${publicKey.toBase58()}`);
      if (response.ok) {
        const data = await response.json();
        setRewards(data);
      }
    } catch (error) {
      console.error('Failed to fetch rewards:', error);
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey]);

  useEffect(() => {
    fetchRewards();
    const fastPoll = setInterval(fetchRewards, 15000);
    return () => {
      clearInterval(fastPoll);
    };
  }, [fetchRewards]);

  const handleClaimAll = async () => {
    if (!connected || !publicKey || !signMessage || !rewards?.total_claimable) return;

    setClaiming(true);
    setClaimResult(null);

    try {
      const wallet = publicKey.toBase58();
      const authMessage = `claim:all:${wallet}:${Date.now()}`;
      const msgBytes = new TextEncoder().encode(authMessage);
      const sigBytes = await signMessage(msgBytes);
      const sigB58 = bs58.encode(sigBytes);

      const response = await fetch('/api/fees/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: wallet,
          signature: sigB58,
          message: authMessage,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setClaimResult({
          success: true,
          message: `Successfully claimed ${data.amount_sent.toFixed(6)} SOL!`,
          tx: data.tx_signature,
        });
        // Refresh rewards
        fetchRewards();
      } else {
        setClaimResult({
          success: false,
          message: data.error || 'Claim failed',
        });
      }
    } catch (error) {
      setClaimResult({
        success: false,
        message: 'Network error. Please try again.',
      });
    } finally {
      setClaiming(false);
    }
  };

  if (!connected) {
    return null;
  }

  if (loading) {
    return (
      <div className="card p-4">
        <div className="flex items-center justify-center gap-2 text-[var(--muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading rewards...</span>
        </div>
      </div>
    );
  }

  const hasClaimable = rewards && rewards.total_claimable > 0;
  const hasClaimed = rewards && rewards.total_claimed > 0;
  const hasPending = rewards && (rewards.total_pending || 0) > 0;
  const hasAnyRewards = hasClaimable || hasClaimed || hasPending;

  // Get all tokens with rewards
  const allTokens = [
    ...(rewards?.backer_rewards.tokens || []).map(t => ({ ...t, type: 'backer' as const })),
    ...(rewards?.creator_rewards.tokens || []).map(t => ({ ...t, type: 'creator' as const })),
  ].filter(t => t.claimable > 0 || t.claimed > 0);

  // Connected but nothing accrued yet — still render the full Claimable/Pending/
  // Claimed grid so backers SEE the live counter is online and waiting. This
  // is the pre-launch state for users who only have 'backing'/'confirmed'
  // backings (memes that haven't launched yet), so there are no DB-tracked
  // rewards AND no on-chain vault accrual — but the UI should still display
  // the system existing instead of an empty state that hides the feature.
  if (!hasAnyRewards) {
    return (
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold">Trading Fee Rewards</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[var(--background)] rounded-lg p-4">
            <div className="text-sm text-[var(--muted)] mb-1">Claimable</div>
            <div className="text-2xl font-bold text-[var(--muted)]">0.000000 SOL</div>
          </div>
          <div className="bg-[var(--background)] rounded-lg p-4">
            <div className="text-sm text-[var(--muted)] mb-1 flex items-center gap-2">
              Pending
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[var(--success)]">
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]" />
                </span>
                Live
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--muted)]">0.000000 SOL</div>
            <div className="text-[10px] font-mono text-[var(--muted)]/80 mt-1">
              on-chain accrual, lands at next cron tick
            </div>
          </div>
          <div className="bg-[var(--background)] rounded-lg p-4">
            <div className="text-sm text-[var(--muted)] mb-1">Total Claimed</div>
            <div className="text-2xl font-bold text-[var(--muted)]">0.000000 SOL</div>
          </div>
        </div>

        <p className="text-sm text-[var(--muted)]">
          You earn 90% of pump.fun trading fees on every token you back.
          Rewards appear here automatically once your backed tokens launch
          and start trading — the <span className="text-[var(--success)] font-medium">Pending</span> counter
          updates in near-real-time as trades hit the on-chain creator vault,
          and the hourly cron sweeps it into <span className="text-[var(--foreground)] font-medium">Claimable</span> for
          one-click payout.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold">Trading Fee Rewards</h2>
        </div>
        {allTokens.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] flex items-center gap-1"
          >
            {expanded ? 'Hide' : 'Show'} details
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Summary — Claimable (ready now) + Pending (live on-chain accrual) + Total Claimed */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[var(--background)] rounded-lg p-4">
          <div className="text-sm text-[var(--muted)] mb-1">Claimable</div>
          <div className={`text-2xl font-bold ${hasClaimable ? 'text-[var(--success)]' : ''}`}>
            <TickingNumber value={rewards?.total_claimable || 0} /> SOL
          </div>
        </div>
        <div className="bg-[var(--background)] rounded-lg p-4">
          <div className="text-sm text-[var(--muted)] mb-1 flex items-center gap-2">
            Pending
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[var(--success)]">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]" />
              </span>
              Live
            </span>
          </div>
          <div className={`text-2xl font-bold ${(rewards?.total_pending || 0) > 0 ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`}>
            <TickingNumber value={rewards?.total_pending || 0} /> SOL
          </div>
          <div className="text-[10px] font-mono text-[var(--muted)]/80 mt-1">
            on-chain accrual, lands at next cron tick
          </div>
        </div>
        <div className="bg-[var(--background)] rounded-lg p-4">
          <div className="text-sm text-[var(--muted)] mb-1">Total Claimed</div>
          <div className="text-2xl font-bold">
            {(rewards?.total_claimed || 0).toFixed(6)} SOL
          </div>
        </div>
      </div>

      {/* Breakdown by source */}
      {rewards && (rewards.backer_rewards.claimable > 0 || rewards.creator_rewards.claimable > 0) && (
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          {rewards.backer_rewards.claimable > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">From backing ({rewards.backer_rewards.tokens.length} tokens):</span>
              <span className="font-medium text-[var(--success)]">
                {rewards.backer_rewards.claimable.toFixed(6)} SOL
              </span>
            </div>
          )}
          {rewards.creator_rewards.claimable > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Creator fees ({rewards.creator_rewards.tokens.length} tokens):</span>
              <span className="font-medium text-[var(--success)]">
                {rewards.creator_rewards.claimable.toFixed(6)} SOL
              </span>
            </div>
          )}
        </div>
      )}

      {/* Expanded token details */}
      {expanded && allTokens.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <div className="text-sm font-medium text-[var(--muted)]">By Token:</div>
          {allTokens.map((token, idx) => (
            <Link
              key={`${token.meme_id}-${token.type}-${idx}`}
              href={`/meme/${token.meme_id}`}
              className="flex justify-between items-center text-sm p-2 rounded-lg bg-[var(--background)] hover:bg-[var(--border)] transition-colors"
            >
              <div>
                <span className="font-medium">{token.name}</span>
                <span className="text-[var(--muted)] ml-2">${token.symbol}</span>
                <span className="text-xs text-[var(--muted)] ml-2">
                  ({token.type === 'backer' ? 'backer' : 'creator'})
                </span>
              </div>
              <div className="text-right">
                {token.claimable > 0 && (
                  <span className="text-[var(--success)] font-medium">
                    {token.claimable.toFixed(6)} SOL
                  </span>
                )}
                {token.claimable === 0 && token.claimed > 0 && (
                  <span className="text-[var(--muted)]">
                    claimed {token.claimed.toFixed(6)} SOL
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Claim All button */}
      {hasClaimable && (
        <button
          onClick={handleClaimAll}
          disabled={claiming}
          className="w-full py-3 px-4 rounded-lg bg-[var(--success)] text-white font-semibold hover:bg-[var(--success)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {claiming ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Claiming...
            </span>
          ) : (
            `Claim All ${rewards?.total_claimable.toFixed(4)} SOL`
          )}
        </button>
      )}

      {/* Claim result */}
      {claimResult && (
        <div
          className={`p-3 rounded-lg text-sm ${
            claimResult.success
              ? 'bg-[var(--success)]/20 text-[var(--success)]'
              : 'bg-[var(--error)]/20 text-[var(--error)]'
          }`}
        >
          <div className="flex items-center gap-2">
            {claimResult.success && <Check className="w-4 h-4" />}
            <span>{claimResult.message}</span>
          </div>
          {claimResult.tx && (
            <a
              href={`https://solscan.io/tx/${claimResult.tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 mt-2 text-xs underline"
            >
              View transaction <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Info */}
      <p className="text-xs text-[var(--muted)]">
        Rewards accrue from trading fees when your backed tokens are traded on pump.fun. Min claim: 0.001 SOL.
      </p>
    </div>
  );
};
