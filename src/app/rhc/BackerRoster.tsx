'use client';

// The wallets in the raise — and, after launch, whether they are still in.
//
// This is the SOL page's BackersList (pre-launch) and GenesisBackerRoster
// (post-launch) for Robinhood Chain. Nothing here is self-reported: the
// list is the contract's own Deposited events and every number is a live
// view read (/api/rhc/campaign/[address]/backers). "Hold" is a wallet's
// current token balance against the allocation the raise gave it, so a
// visitor can see at a glance who kept their position and who sold.
import { useEffect, useState } from 'react';
import { fmtEth, explorerUrl, lockMultiplier, shortAddr } from '@/lib/rhc';
import type { RosterResponse, RosterBacker } from '../api/rhc/campaign/[address]/backers/route';

interface Props {
  address: `0x${string}`;
  launched: boolean;
  me?: `0x${string}`;
  symbol: string;
  quoteSymbol: string;
  quoteDecimals: number;
  isErc20Quote: boolean;
  /// Bump to refetch (a confirmed tx hash works) — the roster must move
  /// when the user's own deposit / withdraw / claim lands.
  refreshKey: string;
}

const short = shortAddr;
const nowS = () => Math.floor(Date.now() / 1000);
/// Pre-launch a lock is a promise in days; post-launch it is a date.
const lockedNow = (b: RosterBacker) => b.lockDays > 0 && (b.lockUntil === 0 || b.lockUntil > nowS());
const lockLabel = (b: RosterBacker) => b.lockUntil > 0
  ? new Date(b.lockUntil * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  : b.lockDays >= 365 ? `${(b.lockDays / 365).toFixed(b.lockDays % 365 ? 1 : 0)}y after launch` : `${b.lockDays}d after launch`;
const lockMult = (b: RosterBacker) => lockMultiplier(b.lockDays);
/// The lock tag — the thing a speculator reads. It is a contract fact:
/// claimTokens() reverts before this date, and there is nobody who could
/// change that. Link goes to the campaign contract, not to us.
const LockTag = ({ b, address }: { b: RosterBacker; address: string }) => lockedNow(b) ? (
  <a href={explorerUrl(address) + '#readContract'} target="_blank" rel="noopener noreferrer"
    title={`lockDays(${b.wallet}) on the campaign contract, claimTokens() reverts before launch + ${b.lockDays} days; no one can shorten it. Fee weight ×${lockMult(b)}.`}
    className="ml-2 text-[9px] uppercase tracking-widest text-[var(--accent-gold)] border border-[var(--accent-gold)]/50 px-1 py-0.5 hover:bg-[var(--accent-gold)]/10">
    🔒 {lockLabel(b)}{lockMult(b) > 1 ? ` · ×${lockMult(b)} fees` : ''}
  </a>
) : null;
const th = 'py-2 px-2 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] whitespace-nowrap';

function fmtUnits(v: bigint, decimals: number, digits = 3): string {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * 10n ** BigInt(digits)) / base;
  return `${whole}.${frac.toString().padStart(digits, '0').replace(/0+$/, '') || '0'}`;
}
const fmtTok = (v: bigint) => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 });

/// Hold = balance / allocation, in whole percent. A wallet that bought
/// more than it was allotted reads above 100 — that is real information
/// (they added), not an error, so it is shown rather than clamped.
function holdPct(b: RosterBacker): number | null {
  const alloc = BigInt(b.allocation);
  if (alloc === 0n) return null;
  return Number((BigInt(b.tokenBalance) * 1000n) / alloc) / 10;
}

