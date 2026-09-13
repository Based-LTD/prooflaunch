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
    <div className="fixed inset-0 z-[60] bg-[var(--background)]/97 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-10">
          <p className="font-mono text-2xl tracking-wider uppercase text-[var(--foreground)]">
            <span className="text-[var(--accent)]">▮</span> Proof<span className="text-[var(--accent)]">/</span>Launch
          </p>
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mt-2">
            {'// '}community-pooled token launches · pick your chain · switch anytime
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <button
            onClick={() => choose('sol')}
            className="group border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] text-left transition-colors"
          >
            <div className="border-b border-[var(--border)] px-3 py-1.5">
              <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent)]/60 text-[var(--accent)] bg-[var(--accent)]/5">
                Solana
              </span>
            </div>
            <div className="p-4">
              <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
                The original. Pooled pump.fun launches with fee share to backers —
                live tokens, $PROOF holder rewards, full launch history.
              </p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-dim)] mt-4 group-hover:text-[var(--accent)] transition-colors">
                {'> '}Enter with Phantom / Solflare
              </p>
            </div>
          </button>

          <button
            onClick={() => choose('rhc')}
            className="group border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] text-left transition-colors"
          >
            <div className="border-b border-[var(--border)] px-3 py-1.5">
              <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent-gold)]/60 text-[var(--accent-gold)] bg-[var(--accent-gold)]/5">
                Robinhood Chain
              </span>
            </div>
            <div className="p-4">
              <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
                The trustless one. Pool the raise, own the float, earn the fees —
                enforced by ownerless contracts. Launches on pons. New.
              </p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-dim)] mt-4 group-hover:text-[var(--accent)] transition-colors">
                {'> '}Enter with Phantom / MetaMask
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
