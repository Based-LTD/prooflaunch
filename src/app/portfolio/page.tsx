'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import Link from 'next/link';
import { Coins, TrendingUp, Clock, Gift, AlertCircle, Loader2, ExternalLink, RefreshCw, Key, Copy, Check, Eye, EyeOff, Sparkles, Users } from 'lucide-react';
import { PortfolioRewards } from '@/components/PortfolioRewards';

interface BackingWithMeme {
  id: string;
  meme_id: string;
  amount_sol: number;
  status: 'pending' | 'confirmed' | 'refunded' | 'distributed' | 'withdrawn';
  deposit_tx?: string;
  refund_tx?: string;
  created_at: string;
  burner_wallet?: string;
  encrypted_private_key?: string;
  memes: {
    id: string;
    name: string;
    symbol: string;
    image_url: string;
    status: string;
    total_slots: number;
    backing_goal_sol: number;
    current_backing_sol: number;
    backing_deadline: string;
    mint_address?: string;
    pump_fun_url?: string;
    trust_score?: number;
    backer_count?: number;
  };
}

interface CreatedMeme {
  id: string;
  name: string;
  symbol: string;
  image_url: string;
  status: string;
  total_slots: number;
  backing_goal_sol: number;
  current_backing_sol: number;
  backing_deadline: string;
  mint_address?: string;
  pump_fun_url?: string;
  backer_count?: number;
  created_at: string;
}

