'use client';

// The flywheel you can watch. A spoked wheel that turns faster when ETH
// is waiting to burn, numbers that count up when they change, a bar of
// $PROOF supply that no longer exists, and a tape of the last burns each
// linking to its transaction. Before the burner exists the tape scrolls
// the mechanism itself so the panel is alive from day one. Every number
// comes from /api/rhc/flywheel, which reads the chain; nothing is
// estimated. Respects prefers-reduced-motion.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount, useWriteContract } from 'wagmi';
import { proofBurnerAbi, PROOF_BURNER, PROOF_BURNER_LIVE, fmtEth, explorerUrl, robinhoodChain } from '@/lib/rhc';
import type { FlywheelFeed } from '../api/rhc/flywheel/route';

const CAP = 200_000_000_000_000_000n; // 0.2 ETH per crank

/// Animate a number from its previous value to the new one (~900ms, eased).
function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); from.current = target; return; }
    const start = performance.now(); const a = from.current; const b = target;
    if (a === b) return;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - p, 3);
      setV(a + (b - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const tok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const eth = (n: number, d = 4) => n.toFixed(d);
const ago = (ts: number | null) => {
  if (!ts) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

function Wheel({ speed, live }: { speed: number; live: boolean }) {
  // speed: seconds per revolution. Slow idle, quick when there is ETH waiting.
  return (
    <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0" aria-hidden>
      <svg viewBox="0 0 100 100" className="w-full h-full fw-spin" style={{ animationDuration: `${speed}s` }}>
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--accent-gold)" strokeOpacity="0.35" strokeWidth="2" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="var(--accent-gold)" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="4 3" />
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * Math.PI) / 4; const x1 = 50 + 30 * Math.cos(a), y1 = 50 + 30 * Math.sin(a), x2 = 50 + 44 * Math.cos(a), y2 = 50 + 44 * Math.sin(a);
          const ax = 50 + 44 * Math.cos(a + 0.12), ay = 50 + 44 * Math.sin(a + 0.12);
          return (<g key={i}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent-gold)" strokeWidth="2.5" strokeLinecap="round" /><circle cx={ax} cy={ay} r="2.2" fill="var(--accent)" /></g>);
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-2xl ${live ? 'fw-flame' : 'opacity-60'}`}>🔥</span>
      </div>
      <style jsx>{`
        .fw-spin { animation: fw-rot linear infinite; transform-origin: 50% 50%; }
        @keyframes fw-rot { to { transform: rotate(360deg); } }
        .fw-flame { animation: fw-flick 0.9s ease-in-out infinite; display: inline-block; }
        @keyframes fw-flick { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 4px rgba(255,157,0,.6)); } 50% { transform: scale(1.18); filter: drop-shadow(0 0 12px rgba(255,157,0,.95)); } }
        @media (prefers-reduced-motion: reduce) { .fw-spin, .fw-flame { animation: none !important; } }
      `}</style>
    </div>
  );
}

// One moving thing on the panel (the wheel). Everything else holds still:
// a five-step flow strip before launch, the last three burns after.
const FLOW = ['a trade', 'creator tax', '30% → burner', '$PROOF bought', 'burned'];

export function FlywheelPanel({ compact = false, strip = false }: { compact?: boolean; strip?: boolean }) {
  const [f, setF] = useState<FlywheelFeed | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const prev = useRef<FlywheelFeed | null>(null);
  const { isConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

  useEffect(() => {
    if (!PROOF_BURNER_LIVE) return;
    let live = true;
    const load = async () => {
      try {
        const r = await fetch('/api/rhc/flywheel', { cache: 'no-store' }); const j: FlywheelFeed = await r.json();
        if (!live || !j.live || !j.dead) return;
        if (prev.current && prev.current.dead !== j.dead) { setFlash('burned'); setTimeout(() => setFlash(null), 1600); }
        prev.current = j; setF(j);
      } catch { /* keep last */ }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const dead = f?.dead ? Number(f.dead) / 1e18 : 0;
  const supply = f?.supply ? Number(f.supply) / 1e18 : 0;
  const spent = f?.spent ? Number(f.spent) / 1e18 : 0;
  const pulled = f?.pulled ? Number(f.pulled) / 1e18 : 0;
  const pendingWei = f?.pending ? BigInt(f.pending) : 0n;
  const pending = Number(pendingWei) / 1e18;
  const deadA = useCountUp(dead), spentA = useCountUp(spent), pulledA = useCountUp(pulled), pendingA = useCountUp(pending);
  const pct = supply > 0 ? (dead / supply) * 100 : 0;
  const pctA = useCountUp(pct);
  // idle: one turn per 24s; with ETH waiting, down to one per 4s
  const speed = !PROOF_BURNER_LIVE ? 30 : pending > 0 ? Math.max(4, 24 - Math.min(20, pending * 200)) : 24;

  const recent = (f?.burns ?? []).slice(0, 3);

  // The board's strip: the wheel, the number, the meter, three figures,
  // the crank, two links. No sentences — the page is the tokens.
  if (strip) {
    return (
      <div className={`border border-[var(--accent-gold)]/60 bg-[var(--card)] ${flash ? 'fw-flash' : ''}`}>
        <div className="p-3 sm:p-4 flex flex-col md:flex-row md:items-center gap-4">
          <Wheel speed={speed} live={PROOF_BURNER_LIVE && pending > 0} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-3xl sm:text-4xl text-[var(--accent-gold)] leading-none tabular-nums">{PROOF_BURNER_LIVE ? (f ? tok(deadA) : '…') : '0'}</span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">$PROOF burned · {PROOF_BURNER_LIVE && f ? pctA.toFixed(3) : '0.000'}% of supply</span>
            </div>
            <div className="mt-2 h-1.5 border border-[var(--accent-gold)]/40 bg-[var(--background)] overflow-hidden">
              <div className="h-full bg-[var(--accent-gold)] fw-bar" style={{ width: `${Math.min(100, pctA)}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              <span><span className="text-[var(--foreground)] tabular-nums">{PROOF_BURNER_LIVE && f ? eth(spentA) : '0'}</span> ETH burned</span>
              <span><span className="text-[var(--success)] tabular-nums">{PROOF_BURNER_LIVE && f ? eth(pendingA) : '0'}</span> ETH waiting</span>
              <span><span className="text-[var(--foreground)] tabular-nums">{PROOF_BURNER_LIVE && f ? (f.burns?.length ?? 0) : 0}</span> burns</span>
              <span><span className="text-[var(--accent-gold)]">30%</span> of every launch&apos;s tax</span>
            </div>
          </div>
          <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0">
            {PROOF_BURNER_LIVE && isConnected && pendingWei > 0n && (
              <button onClick={() => writeContract({ address: PROOF_BURNER, abi: proofBurnerAbi, functionName: 'crank', chainId: robinhoodChain.id })} disabled={isPending}
                className="fw-glow px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--accent-gold)] text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/10 disabled:opacity-40">
                🔥 Burn {fmtEth(pendingWei > CAP ? CAP : pendingWei, 4)} ETH
              </button>
            )}
            <Link href="/rhc/flywheel" className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:text-[var(--accent-hover)]">full flywheel →</Link>
          </div>
        </div>
        <style jsx>{`
          .fw-bar { transition: width 0.9s cubic-bezier(.2,.8,.2,1); box-shadow: 0 0 10px rgba(255,157,0,.6); }
          .fw-glow { animation: fw-pulse 1.6s ease-in-out infinite; }
          @keyframes fw-pulse { 0%,100% { box-shadow: 0 0 0 rgba(255,157,0,0); } 50% { box-shadow: 0 0 16px rgba(255,157,0,.55); } }
          .fw-flash { animation: fw-hit 1.6s ease-out; }
          @keyframes fw-hit { 0% { box-shadow: inset 0 0 0 2px rgba(255,157,0,.9), 0 0 24px rgba(255,157,0,.5); } 100% { box-shadow: none; } }
          @media (prefers-reduced-motion: reduce) { .fw-glow, .fw-flash { animation: none !important; } }
        `}</style>
      </div>
    );
  }

  return (
    <div className={`border border-[var(--accent-gold)]/60 bg-[var(--card)] overflow-hidden ${flash ? 'fw-flash' : ''}`}>
      <div className="flex items-center justify-between border-b border-[var(--accent-gold)]/40 px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">{'// '}FLYWHEEL — fees → burned $PROOF</span>
        <span className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          {!PROOF_BURNER_LIVE && <span>begins with the $PROOF launch</span>}
          <Link href="/rhc/flywheel" className="text-[var(--accent)] hover:text-[var(--accent-hover)]">full flywheel →</Link>
        </span>
      </div>

      <div className={`p-3 ${compact ? '' : 'sm:p-4'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Wheel speed={speed} live={PROOF_BURNER_LIVE && pending > 0} />
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">$PROOF that no longer exists</div>
            <div className="font-mono text-3xl sm:text-4xl text-[var(--accent-gold)] leading-none mt-1 tabular-nums">
              {PROOF_BURNER_LIVE ? (f ? tok(deadA) : '…') : '—'}
            </div>
            <div className="mt-2 h-2 border border-[var(--accent-gold)]/40 bg-[var(--background)] overflow-hidden">
              <div className="h-full bg-[var(--accent-gold)] fw-bar" style={{ width: `${Math.min(100, pctA)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
              <span>{PROOF_BURNER_LIVE && f ? `${pctA.toFixed(3)}% of supply` : '0.000% of supply'}</span>
              <span>{PROOF_BURNER_LIVE && f ? `${f.burns?.length ?? 0} burns on the tape` : 'counters start at launch'}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['ETH burned into $PROOF', PROOF_BURNER_LIVE && f ? `${eth(spentA)} ETH` : '— ETH', 'var(--foreground)', 'spent'],
            ['Collected from campaigns', PROOF_BURNER_LIVE && f ? `${eth(pulledA)} ETH` : '— ETH', 'var(--muted)', 'pulled'],
            ['Waiting to burn', PROOF_BURNER_LIVE && f ? `${eth(pendingA)} ETH` : '— ETH', 'var(--success)', 'pending'],
            ['Fixed legs, every launch', '30% burn · 10% platform', 'var(--accent-gold)', 'legs'],
          ].map(([k, v, c, id]) => (
            <div key={id} className="border border-[var(--border)] bg-[var(--background)] px-3 py-2">
              <div className="font-mono text-sm tabular-nums" style={{ color: c }}>{v}</div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mt-0.5">{k}</div>
            </div>
          ))}
        </div>

        {PROOF_BURNER_LIVE && recent.length > 0 ? (
          <div className="mt-3 border-t border-[var(--accent-gold)]/30 pt-2 space-y-1">
            {recent.map((b) => (
              <a key={b.tx} href={`https://robinhoodchain.blockscout.com/tx/${b.tx}`} target="_blank" rel="noopener noreferrer"
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-[10px] font-mono uppercase tracking-widest hover:text-[var(--accent)]">
                <span><span className="text-[var(--accent-gold)]">🔥 {tok(Number(b.tokens) / 1e18)} $PROOF</span> <span className="text-[var(--muted)]">for {eth(Number(b.ethIn) / 1e18)} ETH · {b.viaCurve ? 'curve' : 'v4'}</span></span>
                <span className="text-[var(--muted)]">{ago(b.ts)}</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-3 border-t border-[var(--accent-gold)]/30 pt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono uppercase tracking-widest">
            {FLOW.map((t, i) => (
              <span key={t} className="flex items-center gap-2">
                <span className={i === FLOW.length - 1 ? 'text-[var(--accent-gold)]' : 'text-[var(--foreground)]'}>{t}</span>
                {i < FLOW.length - 1 && <span className="text-[var(--muted-soft)]">→</span>}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {PROOF_BURNER_LIVE ? 'Ownerless. Anyone can crank it; nobody can stop it or point it anywhere else.' : 'Every launch through this site feeds it. Backers keep the majority; sellers forfeit into it.'}
          </p>
          {PROOF_BURNER_LIVE && isConnected && pendingWei > 0n && (
            <button onClick={() => writeContract({ address: PROOF_BURNER, abi: proofBurnerAbi, functionName: 'crank', chainId: robinhoodChain.id })} disabled={isPending}
              className="fw-glow px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--accent-gold)] text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/10 disabled:opacity-40">
              🔥 Burn {fmtEth(pendingWei > CAP ? CAP : pendingWei, 4)} ETH now
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .fw-bar { transition: width 0.9s cubic-bezier(.2,.8,.2,1); box-shadow: 0 0 10px rgba(255,157,0,.6); }
        .fw-glow { animation: fw-pulse 1.6s ease-in-out infinite; }
        @keyframes fw-pulse { 0%,100% { box-shadow: 0 0 0 rgba(255,157,0,0); } 50% { box-shadow: 0 0 16px rgba(255,157,0,.55); } }
        .fw-flash { animation: fw-hit 1.6s ease-out; }
        @keyframes fw-hit { 0% { box-shadow: inset 0 0 0 2px rgba(255,157,0,.9), 0 0 24px rgba(255,157,0,.5); } 100% { box-shadow: none; } }
        @media (prefers-reduced-motion: reduce) {
          .fw-glow, .fw-flash { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
