'use client';

// The context a trade box needs before anyone should press Buy: price,
// market cap, where the token sits on the pons curve, what a trade pays,
// and the way out to the venues people already trust. A backer's first
// read of the card (2026-09-25): "I get you can buy here, but without
// mcap / curve position it's tough to know what buying means."
//
// Everything is read live from the curve; nothing here is a claim.
import { useEffect, useState } from 'react';
import { parseAbi } from 'viem';
import { rhcPublicClient } from '@/lib/rhc';

const curveStatsAbi = parseAbi([
  'function quoteReserve() view returns (uint256)',      // virtual + real ETH on the curve
  'function realQuoteReserve() view returns (uint256)',  // ETH actually deposited
  'function tokenReserve() view returns (uint256)',      // tokens still on the curve
  'function graduationThreshold() view returns (uint256)',
]);
const erc20Supply = parseAbi(['function totalSupply() view returns (uint256)']);

type Stats = { priceEth: number; mcapEth: number; progress: number; toGoEth: number; realEth: number };

export function CurveStats({ curve, token, symbol, taxBps, graduated }: {
  curve: `0x${string}`; token: `0x${string}`; symbol: string; taxBps: number; graduated: boolean;
}) {
  const [s, setS] = useState<Stats | null>(null);
  const [usd, setUsd] = useState<number | null>(null);

  useEffect(() => {
    if (graduated) return;
    let live = true;
    const load = async () => {
      try {
        const [q, rq, t, g, supply] = await rhcPublicClient.multicall({
          contracts: [
            { address: curve, abi: curveStatsAbi, functionName: 'quoteReserve' },
            { address: curve, abi: curveStatsAbi, functionName: 'realQuoteReserve' },
            { address: curve, abi: curveStatsAbi, functionName: 'tokenReserve' },
            { address: curve, abi: curveStatsAbi, functionName: 'graduationThreshold' },
            { address: token, abi: erc20Supply, functionName: 'totalSupply' },
          ],
          allowFailure: false,
        }) as [bigint, bigint, bigint, bigint, bigint];
        // Spot price from the reserve ratio — what the next marginal token costs.
        const priceEth = Number(q) / Number(t);
        const mcapEth = priceEth * (Number(supply) / 1e18);
        const progress = g > 0n ? Math.min(100, (Number(q) / Number(g)) * 100) : 0;
        const toGoEth = Math.max(0, Number(g - q) / 1e18);
        if (live) setS({ priceEth, mcapEth, progress, toGoEth, realEth: Number(rq) / 1e18 });
      } catch { /* keep the last good read */ }
    };
    void load();
    const id = setInterval(load, 15_000);
    return () => { live = false; clearInterval(id); };
  }, [curve, token, graduated]);

  useEffect(() => {
    let live = true;
    fetch('/api/rhc/eth-usd').then((r) => r.json()).then((j) => { if (live && typeof j.usd === 'number') setUsd(j.usd); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const money = (eth: number) => usd ? `$${(eth * usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null;
  const tile = 'border border-[var(--border)] bg-[var(--background)] px-2.5 py-2';
  const k = 'text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]';
  const v = 'font-mono text-sm text-[var(--foreground)] leading-tight';
  const sub = 'text-[9px] font-mono text-[var(--muted)]';

  return (
    <div className="space-y-2">
      {/* The one line nobody reads but everybody sees. */}
      <p className="text-[11px] font-mono text-[var(--foreground)] leading-snug">
        {graduated
          ? <>Trading is on <span className="text-[var(--accent)]">Uniswap v4</span> now. Buy and sell there, or on any venue below.</>
          : <>Buying here <span className="text-[var(--accent)]">is</span> buying on the pons bonding curve, from your wallet. Same price, same fees, nothing in between.</>}
      </p>

      {!graduated && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className={tile}>
            <div className={k}>Price</div>
            <div className={v}>{s ? s.priceEth.toExponential(2) : '—'} <span className={sub}>ETH</span></div>
            <div className={sub}>{s && usd ? `$${(s.priceEth * usd).toPrecision(3)}` : 'per token'}</div>
          </div>
          <div className={tile}>
            <div className={k}>Market cap</div>
            <div className={v}>{s ? s.mcapEth.toFixed(2) : '—'} <span className={sub}>ETH</span></div>
            <div className={sub}>{s ? (money(s.mcapEth) ?? 'full supply at spot') : ''}</div>
          </div>
          <div className={tile}>
            <div className={k}>Curve → graduation</div>
            <div className={v}>{s ? `${s.progress.toFixed(1)}%` : '—'}</div>
            <div className="h-1 mt-1 bg-[var(--border)]"><div className="h-1 bg-[var(--accent)]" style={{ width: `${s?.progress ?? 0}%` }} /></div>
            <div className={sub}>{s ? `${s.toGoEth.toFixed(3)} ETH to Uniswap v4` : ''}</div>
          </div>
          <div className={tile}>
            <div className={k}>Every trade pays</div>
            <div className={v}>{((taxBps + 100) / 100).toFixed(taxBps % 100 ? 1 : 0)}%</div>
            <div className={sub}>{(taxBps / 100).toFixed(taxBps % 100 ? 1 : 0)}% to backers · 1% pons</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* pons is the venue people already trust — it gets the primary
            button. The box below exists so no launch depends on it. */}
        <a href={`https://www.ponsfamily.com/launchpad/${token.toLowerCase()}`} target="_blank" rel="noopener noreferrer" className="btn-primary !px-3 !py-1.5 !text-[10px]">
          Trade on pons ↗
        </a>
        <a href={`https://axiom.trade/meme/${token}`} target="_blank" rel="noopener noreferrer"
          className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
          Trade on Axiom ↗
        </a>
        {graduated && (
          <a href={`https://dexscreener.com/robinhood/${token}`} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
            Dexscreener ↗
          </a>
        )}
        <span className="self-center text-[9px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
          {graduated ? '' : 'or trade below'}
        </span>
      </div>
    </div>
  );
}
