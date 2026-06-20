'use client';

// Public proof-of-trust page. Anyone can land here, see every live
// launch's audit status at a glance, and click any token to verify
// its receipt live. The audit is the same forensic check the operator
// runs locally — just rendered with a permalink for the public to see.

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw, ExternalLink, ShieldCheck, AlertTriangle, ShieldAlert, MinusCircle } from 'lucide-react';

interface AuditFinding {
  severity: 'CRITICAL' | 'warn' | 'info';
  area: string;
  msg: string;
}

interface AuditSummary {
  rows_verified: number;
  rows_phantom: number;
  burn_on_chain: string;
  burn_db_sum: string;
  burn_drift_pct: number | null;
  uncollected_lamports: number;
  bot_count: number;
  backer_count: number;
  total_claimable_sol: number;
}

interface AuditRow {
  meme_id: string;
  symbol: string;
  name: string;
  mint_address: string | null;
  status: 'clean' | 'warn' | 'CRITICAL' | 'na';
  ran_at: string;
  findings: AuditFinding[];
  summary: AuditSummary;
  current_backing_sol?: number | null;
  launched_at?: string | null;
}

interface ListResponse {
  ran_at: string;
  aggregate: {
    total_memes: number;
    auditable: number;
    clean: number;
    warn: number;
    critical: number;
    na: number;
    rows_verified: number;
    phantoms_total: number;
  };
  reports: AuditRow[];
}

