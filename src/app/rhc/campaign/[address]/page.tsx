'use client';

// Campaign detail + all lifecycle actions. Everything the user does here is
// their own transaction against an ownerless contract — the site is a
// convenience view, never a custodian or gatekeeper.
import { use, useEffect, useState, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, isAddress } from 'viem';
import {
  rhcPublicClient, campaignAbi, splitterAbi, fmtEth, explorerUrl, RHC_WETH,
} from '@/lib/rhc';
import { RhcHeader, StatusPill } from '../../components';

interface State {
  meta: { name: string; symbol: string; description: string };
  creator: `0x${string}`;
  goal: bigint; minDeposit: bigint; maxDeposit: bigint; maxBackers: bigint;
  deadline: bigint; totalRaised: bigint; backerCount: bigint;
  launched: boolean; cancelled: boolean; refundable: boolean;
  token: `0x${string}`; feeSplitter: `0x${string}`;
  tokensAtLaunch: bigint; totalRaisedAtLaunch: bigint;
  myContribution: bigint; myTokensClaimed: boolean;
  myFeeEntitlement: bigint; myFeesClaimed: bigint;
}

export default function CampaignPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: rawAddr } = use(params);
  const addr = (isAddress(rawAddr) ? rawAddr : '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const { address: me, isConnected } = useAccount();
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState('0.1');
  const { writeContract, data: txHash, isPending, error: writeErr, reset } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const load = useCallback(async () => {
    try {
      const c = { address: addr, abi: campaignAbi } as const;
      const zero = '0x0000000000000000000000000000000000000000' as `0x${string}`;
      const who = me ?? zero;
      const [meta, creator, goal, minDeposit, maxDeposit, maxBackers, deadline, totalRaised,
        backerCount, launched, cancelled, refundable, token, feeSplitter, tokensAtLaunch,
        totalRaisedAtLaunch, myContribution, myTokensClaimed] =
        await rhcPublicClient.multicall({
          contracts: [
            { ...c, functionName: 'tokenMeta' },
            { ...c, functionName: 'creator' },
            { ...c, functionName: 'goal' },
            { ...c, functionName: 'minDeposit' },
            { ...c, functionName: 'maxDeposit' },
            { ...c, functionName: 'maxBackers' },
            { ...c, functionName: 'deadline' },
            { ...c, functionName: 'totalRaised' },
            { ...c, functionName: 'backerCount' },
            { ...c, functionName: 'launched' },
            { ...c, functionName: 'cancelled' },
            { ...c, functionName: 'refundable' },
            { ...c, functionName: 'token' },
            { ...c, functionName: 'feeSplitter' },
            { ...c, functionName: 'tokensAtLaunch' },
            { ...c, functionName: 'totalRaisedAtLaunch' },
            { ...c, functionName: 'contributionOf', args: [who] },
            { ...c, functionName: 'tokensClaimed', args: [who] },
          ],
          allowFailure: false,
        }) as unknown as [State['meta'], `0x${string}`, bigint, bigint, bigint, bigint, bigint,
          bigint, bigint, boolean, boolean, boolean, `0x${string}`, `0x${string}`, bigint, bigint,
          bigint, boolean];

      let myFeeEntitlement = 0n, myFeesClaimed = 0n;
      if (launched && me) {
        [myFeeEntitlement, myFeesClaimed] = await rhcPublicClient.multicall({
          contracts: [
            { address: feeSplitter, abi: splitterAbi, functionName: 'backerEntitlement', args: [me, RHC_WETH] },
            { address: feeSplitter, abi: splitterAbi, functionName: 'backerClaimed', args: [me, RHC_WETH] },
          ],
          allowFailure: false,
        }) as [bigint, bigint];
      }
      setS({ meta, creator, goal, minDeposit, maxDeposit, maxBackers, deadline, totalRaised,
        backerCount, launched, cancelled, refundable, token, feeSplitter, tokensAtLaunch,
        totalRaisedAtLaunch, myContribution, myTokensClaimed, myFeeEntitlement, myFeesClaimed });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [addr, me]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (txConfirmed) { reset(); load(); } }, [txConfirmed, reset, load]);

  const act = (functionName: 'withdraw' | 'launch' | 'claimTokens' | 'refund' | 'cancel' | 'pokeCollect') =>
    writeContract({ address: addr, abi: campaignAbi, functionName });

  if (err) return <main className="mx-auto max-w-3xl px-4 py-8"><RhcHeader /><p className="font-mono text-red-400">read failed: {err}</p></main>;
  if (!s) return <main className="mx-auto max-w-3xl px-4 py-8"><RhcHeader /><p className="font-mono text-neutral-500 animate-pulse">reading chain…</p></main>;

  const now = BigInt(Math.floor(Date.now() / 1000));
  const goalMet = s.totalRaised >= s.goal;
  const iAmCreator = me?.toLowerCase() === s.creator.toLowerCase();
  const canLaunch = !s.launched && !s.cancelled && goalMet && (iAmCreator || now >= s.deadline);
  const myTokenShare = s.launched && s.totalRaisedAtLaunch > 0n
    ? (s.tokensAtLaunch * s.myContribution) / s.totalRaisedAtLaunch : 0n;
  const feesOwed = s.myFeeEntitlement - s.myFeesClaimed;
  const pct = s.goal > 0n ? Number((s.totalRaised * 100n) / s.goal) : 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <RhcHeader />

      <div className="border border-neutral-700 p-6">
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-2xl text-orange-400">${s.meta.symbol}
            <span className="text-neutral-400 text-lg ml-3">{s.meta.name}</span>
          </h1>
          <StatusPill launched={s.launched} cancelled={s.cancelled} refundable={s.refundable}
            deadline={s.deadline} totalRaised={s.totalRaised} goal={s.goal} />
        </div>
        <p className="mt-2 font-mono text-sm text-neutral-400">{s.meta.description}</p>

        <div className="mt-4 h-2 bg-neutral-800">
          <div className="h-full bg-orange-500" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs text-neutral-400">
          <div><div className="text-neutral-200 text-base">{fmtEth(s.totalRaised)} ETH</div>raised of {fmtEth(s.goal)}</div>
          <div><div className="text-neutral-200 text-base">{s.backerCount.toString()}</div>backers{s.maxBackers > 0n ? ` / ${s.maxBackers}` : ''}</div>
          <div><div className="text-neutral-200 text-base">{fmtEth(s.minDeposit)}</div>min per backer</div>
          <div><div className="text-neutral-200 text-base">{new Date(Number(s.deadline) * 1000).toLocaleDateString()}</div>deadline</div>
        </div>

        {/* ── actions ─────────────────────────────────────────── */}
        {!isConnected && <p className="mt-6 font-mono text-sm text-neutral-500">connect your wallet to participate</p>}

        {isConnected && !s.launched && !s.cancelled && !s.refundable && now < s.deadline && (
          <div className="mt-6 flex items-center gap-3">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-black border border-neutral-600 px-3 py-2 font-mono text-sm w-32 text-neutral-200"
              placeholder="ETH"
            />
            <button
              onClick={() => writeContract({ address: addr, abi: campaignAbi, functionName: 'deposit', value: parseEther(amount || '0') })}
              disabled={isPending}
              className="border border-orange-500 px-6 py-2 font-mono text-sm uppercase tracking-wider text-orange-400 hover:bg-orange-500 hover:text-black transition-colors disabled:opacity-50"
            >
              back this launch
            </button>
            {s.myContribution > 0n && (
              <button onClick={() => act('withdraw')} disabled={isPending}
                className="border border-neutral-600 px-4 py-2 font-mono text-sm text-neutral-400 hover:border-red-500 hover:text-red-400 transition-colors">
                withdraw {fmtEth(s.myContribution)} ETH
              </button>
            )}
          </div>
        )}

        {isConnected && canLaunch && (
          <button onClick={() => act('launch')} disabled={isPending}
            className="mt-4 border border-green-600 px-6 py-2 font-mono text-sm uppercase tracking-wider text-green-400 hover:bg-green-600 hover:text-black transition-colors">
            {iAmCreator ? 'launch now' : 'launch (deadline passed — anyone may)'}
          </button>
        )}

        {isConnected && s.refundable && s.myContribution > 0n && (
          <button onClick={() => act('refund')} disabled={isPending}
            className="mt-4 border border-red-500 px-6 py-2 font-mono text-sm uppercase tracking-wider text-red-400 hover:bg-red-500 hover:text-black transition-colors">
            refund {fmtEth(s.myContribution)} ETH
          </button>
        )}

        {isConnected && iAmCreator && !s.launched && !s.cancelled && (
          <button onClick={() => act('cancel')} disabled={isPending}
            className="mt-4 ml-3 border border-neutral-700 px-4 py-2 font-mono text-xs text-neutral-500 hover:border-red-500 hover:text-red-400 transition-colors">
            cancel campaign (opens refunds)
          </button>
        )}

        {/* ── post-launch ─────────────────────────────────────── */}
        {s.launched && (
          <div className="mt-6 border-t border-neutral-800 pt-4 font-mono text-sm space-y-3">
            <p className="text-neutral-400">
              token: <a href={explorerUrl(s.token)} target="_blank" className="text-orange-400 underline">{s.token}</a>
            </p>
            {s.myContribution > 0n && !s.myTokensClaimed && (
              <button onClick={() => act('claimTokens')} disabled={isPending}
                className="border border-green-600 px-6 py-2 uppercase tracking-wider text-green-400 hover:bg-green-600 hover:text-black transition-colors">
                claim {(Number(myTokenShare) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${s.meta.symbol}
              </button>
            )}
            {s.myTokensClaimed && <p className="text-green-500">✓ tokens claimed</p>}
            {s.myContribution > 0n && (
              <div className="flex items-center gap-3">
                <span className="text-neutral-400">your fee share (WETH): {fmtEth(feesOwed > 0n ? feesOwed : 0n, 6)}</span>
                <button
                  onClick={() => writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBacker', args: [RHC_WETH] })}
                  disabled={isPending || feesOwed === 0n}
                  className="border border-neutral-600 px-3 py-1 text-xs uppercase text-neutral-300 hover:border-orange-500 hover:text-orange-400 transition-colors disabled:opacity-40">
                  claim fees
                </button>
                <button onClick={() => act('pokeCollect')} disabled={isPending}
                  className="border border-neutral-700 px-3 py-1 text-xs text-neutral-500 hover:border-neutral-400 transition-colors"
                  title="permissionless: pull accrued creator fees from pons into the splitter">
                  collect from pons
                </button>
              </div>
            )}
          </div>
        )}

        {(isPending || txHash) && !txConfirmed && (
          <p className="mt-4 font-mono text-xs text-orange-400 animate-pulse">
            {isPending ? 'confirm in wallet…' : 'tx pending…'}
          </p>
        )}
        {writeErr && (
          <p className="mt-4 font-mono text-xs text-red-400">
            {(writeErr as Error).message.split('\n')[0].slice(0, 160)}
          </p>
        )}
      </div>

      <p className="mt-6 font-mono text-xs text-neutral-600">
        campaign <a href={explorerUrl(addr)} target="_blank" className="underline">{addr}</a> ·
        fee splitter <a href={explorerUrl(s.feeSplitter)} target="_blank" className="underline">{s.feeSplitter.slice(0, 10)}…</a> ·
        ownerless contracts — verify everything yourself
      </p>
    </main>
  );
}
