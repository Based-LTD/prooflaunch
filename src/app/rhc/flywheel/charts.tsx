'use client';

// Two plain-SVG charts for the flywheel page. One series each, so the
// series hue does the identity work and the title names it; hover gives a
// crosshair + tooltip (area) or a per-bar tooltip (columns). Marks are
// thin, grid recessive, text in text tokens never the series color.
// Series hue #c98500 validated on the #0e0e0e card (dataviz six checks);
// the brand gold is too light for a fill and stays a text accent.
import { useMemo, useState } from 'react';

export const SERIES = '#c98500';
export const SERIES_2 = '#8a8a82'; // de-emphasis gray (emphasis form): always labeled

export interface Pt { x: number; y: number; label: string; sub?: string }

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const fmtY = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v >= 1 ? v.toFixed(v < 10 ? 2 : 0) : v.toFixed(4));

export function AreaChart({ pts, height = 200, unit = '' }: { pts: Pt[]; height?: number; unit?: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 640, H = height, L = 44, R = 12, T = 12, B = 26;
  const maxY = niceMax(Math.max(0, ...pts.map((p) => p.y)));
  const xs = (i: number) => (pts.length <= 1 ? L : L + ((W - L - R) * i) / (pts.length - 1));
  const ys = (v: number) => T + (H - T - B) * (1 - v / maxY);
  const path = useMemo(() => pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.y).toFixed(1)}`).join(' '), [pts, maxY]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = pts.length ? `${path} L${xs(pts.length - 1).toFixed(1)},${ys(0)} L${xs(0).toFixed(1)},${ys(0)} Z` : '';
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0, d = Infinity; pts.forEach((_, i) => { const dd = Math.abs(xs(i) - x); if (dd < d) { d = dd; best = i; } }); setHi(best);
  };
  if (!pts.length) return <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">no data yet</p>;
  const h = hi !== null ? pts[hi] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onMouseMove={onMove} onMouseLeave={() => setHi(null)} role="img" aria-label="area chart">
        {[0, 0.5, 1].map((f) => (<g key={f}><line x1={L} x2={W - R} y1={ys(maxY * f)} y2={ys(maxY * f)} stroke="var(--border)" strokeWidth="1" /><text x={L - 6} y={ys(maxY * f) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="monospace">{fmtY(maxY * f)}</text></g>))}
        <path d={area} fill={SERIES} fillOpacity="0.18" />
        <path d={path} fill="none" stroke={SERIES} strokeWidth="2" strokeLinejoin="round" />
        {pts.length && <circle cx={xs(pts.length - 1)} cy={ys(pts[pts.length - 1].y)} r="4" fill={SERIES} stroke="var(--card)" strokeWidth="2" />}
        {h && <><line x1={xs(hi!)} x2={xs(hi!)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="3 3" /><circle cx={xs(hi!)} cy={ys(h.y)} r="5" fill={SERIES} stroke="var(--card)" strokeWidth="2" /></>}
        <text x={L} y={H - 8} fontSize="9" fill="var(--muted)" fontFamily="monospace">{pts[0].label}</text>
        <text x={W - R} y={H - 8} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="monospace">{pts[pts.length - 1].label}</text>
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[10px] font-mono">
          <span className="text-[var(--muted)]">{h.label}</span> <span className="text-[var(--foreground)]">{fmtY(h.y)} {unit}</span>{h.sub && <span className="text-[var(--muted)]"> · {h.sub}</span>}
        </div>
      )}
    </div>
  );
}

export function Columns({ pts, height = 160, unit = '' }: { pts: Pt[]; height?: number; unit?: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 640, H = height, L = 44, R = 12, T = 12, B = 26;
  const maxY = niceMax(Math.max(0, ...pts.map((p) => p.y)));
  const n = Math.max(1, pts.length); const slot = (W - L - R) / n; const bw = Math.max(2, Math.min(28, slot - 2));
  const ys = (v: number) => T + (H - T - B) * (1 - v / maxY);
  if (!pts.length) return <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">no data yet</p>;
  const h = hi !== null ? pts[hi] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onMouseLeave={() => setHi(null)} role="img" aria-label="column chart">
        {[0, 0.5, 1].map((f) => (<g key={f}><line x1={L} x2={W - R} y1={ys(maxY * f)} y2={ys(maxY * f)} stroke="var(--border)" strokeWidth="1" /><text x={L - 6} y={ys(maxY * f) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="monospace">{fmtY(maxY * f)}</text></g>))}
        {pts.map((p, i) => {
          const x = L + slot * i + (slot - bw) / 2; const y = ys(p.y); const hgt = Math.max(0, ys(0) - y);
          return (<g key={i} onMouseEnter={() => setHi(i)}><rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" /><rect x={x} y={y} width={bw} height={hgt} rx={hgt > 4 ? 2 : 0} fill={SERIES} opacity={hi === null || hi === i ? 1 : 0.45} /></g>);
        })}
        <text x={L} y={H - 8} fontSize="9" fill="var(--muted)" fontFamily="monospace">{pts[0].label}</text>
        <text x={W - R} y={H - 8} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="monospace">{pts[pts.length - 1].label}</text>
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[10px] font-mono">
          <span className="text-[var(--muted)]">{h.label}</span> <span className="text-[var(--foreground)]">{fmtY(h.y)} {unit}</span>{h.sub && <span className="text-[var(--muted)]"> · {h.sub}</span>}
        </div>
      )}
    </div>
  );
}

/// Horizontal single-hue bars, sorted by the caller. Direct-labeled.
export function HBars({ rows, unit = '' }: { rows: { label: string; value: number; href?: string }[]; unit?: string }) {
  const max = Math.max(1e-12, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">no data yet</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[7rem_1fr_5rem] items-center gap-2 text-[10px] font-mono">
          {r.href ? <a href={r.href} className="truncate text-[var(--foreground)] hover:text-[var(--accent)]">{r.label}</a> : <span className="truncate text-[var(--foreground)]">{r.label}</span>}
          <div className="h-2.5 bg-[var(--background)] border border-[var(--border)]"><div className="h-full" style={{ width: `${(r.value / max) * 100}%`, background: SERIES }} /></div>
          <span className="text-right text-[var(--muted)] tabular-nums">{fmtY(r.value)} {unit}</span>
        </div>
      ))}
    </div>
  );
}
