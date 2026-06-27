'use client';

import { FC, useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { Coins, Loader2, Check, ExternalLink } from 'lucide-react';

interface RewardsData {
  backer_rewards: {
    claimable: number;
    total_claimed: number;
  };
  creator_rewards: {
    claimable: number;
    total_claimed: number;
  };
  total_claimable: number;
  total_claimed: number;
}

interface ClaimRewardsProps {
  memeId: string;
  isCreator: boolean;
  isBacker: boolean;
}

export const ClaimRewards: FC<ClaimRewardsProps> = ({ memeId, isCreator, isBacker }) => {
  const { connected, publicKey, signMessage } = useWallet();
  const [rewards, setRewards] = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ success: boolean; message: string; tx?: string } | null>(null);

  const fetchRewards = useCallback(async () => {
    if (!connected || !publicKey) {
      setRewards(null);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/fees/claim?wallet=${publicKey.toBase58()}&meme_id=${memeId}`);
      if (response.ok) {
        const data = await response.json();
        setRewards(data);
      }
    } catch (error) {
      console.error('Failed to fetch rewards:', error);
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, memeId]);

  useEffect(() => {
    fetchRewards();
    // Poll every 30 seconds
    const interval = setInterval(fetchRewards, 30000);
    return () => clearInterval(interval);
  }, [fetchRewards]);

  const handleClaim = async () => {
    if (!connected || !publicKey || !signMessage || !rewards?.total_claimable) return;

    setClaiming(true);
    setClaimResult(null);

    try {
      const wallet = publicKey.toBase58();
      const authMessage = `claim:${memeId}:${wallet}:${Date.now()}`;
      const msgBytes = new TextEncoder().encode(authMessage);
      const sigBytes = await signMessage(msgBytes);
      const sigB58 = bs58.encode(sigBytes);

      const response = await fetch('/api/fees/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: wallet,
          meme_id: memeId,
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

  // Don't show if user is neither creator nor backer
  if (!isCreator && !isBacker) {
    return null;
  }

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

  const backerClaimable = rewards?.backer_rewards.claimable ?? 0;
  const creatorClaimable = rewards?.creator_rewards.claimable ?? 0;
  // Backer claims are paused pending the active-claim mechanism. Only
  // the creator portion is actually claimable until that lands. The API
  // also enforces this server-side; the UI just renders the matching
  // state so the button doesn't pretend it'll succeed.
  const claimableNow = creatorClaimable;
  const accruingPaused = backerClaimable;
  const hasClaimed = rewards && rewards.total_claimed > 0;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Coins className="w-5 h-5 text-[var(--accent)]" />
        <h3 className="font-semibold">Trading Fee Rewards</h3>
      </div>

      {rewards && (
        <div className="space-y-2">
          {/* Backer rewards — accruing, distribution paused */}
          {isBacker && accruingPaused > 0 && (
            <div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted)]">Backer share (accruing):</span>
                <span className="font-medium text-[var(--accent-gold)]">
                  {accruingPaused.toFixed(6)} SOL
                </span>
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-1">
                Claim mechanism paused pending legal review. Balance continues to accrue. See <a href="/roadmap" className="underline">roadmap</a>.
              </p>
            </div>
          )}

          {/* Creator rewards — claimable */}
          {isCreator && creatorClaimable > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Creator fee:</span>
              <span className="font-medium text-[var(--success)]">
                {creatorClaimable.toFixed(6)} SOL
              </span>
            </div>
          )}

          {/* Total claimable now (creator only while backer is paused) */}
          {claimableNow > 0 && (
            <div className="flex justify-between text-sm pt-2 border-t border-[var(--border)]">
              <span className="font-medium">Claimable now:</span>
              <span className="font-bold text-[var(--success)]">
                {claimableNow.toFixed(6)} SOL
              </span>
            </div>
          )}

          {/* Previously claimed */}
          {hasClaimed && (
            <div className="flex justify-between text-xs text-[var(--muted)]">
              <span>Previously claimed:</span>
              <span>{rewards.total_claimed.toFixed(6)} SOL</span>
            </div>
          )}
        </div>
      )}

      {/* No rewards message */}
      {claimableNow === 0 && accruingPaused === 0 && !hasClaimed && (
        <p className="text-sm text-[var(--muted)]">
          No rewards yet. Rewards accrue from trading fees when this token is traded.
        </p>
      )}

      {/* Claim button — only when creator portion is actually claimable */}
      {claimableNow > 0 && (
        <button
          onClick={handleClaim}
          disabled={claiming}
          className="w-full py-2 px-4 rounded-lg bg-[var(--success)] text-white font-medium hover:bg-[var(--success)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {claiming ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Claiming...
            </span>
          ) : (
            `Claim ${claimableNow.toFixed(4)} SOL`
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
        Rewards update automatically as trades occur. Min claim: 0.001 SOL.
      </p>
    </div>
  );
};
