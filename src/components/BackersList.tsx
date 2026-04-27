'use client';

import { FC } from 'react';
import { Users, ExternalLink, Trophy, Loader2, Undo2 } from 'lucide-react';

interface Backing {
  id: string;
  backer_wallet: string;
  amount_sol: number;
  created_at: string;
  deposit_tx?: string;
  status?: string;
}

interface BackersListProps {
  backings: Backing[];
  totalBacking: number;
  currentWallet?: string;
  canWithdraw?: boolean;
  onWithdraw?: (backerWallet: string) => void;
  withdrawing?: boolean;
  withdrawStatus?: string | null;
}

export const BackersList: FC<BackersListProps> = ({
  backings,
  totalBacking,
  currentWallet,
  canWithdraw = false,
  onWithdraw,
  withdrawing = false,
  withdrawStatus,
}) => {
  // Sort by amount descending
  const sortedBackings = [...backings].sort((a, b) => b.amount_sol - a.amount_sol);

  // Shorten wallet address
  const shortAddress = (address: string) =>
    `${address.slice(0, 4)}...${address.slice(-4)}`;

  // Format date
  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Get rank badge
  const getRankBadge = (index: number) => {
    if (index === 0) return { icon: '1', color: 'text-yellow-500' };
    if (index === 1) return { icon: '2', color: 'text-gray-400' };
    if (index === 2) return { icon: '3', color: 'text-amber-600' };
    return null;
  };

  // Calculate percentage of total
  const getPercentage = (amount: number) => {
    if (totalBacking === 0) return 0;
    return ((amount / totalBacking) * 100).toFixed(1);
  };

  // Get Solscan URL (devnet or mainnet based on env)
  const getSolscanUrl = (signature: string) => {
    const isDevnet = process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'devnet';
    const cluster = isDevnet ? '?cluster=devnet' : '';
    return `https://solscan.io/tx/${signature}${cluster}`;
  };

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[var(--border)]">
        <Users className="w-5 h-5 text-[var(--accent)]" />
        <h3 className="font-semibold uppercase">Genesis Backers</h3>
        <span className="text-xs text-[var(--muted)]">({backings.length} backers)</span>
      </div>

      {backings.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted)]">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No backers yet</p>
          <p className="text-xs">Be the first to back this meme!</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[350px] overflow-y-auto">
          {sortedBackings.map((backing, index) => {
            const rank = getRankBadge(index);
            const isCurrentUser = currentWallet === backing.backer_wallet;
            const isWithdrawn = backing.status === 'withdrawn';
            const canUserWithdraw = isCurrentUser && canWithdraw && !isWithdrawn && onWithdraw;

            return (
              <div
                key={backing.id}
                className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                  isWithdrawn
                    ? 'bg-[var(--background)] opacity-50'
                    : isCurrentUser
                    ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30'
                    : 'bg-[var(--background)] hover:bg-[var(--card)]'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Rank indicator */}
                  <div className="w-6 text-center">
                    {rank ? (
                      <span className={`text-sm font-bold ${rank.color}`}>
                        #{rank.icon}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">#{index + 1}</span>
                    )}
                  </div>

                  {/* Wallet info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium">
                        {shortAddress(backing.backer_wallet)}
                      </code>
                      {isCurrentUser && (
                        <span className="text-xs bg-[var(--accent)] text-white px-1.5 py-0.5 rounded">
                          You
                        </span>
                      )}
                      {index === 0 && !isCurrentUser && (
                        <Trophy className="w-3 h-3 text-yellow-500" />
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {isWithdrawn ? 'Withdrawn' : formatDate(backing.created_at)}
                    </div>
                  </div>
                </div>

                {/* Amount and percentage */}
                <div className="text-right">
                  <div className={`font-semibold text-sm ${isWithdrawn ? 'line-through' : ''}`}>
                    {backing.amount_sol.toFixed(2)} SOL
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {isWithdrawn ? 'Refunded' : `${getPercentage(backing.amount_sol)}% of total`}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 ml-2">
                  {/* Withdraw button for current user */}
                  {canUserWithdraw && (
                    <button
                      onClick={() => onWithdraw(backing.backer_wallet)}
                      disabled={withdrawing}
                      className="text-[var(--warning)] hover:text-[var(--error)] transition-colors disabled:opacity-50"
                      title="Withdraw backing"
                    >
                      {withdrawing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Undo2 className="w-4 h-4" />
                      )}
                    </button>
                  )}

                  {/* Solscan link */}
                  {backing.deposit_tx && (
                    <a
                      href={getSolscanUrl(backing.deposit_tx)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                      title="View on Solscan"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Withdraw status message */}
      {withdrawStatus && (
        <div className={`mt-3 p-3 rounded-lg text-sm text-center ${
          withdrawStatus.includes('Error')
            ? 'bg-[var(--error)]/20 text-[var(--error)]'
            : withdrawStatus.includes('Successfully')
            ? 'bg-[var(--success)]/20 text-[var(--success)]'
            : 'bg-[var(--accent)]/20 text-[var(--accent)]'
        }`}>
          {withdrawStatus}
        </div>
      )}

      {/* Total summary */}
      {backings.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--border)] flex justify-between text-sm">
          <span className="text-[var(--muted)]">Total Backed</span>
          <span className="font-semibold">{totalBacking.toFixed(2)} SOL</span>
        </div>
      )}
    </div>
  );
};