export function BackerRoster({ address, launched, me, symbol, quoteSymbol, quoteDecimals, isErc20Quote, refreshKey }: Props) {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/rhc/campaign/${address}/backers`, { cache: 'no-store' });
        const j = await r.json();
        if (!live) return;
        if (!r.ok) { setErr(j.error ?? 'roster unavailable'); return; }
        setErr(null); setData(j);
      } catch (e) { if (live) setErr(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [address, refreshKey]);

  const q = (v: bigint) => (isErc20Quote ? fmtUnits(v, quoteDecimals) : fmtEth(v, 4));
  const total = data ? BigInt(launched ? data.totalRaisedAtLaunch : data.totalRaised) : 0n;
  const pctOf = (v: bigint) => (total > 0n ? (Number((v * 1000n) / total) / 10).toFixed(1) : '0.0');
  const backers = data?.backers ?? [];
  const stillIn = backers.filter((b) => !b.tokensClaimed || BigInt(b.tokenBalance) > 0n).length;
  const lockedCount = backers.filter(lockedNow).length;
  const holds = backers.map(holdPct).filter((h): h is number => h !== null);
  const avgHold = holds.length ? holds.reduce((a, b) => a + Math.min(b, 100), 0) / holds.length : null;

  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          {launched ? 'GENESIS BACKERS' : 'BACKERS'}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          {data ? `${backers.length} wallet${backers.length === 1 ? '' : 's'}` : '…'}
        </span>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
          {launched
            ? `Who funded the launch, and how much of their $${symbol} each still holds.`
            : 'Every wallet in this raise, read from the contract. A backer can withdraw any time before launch; the seat frees and the deposit goes back.'}
        </p>

        {data && backers.length > 0 && lockedCount > 0 && !launched && (
          <div className="flex flex-wrap gap-2">
            <span className="border border-[var(--accent-gold)]/50 bg-[var(--background)] px-2 py-1 text-[10px] font-mono uppercase tracking-widest">
              <span className="text-[var(--accent-gold)]">{lockedCount}</span> of {backers.length} locked their tokens pre-launch
            </span>
          </div>
        )}
        {launched && data && backers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {lockedCount > 0 && (
              <span className="border border-[var(--accent-gold)]/50 bg-[var(--background)] px-2 py-1 text-[10px] font-mono uppercase tracking-widest">
                <span className="text-[var(--accent-gold)]">{lockedCount}</span> locked
              </span>
            )}
            <span className="border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[10px] font-mono uppercase tracking-widest">
              <span className="text-[var(--accent)]">{stillIn}</span> of {backers.length} still in
            </span>
            {avgHold !== null && (
              <span className="border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[10px] font-mono uppercase tracking-widest">
                avg hold <span className="text-[var(--accent)]">{avgHold.toFixed(0)}%</span>
              </span>
            )}
          </div>
        )}

        {err && !data && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">roster unavailable · {err.slice(0, 80)}</p>
        )}
        {!err && !data && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] animate-pulse">reading deposits…</p>
        )}
        {data && backers.length === 0 && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">no backers yet · the first seat is open</p>
        )}

        {backers.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className={`${th} text-left`}>#</th>
                    <th className={`${th} text-left`}>Wallet</th>
                    <th className={`${th} text-right`}>Stake</th>
                    <th className={`${th} text-right`}>% of pool</th>
                    {launched ? (
                      <>
                        <th className={`${th} text-right`}>Allocation</th>
                        <th className={`${th} text-right`}>Hold</th>
                        <th className={`${th} text-right`}>Fees earned</th>
                        <th className={`${th} text-right text-[var(--success)]`}>Pending</th>
                      </>
                    ) : (
                      <th className={`${th} text-right`}>In since</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {backers.map((b, i) => {
                    const isMe = !!me && me.toLowerCase() === b.wallet.toLowerCase();
                    const h = holdPct(b);
                    return (
                      <tr key={b.wallet} className={`border-b border-[var(--border)]/50 ${isMe ? 'bg-[var(--accent)]/5' : ''}`}>
                        <td className="py-2 px-2 text-[var(--muted)]">{i + 1}</td>
                        <td className="py-2 px-2">
                          <a href={explorerUrl(b.wallet)} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)]">{short(b.wallet)}</a>
                          {isMe && <span className="ml-2 text-[9px] uppercase tracking-widest text-[var(--accent)]">you</span>}
                          {data?.hasBuckets && b.bucket === 2 && <span className="ml-2 text-[9px] uppercase tracking-widest text-[var(--muted)]">team</span>}
                          <LockTag b={b} address={address} />
                        </td>
                        <td className="py-2 px-2 text-right">{q(BigInt(b.contribution))} {quoteSymbol}</td>
                        <td className="py-2 px-2 text-right text-[var(--muted)]">{pctOf(BigInt(b.contribution))}%</td>
                        {launched ? (
                          <>
                            <td className="py-2 px-2 text-right text-[var(--muted)]">{fmtTok(BigInt(b.allocation))}</td>
                            <td className={`py-2 px-2 text-right ${h === null ? 'text-[var(--muted)]' : h >= 90 ? 'text-[var(--success)]' : h > 0 ? 'text-[var(--warning,#c9a227)]' : 'text-[var(--error)]'}`}>
                              {!b.tokensClaimed ? (lockedNow(b) ? 'locked' : 'unclaimed') : h === null ? '—' : `${h >= 999 ? '>999' : h.toFixed(0)}%`}
                            </td>
                            <td className="py-2 px-2 text-right">{fmtEth(BigInt(b.feesClaimed), 6)} ETH</td>
                            <td className="py-2 px-2 text-right text-[var(--success)]">{BigInt(b.feesPending) > 0n ? `${fmtEth(BigInt(b.feesPending), 6)} ETH` : '—'}</td>
                          </>
                        ) : (
                          <td className="py-2 px-2 text-right text-[var(--muted)]">
                            {b.firstTs ? new Date(b.firstTs * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }) : `#${b.firstBlock}`}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden space-y-2">
              {backers.map((b, i) => {
                const isMe = !!me && me.toLowerCase() === b.wallet.toLowerCase();
                const h = holdPct(b);
                return (
                  <div key={b.wallet} className={`border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-mono ${isMe ? 'border-[var(--accent)]' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        <span className="text-[var(--muted)] mr-2">{i + 1}</span>
                        <a href={explorerUrl(b.wallet)} target="_blank" rel="noopener noreferrer">{short(b.wallet)}</a>
                        {isMe && <span className="ml-2 text-[9px] uppercase tracking-widest text-[var(--accent)]">you</span>}
                        {data?.hasBuckets && b.bucket === 2 && <span className="ml-2 text-[9px] uppercase tracking-widest text-[var(--muted)]">team</span>}
                        <LockTag b={b} address={address} />
                      </span>
                      <span>{q(BigInt(b.contribution))} {quoteSymbol} · {pctOf(BigInt(b.contribution))}%</span>
                    </div>
                    {launched && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] uppercase tracking-widest text-[var(--muted)]">
                        <span>hold <span className={h === null ? '' : h >= 90 ? 'text-[var(--success)]' : h > 0 ? 'text-[var(--warning,#c9a227)]' : 'text-[var(--error)]'}>{!b.tokensClaimed ? (lockedNow(b) ? 'locked' : 'unclaimed') : h === null ? '—' : `${h >= 999 ? '>999' : h.toFixed(0)}%`}</span></span>
                        <span>earned {fmtEth(BigInt(b.feesClaimed), 6)} ETH</span>
                        {BigInt(b.feesPending) > 0n && <span className="text-[var(--success)]">pending {fmtEth(BigInt(b.feesPending), 6)} ETH</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {data && data.left.length > 0 && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
            left before launch: {data.left.map(short).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}
