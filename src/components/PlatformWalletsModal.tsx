'use client';

import { FC, useEffect, useState, useCallback } from 'react';
import { X, Copy, Check, ExternalLink, Loader2, Wallet } from 'lucide-react';

interface PlatformWallet {
  key: string;
  label: string;
  role: string;
  address: string;
  balanceSol: number;
  solscanUrl: string;
}

interface PlatformWalletsResponse {
  wallets: PlatformWallet[];
  proofMint: string;
  proofMintSolscanUrl: string;
  asOf: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function formatSol(v: number): string {
  if (v >= 1000) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.001) return v.toFixed(4);
  return v.toFixed(6);
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export const PlatformWalletsModal: FC<Props> = ({ open, onClose }) => {
  const [data, setData] = useState<PlatformWalletsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/platform-wallets', { cache: 'no-store' });
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const copy = (addr: string) => {
    void navigator.clipboard.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!open) return null;

  const totalSol = (data?.wallets ?? []).reduce((s, w) => s + (w.balanceSol || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[var(--background)]/80"
        style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      />

      {/* Card — glass */}
      <div
        className="relative w-full max-w-2xl border border-[var(--accent)]/30 bg-[var(--card)]/85 shadow-2xl max-h-[calc(100vh-2rem)] overflow-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      >
        {/* Header */}
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between sticky top-0 bg-[var(--card)]/85" style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
          <div className="flex items-center gap-2">
            <Wallet className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
              {'// PLATFORM_WALLETS'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4">
          <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
            Every wallet Proof Launch operates on-chain. Public addresses, live balances. Verify anything on Solscan.
          </p>

          {loading && !data && (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
            </div>
          )}

          {data && (
            <>
              {/* Total bar */}
              <div className="border border-[var(--border)] bg-[var(--background)] px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  Total SOL across platform wallets
                </span>
                <span className="font-mono font-semibold text-[var(--accent-gold)]">
                  {formatSol(totalSol)} SOL
                </span>
              </div>

              {/* Wallet rows */}
              <div className="divide-y divide-[var(--border)] border border-[var(--border)]">
                {data.wallets.map((w) => {
                  const isCopied = copied === w.address;
                  return (
                    <div key={w.key} className="p-3 sm:p-4 space-y-2 bg-[var(--card)]/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-semibold text-sm text-[var(--foreground)] truncate">
                            {w.label}
                          </div>
                          <p className="text-[10px] font-mono text-[var(--muted)] leading-relaxed mt-0.5">
                            {w.role}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-semibold text-sm text-[var(--accent)]">
                            {formatSol(w.balanceSol)}
                          </div>
                          <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
                            SOL
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <code className="text-[var(--muted)] truncate flex-1 select-all">
                          {w.address}
                        </code>
                        <button
                          type="button"
                          onClick={() => copy(w.address)}
                          aria-label="Copy address"
                          className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors shrink-0"
                          title="Copy address"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <a
                          href={w.solscanUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View on Solscan"
                          className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors shrink-0"
                          title="View on Solscan"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* PROOF mint footer */}
              <div className="border border-[var(--accent-gold)]/30 bg-[var(--accent-gold)]/5 p-3 space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
                  $PROOF token mint
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <code className="text-[var(--foreground)] truncate flex-1 select-all">
                    {data.proofMint}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(data.proofMint)}
                    aria-label="Copy mint address"
                    className="text-[var(--muted)] hover:text-[var(--accent-gold)] transition-colors shrink-0"
                  >
                    {copied === data.proofMint ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={data.proofMintSolscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View token on Solscan"
                    className="text-[var(--muted)] hover:text-[var(--accent-gold)] transition-colors shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] pt-1">
                <span>refreshed {formatAgo(data.asOf)}</span>
                <button
                  type="button"
                  onClick={load}
                  disabled={loading}
                  className="hover:text-[var(--accent)] transition-colors disabled:opacity-50"
                >
                  {loading ? 'refreshing…' : '[reload]'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
