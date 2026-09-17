'use client';

// "Claim" is the button. "Claim as stock" is an affordance beside it.
//
// The whole design rule lives in this layout: the picker must never sit
// on the critical path. Someone who wants their ETH hits one button and
// is done — they never see an asset list, never make a portfolio
// decision to collect what they already earned. Someone who wants shares
// opens a drawer. Zero added friction for the default, full power for
// the person who cares.
//
// Every option shows what it would ACTUALLY pay, simulated against the
// live pool. Showing only tickers would hide pool fees that run to 5% on
// the thinner assets, and an invisible 5% on a claim screen reads as us
// skimming — which is the one accusation we can least afford.
import { useCallback, useEffect, useState } from 'react';
import {
  EQUITY_ASSETS,
  EQUITY_ROUTER_LIVE,
  PRICEY_FEE_BPS,
  type EquityAsset,
  fmtShares,
  minOutFrom,
  quoteEquityOut,
} from '@/lib/rhcEquity';
import { fmtEth } from '@/lib/rhc';

interface Props {
  owed: bigint;
  account?: `0x${string}`;
  busy?: boolean;
  onClaimEth: () => void;
  onClaimAs: (asset: EquityAsset, minOut: bigint) => void;
}

type Quotes = Record<string, bigint | null | 'loading'>;

export function ClaimAsPicker({ owed, account, busy, onClaimEth, onClaimAs }: Props) {
  const [open, setOpen] = useState(false);
  const [quotes, setQuotes] = useState<Quotes>({});
  const nothing = owed === 0n;

  const loadQuotes = useCallback(async () => {
    if (!account || nothing) return;
    setQuotes(Object.fromEntries(EQUITY_ASSETS.map((a) => [a.symbol, 'loading' as const])));
    // Sequential, not parallel: this RPC rate-limits hard under bursts and
    // a 429 storm would render every row as "unavailable".
    for (const a of EQUITY_ASSETS) {
      const q = await quoteEquityOut(a, owed, account);
      setQuotes((prev) => ({ ...prev, [a.symbol]: q }));
    }
  }, [account, owed, nothing]);

  useEffect(() => {
    if (open) void loadQuotes();
  }, [open, loadQuotes]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          className="btn-primary flex-1"
          disabled={busy || nothing}
          onClick={onClaimEth}
        >
          {nothing ? 'Nothing to claim' : `Claim ${fmtEth(owed)} ETH`}
        </button>

        {EQUITY_ROUTER_LIVE && !nothing && (
          <button
            className="px-3 py-2 text-[11px] font-mono uppercase tracking-widest
                       border border-[var(--border)] text-[var(--muted)]
                       hover:text-[var(--fg)] hover:border-[var(--fg)] transition-colors"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            as stock {open ? '▴' : '▾'}
          </button>
        )}
      </div>

      {open && (
        <div className="border border-[var(--border)] p-3 space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">
            // Take it as
          </div>

          {EQUITY_ASSETS.map((a) => {
            const q = quotes[a.symbol];
            const pricey = a.feeBps >= PRICEY_FEE_BPS;
            const ready = typeof q === 'bigint' && q > 0n;

            return (
              <button
                key={a.symbol}
                disabled={busy || !ready}
                onClick={() => ready && onClaimAs(a, minOutFrom(q))}
                className="w-full flex items-baseline justify-between gap-3 px-2 py-2 text-left
                           border border-transparent hover:border-[var(--border)]
                           disabled:opacity-40 disabled:hover:border-transparent transition-colors"
              >
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className="font-mono text-sm">{a.symbol}</span>
                  <span className="text-[11px] text-[var(--muted)] truncate">{a.label}</span>
                </span>

                <span className="flex items-baseline gap-2 shrink-0">
                  {pricey && (
                    <span className="text-[10px] font-mono text-[var(--warn,#c9a227)]">
                      −{(a.feeBps / 100).toFixed(2)}% pool fee
                    </span>
                  )}
                  <span className="font-mono text-sm">
                    {q === 'loading'
                      ? '…'
                      : ready
                        ? fmtShares(q, a.decimals)
                        : 'unavailable'}
                  </span>
                </span>
              </button>
            );
          })}

          <p className="text-[10px] text-[var(--muted)] leading-relaxed pt-2">
            Quoted live against the pool, not a price feed. Your claim is paid in
            ETH and swapped in the same transaction — we never hold the shares.
            If the price moves past your slippage bound the claim reverts and
            stays yours to claim again.
          </p>
        </div>
      )}
    </div>
  );
}
