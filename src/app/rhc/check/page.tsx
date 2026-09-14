'use client';

// /rhc/check — paste any Pons token and see who is really buying it. The public face of WalletProof on RHC:
// counts and shares only, every number a replay of on-chain trades. Proof Launch tokens are crowd-funded by
// backers who put ETH in before the token existed; this page shows what the rest of the chain looks like.
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { RhcHeader } from '../components';
import { WpPanel, WpStatsBar } from '../walletproof';
import { WpRecent } from './recent';

function RhcCheckInner() {
  const params = useSearchParams(); const router = useRouter();
  const initial = params.get('t') || '';
  const [input, setInput] = useState(initial);
  const token = /^0x[0-9a-fA-F]{40}$/.test(initial) ? initial : null;
  const submit = (e: React.FormEvent) => { e.preventDefault(); const t = input.trim(); if (/^0x[0-9a-fA-F]{40}$/.test(t)) router.replace(`/rhc/check?t=${t}`); };
  return (
    <div className="max-w-3xl mx-auto pb-8 space-y-4">
      <RhcHeader />
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-3 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{'// '}CHECK A PONS TOKEN — who is really buying?</span>
        </div>
        <form onSubmit={submit} className="p-3 flex flex-col sm:flex-row gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x… token or curve address" spellCheck={false}
            className="flex-1 bg-[var(--background)] border border-[var(--border)] px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent-gold)]" />
          <button type="submit" className="btn-primary">Check</button>
        </form>
        <p className="px-3 pb-3 text-[10px] font-mono text-[var(--muted-soft)] leading-relaxed">
          Every buy and sell on the curve is replayed. Buyers are sorted into independent wallets, wallets seen in synchronized dumps (8+ sellers inside 5 seconds), one-shot wallets that never bought anything else, and launch bots. No wallet is ever listed — only counts.
        </p>
      </div>
      {token && <WpPanel token={token} />}
      <WpStatsBar />
      <WpRecent />
    </div>
  );
}

// useSearchParams requires a Suspense boundary for static prerender —
// without this the whole site build fails on /rhc/check.
export default function RhcCheckPage() {
  return (
    <Suspense fallback={null}>
      <RhcCheckInner />
    </Suspense>
  );
}
