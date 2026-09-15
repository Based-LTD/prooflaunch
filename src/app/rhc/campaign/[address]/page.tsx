'use client';

// Campaign detail + lifecycle actions, in the house style (CSS vars,
// bordered card shells, "// LABEL" section headers, btn-primary CTAs).
// Every action is the user's own transaction against an ownerless
// contract — the site is a convenience view, never a custodian.
import { use, useEffect, useState, useCallback } from 'react';
import { useAccount, useWalletClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, isAddress } from 'viem';
import {
  rhcPublicClient, campaignAbi, splitterAbi, fmtEth, explorerUrl, RHC_WETH, robinhoodChain,
} from '@/lib/rhc';
import { RhcHeader, StatusPill } from '../../components';
import { WpPanel } from '../../walletproof';

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
  isV4: boolean; // pons V2 campaign — native-ETH fees, pokeHarvest crank
}

const label = 'block text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5';

export default function CampaignPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: rawAddr } = use(params);
  const addr = (isAddress(rawAddr) ? rawAddr : '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const { address: me, isConnected } = useAccount();
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState('0.1');
  const { writeContract, data: txHash, isPending, error: writeErr, reset } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const [watchState, setWatchState] = useState<'idle' | 'asking' | 'ok' | 'nope'>('idle');
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

      // Generation probe: v4 (pons V2) campaigns expose curve(); their fee
      // asset is native ETH (address(0)). v1-v3 campaigns fee in WETH.
      let isV4 = false;
      try {
        await rhcPublicClient.readContract({ ...c, functionName: 'curve' });
        isV4 = true;
      } catch { /* pre-v4 campaign */ }
      const feeAsset = (isV4 ? zero : RHC_WETH) as `0x${string}`;

      let myFeeEntitlement = 0n, myFeesClaimed = 0n;
      if (launched && me) {
        [myFeeEntitlement, myFeesClaimed] = await rhcPublicClient.multicall({
          contracts: [
            { address: feeSplitter, abi: splitterAbi, functionName: 'backerEntitlement', args: [me, feeAsset] },
            { address: feeSplitter, abi: splitterAbi, functionName: 'backerClaimed', args: [me, feeAsset] },
          ],
          allowFailure: false,
        }) as [bigint, bigint];
      }
      setS({ meta, creator, goal, minDeposit, maxDeposit, maxBackers, deadline, totalRaised,
        backerCount, launched, cancelled, refundable, token, feeSplitter, tokensAtLaunch,
        totalRaisedAtLaunch, myContribution, myTokensClaimed, myFeeEntitlement, myFeesClaimed, isV4 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [addr, me]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (txConfirmed) { reset(); load(); } }, [txConfirmed, reset, load]);

  const act = (functionName: 'withdraw' | 'launch' | 'claimTokens' | 'refund' | 'cancel' | 'pokeCollect' | 'pokeHarvest') =>
    writeContract({ address: addr, abi: campaignAbi, functionName, chainId: robinhoodChain.id });

  const shell = (children: React.ReactNode) => (
    <div className="max-w-3xl mx-auto pb-8"><RhcHeader />{children}</div>
  );

  if (err) return shell(
    <p className="text-xs font-mono text-[var(--error)] border border-[var(--error)]/40 bg-[var(--error)]/5 p-3">
      CHAIN READ FAILED: {err}
    </p>
  );
  if (!s) return shell(
    <p className="text-xs font-mono text-[var(--muted)] animate-pulse py-6 text-center">reading chain…</p>
  );

  const now = BigInt(Math.floor(Date.now() / 1000));
  const goalMet = s.totalRaised >= s.goal;
  const iAmCreator = me?.toLowerCase() === s.creator.toLowerCase();
  const canLaunch = !s.launched && !s.cancelled && goalMet && (iAmCreator || now >= s.deadline);
  const myTokenShare = s.launched && s.totalRaisedAtLaunch > 0n
    ? (s.tokensAtLaunch * s.myContribution) / s.totalRaisedAtLaunch : 0n;
  const feesOwed = s.myFeeEntitlement > s.myFeesClaimed ? s.myFeeEntitlement - s.myFeesClaimed : 0n;
  const pct = s.goal > 0n ? Number((s.totalRaised * 100n) / s.goal) : 0;

  return shell(
    <>
      <div className="border border-[var(--border)] bg-[var(--card)]">
        {/* Card header — MemeCard convention */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
            {'// '}${s.meta.symbol} — {s.meta.name}
          </span>
          <StatusPill launched={s.launched} cancelled={s.cancelled} refundable={s.refundable}
            deadline={s.deadline} totalRaised={s.totalRaised} goal={s.goal} />
        </div>

        <div className="p-4">
          {s.meta.description && (
            <p className="text-sm font-mono text-[var(--muted)] mb-4">{s.meta.description}</p>
          )}

          {/* Slot grid — the SOL detail treatment: filled blocks for
              backers in, outlined for open slots. Open raises (maxBackers
              0) show the bar alone. */}
          {!s.launched && s.maxBackers > 0n && s.maxBackers <= 24n && (
            <div className="mb-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Slots</span>
                <span className="text-xs font-mono text-[var(--accent)]">
                  {s.backerCount.toString()} / {s.maxBackers.toString()}
                </span>
              </div>
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${Number(s.maxBackers)}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: Number(s.maxBackers) }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-4 ${
                      i < Number(s.backerCount)
                        ? 'bg-[var(--accent)]'
                        : 'border border-[var(--accent)]'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Raise progress */}
          <div className="h-1.5 bg-[var(--border)]">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              [fmtEth(s.totalRaised, 3) + ' ETH', `raised of ${fmtEth(s.goal, 3)}`],
              [s.backerCount.toString() + (s.maxBackers > 0n ? ` / ${s.maxBackers}` : ''), 'backers'],
              [fmtEth(s.minDeposit, 3), 'min per backer'],
              [new Date(Number(s.deadline) * 1000).toLocaleDateString(), 'deadline'],
            ].map(([v, k]) => (
              <div key={k as string} className="border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <div className="font-mono text-sm text-[var(--foreground)]">{v}</div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mt-0.5">{k}</div>
              </div>
            ))}
          </div>

          {/* ── actions ─────────────────────────────────────────── */}
          {!isConnected && (
            <p className="mt-5 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              {'> '}Connect your wallet to participate
            </p>
          )}

          {isConnected && !s.launched && !s.cancelled && !s.refundable && now < s.deadline && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {/* Seat round (min == max, slotted): one fixed-price button —
                  the SOL slot-claim feel. Open raise: free amount. */}
              {s.maxBackers > 0n && s.minDeposit === s.maxDeposit && s.minDeposit > 0n ? (
                <button
                  onClick={() => writeContract({ address: addr, abi: campaignAbi, functionName: 'deposit', value: s.minDeposit, chainId: robinhoodChain.id })}
                  disabled={isPending || s.myContribution > 0n}
                  className="btn-primary"
                >
                  {s.myContribution > 0n ? 'Seat Taken ✓' : `Take a Seat — ${fmtEth(s.minDeposit, 3)} ETH`}
                </button>
              ) : (
                <>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="ETH"
                    className="w-28 px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-sm font-mono"
                  />
                  <button
                    onClick={() => writeContract({ address: addr, abi: campaignAbi, functionName: 'deposit', value: parseEther(amount || '0'), chainId: robinhoodChain.id })}
                    disabled={isPending}
                    className="btn-primary"
                  >
                    Back This Launch
                  </button>
                </>
              )}
              {s.myContribution > 0n && (
                <button
                  onClick={() => act('withdraw')}
                  disabled={isPending}
                  className="px-4 py-2.5 text-xs font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
                >
                  Withdraw {fmtEth(s.myContribution, 3)}
                </button>
              )}
            </div>
          )}

          {isConnected && canLaunch && (
            <button onClick={() => act('launch')} disabled={isPending} className="btn-primary mt-4">
              {iAmCreator ? 'Launch Now' : 'Launch (deadline passed — anyone may)'}
            </button>
          )}

          {isConnected && s.refundable && s.myContribution > 0n && (
            <button
              onClick={() => act('refund')}
              disabled={isPending}
              className="mt-4 px-4 py-2.5 text-xs font-mono uppercase tracking-widest border border-[var(--error)] text-[var(--error)] hover:bg-[var(--error)] hover:text-black transition-colors"
            >
              Refund {fmtEth(s.myContribution, 3)} ETH
            </button>
          )}

          {isConnected && iAmCreator && !s.launched && !s.cancelled && (
            <button
              onClick={() => act('cancel')}
              disabled={isPending}
              className="mt-4 ml-3 px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted-soft)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
            >
              Cancel Campaign
            </button>
          )}

          {/* ── post-launch ─────────────────────────────────────── */}
          {s.launched && (
            <div className="mt-5 border-t border-[var(--border)] pt-4 space-y-3">
              <div>
                <span className={label}>Token</span>
                <a href={explorerUrl(s.token)} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] break-all">
                  {s.token}
                </a>
              </div>
              <WpPanel token={s.token} />
              {s.myContribution > 0n && !s.myTokensClaimed && (
                <button onClick={() => act('claimTokens')} disabled={isPending} className="btn-primary">
                  Claim {(Number(myTokenShare) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${s.meta.symbol}
                </button>
              )}
              {s.myTokensClaimed && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
                    ✓ Tokens claimed
                  </p>
                  {/* EIP-747: ask the wallet to TRACK the token. New tokens
                      on a young chain are invisible in wallet UIs until
                      told — the #1 support question on the SOL side too. */}
                  <button
                    onClick={async () => {
                      // Route through the CONNECTED wallet's client (not a
                      // bare window.ethereum, which may be a different
                      // extension) and always report the outcome — a silent
                      // no-op here cost the founder a test cycle.
                      setWatchState('asking');
                      try {
                        const ok = await walletClient?.watchAsset({
                          type: 'ERC20',
                          options: { address: s.token, symbol: s.meta.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 11) || 'TOKEN', decimals: 18 },
                        });
                        setWatchState(ok ? 'ok' : 'nope');
                      } catch {
                        setWatchState('nope');
                      }
                    }}
                    disabled={watchState === 'asking' || !walletClient}
                    className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                  >
                    {watchState === 'asking' ? 'Check your wallet…' : watchState === 'ok' ? '✓ Added to wallet' : watchState === 'nope' ? 'Wallet refused — use Explorer →' : '+ Add Token to Wallet'}
                  </button>
                  <a
                    href={explorerUrl(s.token)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:text-[var(--accent-hover)]"
                  >
                    Verify on Explorer ↗
                  </a>
                </div>
              )}
              {s.myContribution > 0n && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    Your fee share ({s.isV4 ? 'ETH' : 'WETH'}): <span className="text-[var(--foreground)]">{fmtEth(feesOwed, 6)}</span>
                  </span>
                  <button
                    onClick={() => writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBacker', args: [s.isV4 ? '0x0000000000000000000000000000000000000000' : RHC_WETH], chainId: robinhoodChain.id })}
                    disabled={isPending || feesOwed === 0n}
                    className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                  >
                    Claim Fees
                  </button>
                  <button
                    onClick={() => act(s.isV4 ? 'pokeHarvest' : 'pokeCollect')}
                    disabled={isPending}
                    title="Permissionless: pull accrued creator fees from pons into the splitter"
                    className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                  >
                    Collect From pons
                  </button>
                </div>
              )}
            </div>
          )}

          {(isPending || txHash) && !txConfirmed && (
            <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] animate-pulse">
              {isPending ? '> Confirm in wallet…' : '> Tx pending…'}
            </p>
          )}
          {writeErr && (
            <p className="mt-4 text-xs font-mono text-[var(--error)]">
              {(writeErr as Error).message.split('\n')[0].slice(0, 160)}
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] break-all">
        Campaign{' '}
        <a href={explorerUrl(addr)} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--muted)]">{addr}</a>
        {' '}· Splitter{' '}
        <a href={explorerUrl(s.feeSplitter)} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--muted)]">{s.feeSplitter.slice(0, 10)}…</a>
        {' '}· Ownerless contracts — verify everything yourself
      </p>
    </>
  );
}