function StatusBadge({ status }: { status: AuditRow['status'] }) {
  if (status === 'clean') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
        <ShieldCheck className="w-3 h-3" /> CLEAN
      </span>
    );
  }
  if (status === 'warn') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
        <AlertTriangle className="w-3 h-3" /> WARN
      </span>
    );
  }
  if (status === 'CRITICAL') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--error)]">
        <ShieldAlert className="w-3 h-3" /> CRITICAL
      </span>
    );
  }
  // 'na' — no bot stack, audit doesn't apply
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
      <MinusCircle className="w-3 h-3" /> N/A
    </span>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function ProofPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reaudit, setReaudit] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/audit/list');
      if (r.ok) setData(await r.json());
    } catch { /* surfaced via empty state */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const rerunOne = async (memeId: string) => {
    setReaudit(memeId);
    try {
      const r = await fetch(`/api/audit/${memeId}?fresh=1`);
      if (r.ok) {
        const fresh: AuditRow = await r.json();
        setData((d) => d ? {
          ...d,
          reports: d.reports.map((row) => row.meme_id === memeId ? { ...row, ...fresh } : row),
        } : d);
      }
    } finally { setReaudit(null); }
  };

  const agg = data?.aggregate;

  return (
    <div className="space-y-6">
      {/* Header — terminal block */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // PROOF_LAUNCH.SYS // FORENSIC_AUDIT
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
            [PUBLIC]
          </span>
        </div>
        <div className="p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
            &gt; PROOF_OF_PROOF
          </div>
          <h1 className="text-2xl sm:text-3xl font-mono font-semibold uppercase tracking-tight">
            Public Audit Receipts
          </h1>
          <p className="text-xs font-mono text-[var(--muted)] mt-2 max-w-2xl leading-relaxed">
            Every live launch with a bot stack runs the same forensic check on-demand, exposed here for anyone to verify.
            DB claims vs on-chain reality, phantom-success detection, uncollected-fee surfaces, and burn supply
            reconciliation. Tokens without bots are marked N/A — there&apos;s nothing to reconcile.
          </p>
        </div>
      </div>

      {/* Aggregate stats */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // PLATFORM_HEALTH
          </span>
          {data?.ran_at && (
            <span className="text-[10px] font-mono text-[var(--muted)]">
              cached: ran {timeAgo(data.ran_at)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-[var(--border)]">
          <div className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">Live tokens</div>
            <div className="text-2xl sm:text-3xl font-mono font-semibold text-[var(--accent)]">
              {agg?.total_memes ?? '—'}
            </div>
            <div className="text-[9px] font-mono text-[var(--muted)] mt-1">
              {agg ? `${agg.auditable} with bots` : ''}
            </div>
          </div>
          <div className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">Clean</div>
            <div className="text-2xl sm:text-3xl font-mono font-semibold text-[var(--success)]">
              {agg?.clean ?? '—'}
            </div>
          </div>
          <div className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">Warn</div>
            <div className="text-2xl sm:text-3xl font-mono font-semibold text-[var(--accent-gold)]">
              {agg?.warn ?? '—'}
            </div>
          </div>
          <div className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">Critical</div>
            <div className="text-2xl sm:text-3xl font-mono font-semibold text-[var(--error)]">
              {agg?.critical ?? '—'}
            </div>
          </div>
          <div className="p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">N/A</div>
            <div className="text-2xl sm:text-3xl font-mono font-semibold text-[var(--muted)]">
              {agg?.na ?? '—'}
            </div>
            <div className="text-[9px] font-mono text-[var(--muted)] mt-1">no bot stack</div>
          </div>
        </div>
        <div className="border-t border-[var(--border)] px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {agg?.rows_verified ?? 0} ON-CHAIN TXS VERIFIED · {agg?.phantoms_total ?? 0} PHANTOMS DETECTED
          </div>
          <button
            type="button"
            onClick={fetchList}
            disabled={loading}
            className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Re-fetch
          </button>
        </div>
      </div>

      {/* Per-meme table */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // RECEIPTS [{data?.reports.length ?? 0}]
          </span>
        </div>
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
          </div>
        )}
        {!loading && data && data.reports.length === 0 && (
          <div className="p-12 text-center">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-3">[!] NO_LIVE</div>
            <p className="text-xs font-mono text-[var(--muted)]">&gt; No live tokens to audit right now.</p>
          </div>
        )}
        {!loading && data && data.reports.length > 0 && (
          <div className="divide-y divide-[var(--border)]">
            {data.reports.map((r) => {
              const isOpen = expanded === r.meme_id;
              return (
                <div key={r.meme_id} className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.meme_id)}
                    className="w-full text-left grid grid-cols-[3rem_minmax(0,1fr)_6rem_6rem_5rem] sm:grid-cols-[4rem_minmax(0,1fr)_8rem_7rem_6rem] items-center gap-3 hover:bg-[var(--border)]/10 transition-colors -mx-2 px-2 py-1"
                  >
                    <span className="text-[var(--muted)] font-mono text-[11px]">
                      {String(data.reports.indexOf(r) + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-sm truncate">
                        {r.symbol} <span className="text-[var(--muted)] font-normal">/ {r.name}</span>
                      </div>
                      <div className="font-mono text-[10px] text-[var(--muted)] truncate">
                        {r.mint_address ? `${r.mint_address.slice(0, 6)}…${r.mint_address.slice(-6)}` : 'unlaunched'}
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-right tabular-nums">
                      {r.status === 'na' ? <span className="text-[var(--muted)]">—</span> : `${r.summary.rows_verified} txs`}
                    </div>
                    <div className="font-mono text-[10px] text-right text-[var(--muted)]">
                      {r.status === 'na' ? '—' : timeAgo(r.ran_at)}
                    </div>
                    <div className="text-right">
                      <StatusBadge status={r.status} />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="mt-3 pt-3 border-t border-[var(--border)]/50 space-y-3">
                      {r.status === 'na' && (
                        <div className="text-[11px] font-mono text-[var(--muted)] py-2 leading-relaxed">
                          <span className="text-[var(--foreground)]">No bot stack configured.</span> The forensic audit verifies
                          on-chain bot activity against DB claims — without bots there&apos;s nothing to reconcile. Standard launch + backing
                          mechanics still run normally; they&apos;re just not in scope for this receipt.
                        </div>
                      )}

                      {r.status !== 'na' && (
                        <>
                      {/* Sub-summary metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-mono">
                        <div>
                          <div className="text-[9px] uppercase tracking-widest text-[var(--muted)]">Txs verified</div>
                          <div className="tabular-nums">{r.summary.rows_verified}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-widest text-[var(--muted)]">Phantoms</div>
                          <div className={`tabular-nums ${r.summary.rows_phantom > 0 ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>
                            {r.summary.rows_phantom}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-widest text-[var(--muted)]">Uncollected</div>
                          <div className="tabular-nums">{(r.summary.uncollected_lamports / 1e9).toFixed(4)} SOL</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-widest text-[var(--muted)]">Burn drift</div>
                          <div className="tabular-nums">
                            {r.summary.burn_drift_pct === null ? '—' : `${r.summary.burn_drift_pct.toFixed(2)}%`}
                          </div>
                        </div>
                      </div>

                      {/* Findings list */}
                      {r.findings.length === 0 ? (
                        <div className="text-[11px] font-mono text-[var(--success)] py-2">
                          ✓ No findings. System is internally consistent.
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {r.findings.map((f, i) => (
                            <div
                              key={i}
                              className={`text-[11px] font-mono px-2 py-1.5 border-l-2 ${
                                f.severity === 'CRITICAL' ? 'border-[var(--error)] text-[var(--error)]'
                                : f.severity === 'warn' ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]'
                                : 'border-[var(--muted)] text-[var(--muted)]'
                              }`}
                            >
                              <span className="uppercase tracking-wider text-[9px] opacity-70">[{f.severity}/{f.area}]</span>{' '}
                              {f.msg}
                            </div>
                          ))}
                        </div>
                      )}
                        </>
                      )}

                      {/* Actions row */}
                      <div className="flex items-center gap-3 pt-2">
                        {r.status !== 'na' && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); rerunOne(r.meme_id); }}
                            disabled={reaudit === r.meme_id}
                            className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3 h-3 ${reaudit === r.meme_id ? 'animate-spin' : ''}`} />
                            Run live
                          </button>
                        )}
                        <Link
                          href={`/meme/${r.meme_id}`}
                          className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-colors inline-flex items-center gap-1.5"
                        >
                          View token <ExternalLink className="w-3 h-3" />
                        </Link>
                        {r.mint_address && (
                          <a
                            href={`https://solscan.io/token/${r.mint_address}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-colors inline-flex items-center gap-1.5"
                          >
                            Mint on Solscan <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* How-it-works strip */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // HOW
          </span>
        </div>
        <div className="p-5 text-[11px] font-mono text-[var(--muted)] space-y-2 leading-relaxed">
          <p>
            <span className="text-[var(--foreground)]">A. Phantom-success scan</span> — every meme_buybacks row marked completed/partial is verified against its on-chain tx. If the DB claims success but the tx reverted, it&apos;s a phantom and gets flagged CRITICAL.
          </p>
          <p>
            <span className="text-[var(--foreground)]">B. Bot wallet reconciliation</span> — bot wallets&apos; on-chain balances are compared to the DB&apos;s lifetime sums. Drift gets flagged.
          </p>
          <p>
            <span className="text-[var(--foreground)]">C. Uncollected fee surfaces</span> — every place a token&apos;s creator fees can sit (BC vault, PumpSwap auth + wSOL, sub-escrow ATAs) is probed. Anything &gt;1 SOL is flagged.
          </p>
          <p>
            <span className="text-[var(--foreground)]">D. Burn supply reconciliation</span> — the on-chain mint&apos;s lifetime burn (1B initial − current supply) is compared to the DB&apos;s sum of burn-tx deltas. Drift &gt;1% is flagged.
          </p>
          <p className="pt-2 text-[var(--muted)]/70">
            Public API: <code className="text-[var(--accent)]">GET /api/audit/&lt;meme_id&gt;?fresh=1</code> returns the same JSON receipt rendered here.
          </p>
        </div>
      </div>
    </div>
  );
}
