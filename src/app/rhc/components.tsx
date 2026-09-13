'use client';

// Shared RHC UI — styled to match the SOL site's design system exactly:
// same CSS variables, card shells, chip and label conventions. The only
// RHC-specific signal is the small "ROBINHOOD CHAIN" chip in the header
// (wayfinding), everything else is the house style.
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { robinhoodChain } from '@/lib/rhc';

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    return (
      <button onClick={() => connect({ connector: connectors[0] })} disabled={isPending} className="btn-primary">
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </button>
    );
  }
  if (chainId !== robinhoodChain.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: robinhoodChain.id })}
        className="px-4 py-2.5 text-xs font-mono uppercase tracking-widest border border-[var(--error)] text-[var(--error)] hover:bg-[var(--error)] hover:text-black transition-colors"
      >
        Switch to Robinhood Chain
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

export function RhcHeader() {
  // Brand + nav live in the global Navbar (chain-aware). This row carries
  // the chain chip + tagline and the EVM wallet button (wagmi context is
  // scoped to /rhc, so the button can't live in the global navbar).
  return (
    <div className="flex flex-wrap items-center justify-between mb-6 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent)]/60 text-[var(--accent)] bg-[var(--accent)]/5 shrink-0">
          Robinhood Chain
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
          {'// '}Pool the raise · own the float · earn the fees
        </span>
      </div>
      <ConnectButton />
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
