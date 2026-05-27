'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  History,
  ExternalLink,
  CheckCircle,
  Rocket,
  Clock,
  XCircle,
  Flame,
  TrendingUp,
  X,
} from 'lucide-react';

interface ProofLaunchEntry {
  id: string;
  symbol: string;
  name: string;
  status: 'backing' | 'funded' | 'live' | 'failed' | string;
  mint_address: string | null;
  launched_at: string | null;
  created_at: string;
  source: 'proof_launch';
}

interface PumpfunGraduatedEntry {
  mint: string;
  symbol: string | null;
  name: string | null;
  source: 'pumpfun_graduated';
}

interface LaunchLabEntry {
  mint: string;
  symbol: string | null;
  name: string | null;
  source: 'launch_lab';
}

interface ExternalEntry {
  mint: string;
  symbol: string | null;
  name: string | null;
  burnt: boolean;
  source: 'external';
}

interface CreatorLaunchesData {
  wallet: string;
  proof_launch: ProofLaunchEntry[];
  pumpfun_graduated: PumpfunGraduatedEntry[];
  pumpfun_pregrad_count: number;
  launch_lab: LaunchLabEntry[];
  external: ExternalEntry[];
  totals: {
    proof_launch: number;
    pumpfun_graduated: number;
    pumpfun_pregrad_count: number;
    launch_lab: number;
    external: number;
    grand_total: number;
  };
}

interface Props {
  wallet: string;
  variant?: 'submit' | 'meme-page';
  excludeMemeId?: string;
}

const PL_STATUS_BADGE: Record<string, { label: string; cls: string; Icon: typeof CheckCircle }> = {
  live:    { label: 'LAUNCHED',  cls: 'text-[var(--success)] border-[var(--success)]', Icon: Rocket },
  funded:  { label: 'FUNDED',    cls: 'text-[var(--accent-gold)] border-[var(--accent-gold)]', Icon: CheckCircle },
  backing: { label: 'BACKING',   cls: 'text-[var(--accent)] border-[var(--accent)]', Icon: Clock },
  failed:  { label: 'EXPIRED',   cls: 'text-[var(--muted)] border-[var(--muted)]', Icon: XCircle },
};

