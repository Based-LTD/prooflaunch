'use client';

// First-visit chain chooser. One brand, two worlds:
//   SOL — the original, battle-tested pooled launches on pump.fun
//   RHC — the trustless rebuild on Robinhood Chain, ownerless contracts
//
// Shows ONCE on "/" for visitors with no remembered preference; picking a
// side is remembered (localStorage) and the nav's SOL/RHC toggle updates it
// thereafter. Deep links are never gated — this only mounts on "/".
// Visitors who previously chose RHC are routed straight there.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ChainGate() {
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const pref = localStorage.getItem('pl-chain');
      if (pref === 'rhc') router.replace('/rhc');
      else if (!pref) setShow(true);
    } catch { /* storage blocked — never gate */ }
  }, [router]);

  if (!show) return null;

  const choose = (chain: 'sol' | 'rhc') => {
    try { localStorage.setItem('pl-chain', chain); } catch {}
    if (chain === 'rhc') router.push('/rhc');
    else setShow(false);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center px-4">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-10">
          <p className="font-mono text-2xl tracking-wider uppercase">
            <span className="text-[var(--accent)]">▮</span> Proof<span className="text-[var(--accent)]">/</span>Launch
          </p>
          <p className="font-mono text-sm text-neutral-500 mt-2">
            community-pooled token launches · pick your chain (switch anytime)
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <button
            onClick={() => choose('sol')}
            className="group border border-neutral-700 hover:border-orange-500 p-6 text-left transition-colors"
          >
            <p className="font-mono text-lg text-orange-400 uppercase tracking-widest">Solana</p>
            <p className="font-mono text-xs text-neutral-400 mt-2 leading-relaxed">
              The original. Pooled pump.fun launches with fee share to backers —
              live tokens, $PROOF holder rewards, full launch history.
            </p>
            <p className="font-mono text-xs text-orange-400/70 mt-4 group-hover:text-orange-400">
              enter with Phantom/Solflare →
            </p>
          </button>

          <button
            onClick={() => choose('rhc')}
            className="group border border-neutral-700 hover:border-cyan-400 p-6 text-left transition-colors"
          >
            <p className="font-mono text-lg text-cyan-400 uppercase tracking-widest">Robinhood Chain</p>
            <p className="font-mono text-xs text-neutral-400 mt-2 leading-relaxed">
              The trustless one. Pool the raise, own the float, earn the fees —
              enforced by ownerless contracts. Launches on pons. New.
            </p>
            <p className="font-mono text-xs text-cyan-400/70 mt-4 group-hover:text-cyan-400">
              enter with Phantom/MetaMask →
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
