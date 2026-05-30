'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import Link from 'next/link';
import {
  Coins, Clock, Loader2, ExternalLink, RefreshCw,
  Key, Copy, Check, Eye, EyeOff, Sparkles,
} from 'lucide-react';
import { PortfolioRewards } from '@/components/PortfolioRewards';

// Dashboard-style portfolio. Three tabs (Backings / Tokens / Rewards),
// sticky header with all stats inline, and compact one-line rows so a
// dozen positions fit per viewport. Replaces the previous layout that
// stacked every backing as a tall card and required heavy scrolling.

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

type Tab = 'backings' | 'tokens' | 'rewards';

function getTimeRemaining(deadline: string): string {
  if (!deadline) return '--';
  const now = new Date();
  const end = new Date(deadline);
  if (isNaN(end.getTime())) return '--';
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Status color used on row badges. Compact tone so the row stays in
// the dashboard's monospace rhythm.
function statusTone(status: string): string {
  switch (status) {
    case 'backing':   return 'text-[var(--accent)] border-[var(--accent)]/40';
    case 'funded':    return 'text-[var(--success)] border-[var(--success)]/40';
    case 'launching': return 'text-[var(--accent-gold)] border-[var(--accent-gold)]/40';
    case 'live':      return 'text-[var(--success)] border-[var(--success)]/40';
    case 'failed':    return 'text-[var(--error)] border-[var(--error)]/40';
    default:          return 'text-[var(--muted)] border-[var(--border)]';
  }
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
  const [tab, setTab] = useState<Tab>('backings');

  // ── Burner key reveal (token wallet export) ──
  const toggleRevealKey = async (backing: BackingWithMeme) => {
    const backingId = backing.id;
    if (revealedKeys.has(backingId)) {
      setRevealedKeys((prev) => {
        const m = new Map(prev);
        m.delete(backingId);
        return m;
      });
      return;
    }
    setLoadingKeys((prev) => new Set(prev).add(backingId));
    try {
      const res = await fetch('/api/backings/export-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: backing.meme_id,
          backer_wallet: publicKey?.toBase58(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRevealedKeys((prev) => {
          const m = new Map(prev);
          m.set(backingId, data.private_key);
          return m;
        });
      } else {
        const data = await res.json();
        alert(`Cannot export key: ${data.error}`);
      }
    } catch (e) {
      console.error('Failed to export key:', e);
      alert('Failed to export private key');
    } finally {
      setLoadingKeys((prev) => {
        const s = new Set(prev);
        s.delete(backingId);
        return s;
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
    } catch (e) {
      console.error('Failed to fetch portfolio:', e);
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
    const feeAmount = (backing.amount_sol * 0.02).toFixed(4);
    const refundAmount = (backing.amount_sol * 0.98).toFixed(4);
    const confirmed = window.confirm(
      `Withdraw your backing of ${backing.amount_sol.toFixed(2)} SOL?\n\n` +
      `Withdrawal fee (2%): ${feeAmount} SOL\n` +
      `You will receive: ${refundAmount} SOL\n\n` +
      `This action cannot be undone.`,
    );
    if (!confirmed) return;
    setRequesting(backing.id);
    try {
      const backerWallet = publicKey.toBase58();
      const authMessage = `withdraw:${backing.meme_id}:${backerWallet}:${Date.now()}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);
      const res = await fetch('/api/backings/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: backing.meme_id,
          backer_wallet: backerWallet,
          signature: sigB58,
          message: authMessage,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Withdrawal successful!\n\nReceived: ${data.amount_refunded?.toFixed(4) || refundAmount} SOL`);
        await fetchPortfolio();
      } else {
        alert(`Withdrawal failed: ${data.error}`);
      }
    } catch (e) {
      console.error('Withdrawal request failed:', e);
      alert('Withdrawal request failed');
    } finally {
      setRequesting(null);
    }
  };

  // ── Derived stats ──
  const totalBacked = useMemo(
    () => backings
      .filter((b) => b.status === 'confirmed' || b.status === 'distributed')
      .reduce((sum, b) => sum + b.amount_sol, 0),
    [backings],
  );
  const activeBackings = useMemo(
    () => backings.filter((b) => b.status === 'confirmed' && b.memes.status === 'backing').length,
    [backings],
  );
  const launchedBackings = useMemo(
    () => backings.filter((b) => b.memes.status === 'live').length,
    [backings],
  );
  const refundedAmount = useMemo(
    () => backings.filter((b) => b.status === 'refunded').reduce((sum, b) => sum + b.amount_sol, 0),
    [backings],
  );

  const visibleBackings = useMemo(
    () => backings.filter((b) => b.status !== 'refunded' && b.status !== 'withdrawn'),
    [backings],
  );
  const visibleCreatedMemes = useMemo(
    () =>
      createdMemes.filter((meme) => {
        if (meme.status !== 'backing') return true;
        if (new Date(meme.backing_deadline) > new Date()) return true;
        if (meme.backer_count && meme.backer_count > 0) return true;
        return false;
      }),
    [createdMemes],
  );

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
    <div className="space-y-3">
      {/* Sticky dashboard header: title + inline stats + tabs + refresh.
          Compresses what was previously two large blocks into one ~80px
          band that pins to the viewport. */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 bg-[var(--background)] border-b border-[var(--border)] pb-3 pt-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base sm:text-lg font-mono font-semibold uppercase tracking-tight">
              Portfolio
            </h1>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-0.5">
              <span><span className="text-[var(--foreground)]">{totalBacked.toFixed(2)}</span> SOL pledged</span>
              <span><span className="text-[var(--foreground)]">{activeBackings}</span> active</span>
              <span><span className="text-[var(--success)]">{launchedBackings}</span> launched</span>
              {refundedAmount > 0 && (
                <span><span className="text-[var(--accent-gold)]">{refundedAmount.toFixed(2)}</span> refunded</span>
              )}
            </span>
          </div>
          <button
            onClick={fetchPortfolio}
            className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] hover:text-[var(--accent)] flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono uppercase tracking-widest">
          {(
            [
              { v: 'backings', label: `Backings ${visibleBackings.length}` },
              { v: 'tokens',   label: `Your Tokens ${visibleCreatedMemes.length}` },
              { v: 'rewards',  label: 'Rewards' },
            ] as { v: Tab; label: string }[]
          ).map((t) => {
            const active = tab === t.v;
            return (
              <button
                key={t.v}
                onClick={() => setTab(t.v)}
                className={`px-2.5 py-1 border transition-colors ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/60'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* BACKINGS TAB */}
      {tab === 'backings' && (
        <div className="space-y-2">
          {visibleBackings.length === 0 ? (
            <EmptyState
              icon={<Coins className="w-6 h-6" />}
              title="No backings yet"
              cta={{ href: '/', label: 'Browse Tokens' }}
            />
          ) : (
            visibleBackings.map((backing) => (
              <BackingRow
                key={backing.id}
                backing={backing}
                requesting={requesting === backing.id}
                onWithdraw={() => handleWithdraw(backing)}
                onToggleKey={() => toggleRevealKey(backing)}
                keyLoading={loadingKeys.has(backing.id)}
                revealedKey={revealedKeys.get(backing.id)}
                copied={copiedKey === backing.id}
                onCopy={(text) => copyToClipboard(text, backing.id)}
              />
            ))
          )}
        </div>
      )}

      {/* TOKENS TAB (creator's own) */}
      {tab === 'tokens' && (
        <div className="space-y-2">
          {visibleCreatedMemes.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="w-6 h-6" />}
              title="No tokens submitted yet"
              cta={{ href: '/submit', label: 'Submit a Token' }}
            />
          ) : (
            visibleCreatedMemes.map((meme) => <CreatorRow key={meme.id} meme={meme} />)
          )}
        </div>
      )}

      {/* REWARDS TAB */}
      {tab === 'rewards' && <PortfolioRewards />}
    </div>
  );
}

// ── Single-line row for a backing position. One avatar + name + status
// chip + amount + status-specific action button. Burner key reveal lives
// in a collapsible disclosure below the main row so the row itself stays
// the dashboard's 56px rhythm. ──
function BackingRow({
  backing, requesting, onWithdraw, onToggleKey, keyLoading,
  revealedKey, copied, onCopy,
}: {
  backing: BackingWithMeme;
  requesting: boolean;
  onWithdraw: () => void;
  onToggleKey: () => void;
  keyLoading: boolean;
  revealedKey: string | undefined;
  copied: boolean;
  onCopy: (text: string) => void;
}) {
  const meme = backing.memes;
  const isProving = meme.status === 'backing';
  const isLive    = meme.status === 'live';
  const isFailed  = meme.status === 'failed';
  const isPast    = new Date(meme.backing_deadline) < new Date();
  const canRefund = backing.status === 'confirmed' && isPast && !isLive;
  const showKeyRow = backing.burner_wallet && (isLive || isFailed || isPast);

  return (
    <div className="border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/60 transition-colors">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <Link href={`/meme/${meme.id}`} className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-80">
          {meme.image_url ? (
            <img src={meme.image_url} alt={meme.name} className="w-9 h-9 object-cover border border-[var(--border)] flex-shrink-0" />
          ) : (
            <div className="w-9 h-9 border border-[var(--border)] bg-[var(--background)] flex items-center justify-center text-xs font-mono font-semibold text-[var(--accent)] flex-shrink-0">
              {meme.symbol.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-mono font-semibold uppercase tracking-tight truncate text-[var(--foreground)]">
                {meme.name}
              </span>
              <span className={`text-[9px] font-mono uppercase tracking-wider px-1 py-0.5 border flex-shrink-0 ${statusTone(meme.status)}`}>
                {meme.status}
              </span>
            </div>
            <div className="text-[10px] font-mono text-[var(--accent)]">${meme.symbol}</div>
          </div>
        </Link>

        <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] flex-shrink-0">
          <div className="text-right">
            <div>Backed</div>
            <div className="text-[var(--foreground)]">{backing.amount_sol.toFixed(2)} SOL</div>
          </div>
          {isProving && (
            <div className="text-right">
              <div>Ends</div>
              <div className="text-[var(--accent-gold)] flex items-center gap-0.5 justify-end">
                <Clock className="w-2.5 h-2.5" />
                {getTimeRemaining(meme.backing_deadline)}
              </div>
            </div>
          )}
          {isLive && meme.pump_fun_url && (
            <a
              href={meme.pump_fun_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-[10px] py-1 px-2.5 flex items-center gap-1 normal-case tracking-normal"
            >
              <ExternalLink className="w-3 h-3" /> Trade
            </a>
          )}
          {isProving && backing.status === 'confirmed' && (
            <button
              onClick={onWithdraw}
              disabled={requesting}
              className="border border-[var(--border)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)] text-[10px] py-1 px-2.5 flex items-center gap-1 disabled:opacity-50"
            >
              {requesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Withdraw
            </button>
          )}
          {canRefund && (
            <button
              onClick={onWithdraw}
              disabled={requesting}
              className="bg-[var(--accent-gold)]/20 border border-[var(--accent-gold)] text-[var(--accent-gold)] text-[10px] py-1 px-2.5 flex items-center gap-1 disabled:opacity-50"
            >
              {requesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refund
            </button>
          )}
          {showKeyRow && (
            <button
              onClick={onToggleKey}
              disabled={keyLoading}
              title="Token burner wallet"
              className="text-[var(--muted)] hover:text-[var(--accent)]"
            >
              {keyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : revealedKey ? <EyeOff className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {revealedKey && (
        <div className="border-t border-[var(--border)] px-3 py-2 bg-[var(--background)] flex items-center justify-between gap-2">
          <code className="text-[10px] break-all text-[var(--accent-gold)] flex-1">{revealedKey}</code>
          <button
            onClick={() => onCopy(revealedKey)}
            className="p-1 hover:bg-[var(--card)] flex-shrink-0"
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5 text-[var(--muted)]" />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Single-line row for a creator's own token. Same compact rhythm as
// BackingRow; differentiates with a left gold border + creator badge. ──
function CreatorRow({ meme }: { meme: CreatedMeme }) {
  const isProving = meme.status === 'backing';
  const isFunded  = meme.status === 'funded';
  const isLive    = meme.status === 'live';
  const totalSlots = Number(meme.total_slots) || 8;
  const filledSlots = Number(meme.backer_count) || 0;
  const progress = totalSlots > 0 ? (filledSlots / totalSlots) * 100 : 0;

  return (
    <div className="border border-[var(--border)] border-l-2 border-l-[var(--accent-gold)] bg-[var(--card)] hover:border-[var(--accent)]/60 transition-colors">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <Link href={`/meme/${meme.id}`} className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-80">
          {meme.image_url ? (
            <img src={meme.image_url} alt={meme.name} className="w-9 h-9 object-cover border border-[var(--accent-gold)] flex-shrink-0" />
          ) : (
            <div className="w-9 h-9 border border-[var(--accent-gold)] bg-[var(--background)] flex items-center justify-center text-xs font-mono font-semibold text-[var(--accent-gold)] flex-shrink-0">
              {meme.symbol.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-mono font-semibold uppercase tracking-tight truncate text-[var(--foreground)]">
                {meme.name}
              </span>
              <span className={`text-[9px] font-mono uppercase tracking-wider px-1 py-0.5 border flex-shrink-0 ${statusTone(meme.status)}`}>
                {meme.status}
              </span>
            </div>
            <div className="text-[10px] font-mono text-[var(--accent-gold)]">${meme.symbol} · creator</div>
          </div>
        </Link>

        <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] flex-shrink-0">
          <div className="text-right">
            <div>Slots</div>
            <div className="text-[var(--foreground)]">{filledSlots}/{totalSlots}</div>
          </div>
          {isProving && (
            <div className="text-right">
              <div>Ends</div>
              <div className="text-[var(--accent-gold)]">{getTimeRemaining(meme.backing_deadline)}</div>
            </div>
          )}
          {isFunded && (
            <Link href={`/meme/${meme.id}`} className="btn-primary text-[10px] py-1 px-2.5 normal-case tracking-normal">
              Launch
            </Link>
          )}
          {isLive && meme.pump_fun_url && (
            <a
              href={meme.pump_fun_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-[10px] py-1 px-2.5 flex items-center gap-1 normal-case tracking-normal"
            >
              <ExternalLink className="w-3 h-3" /> Trade
            </a>
          )}
        </div>
      </div>
      {(isProving || isFunded) && (
        <div className="px-3 pb-2 flex items-center gap-2">
          <div className="h-0.5 flex-1 bg-[var(--background)] overflow-hidden">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
          <span className="text-[9px] font-mono text-[var(--muted)] tabular-nums">{progress.toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, title, cta }: {
  icon: React.ReactNode;
  title: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="border border-dashed border-[var(--border)] bg-[var(--card)] p-8 text-center">
      <div className="w-12 h-12 mx-auto border border-[var(--border)] bg-[var(--background)] flex items-center justify-center text-[var(--muted)] mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-mono font-semibold uppercase tracking-tight mb-1">{title}</h3>
      <Link
        href={cta.href}
        className="inline-block mt-2 px-3 py-1.5 border border-[var(--accent)] text-[var(--accent)] text-[10px] font-mono uppercase tracking-widest hover:bg-[var(--accent)]/10 transition-colors"
      >
        {cta.label}
      </Link>
    </div>
  );
}
