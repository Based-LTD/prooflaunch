'use client';

// The $PLAUNCH flywheel, in full. Everything here is a chain read through
// /api/rhc/flywheel: the burner's counters, the dead address, every burn
// by day, which launches fed it, who cranked it. Before the burner exists
// the page explains the mechanism and shows the shape of what will fill
// in — same layout, dashed numbers — so the URL can be shared on day one.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount, useWriteContract } from 'wagmi';
import { RhcHeader } from '../components';
import { DashboardCard } from '@/components/meme/DashboardCard';
import { AreaChart, Columns, HBars, SERIES, SERIES_2 } from './charts';
import { proofBurnerAbi, PROOF_BURNER, PROOF_BURNER_LIVE, fmtEth, explorerUrl, robinhoodChain } from '@/lib/rhc';
import type { FlywheelFeed } from '../../api/rhc/flywheel/route';

const tok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' });
const ago = (ts: number | null) => { if (!ts) return ''; const s = Math.max(0, Math.floor(Date.now() / 1000) - ts); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const CAP = 200_000_000_000_000_000n;

export default function FlywheelPage() {
  const [f, setF] = useState<FlywheelFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { address: me, isConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

  useEffect(() => {
    if (!PROOF_BURNER_LIVE) return;
    let live = true;
    const load = async () => {
      try { const r = await fetch('/api/rhc/flywheel', { cache: 'no-store' }); const j = await r.json(); if (!live) return; if (!r.ok) { setErr(j.error ?? 'feed error'); return; } setErr(null); setF(j); }
      catch (e) { if (live) setErr(e instanceof Error ? e.message : String(e)); }
    };
    void load(); const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const n = (s?: string) => (s ? Number(s) / 1e18 : 0);
  const dead = n(f?.dead), supply = n(f?.supply), spent = n(f?.spent), pulled = n(f?.pulled), pending = n(f?.pending), fees = n(f?.creationFees);
  const pct = supply > 0 ? (dead / supply) * 100 : 0;
  const pendingWei = f?.pending ? BigInt(f.pending) : 0n;

  // series
  let cum = 0;
  const cumulative = (f?.daily ?? []).map((d) => { cum += n(d.tokens); return { x: 0, y: cum, label: day(d.day), sub: `${d.count} burn${d.count === 1 ? '' : 's'}` }; });
  const perDay = (f?.daily ?? []).map((d) => ({ x: 0, y: n(d.eth), label: day(d.day), sub: `${tok(n(d.tokens))} $PLAUNCH` }));
  const sources = [{ label: 'campaign fee legs + forfeits', value: pulled, color: SERIES }, { label: 'creation fees', value: fees, color: SERIES_2 }];
  const srcTotal = Math.max(1e-12, pulled + fees);
  const myCranks = me && f?.crankers ? (f.crankers.find((c) => c.wallet.toLowerCase() === me.toLowerCase())?.cranks ?? 0) : 0;

  const live = PROOF_BURNER_LIVE && !!f;
  const dash = (v: string) => (live ? v : '—');

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <RhcHeader />

      {/* hero */}
      <div className="border border-[var(--accent-gold)]/60 bg-[var(--card)]">
        <div className="flex items-center justify-between border-b border-[var(--accent-gold)]/40 px-3 py-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">{'// '}THE $PLAUNCH FLYWHEEL</span>
          {PROOF_BURNER_LIVE
            ? <a href={explorerUrl(PROOF_BURNER)} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)]">burner contract ↗</a>
            : <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">begins with the $PLAUNCH launch</span>}
        </div>
        <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6 items-center">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">$PLAUNCH that no longer exists</div>
            <div className="font-sans font-semibold text-5xl sm:text-6xl text-[var(--accent-gold)] leading-none mt-2 tabular-nums">{dash(tok(dead))}</div>
            <div className="mt-3 h-3 border border-[var(--accent-gold)]/40 bg-[var(--background)] overflow-hidden">
              <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: SERIES, transition: 'width .9s' }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              <span>{live ? `${pct.toFixed(3)}% of supply` : '0.000% of supply'}</span>
              <span>{live ? `${tok(supply)} minted` : ''}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['ETH burned into $PLAUNCH', dash(`${spent.toFixed(4)} ETH`)],
              ['collected from campaigns', dash(`${pulled.toFixed(4)} ETH`)],
              ['waiting to burn', dash(`${pending.toFixed(4)} ETH`)],
              ['burns so far', dash(String(f?.totalBurns ?? 0))],
            ].map(([k, v]) => (
              <div key={k} className="border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <div className="font-mono text-base tabular-nums text-[var(--foreground)]">{v}</div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mt-0.5">{k}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 sm:px-6 pb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-mono text-[var(--muted)] max-w-2xl leading-relaxed">
            {live ? 'Every launch on this site carries' : 'From the flywheel factory onward, every launch on this site will carry'} a fixed <span className="text-[var(--accent-gold)]">30% $PLAUNCH burn leg</span> on its creator tax. Every creation fee and every share a seller forfeits burns too.
            {live ? 'An ownerless contract does the buying:' : 'An ownerless contract will do the buying:'} pons curve before graduation, Uniswap v4 after, 0.2 ETH per crank, one crank per block. Anyone can crank it; nobody can stop it or point it anywhere else.
          </p>
          {live && isConnected && pendingWei > 0n && (
            <button onClick={() => writeContract({ address: PROOF_BURNER, abi: proofBurnerAbi, functionName: 'crank', chainId: robinhoodChain.id })} disabled={isPending}
              className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--accent-gold)] text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/10 disabled:opacity-40">
              🔥 Burn {fmtEth(pendingWei > CAP ? CAP : pendingWei, 4)} ETH now{myCranks ? ` · you've cranked ${myCranks}×` : ''}
            </button>
          )}
        </div>
        {err && <p className="px-4 pb-3 text-xs font-mono text-[var(--error)]">feed: {err}</p>}
      </div>

      {!PROOF_BURNER_LIVE && (
        <div className="mt-4 border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-3">{'// '}HOW IT WILL RUN</div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-[10px] font-mono uppercase tracking-widest">
            {['A trade on any ProofLaunch token', 'creator tax (0–10%, set at creation)', '30% → the burner, fixed', '$PLAUNCH bought on-chain', 'sent to 0x…dEaD'].map((t, i) => (
              <div key={t} className="border border-[var(--border)] bg-[var(--background)] px-3 py-2 flex items-center gap-2"><span className="text-[var(--accent-gold)]">{i + 1}</span><span className="text-[var(--foreground)] normal-case tracking-normal">{t}</span></div>
            ))}
          </div>
          <p className="mt-3 text-xs font-mono text-[var(--muted)]">Plus every creation fee and every seller&apos;s forfeited share. The charts below fill in from the first burn. <Link href="/rhc/docs" className="text-[var(--accent)] hover:underline">Docs →</Link></p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DashboardCard label="$PLAUNCH BURNED, CUMULATIVE" meta={live ? `${tok(n(f?.burnedByFlywheel))} via the flywheel` : undefined}>
          {live ? <AreaChart pts={cumulative} unit="$PLAUNCH" /> : <div className="h-40 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">fills in from the first burn</div>}
        </DashboardCard>
        <DashboardCard label="ETH BURNED PER DAY" meta={live ? `${(f?.daily ?? []).length} days` : undefined}>
          {live ? <Columns pts={perDay} unit="ETH" /> : <div className="h-40 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">fills in from the first burn</div>}
        </DashboardCard>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DashboardCard label="WHERE THE ETH CAME FROM">
          {live ? (
            <div className="space-y-2">
              <div className="flex h-3 gap-[2px] overflow-hidden">
                {sources.map((s) => <div key={s.label} style={{ width: `${(s.value / srcTotal) * 100}%`, background: s.color }} title={s.label} />)}
              </div>
              {sources.map((s) => (
                <div key={s.label} className="flex items-center justify-between text-[10px] font-mono">
                  <span className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5" style={{ background: s.color }} /><span className="text-[var(--foreground)]">{s.label}</span></span>
                  <span className="text-[var(--muted)] tabular-nums">{s.value.toFixed(4)} ETH · {((s.value / srcTotal) * 100).toFixed(0)}%</span>
                </div>
              ))}
              <p className="text-[10px] font-mono text-[var(--muted-soft)]">Forfeits arrive through the same leg as the fixed 30%, so they are counted together.</p>
            </div>
          ) : <div className="h-24 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">—</div>}
        </DashboardCard>
        <DashboardCard label="LAUNCHES FEEDING THE BURN" meta={live ? `${(f?.feeders ?? []).length} campaigns` : undefined}>
          {live ? <HBars unit="ETH" rows={(f?.feeders ?? []).map((x) => ({ label: `$${x.symbol}`, value: n(x.eth), href: `/rhc/campaign/${x.campaign}` }))} /> : <div className="h-24 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">—</div>}
        </DashboardCard>
        <DashboardCard label="WHO CRANKS IT" meta={live ? 'last 60 burns' : undefined}>
          {live ? <HBars unit="cranks" rows={(f?.crankers ?? []).map((c) => ({ label: short(c.wallet), value: c.cranks, href: explorerUrl(c.wallet) }))} /> : <div className="h-24 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">—</div>}
        </DashboardCard>
      </div>

      <div className="mt-4">
        <DashboardCard label="EVERY BURN" meta={live ? `last ${(f?.burns ?? []).length}` : undefined} noBodyPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead><tr className="border-b border-[var(--border)]">{['when', 'ETH in', '$PLAUNCH burned', 'route', 'cranked by', 'tx'].map((h) => <th key={h} className="text-left py-2 px-3 text-[10px] uppercase tracking-widest text-[var(--muted)]">{h}</th>)}</tr></thead>
              <tbody>
                {live && (f?.burns ?? []).length ? (f!.burns!.map((b) => (
                  <tr key={b.tx} className="border-b border-[var(--border)]/50">
                    <td className="py-2 px-3 text-[var(--muted)]">{ago(b.ts)}</td>
                    <td className="py-2 px-3 tabular-nums">{n(b.ethIn).toFixed(4)}</td>
                    <td className="py-2 px-3 tabular-nums text-[var(--accent-gold)]">{tok(n(b.tokens))}</td>
                    <td className="py-2 px-3 text-[var(--muted)]">{b.viaCurve ? 'curve' : 'v4 pool'}</td>
                    <td className="py-2 px-3">{b.from ? <a href={explorerUrl(b.from)} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)]">{short(b.from)}</a> : '—'}</td>
                    <td className="py-2 px-3"><a href={`https://robinhoodchain.blockscout.com/tx/${b.tx}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{b.tx.slice(0, 10)}…</a></td>
                  </tr>
                ))) : (
                  <tr><td colSpan={6} className="py-6 text-center text-[10px] uppercase tracking-widest text-[var(--muted)]">{PROOF_BURNER_LIVE ? 'no burns yet' : 'the first burn lands here'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </DashboardCard>
      </div>

      <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
        {live ? 'Every number on this page is read from the chain.' : 'Once the burner is live, every number on this page is read from the chain.'} Burner counters, the dead address balance, and the burner&apos;s own events. <Link href="/rhc/audit" className="underline hover:text-[var(--muted)]">Audit →</Link>
      </p>
    </div>
  );
}
