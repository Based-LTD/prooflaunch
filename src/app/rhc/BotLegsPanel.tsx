'use client';

// The coin's own bots — the SOL page's BuybackBotPanel for Robinhood
// Chain. Every leg on the campaign's splitter is read live: what it has
// pulled, what it has done (burned / added as liquidity), what is waiting
// for it, and a crank button, since anyone may run them. The platform and
// $PLAUNCH-burn legs are named; named vault wallets show as vaults.
import { useEffect, useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { rhcPublicClient, splitterAbi, fmtEth, explorerUrl, robinhoodChain, PROOF_BURNER, PROOF_BURNER_LIVE, shortAddr } from '@/lib/rhc';

const PLATFORM_LEGS = new Set(['0xd994ae0945c787a487c6dbd5188512e358986e29', '0x6ca08565caf4f5caafb4bfeecece6e0ea3c65dcb']);
const legAbi = [
  { type: 'function', name: 'totalEthSpent', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalTokensBurned', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalLiquidityAdds', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalEthDeployed', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lastCrankBlock', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'crank', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const;

type Kind = 'burn' | 'feeder' | 'proofburn' | 'platform' | 'vault' | 'creator';
interface Leg { addr: `0x${string}`; bps: number; kind: Kind; owed: bigint; ethSpent?: bigint; burned?: bigint; adds?: bigint; deployed?: bigint; ethBal: bigint }

const LABEL: Record<Kind, string> = { burn: '🔥 BURN', feeder: '🌊 POOL FEEDER', proofburn: '🔥 $PLAUNCH BURN', platform: 'PLATFORM', vault: '🏦 VAULT', creator: '👤 CREATOR FEE' };

export function BotLegsPanel({ splitter, feeAsset, symbol, launched, refreshKey, creator }: { splitter: `0x${string}`; feeAsset: `0x${string}`; symbol: string; launched: boolean; refreshKey: string; creator?: `0x${string}` }) {
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const { isConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const n = Number(await rhcPublicClient.readContract({ address: splitter, abi: splitterAbi, functionName: 'legCount' }));
        const idx = Array.from({ length: n }, (_, i) => BigInt(i));
        const rows = await rhcPublicClient.multicall({
          contracts: idx.flatMap((i) => [
            { address: splitter, abi: splitterAbi, functionName: 'legRecipients', args: [i] },
            { address: splitter, abi: splitterAbi, functionName: 'legBps', args: [i] },
          ]),
          allowFailure: true,
        });
        const addrs: { addr: `0x${string}`; bps: number }[] = [];
        for (let i = 0; i < n; i++) {
          const a = rows[i * 2], b = rows[i * 2 + 1];
          if (a.status === 'success' && b.status === 'success') addrs.push({ addr: a.result as `0x${string}`, bps: Number(b.result) });
        }
        const probes = await rhcPublicClient.multicall({
          contracts: addrs.flatMap((l) => [
            { address: splitter, abi: splitterAbi, functionName: 'legOwed', args: [l.addr, feeAsset] },
            { address: l.addr, abi: legAbi, functionName: 'totalEthSpent' },
            { address: l.addr, abi: legAbi, functionName: 'totalTokensBurned' },
            { address: l.addr, abi: legAbi, functionName: 'totalLiquidityAdds' },
            { address: l.addr, abi: legAbi, functionName: 'totalEthDeployed' },
          ]),
          allowFailure: true,
        });
        const bals = await Promise.all(addrs.map((l) => rhcPublicClient.getBalance({ address: l.addr }).catch(() => 0n)));
        const pick = (i: number, k: number) => { const r = probes[i * 5 + k]; return r.status === 'success' ? (r.result as bigint) : undefined; };
        const out: Leg[] = addrs.map((l, i) => {
          const owed = pick(i, 0) ?? 0n, ethSpent = pick(i, 1), burned = pick(i, 2), adds = pick(i, 3), deployed = pick(i, 4);
          const low = l.addr.toLowerCase();
          // A plain wallet leg paid to the campaign's own creator is a
          // creator fee, whoever set it and whatever they called it. Naming
          // it beats letting it sit among the anonymous treasury addresses.
          const kind: Kind = PROOF_BURNER_LIVE && low === PROOF_BURNER.toLowerCase() ? 'proofburn'
            : adds !== undefined ? 'feeder' : burned !== undefined ? 'burn' : PLATFORM_LEGS.has(low) ? 'platform'
            : creator && low === creator.toLowerCase() ? 'creator' : 'vault';
          return { addr: l.addr, bps: l.bps, kind, owed, ethSpent, burned, adds, deployed, ethBal: bals[i] };
        });
        if (live) setLegs(out);
      } catch { if (live) setLegs([]); }
    })();
    return () => { live = false; };
  }, [splitter, feeAsset, refreshKey, creator]);

  const bots = (legs ?? []).filter((l) => l.kind !== 'platform');
  if (!legs || bots.length === 0) return null;
  const tok = (v?: bigint) => v === undefined ? '—' : (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{'// '}BOTS</span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">{bots.length} leg{bots.length === 1 ? '' : 's'} · ownerless</span>
      </div>
      <div className="p-3 sm:p-4 space-y-2">
        {bots.map((l) => {
          const crankable = (l.kind === 'burn' || l.kind === 'feeder' || l.kind === 'proofburn') && launched;
          const waiting = l.owed + l.ethBal;
          return (
            <div key={l.addr} className="border border-[var(--border)] bg-[var(--background)] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest">
                  <span className="text-[var(--foreground)]">{LABEL[l.kind]}</span>
                  <span className="text-[var(--accent)] ml-2">{(l.bps / 100).toFixed(l.bps % 100 ? 1 : 0)}%</span>
                  <a href={explorerUrl(l.addr)} target="_blank" rel="noopener noreferrer" className="ml-2 text-[var(--muted-soft)] hover:text-[var(--accent)]">{shortAddr(l.addr)} ↗</a>
                </span>
                {crankable && isConnected && waiting > 0n && (
                  <button onClick={() => writeContract({ address: l.addr, abi: legAbi, functionName: 'crank', chainId: robinhoodChain.id })} disabled={isPending}
                    className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border border-[var(--accent)]/60 text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-40">
                    Crank
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                {l.kind === 'burn' && <><span><span className="text-[var(--foreground)]">{tok(l.burned)}</span> ${symbol} burned</span><span><span className="text-[var(--foreground)]">{fmtEth(l.ethSpent ?? 0n, 4)}</span> ETH spent</span></>}
                {l.kind === 'feeder' && <><span><span className="text-[var(--foreground)]">{String(l.adds ?? 0n)}</span> liquidity adds</span><span><span className="text-[var(--foreground)]">{fmtEth(l.deployed ?? 0n, 4)}</span> ETH locked in</span></>}
                {l.kind === 'proofburn' && <span>this campaign&apos;s share of the flywheel</span>}
                {l.kind === 'vault' && <span>named wallet · pulls its own share</span>}
                <span><span className={waiting > 0n ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}>{fmtEth(waiting, 5)}</span> ETH waiting</span>
              </div>
            </div>
          );
        })}
        <p className="text-[10px] font-mono text-[var(--muted-soft)] leading-relaxed">
          Ownerless contracts. Anyone can crank one.
        </p>
      </div>
    </div>
  );
}