function getTimeRemaining(deadline: string): string {
  if (!deadline) return '--';

  const now = new Date();
  const end = new Date(deadline);

  // Check for invalid date
  if (isNaN(end.getTime())) return '--';

  const diff = end.getTime() - now.getTime();

  if (diff <= 0) return 'Ended';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getStatusBadge(status: string) {
  const configs: Record<string, { label: string; class: string }> = {
    backing: { label: 'Proving', class: 'bg-blue-500/20 text-blue-400' },
    funded: { label: 'Funded', class: 'bg-green-500/20 text-green-400' },
    launching: { label: 'Launching', class: 'bg-yellow-500/20 text-yellow-400' },
    live: { label: 'Live', class: 'bg-green-500/20 text-green-400' },
    failed: { label: 'Failed', class: 'bg-red-500/20 text-red-400' },
  };
  return configs[status] || { label: status, class: 'bg-gray-500/20 text-gray-400' };
}

export default function PortfolioPage() {
  const { connected, publicKey, signMessage } = useWallet();
  const [backings, setBackings] = useState<BackingWithMeme[]>([]);
  const [createdMemes, setCreatedMemes] = useState<CreatedMeme[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Map<string, string>>(new Map());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const toggleRevealKey = async (backing: BackingWithMeme) => {
    const backingId = backing.id;

    // If already revealed, hide it
    if (revealedKeys.has(backingId)) {
      setRevealedKeys(prev => {
        const newMap = new Map(prev);
        newMap.delete(backingId);
        return newMap;
      });
      return;
    }

    // Fetch the private key from the secure API
    setLoadingKeys(prev => new Set(prev).add(backingId));
    try {
      const response = await fetch('/api/backings/export-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: backing.meme_id,
          backer_wallet: publicKey?.toBase58(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setRevealedKeys(prev => {
          const newMap = new Map(prev);
          newMap.set(backingId, data.private_key);
          return newMap;
        });
      } else {
        const data = await response.json();
        alert(`Cannot export key: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to export key:', error);
      alert('Failed to export private key');
    } finally {
      setLoadingKeys(prev => {
        const newSet = new Set(prev);
        newSet.delete(backingId);
        return newSet;
      });
    }
  };

  const copyToClipboard = async (text: string, backingId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(backingId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fetchPortfolio = useCallback(async () => {
    if (!publicKey) return;

    setLoading(true);
    try {
      // Fetch backings and created memes in parallel
      const [backingsRes, memesRes] = await Promise.all([
        fetch(`/api/backings?backer=${publicKey.toBase58()}`),
        fetch(`/api/memes?creator=${publicKey.toBase58()}`),
      ]);

      if (backingsRes.ok) {
        const data = await backingsRes.json();
        setBackings(data.backings || []);
      }

      if (memesRes.ok) {
        const data = await memesRes.json();
        setCreatedMemes(data.memes || []);
      }
    } catch (error) {
      console.error('Failed to fetch portfolio:', error);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (connected && publicKey) {
      fetchPortfolio();
    }
  }, [connected, publicKey, fetchPortfolio]);

  const handleWithdraw = async (backing: BackingWithMeme) => {
    if (!publicKey || !signMessage) return;

    // Confirm withdrawal with fee warning
    const feeAmount = (backing.amount_sol * 0.02).toFixed(4);
    const refundAmount = (backing.amount_sol * 0.98).toFixed(4);
    const confirmed = window.confirm(
      `Withdraw your backing of ${backing.amount_sol.toFixed(2)} SOL?\n\n` +
      `Withdrawal fee (2%): ${feeAmount} SOL\n` +
      `You will receive: ${refundAmount} SOL\n\n` +
      `This action cannot be undone.`
    );

    if (!confirmed) return;

    setRequesting(backing.id);
    try {
      // Sign a message to prove wallet ownership (server requires this)
      const backerWallet = publicKey.toBase58();
      const authMessage = `withdraw:${backing.meme_id}:${backerWallet}:${Date.now()}`;
      const msgBytes = new TextEncoder().encode(authMessage);
      const sigBytes = await signMessage(msgBytes);
      const sigB58 = bs58.encode(sigBytes);

      const response = await fetch('/api/backings/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: backing.meme_id,
          backer_wallet: backerWallet,
          signature: sigB58,
          message: authMessage,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Withdrawal successful!\n\nReceived: ${data.amount_refunded?.toFixed(4) || refundAmount} SOL`);
        // Refresh backings
        await fetchPortfolio();
      } else {
        alert(`Withdrawal failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Withdrawal request failed:', error);
      alert('Withdrawal request failed');
    } finally {
      setRequesting(null);
    }
  };

  // Calculate stats
  const totalBacked = backings
    .filter(b => b.status === 'confirmed' || b.status === 'distributed')
    .reduce((sum, b) => sum + b.amount_sol, 0);

  const activeBackings = backings.filter(
    b => b.status === 'confirmed' && b.memes.status === 'backing'
  ).length;

  const launchedBackings = backings.filter(
    b => b.memes.status === 'live'
  ).length;

  const refundedAmount = backings
    .filter(b => b.status === 'refunded')
    .reduce((sum, b) => sum + b.amount_sol, 0);

  // Filter out refunded/withdrawn backings - they disappear after claiming
  const visibleBackings = backings.filter(b =>
    b.status !== 'refunded' && b.status !== 'withdrawn'
  );

  // Filter out expired created memes with no backings
  const visibleCreatedMemes = createdMemes.filter(meme => {
    // Keep all non-backing memes (live, funded, etc.)
    if (meme.status !== 'backing') return true;
    // Keep memes that haven't expired yet
    if (new Date(meme.backing_deadline) > new Date()) return true;
    // Keep expired memes that have backings
    if (meme.backer_count && meme.backer_count > 0) return true;
    // Hide expired memes with no backings
    return false;
  });

  if (!connected) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="border border-[var(--warning)] bg-[var(--card)]">
          <div className="border-b border-[var(--warning)] px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
              [!] WALLET_REQUIRED
            </span>
          </div>
          <div className="p-6">
            <h2 className="text-base font-mono font-semibold uppercase tracking-tight mb-2">Wallet required</h2>
            <p className="text-xs font-mono text-[var(--muted)]">
              &gt; Connect your wallet to view your portfolio
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header — terminal block */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // PROOF_LAUNCH.SYS // PORTFOLIO
          </span>
          <button
            onClick={fetchPortfolio}
            className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)] flex items-center gap-1"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
            REFRESH
          </button>
        </div>
        <div className="p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
            &gt; USER
          </div>
          <h1 className="text-2xl sm:text-3xl font-mono font-semibold uppercase tracking-tight">
            Portfolio
          </h1>
          <p className="text-xs font-mono text-[var(--muted)] mt-2">
            Your backings and launched tokens
          </p>
        </div>
      </div>

      {/* Stats — terminal readout */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // METRICS
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-[var(--border)]">
          <div className="p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">SOL Pledged</div>
            <div className="text-2xl font-mono font-semibold text-[var(--accent)]">{totalBacked.toFixed(2)}</div>
          </div>
          <div className="p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">Active</div>
            <div className="text-2xl font-mono font-semibold text-[var(--accent)]">{activeBackings}</div>
          </div>
          <div className="p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">Launched</div>
            <div className="text-2xl font-mono font-semibold text-[var(--success)]">{launchedBackings}</div>
          </div>
          <div className="p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">Refunded</div>
            <div className="text-2xl font-mono font-semibold text-[var(--accent-gold)]">{refundedAmount.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Trading Fee Rewards */}
      <PortfolioRewards />

      {/* Backings List */}
      <div className="space-y-4">
        <div className="border-l-2 border-[var(--accent)] pl-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // SECTION
          </div>
          <h2 className="text-xl font-mono font-semibold uppercase tracking-tight">
            Your Backings
          </h2>
        </div>

        {visibleBackings.length === 0 ? (
          <div className="relative border-2 border-dashed border-[var(--border)] bg-[var(--card)] p-8 text-center">
            <div className="w-16 h-16 mx-auto bg-[var(--background)] flex items-center justify-center border-2 border-[var(--border)] mb-4">
              <Coins className="w-8 h-8 text-[var(--muted)] opacity-50" />
            </div>
            <h3 className="text-lg font-black uppercase tracking-tight mb-2">No Backings Yet</h3>
            <p className="text-[var(--muted)] mb-4 uppercase tracking-wide text-sm">
              Find a token to back in the Proving Grounds
            </p>
            <Link href="/" className="inline-block px-6 py-3 bg-[var(--accent)] text-white font-black uppercase tracking-wide hover:opacity-90 transition-opacity border-2 border-[var(--accent)]">
              Browse Tokens
            </Link>
          </div>
        ) : (
          visibleBackings.map((backing) => {
            const meme = backing.memes;
            const statusBadge = getStatusBadge(meme.status);
            const isProving = meme.status === 'backing';
            const isFailed = meme.status === 'failed';
            const isLive = meme.status === 'live';
            const isPastDeadline = new Date(meme.backing_deadline) < new Date();
            const canRefund = backing.status === 'confirmed' && isPastDeadline && !isLive;

            return (
              <div key={backing.id} className="relative border-2 border-[var(--border)] bg-[var(--card)] p-5 hover:border-[var(--accent)] transition-colors">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/meme/${meme.id}`}
                    className="flex items-center gap-4 hover:opacity-80 transition-opacity"
                  >
                    {meme.image_url ? (
                      <img
                        src={meme.image_url}
                        alt={meme.name}
                        className="w-14 h-14 object-cover border-2 border-[var(--accent)]"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-gradient-to-br from-[var(--gradient-start)] to-[var(--gradient-end)] flex items-center justify-center text-xl font-bold border-2 border-[var(--accent)]">
                        {meme.symbol.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-black uppercase tracking-tight">{meme.name}</h3>
                        <span className={`px-2 py-0.5 text-xs font-bold uppercase ${statusBadge.class}`}>
                          {statusBadge.label}
                        </span>
                      </div>
                      <span className="text-sm text-[var(--accent-gold)] font-bold">${meme.symbol}</span>
                    </div>
                  </Link>

                  <div className="flex items-center gap-6">
                    {/* Amount backed */}
                    <div className="text-right">
                      <div className="text-sm text-[var(--muted)]">Backed</div>
                      <div className="font-semibold">{backing.amount_sol.toFixed(2)} SOL</div>
                    </div>

                    {/* Status-specific info */}
                    {isProving && (
                      <div className="text-right">
                        <div className="text-sm text-[var(--muted)]">Time Left</div>
                        <div className="font-semibold text-[var(--warning)]">
                          {getTimeRemaining(meme.backing_deadline)}
                        </div>
                      </div>
                    )}

                    {isLive && meme.pump_fun_url && (
                      <a
                        href={meme.pump_fun_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary flex items-center gap-2 py-2 px-4"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Trade
                      </a>
                    )}

                    {backing.status === 'refunded' && (
                      <div className="text-right">
                        <div className="text-sm text-[var(--muted)]">Status</div>
                        <div className="font-semibold text-green-400">Refunded</div>
                      </div>
                    )}

                    {/* Withdraw button for active backings during proving phase */}
                    {isProving && backing.status === 'confirmed' && (
                      <button
                        onClick={() => handleWithdraw(backing)}
                        disabled={requesting === backing.id}
                        className="bg-[var(--border)] hover:bg-[var(--card)] text-[var(--foreground)] font-semibold py-2 px-4 rounded-lg flex items-center gap-2 disabled:opacity-50"
                      >
                        {requesting === backing.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        Withdraw
                      </button>
                    )}

                    {/* Refund button for failed/expired backings */}
                    {canRefund && backing.status === 'confirmed' && (
                      <button
                        onClick={() => handleWithdraw(backing)}
                        disabled={requesting === backing.id}
                        className="bg-[var(--warning)] hover:bg-[var(--warning)]/80 text-black font-semibold py-2 px-4 rounded-lg flex items-center gap-2 disabled:opacity-50"
                      >
                        {requesting === backing.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        Claim Refund
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar for proving memes */}
                {isProving && (() => {
                  const totalSlots = Number(meme.total_slots) || 8;
                  const filledSlots = Number(meme.backer_count) || 0;
                  const slotProgress = totalSlots > 0 ? Math.min((filledSlots / totalSlots) * 100, 100) : 0;
                  return (
                    <div className="mt-4 pt-4 border-t border-[var(--border)]">
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-[var(--muted)]">Slots</span>
                        <span>
                          {filledSlots} / {totalSlots}
                        </span>
                      </div>
                      <div className="h-2 bg-[var(--background)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent)] rounded-full transition-all"
                          style={{ width: `${slotProgress}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}

                {/* Fee qualification note */}
                {backing.amount_sol >= 0.5 && (isProving || isLive) && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center gap-2 text-sm text-[var(--success)]">
                    <Gift className="w-4 h-4" />
                    Qualifies for genesis fee share
                  </div>
                )}

                {/* Token Wallet Info - show after launch OR if meme failed/expired */}
                {backing.burner_wallet && (isLive || isFailed || (isPastDeadline && !isLive)) && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                        <Key className="w-4 h-4" />
                        <span>Token Wallet: {backing.burner_wallet.slice(0, 8)}...{backing.burner_wallet.slice(-6)}</span>
                      </div>
                      <button
                        onClick={() => toggleRevealKey(backing)}
                        disabled={loadingKeys.has(backing.id)}
                        className="text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] flex items-center gap-1 disabled:opacity-50"
                      >
                        {loadingKeys.has(backing.id) ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading...
                          </>
                        ) : revealedKeys.has(backing.id) ? (
                          <>
                            <EyeOff className="w-4 h-4" />
                            Hide Key
                          </>
                        ) : (
                          <>
                            <Eye className="w-4 h-4" />
                            Show Key
                          </>
                        )}
                      </button>
                    </div>
                    {revealedKeys.has(backing.id) && (
                      <div className="mt-2 p-3 bg-[var(--background)] rounded-lg">
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-xs break-all text-[var(--warning)]">
                            {revealedKeys.get(backing.id)}
                          </code>
                          <button
                            onClick={() => copyToClipboard(revealedKeys.get(backing.id)!, backing.id)}
                            className="flex-shrink-0 p-2 hover:bg-[var(--card)] rounded"
                            title="Copy to clipboard"
                          >
                            {copiedKey === backing.id ? (
                              <Check className="w-4 h-4 text-[var(--success)]" />
                            ) : (
                              <Copy className="w-4 h-4 text-[var(--muted)]" />
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-[var(--muted)] mt-2">
                          Import this key into Phantom to access your token wallet
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Token wallet placeholder - shown during active backing phase */}
                {!isLive && !isFailed && !isPastDeadline && backing.status === 'confirmed' && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]">
                    <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                      <Key className="w-4 h-4 opacity-50" />
                      <span className="italic">Burner wallet access available after launch or expiry</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Your Creations Section */}
      <div className="space-y-4">
        <div className="border-l-2 border-[var(--accent-gold)] pl-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // SECTION
          </div>
          <h2 className="text-xl font-mono font-semibold uppercase tracking-tight">
            Your Tokens
          </h2>
        </div>

        {visibleCreatedMemes.length === 0 ? (
          <div className="relative border-2 border-dashed border-[var(--border)] bg-[var(--card)] p-8 text-center">
            <div className="w-16 h-16 mx-auto bg-[var(--background)] flex items-center justify-center border-2 border-[var(--border)] mb-4">
              <Sparkles className="w-8 h-8 text-[var(--muted)] opacity-50" />
            </div>
            <h3 className="text-lg font-black uppercase tracking-tight mb-2">No Tokens Submitted</h3>
            <p className="text-[var(--muted)] mb-4 uppercase tracking-wide text-sm">
              Submit your first token
            </p>
            <Link href="/submit" className="inline-block px-6 py-3 bg-[var(--accent)] text-white font-black uppercase tracking-wide hover:opacity-90 transition-opacity border-2 border-[var(--accent)]">
              Submit a Token
            </Link>
          </div>
        ) : (
          visibleCreatedMemes.map((meme) => {
            const statusBadge = getStatusBadge(meme.status);
            const isProving = meme.status === 'backing';
            const isFunded = meme.status === 'funded';
            const isLive = meme.status === 'live';
            const totalSlots = Number(meme.total_slots) || 8;
            const filledSlots = Number(meme.backer_count) || 0;
            const progress = totalSlots > 0 ? (filledSlots / totalSlots) * 100 : 0;

            return (
              <div key={meme.id} className="relative border-2 border-[var(--accent-gold)] bg-[var(--card)] p-5 hover:border-[var(--accent)] transition-colors">
                <div className="absolute -top-2 left-4 px-2 bg-[var(--card)] text-[var(--accent-gold)] text-xs font-bold uppercase">Creator</div>
                <div className="flex items-center justify-between pt-1">
                  <Link
                    href={`/meme/${meme.id}`}
                    className="flex items-center gap-4 hover:opacity-80 transition-opacity"
                  >
                    {meme.image_url ? (
                      <img
                        src={meme.image_url}
                        alt={meme.name}
                        className="w-14 h-14 object-cover border-2 border-[var(--accent-gold)]"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-gradient-to-br from-[var(--gradient-start)] to-[var(--gradient-end)] flex items-center justify-center text-xl font-bold border-2 border-[var(--accent-gold)]">
                        {meme.symbol.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-black uppercase tracking-tight">{meme.name}</h3>
                        <span className={`px-2 py-0.5 text-xs font-bold uppercase ${statusBadge.class}`}>
                          {statusBadge.label}
                        </span>
                      </div>
                      <span className="text-sm text-[var(--accent-gold)] font-bold">${meme.symbol}</span>
                    </div>
                  </Link>

                  <div className="flex items-center gap-6">
                    {/* Slot stats */}
                    <div className="text-right">
                      <div className="text-sm text-[var(--muted)]">Slots</div>
                      <div className="font-semibold">
                        {filledSlots} / {totalSlots}
                      </div>
                    </div>

                    {/* Backer count */}
                    {meme.backer_count !== undefined && (
                      <div className="text-right">
                        <div className="text-sm text-[var(--muted)]">Backers</div>
                        <div className="font-semibold flex items-center gap-1 justify-end">
                          <Users className="w-4 h-4" />
                          {meme.backer_count}
                        </div>
                      </div>
                    )}

                    {/* Time remaining for proving */}
                    {isProving && (
                      <div className="text-right">
                        <div className="text-sm text-[var(--muted)]">Time Left</div>
                        <div className="font-semibold text-[var(--warning)]">
                          {getTimeRemaining(meme.backing_deadline)}
                        </div>
                      </div>
                    )}

                    {/* Launch button for funded memes */}
                    {isFunded && (
                      <Link
                        href={`/meme/${meme.id}`}
                        className="btn-primary flex items-center gap-2 py-2 px-4"
                      >
                        Ready to Launch
                      </Link>
                    )}

                    {/* Trade link for live memes */}
                    {isLive && meme.pump_fun_url && (
                      <a
                        href={meme.pump_fun_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary flex items-center gap-2 py-2 px-4"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Trade
                      </a>
                    )}
                  </div>
                </div>

                {/* Progress bar for proving/funded memes */}
                {(isProving || isFunded) && (
                  <div className="mt-4 pt-4 border-t border-[var(--border)]">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-[var(--muted)]">Progress</span>
                      <span>{progress.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-[var(--background)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)] rounded-full transition-all"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
