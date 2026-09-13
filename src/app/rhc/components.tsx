'use client';

import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { robinhoodChain } from '@/lib/rhc';

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: connectors[0] })}
        disabled={isPending}
        className="border border-orange-500 px-4 py-2 font-mono text-sm uppercase tracking-wider text-orange-400 hover:bg-orange-500 hover:text-black transition-colors"
      >
        {isPending ? 'connecting…' : 'connect wallet'}
      </button>
    );
  }
  if (chainId !== robinhoodChain.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: robinhoodChain.id })}
        className="border border-red-500 px-4 py-2 font-mono text-sm uppercase tracking-wider text-red-400 hover:bg-red-500 hover:text-black transition-colors"
      >
        switch to robinhood chain
      </button>
    );
  }
  return (
    <button
      onClick={() => disconnect()}
      className="border border-green-600 px-4 py-2 font-mono text-sm text-green-400 hover:border-red-500 hover:text-red-400 transition-colors"
      title="click to disconnect"
    >
      {address?.slice(0, 6)}…{address?.slice(-4)}
    </button>
  );
}

export function RhcHeader() {
  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <a href="/rhc" className="font-mono text-xl text-orange-400 uppercase tracking-widest">
          PROOF/LAUNCH <span className="text-neutral-500">· robinhood chain</span>
        </a>
        <p className="font-mono text-xs text-neutral-500 mt-1">
          pool the raise · own the float · earn the fees — enforced by ownerless contracts
        </p>
      </div>
      <div className="flex items-center gap-3">
        <a
          href="/rhc/create"
          className="border border-neutral-600 px-4 py-2 font-mono text-sm uppercase tracking-wider text-neutral-300 hover:border-orange-500 hover:text-orange-400 transition-colors"
        >
          + create
        </a>
        <ConnectButton />
      </div>
    </div>
  );
}

export function StatusPill({ launched, cancelled, refundable, deadline, totalRaised, goal }: {
  launched: boolean; cancelled: boolean; refundable: boolean;
  deadline: bigint; totalRaised: bigint; goal: bigint;
}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  let label = 'raising';
  let cls = 'text-orange-400 border-orange-500';
  if (launched) { label = 'launched'; cls = 'text-green-400 border-green-600'; }
  else if (cancelled) { label = 'cancelled'; cls = 'text-neutral-500 border-neutral-600'; }
  else if (refundable) { label = 'refunds open'; cls = 'text-red-400 border-red-500'; }
  else if (totalRaised >= goal) { label = 'goal met — launchable'; cls = 'text-green-400 border-green-600'; }
  else if (now >= deadline) { label = 'expired'; cls = 'text-neutral-500 border-neutral-600'; }
  return (
    <span className={`border px-2 py-0.5 font-mono text-xs uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}
