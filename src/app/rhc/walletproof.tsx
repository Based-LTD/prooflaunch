'use client';

// WalletProof surfaces for the RHC world: a tier badge for cards, the full "who is really buying" panel for a
// token, and the chain-wide stats bar. All data comes from the WalletProof engine as counts/shares — no wallets.
import { useEffect, useState } from 'react';
import { fetchVerdict, fetchWpStats, WpVerdict, WpStats, WP_TIER_COLOR } from '@/lib/walletproof';

export function useVerdict(token?: string | null) {
  const valid = !!token && /^0x[0-9a-fA-F]{40}$/.test(token) && !/^0x0{40}$/.test(token);
  const [v, setV] = useState<WpVerdict | null | undefined>(undefined); // undefined = loading, null = unknown
  useEffect(() => {
    if (!valid) return;
    let live = true;
    const tick = () => fetchVerdict(token as string).then((r) => { if (live) setV(r); });
    tick();
    const id = setInterval(tick, 20_000);
    return () => { live = false; clearInterval(id); };
  }, [token, valid]);
  return valid ? v : null;
}

const pillStyle = (color: string) => ({
  borderColor: `color-mix(in srgb, ${color} 60%, transparent)`, color, background: `color-mix(in srgb, ${color} 5%, transparent)`,
});

// Compact pill: "🟢 REAL · 41 buyers". Renders nothing while loading or when the engine doesn't know the token.
export function WpBadge({ token }: { token?: string | null }) {
  const v = useVerdict(token);
  if (!v) return null;
  const color = WP_TIER_COLOR[v.tier];
  return (
    <span title={v.reasons.join(' · ')} className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border shrink-0" style={pillStyle(color)}>
      <span>{v.emoji}</span><span>{v.label}</span>
      <span className="opacity-70">· {v.buyers.real} real</span>
    </span>
  );
}

function Stat({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--background)] px-3 py-2" title={hint}>
      <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">{k}</div>
      <div className="font-mono text-sm text-[var(--foreground)]">{v}</div>
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// Full verdict panel for one token.
export function WpPanel({ token, compact = false }: { token?: string | null; compact?: boolean }) {
  const v = useVerdict(token);
  if (v === undefined) return <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] animate-pulse">reading buyers…</p>;
  if (v === null) return <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">WalletProof has no read on this token yet.</p>;
  const color = WP_TIER_COLOR[v.tier];
  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{'// '}WalletProof — who is really buying</span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 border" style={pillStyle(color)}>
          {v.emoji} {v.label}
        </span>
      </div>
      <div className="p-3 space-y-3">
        <p className="font-mono text-xs text-[var(--foreground)]">{v.blurb}</p>
        <ul className="space-y-1">
          {v.reasons.map((r) => <li key={r} className="font-mono text-[11px] text-[var(--muted)]">— {r}</li>)}
        </ul>
        <div className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
          <Stat k="independent buyers" v={String(v.buyers.real)} hint="wallets with history on this chain, not seen in synchronized dumps, not launch bots" />
          <Stat k="crew volume" v={pct(v.volume_eth.crew_share)} hint="share of buy ETH from wallets seen in 8+-seller synchronized dumps" />
          <Stat k="one-shot wallets" v={`${v.buyers.one_shot} (${pct(v.buyers.total ? v.buyers.one_shot / v.buyers.total : 0)})`} hint="wallets that bought exactly one launch, ever" />
          <Stat k="launch bots" v={String(v.buyers.bots)} hint="wallets that bought 100+ launches" />
          {!compact && <Stat k="synchronized dumps" v={String(v.curve_state.dumps)} />}
          {!compact && <Stat k="curve" v={`${v.curve_state.reserve_eth.toFixed(2)} ETH${v.curve_state.graduated ? ' · graduated' : ''}`} hint={`peak ${v.curve_state.peak_eth.toFixed(2)} ETH`} />}
          {!compact && <Stat k="deployer launches" v={String(v.deployer_history.launches)} hint={`${v.deployer_history.graduations} graduations · ${v.deployer_history.crew_dumped_tokens} crew-dumped · ${v.deployer_history.farm_tokens} farm-bought`} />}
          {!compact && <Stat k="top buyer" v={pct(v.buyers.top_buyer_share)} hint="largest single buyer's share of buy volume" />}
        </div>
        {v.receipt && (
          <p className="text-[9px] font-mono text-[var(--muted-soft)] leading-relaxed">
            receipt: blocks {v.receipt.launch_block.toLocaleString()}–{v.receipt.indexed_to_block.toLocaleString()} · {v.receipt.trades.toLocaleString()} trades replayed · {v.receipt.method}
          </p>
        )}
      </div>
    </div>
  );
}

// Chain-wide bar: what the rest of Pons looked like in the last 24 h.
export function WpStatsBar() {
  const [s, setS] = useState<WpStats | null>(null);
  useEffect(() => { fetchWpStats(24).then(setS); const id = setInterval(() => fetchWpStats(24).then(setS), 60_000); return () => clearInterval(id); }, []);
  if (!s) return null;
  const manu = s.graduations_by_tier.MANUFACTURED;
  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{'// '}Pons, last 24 h — WalletProof</span>
        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">every trade replayed on-chain</span>
      </div>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat k="launches" v={s.launches.toLocaleString()} />
        <Stat k="graduations" v={String(s.graduations)} />
        <Stat k="manufactured graduations" v={`${manu} (${s.graduations ? Math.round((manu / s.graduations) * 100) : 0}%)`} hint={`by ${s.manufactured_graduation_deployers} deployers`} />
        <Stat k="buy volume from crews" v={pct(s.crew_buy_share)} hint={`${s.known_crew_wallets.toLocaleString()} known crew wallets`} />
      </div>
    </div>
  );
}
