'use client';

// Shared RHC UI — the SOL design system verbatim: same variables, card
// shells, chip and label conventions. Same site, different chain.
import Link from 'next/link';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { WpBadge } from './walletproof';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { robinhoodChain, CampaignRow, fmtEth } from '@/lib/rhc';

// Card-scale social icon — the card root is a <Link>, so open via
// window.open + stopPropagation (nested anchors are invalid HTML).
function CardSocial({ href, label }: { href: string; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
      }}
      title={href}
      className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
    >
      {label}
    </button>
  );
}

// Time left, MemeCard-tight: 2D 4H / 5H 12M / 34M / ENDED.
function timeLeft(deadline: bigint): string {
  const s = Number(deadline) - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'ENDED';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}D ${h}H`;
  if (h > 0) return `${h}H ${m}M`;
  return `${m}M`;
}

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    return (
      <button
        // Connecting requests Robinhood Chain in the same step — users
        // should never meet a separate "switch network" ceremony.
        onClick={() => connect({ connector: connectors[0], chainId: robinhoodChain.id })}
        disabled={isPending}
        // Compact on phones: at 390px the full-width button pushed the
        // hamburger off-screen and stretched the document sideways.
        className="btn-primary !px-2.5 !text-[10px] sm:!px-4 sm:!text-xs whitespace-nowrap"
      >
        {isPending ? 'Connecting…' : (
          <>
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect Wallet</span>
          </>
        )}
      </button>
    );
  }
  if (chainId !== robinhoodChain.id) {
    // Rare fallback (user hopped networks mid-session): fix it silently
    // in one tap, styled like the normal wallet chip — no scary banner.
    return (
      <button
        onClick={() => switchChain({ chainId: robinhoodChain.id })}
        className="px-4 py-2.5 text-xs font-mono border border-[var(--warning)]/60 text-[var(--warning)] hover:bg-[var(--warning)] hover:text-black transition-colors"
        title="Your wallet is on another network — click to hop back"
      >
        {address?.slice(0, 6)}…{address?.slice(-4)} ⚠
      </button>
    );
  }
  return (
    <button
      onClick={() => disconnect()}
      className="px-4 py-2.5 text-xs font-mono border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
      title="Click to disconnect"
    >
      {address?.slice(0, 6)}…{address?.slice(-4)}
    </button>
  );
}

// Subpage header row — chip + tagline only. The wallet button lives in
// the navbar (same slot as the SOL WalletMultiButton), not here.
export function RhcHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between mb-6 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent-gold)]/60 text-[var(--accent-gold)] bg-[var(--accent-gold)]/5 shrink-0">
          Robinhood Chain
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
          {'// '}Pool the raise · own the float · earn the fees
        </span>
      </div>
    </div>
  );
}

export function StatusPill({ launched, cancelled, refundable, deadline, totalRaised, goal }: {
  launched: boolean; cancelled: boolean; refundable: boolean;
  deadline: bigint; totalRaised: bigint; goal: bigint;
}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  let label = 'Backing';
  let color = 'var(--accent)';
  if (launched) { label = 'Live'; color = 'var(--success)'; }
  else if (cancelled) { label = 'Cancelled'; color = 'var(--muted)'; }
  else if (refundable) { label = 'Refunds Open'; color = 'var(--error)'; }
  else if (totalRaised >= goal) { label = 'Funded'; color = 'var(--success)'; }
  else if (now >= deadline) { label = 'Expired'; color = 'var(--muted)'; }
  return (
    <span
      className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border shrink-0"
      style={{ borderColor: `color-mix(in srgb, ${color} 60%, transparent)`, color, background: `color-mix(in srgb, ${color} 5%, transparent)` }}
    >
      {label}
    </span>
  );
}

// One campaign card — the SOL MemeCard anatomy: top bar with $SYM +
// status, avatar + name + socials, description, slot grid or raise bar,
// copyable CA once live, "by creator" footer.
export function CampaignCard({ r, footer }: { r: CampaignRow; footer?: React.ReactNode }) {
  const [caCopied, setCaCopied] = useState(false);
  const pct = r.goal > 0n ? Number((r.totalRaised * 100n) / r.goal) : 0;
  const socials = [
    { label: 'X', href: r.socials?.twitter },
    { label: 'TG', href: r.socials?.telegram },
    { label: 'DC', href: r.socials?.discord },
    { label: 'WEB', href: r.socials?.website },
    { label: 'FC', href: r.socials?.farcaster },
  ].filter((x) => !!x.href?.trim());
  const live = r.launched;
  const seatRound = !live && r.maxBackers > 0n && r.maxBackers <= 24n;

  const copyCA = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(r.token).then(() => {
      setCaCopied(true);
      setTimeout(() => setCaCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <Link href={`/rhc/campaign/${r.address}`} className="block">
      <div className="border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] transition-colors">
        {/* Top bar — system path + status */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
            {'// '}{r.symbol.slice(0, 12)}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {live && <WpBadge token={r.token} />}
            <StatusPill {...r} />
          </div>
        </div>

        {/* Main */}
        <div className="p-4 space-y-3">
          {/* Avatar + name + socials */}
          <div className="flex items-start gap-3">
            {r.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.logo}
                alt={r.name}
                className="w-12 h-12 object-cover border border-[var(--border)] flex-shrink-0"
              />
            ) : (
              <div className="w-12 h-12 border border-[var(--accent)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
                <span className="font-mono font-semibold text-[var(--accent)] text-sm">
                  {(r.symbol || '?').charAt(0)}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-mono font-semibold uppercase tracking-tight text-base truncate">
                {r.name}
              </h3>
              <div className="text-xs font-mono text-[var(--accent)]">${r.symbol}</div>
              {socials.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                  {socials.map((x) => (
                    <CardSocial key={x.label} href={x.href!} label={x.label} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {r.description && (
            <p className="text-xs font-mono text-[var(--muted)] line-clamp-2 leading-relaxed">
              {r.description}
            </p>
          )}

          {/* Backing-phase block */}
          {!live && (
            <div className="space-y-2 pt-1">
              {seatRound ? (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Seats</span>
                    <span className="text-xs font-mono text-[var(--accent)]">
                      {r.backerCount.toString()} / {r.maxBackers.toString()}
                    </span>
                  </div>
                  <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${Number(r.maxBackers)}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: Number(r.maxBackers) }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-3 ${i < Number(r.backerCount) ? 'bg-[var(--accent)]' : 'border border-[var(--accent)]'}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-1 bg-[var(--border)]">
                  <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              )}
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                <span className="text-[var(--muted)]">
                  Pledged: <span className="text-[var(--foreground)]">{fmtEth(r.totalRaised, 3)}</span>
                  {' / '}{fmtEth(r.goal, 3)} ETH
                </span>
                <span className="text-[var(--muted)]">{timeLeft(r.deadline)} left</span>
              </div>
            </div>
          )}

          {/* Live block — copyable CA */}
          {live && (
            <div className="space-y-2 pt-1">
              <button
                onClick={copyCA}
                className="w-full flex items-center gap-2 px-2 py-1.5 bg-[var(--background)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
              >
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">CA:</span>
                <code className="flex-1 text-[10px] font-mono truncate text-left">{r.token}</code>
                {caCopied ? (
                  <Check className="w-3 h-3 text-[var(--success)] flex-shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-[var(--muted)] flex-shrink-0" />
                )}
              </button>
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                <span>{r.backerCount.toString()} backer{r.backerCount === 1n ? '' : 's'}</span>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(`https://robinhoodchain.blockscout.com/token/${r.token}`, '_blank', 'noopener,noreferrer');
                  }}
                  className="text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
                >
                  [↗] Explorer
                </span>
              </div>
            </div>
          )}
          {footer}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          <span>by {r.creator.slice(0, 6)}…{r.creator.slice(-4)}</span>
          <span>&gt; OPEN</span>
        </div>
      </div>
    </Link>
  );
}
