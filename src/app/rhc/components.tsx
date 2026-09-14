'use client';

// Shared RHC UI — the SOL design system verbatim: same variables, card
// shells, chip and label conventions. Same site, different chain.
import Link from 'next/link';
import { WpBadge } from './walletproof';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { robinhoodChain, CampaignRow, fmtEth } from '@/lib/rhc';

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
        className="btn-primary"
      >
        {isPending ? 'Connecting…' : 'Connect Wallet'}
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

// One campaign card — the MemeCard pattern, reused across the board
// columns, /rhc/launched, and /rhc/portfolio.
export function CampaignCard({ r, footer }: { r: CampaignRow; footer?: React.ReactNode }) {
  const pct = r.goal > 0n ? Number((r.totalRaised * 100n) / r.goal) : 0;
  return (
    <Link href={`/rhc/campaign/${r.address}`} className="block">
      <div className="border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] transition-colors">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
            ${r.symbol}
          </span>
          <StatusPill {...r} />
        </div>
        <div className="px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-sm text-[var(--foreground)] truncate">{r.name}</span>
            <span className="font-mono text-xs text-[var(--muted)] shrink-0">
              <span className="text-[var(--foreground)]">{fmtEth(r.totalRaised, 3)}</span>
              {' / '}{fmtEth(r.goal, 3)} ETH
            </span>
          </div>
          {/* Slot grid — the SOL card's visual blocks, verbatim. Slotted
              raises show filled/outlined blocks; open raises (maxBackers 0)
              keep the thin progress bar. */}
          {!r.launched && r.maxBackers > 0n && r.maxBackers <= 24n ? (
            <div className="mt-2">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Slots</span>
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
                    className={`h-3 ${
                      i < Number(r.backerCount)
                        ? 'bg-[var(--accent)]'
                        : 'border border-[var(--accent)]'
                    }`}
                  />
                ))}
              </div>
              <div className="mt-2 h-1 bg-[var(--border)]">
                <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          ) : (
            <div className="mt-2 h-1 bg-[var(--border)]">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            <span>{r.backerCount.toString()} backer{r.backerCount === 1n ? '' : 's'}</span>
            <span className="inline-flex items-center gap-1.5">
              {r.launched && <WpBadge token={r.token} />}
              <span>{r.launched ? 'LIVE' : `ends ${new Date(Number(r.deadline) * 1000).toLocaleDateString()}`}</span>
            </span>
          </div>
          {footer}
        </div>
      </div>
    </Link>
  );
}