export const CreatorPastLaunches: React.FC<Props> = ({ wallet, variant = 'submit', excludeMemeId }) => {
  const [data, setData] = useState<CreatorLaunchesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/creator/${wallet}/launches`);
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setData(j);
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [wallet]);

  // Lock body scroll + escape-to-close while modal open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = 'unset';
    };
  }, [open]);

  if (loading || !data) return null;

  const plFiltered = excludeMemeId
    ? data.proof_launch.filter(m => m.id !== excludeMemeId)
    : data.proof_launch;

  const grandTotal = plFiltered.length
    + data.pumpfun_graduated.length
    + (data.launch_lab?.length || 0)
    + data.external.length
    + data.pumpfun_pregrad_count;

  if (grandTotal === 0) {
    if (variant === 'meme-page') return null;
    return (
      <div className="border border-[var(--accent)]/40 bg-[var(--card)]">
        <div className="border-b border-[var(--accent)]/40 px-4 py-2 flex items-center gap-2">
          <Rocket className="w-3 h-3 text-[var(--accent)]" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            // FIRST_LAUNCH
          </span>
        </div>
        <div className="p-4 text-xs font-mono text-[var(--muted)] leading-relaxed">
          <p>&gt; First token from this wallet anywhere on Solana. Welcome.</p>
        </div>
      </div>
    );
  }

  const headerLabel = variant === 'meme-page'
    ? '// CREATOR_TRACK_RECORD'
    : '// YOUR_TRACK_RECORD';

  const plLive = plFiltered.filter(m => m.status === 'live').length;
  const extActive = data.external.filter(e => !e.burnt).length;
  const extBurnt = data.external.filter(e => e.burnt).length;
  const pfTotal = data.pumpfun_graduated.length + data.pumpfun_pregrad_count;

  // Count distinct platforms touched (helpful subtitle in modal).
  const platformCount =
    (plFiltered.length > 0 ? 1 : 0) +
    (pfTotal > 0 ? 1 : 0) +
    ((data.launch_lab?.length || 0) > 0 ? 1 : 0) +
    (data.external.length > 0 ? 1 : 0);

  return (
    <>
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <History className="w-3 h-3 text-[var(--accent-gold)]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              {headerLabel}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] flex-wrap">
            {plFiltered.length > 0 && (
              <span><span className="text-[var(--accent)]">{plFiltered.length}</span> PL{plLive > 0 ? <span className="text-[var(--success)]"> ({plLive} live)</span> : null}</span>
            )}
            {pfTotal > 0 && (
              <span>
                <span className="text-[var(--accent-gold)]">{pfTotal}</span> pump.fun
                {data.pumpfun_graduated.length > 0 ? <span className="text-[var(--success)]"> ({data.pumpfun_graduated.length} grad)</span> : null}
              </span>
            )}
            {(data.launch_lab?.length || 0) > 0 && (
              <span><span className="text-[var(--accent)]">{data.launch_lab.length}</span> Launch Lab</span>
            )}
            {data.external.length > 0 && (
              <span><span className="text-[var(--warning)]">{data.external.length}</span> other{extBurnt > 0 ? <span className="text-[var(--muted)]"> ({extBurnt} burnt)</span> : null}</span>
            )}
          </div>
        </div>

        {/* CTA — opens modal with full categorized list */}
        <button
          onClick={() => setOpen(true)}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--background)]/40 transition-colors group"
        >
          <span className="text-xs font-mono text-[var(--muted)]">
            <span className="text-[var(--foreground)]">{grandTotal}</span> {grandTotal === 1 ? 'launch' : 'launches'}
            {platformCount > 1 ? <> across <span className="text-[var(--foreground)]">{platformCount}</span> platforms</> : null}
            {data.pumpfun_pregrad_count > 0 && (
              <span className="text-[var(--muted)]"> · {data.pumpfun_pregrad_count} pre-grad</span>
            )}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] group-hover:text-[var(--accent-gold)] transition-colors whitespace-nowrap">
            View full history →
          </span>
        </button>
      </div>

      {open && (
        <CreatorHistoryModal
          headerLabel={headerLabel}
          grandTotal={grandTotal}
          platformCount={platformCount}
          plFiltered={plFiltered}
          data={data}
          extActive={extActive}
          extBurnt={extBurnt}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

interface ModalProps {
  headerLabel: string;
  grandTotal: number;
  platformCount: number;
  plFiltered: ProofLaunchEntry[];
  data: CreatorLaunchesData;
  extActive: number;
  extBurnt: number;
  onClose: () => void;
}

const CreatorHistoryModal: React.FC<ModalProps> = ({
  headerLabel, grandTotal, platformCount, plFiltered, data, extActive, extBurnt, onClose,
}) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      {/* Glass backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-[var(--card)] border border-[var(--border)] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 sm:px-5 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-[var(--accent-gold)] shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                {headerLabel}
              </p>
              <p className="text-sm font-mono text-[var(--foreground)] truncate">
                {grandTotal} {grandTotal === 1 ? 'launch' : 'launches'}
                {platformCount > 1 ? <> across {platformCount} platforms</> : null}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto p-3 sm:p-4 space-y-4">
          {/* Proof Launch */}
          {plFiltered.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-mono uppercase tracking-widest text-[var(--accent)] px-2 py-1 border-b border-[var(--border)]/40">
                /// Via Proof Launch ({plFiltered.length})
              </p>
              {plFiltered.map((m) => {
                const badge = PL_STATUS_BADGE[m.status] || PL_STATUS_BADGE.backing;
                const { Icon } = badge;
                const date = new Date(m.created_at).toISOString().slice(0, 10);
                return (
                  <Link
                    key={m.id}
                    href={`/meme/${m.id}`}
                    onClick={onClose}
                    className="flex items-center justify-between gap-3 px-2 py-2 hover:bg-[var(--background)]/40 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest ${badge.cls}`}>
                        <Icon className="w-2.5 h-2.5" />
                        {badge.label}
                      </span>
                      <span className="text-xs font-mono font-semibold truncate">{m.symbol}</span>
                      <span className="text-xs font-mono text-[var(--muted)] truncate hidden sm:inline">{m.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--muted)] whitespace-nowrap">
                      <span>{date}</span>
                      <ExternalLink className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Pump.fun graduated */}
          {data.pumpfun_graduated.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-mono uppercase tracking-widest text-[var(--accent-gold)] px-2 py-1 border-b border-[var(--border)]/40">
                /// Via pump.fun (graduated) ({data.pumpfun_graduated.length})
              </p>
              {data.pumpfun_graduated.map((t) => (
                <a
                  key={t.mint}
                  href={`https://dexscreener.com/solana/${t.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-2 py-2 hover:bg-[var(--background)]/40 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1 border border-[var(--accent-gold)] text-[var(--accent-gold)] px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest">
                      <TrendingUp className="w-2.5 h-2.5" />
                      GRADUATED
                    </span>
                    <span className="text-xs font-mono font-semibold truncate">{t.symbol || '?'}</span>
                    <span className="text-xs font-mono text-[var(--muted)] truncate hidden sm:inline">{t.name || t.mint.slice(0, 8) + '…'}</span>
                  </div>
                  <ExternalLink className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                </a>
              ))}
            </div>
          )}

          {/* Launch Lab (Raydium) */}
          {(data.launch_lab?.length || 0) > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-mono uppercase tracking-widest text-[var(--accent)] px-2 py-1 border-b border-[var(--border)]/40">
                /// Via Launch Lab (Raydium) ({data.launch_lab.length})
              </p>
              {data.launch_lab.map((t) => (
                <a
                  key={t.mint}
                  href={`https://dexscreener.com/solana/${t.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-2 py-2 hover:bg-[var(--background)]/40 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1 border border-[var(--accent)] text-[var(--accent)] px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest">
                      <TrendingUp className="w-2.5 h-2.5" />
                      LAUNCH_LAB
                    </span>
                    <span className="text-xs font-mono font-semibold truncate">{t.symbol || '?'}</span>
                    <span className="text-xs font-mono text-[var(--muted)] truncate hidden sm:inline">{t.name || t.mint.slice(0, 8) + '…'}</span>
                  </div>
                  <ExternalLink className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                </a>
              ))}
            </div>
          )}

          {/* External (other launchpads via Helius DAS) */}
          {data.external.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-mono uppercase tracking-widest text-[var(--warning)] px-2 py-1 border-b border-[var(--border)]/40">
                /// Created elsewhere ({extActive} active{extBurnt > 0 ? `, ${extBurnt} burnt` : ''})
              </p>
              {data.external.map((t) => (
                <a
                  key={t.mint}
                  href={`https://dexscreener.com/solana/${t.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-2 py-2 hover:bg-[var(--background)]/40 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {t.burnt ? (
                      <span className="inline-flex items-center gap-1 border border-[var(--muted)] text-[var(--muted)] px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest">
                        <Flame className="w-2.5 h-2.5" />
                        BURNT
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 border border-[var(--warning)] text-[var(--warning)] px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest">
                        ACTIVE
                      </span>
                    )}
                    <span className="text-xs font-mono font-semibold truncate">{t.symbol || '?'}</span>
                    <span className="text-xs font-mono text-[var(--muted)] truncate hidden sm:inline">{t.name || t.mint.slice(0, 8) + '…'}</span>
                  </div>
                  <ExternalLink className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                </a>
              ))}
            </div>
          )}

          {/* Pre-grad count */}
          {data.pumpfun_pregrad_count > 0 && (
            <p className="text-[10px] font-mono text-[var(--muted)] text-center pt-2 pb-1 border-t border-[var(--border)]">
              &gt; +{data.pumpfun_pregrad_count} pump.fun {data.pumpfun_pregrad_count === 1 ? 'token' : 'tokens'} pre-graduation (still on bonding curve)
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
