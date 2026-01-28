'use client';

import { FC, useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
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
  const { connected, publicKey } = useWallet();
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
      // Trigger fee processing in background (fire and forget)
      fetch('/api/fees/process', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer prooflaunch-fees',
        },
      }).catch(() => {}); // Ignore errors

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
    if (!connected || !publicKey || !rewards?.total_claimable) return;

    setClaiming(true);
    setClaimResult(null);

    try {
      const response = await fetch('/api/fees/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: publicKey.toBase58(),
          meme_id: memeId,
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

  const hasClaimable = rewards && rewards.total_claimable > 0;
  const hasClaimed = rewards && rewards.total_claimed > 0;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Coins className="w-5 h-5 text-[var(--accent)]" />
        <h3 className="font-semibold">Trading Fee Rewards</h3>
      </div>

      {rewards && (
        <div className="space-y-2">
          {/* Backer rewards */}
          {isBacker && rewards.backer_rewards.claimable > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Backer share:</span>
              <span className="font-medium text-[var(--success)]">
                {rewards.backer_rewards.claimable.toFixed(6)} SOL
              </span>
            </div>
          )}

          {/* Creator rewards */}
          {isCreator && rewards.creator_rewards.claimable > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Creator fee:</span>
              <span className="font-medium text-[var(--success)]">
                {rewards.creator_rewards.claimable.toFixed(6)} SOL
              </span>
            </div>
          )}

          {/* Total claimable */}
          {hasClaimable && (
            <div className="flex justify-between text-sm pt-2 border-t border-[var(--border)]">
              <span className="font-medium">Total claimable:</span>
              <span className="font-bold text-[var(--success)]">
                {rewards.total_claimable.toFixed(6)} SOL
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
      {!hasClaimable && !hasClaimed && (
        <p className="text-sm text-[var(--muted)]">
          No rewards yet. Rewards accrue from trading fees when this token is traded on pump.fun.
        </p>
      )}

      {/* Claim button */}
      {hasClaimable && (
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
            `Claim ${rewards?.total_claimable.toFixed(4)} SOL`
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
