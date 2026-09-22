'use client';

// The flywheel, in one glance: ETH collected from campaign fees → PROOF
// bought and burned. Every number is a counter on the ProofBurner
// contract; nothing here is computed off-chain. Hidden until the burner
// exists (NEXT_PUBLIC_PROOF_BURNER), so this file ships dark and lights
// up on deploy day with no code change.
import { useEffect, useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { rhcPublicClient, proofBurnerAbi, PROOF_BURNER, PROOF_BURNER_LIVE, fmtEth, explorerUrl, robinhoodChain } from '@/lib/rhc';

interface Stats { pulled: bigint; spent: bigint; burned: bigint; pending: bigint; token: `0x${string}`; block: bigint }

export function FlywheelPanel({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<Stats | null>(null);
  const { isConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

  useEffect(() => {
    if (!PROOF_BURNER_LIVE) return;
    let live = true;
    const load = async () => {
      try {
        const c = { address: PROOF_BURNER, abi: proofBurnerAbi } as const;
        const [pulled, spent, burned, pending, token, block] = await rhcPublicClient.multicall({
          contracts: [
            { ...c, functionName: 'totalEthPulled' }, { ...c, functionName: 'totalEthSpent' },
            { ...c, functionName: 'totalTokensBurned' }, { ...c, functionName: 'pendingEth' },
            { ...c, functionName: 'proofToken' }, { ...c, functionName: 'lastCrankBlock' },
          ],
          allowFailure: false,
        }) as unknown as [bigint, bigint, bigint, bigint, `0x${string}`, bigint];
        if (live) setS({ pulled, spent, burned, pending, token, block });
      } catch { /* leave the last reading */ }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  if (!PROOF_BURNER_LIVE) return null;
  const tok = (v: bigint) => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="border border-[var(--accent-gold)]/60 bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--accent-gold)]/40 px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">{'// '}FLYWHEEL — fees → burned $PROOF</span>
        <a href={explorerUrl(PROOF_BURNER)} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)]">burner ↗</a>
      </div>
      <div className={`p-3 ${compact ? '' : 'sm:p-4'}`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['Burned', s ? `${tok(s.burned)} PROOF` : '…', 'var(--accent-gold)'],
            ['ETH spent', s ? `${fmtEth(s.spent, 4)} ETH` : '…', 'var(--foreground)'],
            ['Collected', s ? `${fmtEth(s.pulled, 4)} ETH` : '…', 'var(--muted)'],
            ['Next up', s ? `${fmtEth(s.pending, 4)} ETH` : '…', 'var(--success)'],
          ].map(([k, v, c]) => (
            <div key={k} className="border border-[var(--border)] bg-[var(--background)] px-3 py-2">
              <div className="font-mono text-sm" style={{ color: c }}>{v}</div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mt-0.5">{k}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            30% of every campaign&apos;s creator tax, every seller&apos;s forfeited share, every creation fee. Ownerless. Anyone can crank it.
          </p>
          {isConnected && s && s.pending > 0n && (
            <button onClick={() => writeContract({ address: PROOF_BURNER, abi: proofBurnerAbi, functionName: 'crank', chainId: robinhoodChain.id })} disabled={isPending}
              className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--accent-gold)]/60 text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/10 disabled:opacity-40">
              Burn {fmtEth(s.pending > 200_000_000_000_000_000n ? 200_000_000_000_000_000n : s.pending, 4)} ETH now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
