'use client';

// Campaign detail + lifecycle actions, in the house style (CSS vars,
// bordered card shells, "// LABEL" section headers, btn-primary CTAs).
// Every action is the user's own transaction against an ownerless
// contract — the site is a convenience view, never a custodian.
import { use, useEffect, useState, useCallback } from 'react';
import { useAccount, useWalletClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, isAddress } from 'viem';
import {
  rhcPublicClient, campaignAbi, campaignV3Abi, splitterAbi, curveAbi, erc20Abi, fmtEth, explorerUrl,
  RHC_WETH, robinhoodChain, QUOTE_ASSETS,
} from '@/lib/rhc';
import { RhcHeader, StatusPill } from '../../components';
import { ClaimAsPicker } from '../../ClaimAsPicker';
import { EQUITY_ROUTER_LIVE, EQUITY_ASSETS, poolKeyFor, fmtShares, quoteEquityOut, minOutFrom, type EquityAsset } from '@/lib/rhcEquity';
import { WpPanel } from '../../walletproof';

interface State {
  meta: { name: string; symbol: string; description: string; logo: string };
  creator: `0x${string}`;
  goal: bigint; minDeposit: bigint; maxDeposit: bigint; maxBackers: bigint;
  deadline: bigint; totalRaised: bigint; backerCount: bigint;
  launched: boolean; cancelled: boolean; refundable: boolean;
  token: `0x${string}`; feeSplitter: `0x${string}`;
  tokensAtLaunch: bigint; totalRaisedAtLaunch: bigint;
  myContribution: bigint; myTokensClaimed: boolean;
  myFeeEntitlement: bigint; myFeesClaimed: bigint;
  myTokenBalance: bigint; // live wallet balance — Phantom won't show it, we do
  isV4: boolean; // pons V2 campaign — native-ETH fees, pokeHarvest crank
  curve: `0x${string}` | null;
  curveGraduated: boolean;
  myCurveAllowance: bigint;
  ponsOwed: bigint; // creator fees sitting in pons' escrow, owed to this splitter, not yet collected
  backerBps: number; // splitter's backer share (9000 = 90%), for projecting what a collect yields you
  projectedShare: bigint; // YOUR cut of ponsOwed once collected — shown so 'nothing to claim' can never be the read
  projectedShares: bigint | null; // that cut quoted in the creator's payout asset, if any
  v7: V7 | null; // null for v1–v6 campaigns; this page serves every generation
}

/// v7 adds an ERC20-quoted raise (USDG and friends), contract-enforced
/// team seats, token gating, and an escrowed pons launch fee. All of it
/// is absent on older campaigns, so it lives behind its own probe.
interface V7 {
  quoteToken: `0x${string}`;      // 0 = native ETH
  quoteSymbol: string;
  quoteDecimals: number;
  reservedSeats: number;
  reservedSeatsUsed: bigint;
  publicSeatsUsed: bigint;
  mySeatBucket: number;           // 0 none · 1 public · 2 reserved
  iAmAllowlisted: boolean;
  gateToken: `0x${string}`;
  gateMinBalance: bigint;
  myGateBalance: bigint;
  myQuoteBalance: bigint;
  myQuoteAllowance: bigint;
  launchFeeEscrowed: bigint;
  launchFeeRefunded: boolean;
  payoutAsset: `0x${string}`;     // creator's default for fee claims; 0 = ETH
  splitterHasRouter: boolean;     // FeeSplitterV3 with a live EquityRouter → claimBackerAs works
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;
// pons V2 FeeEscrow — creator tax accrues here (curve → escrow via pons'
// sweeper) until someone cranks it into the campaign's splitter.
const PONS_FEE_ESCROW = '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e' as `0x${string}`;

/// Quote amounts are NOT always 18 decimals — USDG is 6, and treating it
/// as ETH would misprice every input by a factor of a trillion.
function fmtUnits(v: bigint, decimals: number, digits = 4): string {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * 10n ** BigInt(digits)) / base;
  return `${whole}.${frac.toString().padStart(digits, '0').replace(/0+$/, '') || '0'}`;
}

function parseUnits(input: string, decimals: number): bigint {
  const [w = '0', f = ''] = (input || '0').split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

const label = 'block text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5';

export default function CampaignPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: rawAddr } = use(params);
  const addr = (isAddress(rawAddr) ? rawAddr : '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const { address: me, isConnected } = useAccount();
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState('0.1');
  const [buyAmt, setBuyAmt] = useState('0.005');
  const [sellAmt, setSellAmt] = useState('');
  const { writeContract, data: txHash, isPending, error: writeErr, reset } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const [watchState, setWatchState] = useState<'idle' | 'asking' | 'ok' | 'nope'>('idle');
  const { isSuccess: txConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  // ── action receipts (punch list #5) ─────────────────────────────────
  // A tx that confirms used to produce nothing but a reload. Snapshot what
  // the wallet held when the action was sent; when it confirms, say what
  // actually changed — "Sold 1,000,000 $X for 0.0041 ETH" — with the hash.
  type ActionKind = 'buy' | 'sell' | 'approve' | 'claimTokens' | 'claimFees' | 'claimFeesAs' | 'collect' | 'other';
  interface PendingAction { kind: ActionKind; amount?: bigint; asset?: EquityAsset; tokBefore: bigint; ethBefore: bigint; assetBefore?: bigint; label?: string; then?: { claimAs: EquityAsset } }
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ text: string; hash: `0x${string}` } | null>(null);
  const balanceOfAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
  const startAction = async (kind: ActionKind, opts: { amount?: bigint; asset?: EquityAsset; label?: string; then?: { claimAs: EquityAsset } } = {}) => {
    setLastReceipt(null);
    if (!me) { setPendingAction({ kind, ...opts, tokBefore: 0n, ethBefore: 0n }); return; }
    const [ethBefore, assetBefore] = await Promise.all([
      rhcPublicClient.getBalance({ address: me }).catch(() => 0n),
      opts.asset ? rhcPublicClient.readContract({ address: opts.asset.address, abi: balanceOfAbi, functionName: 'balanceOf', args: [me] }).catch(() => 0n) as Promise<bigint> : Promise.resolve(undefined),
    ]);
    setPendingAction({ kind, ...opts, tokBefore: s?.myTokenBalance ?? 0n, ethBefore, assetBefore });
  };
  const fmtTok = (v: bigint) => (Number(v) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 });

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
      let curve: `0x${string}` | null = null;
      try {
        curve = await rhcPublicClient.readContract({ ...c, functionName: 'curve' }) as `0x${string}`;
        isV4 = true;
      } catch { /* pre-v4 campaign */ }
      const feeAsset = (isV4 ? zero : RHC_WETH) as `0x${string}`;
      // What pons already owes this campaign but nobody has pulled down yet.
      // Without this the page shows a zero fee share while real fees sit one
      // hop upstream, and the user has no idea Collect is the next step.
      const ponsOwed = isV4 && launched
        ? await rhcPublicClient.readContract({
            address: PONS_FEE_ESCROW,
            abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
            functionName: 'balanceOf', args: [feeSplitter],
          }).catch(() => 0n) as bigint
        : 0n;
      const backerBps = Number(await rhcPublicClient.readContract({ address: feeSplitter, abi: splitterAbi, functionName: 'backerBps' }).catch(() => 9000));
      const projectedShare = ponsOwed > 0n && totalRaisedAtLaunch > 0n
        ? (ponsOwed * BigInt(backerBps) * myContribution) / (10_000n * totalRaisedAtLaunch)
        : 0n;

      let myFeeEntitlement = 0n, myFeesClaimed = 0n, myTokenBalance = 0n;
      let curveGraduated = false, myCurveAllowance = 0n;
      if (launched && curve && curve !== zero) {
        curveGraduated = await rhcPublicClient.readContract({ address: curve, abi: curveAbi, functionName: 'graduated' }).catch(() => false) as boolean;
        if (me) {
          myCurveAllowance = await rhcPublicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [me, curve] }).catch(() => 0n) as bigint;
        }
      }
      if (launched && me) {
        myTokenBalance = await rhcPublicClient.readContract({
          address: token,
          abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
          functionName: 'balanceOf',
          args: [me],
        }) as bigint;
        [myFeeEntitlement, myFeesClaimed] = await rhcPublicClient.multicall({
          contracts: [
            { address: feeSplitter, abi: splitterAbi, functionName: 'backerEntitlement', args: [me, feeAsset] },
            { address: feeSplitter, abi: splitterAbi, functionName: 'backerClaimed', args: [me, feeAsset] },
          ],
          allowFailure: false,
        }) as [bigint, bigint];
      }
      // v7 probe: quoteToken() only exists from CampaignV3 on. Everything
      // it gates is additive, so older campaigns simply render as before.
      let v7: V7 | null = null;
      try {
        const c3 = { address: addr, abi: campaignV3Abi } as const;
        const [quoteToken, reservedSeats, reservedSeatsUsed, publicSeatsUsed, gateToken,
          gateMinBalance, launchFeeEscrowed, launchFeeRefunded, payoutAsset] =
          await rhcPublicClient.multicall({
            contracts: [
              { ...c3, functionName: 'quoteToken' },
              { ...c3, functionName: 'reservedSeats' },
              { ...c3, functionName: 'reservedSeatsUsed' },
              { ...c3, functionName: 'publicSeatsUsed' },
              { ...c3, functionName: 'gateToken' },
              { ...c3, functionName: 'gateMinBalance' },
              { ...c3, functionName: 'launchFeeEscrowed' },
              { ...c3, functionName: 'launchFeeRefunded' },
              { ...c3, functionName: 'payoutAsset' },
            ],
            allowFailure: false,
          }) as unknown as [`0x${string}`, number, bigint, bigint, `0x${string}`, bigint, bigint, boolean, `0x${string}`];

        let mySeatBucket = 0, iAmAllowlisted = false;
        let myQuoteBalance = 0n, myQuoteAllowance = 0n, myGateBalance = 0n;
        if (me) {
          [mySeatBucket, iAmAllowlisted] = await rhcPublicClient.multicall({
            contracts: [
              { ...c3, functionName: 'seatBucket', args: [me] },
              { ...c3, functionName: 'allowlisted', args: [me] },
            ],
            allowFailure: false,
          }) as unknown as [number, boolean];

          if (quoteToken !== zero) {
            [myQuoteBalance, myQuoteAllowance] = await rhcPublicClient.multicall({
              contracts: [
                { address: quoteToken, abi: erc20Abi, functionName: 'balanceOf', args: [me] },
                { address: quoteToken, abi: erc20Abi, functionName: 'allowance', args: [me, addr] },
              ],
              allowFailure: false,
            }) as [bigint, bigint];
          }
          if (gateToken !== zero) {
            myGateBalance = await rhcPublicClient.readContract({
              address: gateToken, abi: erc20Abi, functionName: 'balanceOf', args: [me],
            }).catch(() => 0n) as bigint;
          }
        }

        // Only a FeeSplitterV3 built with a router can route claims; read it
        // rather than assume, so an older or router-less splitter keeps the
        // plain ETH button and never offers a call that would revert.
        const splitterRouter = await rhcPublicClient.readContract({
          address: feeSplitter, abi: splitterAbi, functionName: 'equityRouter',
        }).catch(() => zero) as `0x${string}`;
        const known = QUOTE_ASSETS.find((q) => q.address.toLowerCase() === quoteToken.toLowerCase());
        v7 = {
          quoteToken, reservedSeats: Number(reservedSeats), reservedSeatsUsed, publicSeatsUsed,
          mySeatBucket, iAmAllowlisted, gateToken, gateMinBalance, myGateBalance,
          myQuoteBalance, myQuoteAllowance, launchFeeEscrowed, launchFeeRefunded,
          payoutAsset, splitterHasRouter: splitterRouter !== zero,
          quoteSymbol: known?.symbol ?? (quoteToken === zero ? 'ETH' : 'TOKEN'),
          quoteDecimals: known?.decimals ?? 18,
        };
      } catch { /* v1–v6 campaign */ }

      setS({ meta, creator, goal, minDeposit, maxDeposit, maxBackers, deadline, totalRaised,
        backerCount, launched, cancelled, refundable, token, feeSplitter, tokensAtLaunch,
        totalRaisedAtLaunch, myContribution, myTokensClaimed, myFeeEntitlement, myFeesClaimed, myTokenBalance, isV4,
        curve, curveGraduated, myCurveAllowance, ponsOwed, backerBps, projectedShare, projectedShares: null, v7 });
      // Quote the projection in the creator's pick, off the critical path.
      if (v7 && me && projectedShare > 0n && v7.payoutAsset !== zero && EQUITY_ROUTER_LIVE) {
        const asset = EQUITY_ASSETS.find((a) => a.address.toLowerCase() === v7!.payoutAsset.toLowerCase());
        if (asset) quoteEquityOut(asset, projectedShare, me).then((q) => setS((prev) => (prev ? { ...prev, projectedShares: q } : prev)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [addr, me]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!txConfirmed || !receipt) return;
    (async () => {
      await load();
      const a = pendingAction;
      if (a && me && s) {
        const sym = s.meta.symbol;
        const gas = receipt.gasUsed * receipt.effectiveGasPrice;
        const [tokAfter, ethAfter, assetAfter] = await Promise.all([
          rhcPublicClient.readContract({ address: s.token, abi: balanceOfAbi, functionName: 'balanceOf', args: [me] }).catch(() => a.tokBefore) as Promise<bigint>,
          rhcPublicClient.getBalance({ address: me }).catch(() => a.ethBefore),
          a.asset ? rhcPublicClient.readContract({ address: a.asset.address, abi: balanceOfAbi, functionName: 'balanceOf', args: [me] }).catch(() => a.assetBefore ?? 0n) as Promise<bigint> : Promise.resolve(undefined),
        ]);
        const ethNet = ethAfter - a.ethBefore + gas; // what the tx paid you, before gas
        const tokDelta = tokAfter - a.tokBefore;
        let text = 'Confirmed';
        if (a.kind === 'buy') text = `Bought ${fmtTok(tokDelta)} $${sym} for ${fmtEth(a.amount ?? 0n)} ETH`;
        else if (a.kind === 'sell') text = `Sold ${fmtTok(a.amount ?? -tokDelta)} $${sym} for ${fmtEth(ethNet, 6)} ETH`;
        else if (a.kind === 'approve') text = `Approved the curve to take $${sym} you sell — now hit Sell`;
        else if (a.kind === 'claimTokens') text = `Claimed ${fmtTok(tokDelta)} $${sym} into your wallet`;
        else if (a.kind === 'claimFees') text = `Claimed ${fmtEth(ethNet, 6)} ETH of fees`;
        else if (a.kind === 'claimFeesAs' && a.asset) text = `Claimed fees as ${a.asset.symbol}: ${fmtShares((assetAfter ?? 0n) - (a.assetBefore ?? 0n), a.asset.decimals)} ${a.asset.symbol} landed in your wallet`;
        else if (a.kind === 'collect') text = 'Collected accrued fees from pons into the splitter — your share is updated below';
        else if (a.label) text = a.label;
        setLastReceipt({ text: `${text} · gas ${fmtEth(gas, 7)} ETH`, hash: receipt.transactionHash });
      }
      setPendingAction(null);
      reset();
      // One-click "collect & claim": once the collect has landed and the
      // page has reloaded, quote the claimer's now-real share and prompt
      // the second signature. If they reject it, step ② stays on screen.
      if (a?.kind === 'collect' && a.then && me && s) {
        const asset = a.then.claimAs;
        const [ent, claimed] = await Promise.all([
          rhcPublicClient.readContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'backerEntitlement', args: [me, ZERO_ADDR] }).catch(() => 0n) as Promise<bigint>,
          rhcPublicClient.readContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'backerClaimed', args: [me, ZERO_ADDR] }).catch(() => 0n) as Promise<bigint>,
        ]);
        const owed = ent > claimed ? ent - claimed : 0n;
        if (owed > 0n) {
          const q = await quoteEquityOut(asset, owed, me);
          if (q && q > 0n) {
            setTimeout(() => {
              void startAction('claimFeesAs', { asset });
              writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBackerAs', args: [poolKeyFor(asset), minOutFrom(q)], chainId: robinhoodChain.id });
            }, 150);
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txConfirmed, receipt]);

  const act = (functionName: 'withdraw' | 'launch' | 'claimTokens' | 'refund' | 'cancel' | 'pokeCollect' | 'pokeHarvest') => {
    const kind: ActionKind = functionName === 'claimTokens' ? 'claimTokens' : functionName === 'pokeHarvest' || functionName === 'pokeCollect' ? 'collect' : 'other';
    const labels: Record<string, string> = { withdraw: 'Withdrawn — your seat is free and your deposit is back', launch: 'Launched — token created on pons and the pooled buy executed', refund: 'Refunded — your deposit is back', cancel: 'Campaign cancelled — refunds open' };
    void startAction(kind, { label: labels[functionName] });
    writeContract({ address: addr, abi: campaignAbi, functionName, chainId: robinhoodChain.id });
  };

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

  // ── v7 derived ──────────────────────────────────────────────────────
  const v7 = s.v7;
  const qDec = v7?.quoteDecimals ?? 18;
  const qSym = v7?.quoteSymbol ?? 'ETH';
  const isErc20Quote = !!v7 && v7.quoteToken !== ZERO_ADDR;
  /// Quote-aware formatter: ETH raises keep the existing fmtEth output,
  /// ERC20 raises honour their own decimals (USDG is 6, not 18).
  const q = (v: bigint, digits = 3) => (isErc20Quote ? fmtUnits(v, qDec, digits) : fmtEth(v, digits));
  const wantAmount = isErc20Quote ? parseUnits(amount, qDec) : parseEther(amount || '0');
  const needsApproval = isErc20Quote && !!v7 && v7.myQuoteAllowance < wantAmount;
  const gated = !!v7 && v7.gateToken !== ZERO_ADDR;
  const gateBlocked = gated && !!v7 && v7.myGateBalance < v7.gateMinBalance;
  // Reserved seats are claimable only by allowlisted wallets, so the
  // number a stranger can actually take is the public bucket alone.
  const publicSeats = s.maxBackers > 0n ? Number(s.maxBackers) - (v7?.reservedSeats ?? 0) : 0;
  const publicSeatsLeft = publicSeats - Number(v7?.publicSeatsUsed ?? 0n);
  const takesReserved = !!v7 && v7.iAmAllowlisted && Number(v7.reservedSeatsUsed) < v7.reservedSeats;
  const publicFull = !!v7 && s.maxBackers > 0n && !takesReserved && publicSeatsLeft <= 0;

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
          {/* Avatar + name — the board card's anatomy; the detail page had
              no picture at all until the first prod test (punch list #1). */}
          <div className="flex items-start gap-3 mb-4">
            {s.meta.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.meta.logo} alt={s.meta.name} className="w-14 h-14 object-cover border border-[var(--border)] flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 border border-[var(--accent)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
                <span className="font-mono font-semibold text-[var(--accent)] text-sm">{s.meta.symbol.slice(0, 4)}</span>
              </div>
            )}
            <div className="min-w-0">
              <div className="font-mono font-semibold text-base truncate">{s.meta.name}</div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">${s.meta.symbol}</div>
              {s.meta.description && (
                <p className="text-sm font-mono text-[var(--muted)] mt-1">{s.meta.description}</p>
              )}
            </div>
          </div>

          {/* Slot grid — the SOL detail treatment: filled blocks for
              backers in, outlined for open slots. Open raises (maxBackers
              0) show the bar alone. */}
          {!s.launched && s.maxBackers > 0n && s.maxBackers <= 24n && (
            <div className="mb-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  Slots{v7 && v7.reservedSeats > 0 ? ' — team round' : ''}
                </span>
                <span className="text-xs font-mono text-[var(--accent)]">
                  {s.backerCount.toString()} / {s.maxBackers.toString()}
                </span>
              </div>
              {/* Reserved seats are drawn apart from public ones. Showing a
                  stranger "3 of 10 left" when seven are allowlist-only earns
                  them a revert instead of a seat. */}
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${Number(s.maxBackers)}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: Number(s.maxBackers) }).map((_, i) => {
                  const reserved = !!v7 && i >= publicSeats;
                  const taken = reserved
                    ? i - publicSeats < Number(v7?.reservedSeatsUsed ?? 0n)
                    : i < Number(v7?.publicSeatsUsed ?? s.backerCount);
                  return (
                    <div
                      key={i}
                      title={reserved ? 'Reserved for the team allowlist' : 'Open seat'}
                      className={`h-4 ${
                        taken
                          ? reserved ? 'bg-[var(--muted)]' : 'bg-[var(--accent)]'
                          : reserved
                            ? 'border border-dashed border-[var(--muted)]'
                            : 'border border-[var(--accent)]'
                      }`}
                    />
                  );
                })}
              </div>
              {v7 && v7.reservedSeats > 0 && (
                <p className="mt-2 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  {publicSeatsLeft > 0 ? `${publicSeatsLeft} open` : 'open seats full'}
                  {' · '}{v7.reservedSeats - Number(v7.reservedSeatsUsed)} reserved for the team
                  {v7.iAmAllowlisted && ' · you are on the allowlist'}
                </p>
              )}
            </div>
          )}

          {/* Raise progress */}
          <div className="h-1.5 bg-[var(--border)]">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              [`${q(s.totalRaised)} ${qSym}`, `raised of ${q(s.goal)}`],
              [s.backerCount.toString() + (s.maxBackers > 0n ? ` / ${s.maxBackers}` : ''), 'backers'],
              [q(s.minDeposit), 'min per backer'],
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
            <div className="mt-5 space-y-3">
              {/* Gating and a full public bucket are the two reasons a
                  deposit would revert. Say so BEFORE they sign, not after. */}
              {gateBlocked && v7 && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--error)] border border-[var(--error)]/40 bg-[var(--error)]/5 px-3 py-2">
                  {'> '}Token-gated: hold {fmtUnits(v7.gateMinBalance, 18, 2)} of{' '}
                  <a href={explorerUrl(v7.gateToken)} target="_blank" rel="noopener noreferrer" className="underline">
                    this token
                  </a>{' '}to back. You hold {fmtUnits(v7.myGateBalance, 18, 2)}.
                </p>
              )}
              {publicFull && !gateBlocked && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] border border-[var(--border)] px-3 py-2">
                  {'> '}Open seats are full. The remaining seats are reserved for the team allowlist.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
              {/* Seat round (min == max, slotted): one fixed-price button —
                  the SOL slot-claim feel. Open raise: free amount. */}
              {s.maxBackers > 0n && s.minDeposit === s.maxDeposit && s.minDeposit > 0n ? (
                isErc20Quote && v7 && v7.myQuoteAllowance < s.minDeposit ? (
                  <button
                    onClick={() => writeContract({ address: v7.quoteToken, abi: erc20Abi, functionName: 'approve', args: [addr, s.minDeposit], chainId: robinhoodChain.id })}
                    disabled={isPending || gateBlocked || publicFull}
                    className="btn-primary"
                  >
                    Approve {q(s.minDeposit)} {qSym}
                  </button>
                ) : (
                  <button
                    onClick={() => isErc20Quote
                      ? writeContract({ address: addr, abi: campaignV3Abi, functionName: 'depositToken', args: [s.minDeposit], chainId: robinhoodChain.id })
                      : writeContract({ address: addr, abi: campaignAbi, functionName: 'deposit', value: s.minDeposit, chainId: robinhoodChain.id })}
                    disabled={isPending || s.myContribution > 0n || gateBlocked || publicFull}
                    className="btn-primary"
                  >
                    {s.myContribution > 0n
                      ? `Seat Taken ✓${v7?.mySeatBucket === 2 ? ' (reserved)' : ''}`
                      : `Take a${takesReserved ? ' Reserved' : ''} Seat — ${q(s.minDeposit)} ${qSym}`}
                  </button>
                )
              ) : (
                <>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={qSym}
                    className="w-28 px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-sm font-mono"
                  />
                  {/* ERC20 raises are two transactions. Naming the step keeps
                      "why did nothing happen" from becoming a support ticket. */}
                  {needsApproval ? (
                    <button
                      onClick={() => v7 && writeContract({ address: v7.quoteToken, abi: erc20Abi, functionName: 'approve', args: [addr, wantAmount], chainId: robinhoodChain.id })}
                      disabled={isPending || wantAmount === 0n || gateBlocked || publicFull}
                      className="btn-primary"
                    >
                      Approve {qSym} — step 1 of 2
                    </button>
                  ) : (
                    <button
                      onClick={() => isErc20Quote
                        ? writeContract({ address: addr, abi: campaignV3Abi, functionName: 'depositToken', args: [wantAmount], chainId: robinhoodChain.id })
                        : writeContract({ address: addr, abi: campaignAbi, functionName: 'deposit', value: wantAmount, chainId: robinhoodChain.id })}
                      disabled={isPending || gateBlocked || publicFull}
                      className="btn-primary"
                    >
                      Back This Launch
                    </button>
                  )}
                  {isErc20Quote && v7 && (
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      you hold {q(v7.myQuoteBalance)} {qSym}
                    </span>
                  )}
                </>
              )}
              {s.myContribution > 0n && (
                <button
                  onClick={() => act('withdraw')}
                  disabled={isPending}
                  className="px-4 py-2.5 text-xs font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
                >
                  Withdraw {q(s.myContribution)} {qSym}
                </button>
              )}
              </div>
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
              Refund {q(s.myContribution)} {qSym}
            </button>
          )}

          {/* An ERC20-quoted raise escrows pons' launch fee in ETH at
              creation. If the raise dies that ETH sits in the campaign
              until someone calls for it — with no button, a creator sees
              their money simply gone, which is exactly how we got called a
              scam the first time. The call is permissionless and always
              pays the creator, so anyone may trigger it. */}
          {v7 && s.refundable && v7.launchFeeEscrowed > 0n && (
            <div className="mt-4">
              {v7.launchFeeRefunded ? (
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
                  ✓ Launch fee of {fmtEth(v7.launchFeeEscrowed)} ETH returned to the creator
                </p>
              ) : (
                <button
                  onClick={() => writeContract({ address: addr, abi: campaignV3Abi, functionName: 'refundLaunchFee', chainId: robinhoodChain.id })}
                  disabled={isPending}
                  className="px-4 py-2.5 text-xs font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                >
                  Return {fmtEth(v7.launchFeeEscrowed)} ETH launch fee to creator
                </button>
              )}
            </div>
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
                    ✓ In your wallet: {(Number(s.myTokenBalance) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${s.meta.symbol}
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
              {/* ── TRADE — direct curve access on OUR page. Token access
                  must never depend on an external UI or a wallet's display:
                  buy/sell are public curve functions, so we call them. ── */}
              {s.launched && s.curve && !s.curveGraduated && (
                <div className="mt-5 border border-[var(--border)] bg-[var(--background)]">
                  <div className="border-b border-[var(--border)] px-3 py-2 flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                      {'// '}TRADE — pons bonding curve, direct
                    </span>
                    <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      your wallet signs, no middleman
                    </span>
                  </div>
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] block">Buy with ETH</span>
                      <div className="flex gap-2">
                        <input
                          value={buyAmt}
                          onChange={(e) => setBuyAmt(e.target.value)}
                          placeholder="0.005"
                          className="w-24 px-2 py-2 bg-[var(--card)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-sm font-mono"
                        />
                        <button
                          onClick={() => { void startAction('buy', { amount: parseEther(buyAmt || '0') }); writeContract({ address: s.curve!, abi: curveAbi, functionName: 'buy', args: [parseEther(buyAmt || '0'), 0n, me!], value: parseEther(buyAmt || '0'), chainId: robinhoodChain.id }); }}
                          disabled={isPending || !me || !Number(buyAmt)}
                          className="btn-primary"
                        >
                          Buy
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] block">
                        Sell ${s.meta.symbol} (you hold {(Number(s.myTokenBalance) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })})
                      </span>
                      <div className="flex gap-2">
                        <input
                          value={sellAmt}
                          onChange={(e) => setSellAmt(e.target.value)}
                          placeholder="amount"
                          className="flex-1 min-w-0 px-2 py-2 bg-[var(--card)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-sm font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setSellAmt(String(Number(s.myTokenBalance) / 1e18))}
                          className="px-2 py-2 text-[9px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        >
                          Max
                        </button>
                        {s.myCurveAllowance < (s.myTokenBalance > 0n ? s.myTokenBalance : 1n) ? (
                          <button
                            onClick={() => { void startAction('approve'); writeContract({ address: s.token, abi: erc20Abi, functionName: 'approve', args: [s.curve!, 2n ** 256n - 1n], chainId: robinhoodChain.id }); }}
                            disabled={isPending || !me}
                            title="One-time: allow the pons curve to take the tokens you sell"
                            className="btn-primary"
                          >
                            Enable Selling
                          </button>
                        ) : (
                          <button
                            onClick={() => { void startAction('sell', { amount: parseEther(sellAmt || '0') }); writeContract({ address: s.curve!, abi: curveAbi, functionName: 'sell', args: [parseEther(sellAmt || '0'), 0n, me!], chainId: robinhoodChain.id }); }}
                            disabled={isPending || !me || !Number(sellAmt)}
                            className="btn-primary"
                          >
                            Sell → ETH
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="px-3 pb-2.5 text-[9px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
                    Trades hit the pons curve directly and pay its 1% fee + this token&apos;s {'creator tax'} —
                    which flows back to this campaign&apos;s backers. ETH from sells lands in your wallet instantly.
                  </p>
                </div>
              )}
              {s.launched && s.curve && s.curveGraduated && (
                <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  {'> '}Graduated — trades on the locked Uniswap v4 pool via pons.
                </p>
              )}

              {/* ── FEES — one ordered story, one enabled button at a time.
                  ① what pons still holds (anyone may collect)  ② your share
                  (claim as the creator's pick, or ETH, or another stock).
                  The old layout stacked a disabled "Nothing to claim" ABOVE
                  the real next step — the founder's word for it was
                  "confusing, ugly, and no SPCX to claim". ── */}
              {(() => {
                const payout = v7 && v7.payoutAsset !== ZERO_ADDR && v7.splitterHasRouter && EQUITY_ROUTER_LIVE && isErc20Quote === false
                  ? EQUITY_ASSETS.find((a) => a.address.toLowerCase() === v7.payoutAsset.toLowerCase()) : undefined;
                const canRoute = !!v7 && v7.splitterHasRouter && EQUITY_ROUTER_LIVE && isErc20Quote === false;
                const iBack = s.myContribution > 0n;
                const waiting = s.ponsOwed > 0n;
                const collect = (then?: EquityAsset) => {
                  void startAction('collect', { then: then ? { claimAs: then } : undefined });
                  writeContract({ address: addr, abi: campaignAbi, functionName: s.isV4 ? 'pokeHarvest' : 'pokeCollect', chainId: robinhoodChain.id });
                };
                const step = (n: string, title: string, sub: React.ReactNode, right: React.ReactNode, tone = 'text-[var(--foreground)]') => (
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3">
                    <div className="min-w-0">
                      <div className={`text-[10px] font-mono uppercase tracking-widest ${tone}`}>{n}{title}</div>
                      <div className="text-xs font-mono text-[var(--muted)] mt-0.5">{sub}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">{right}</div>
                  </div>
                );
                return (
                  <div className="mt-5 border border-[var(--border)] bg-[var(--background)]">
                    <div className="border-b border-[var(--border)] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                        {'// '}FEES — {(s.backerBps / 100).toFixed(0)}% of every trade&apos;s creator tax goes to backers
                      </span>
                      {payout && (
                        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
                          pays out in <span className="text-[var(--accent)]">{payout.symbol}</span> · creator&apos;s pick · you may take ETH or another stock
                        </span>
                      )}
                    </div>

                    {waiting && step('① ', 'Collect from pons',
                      <>{fmtEth(s.ponsOwed, 6)} ETH of creator fees are waiting · anyone may collect</>,
                      isConnected ? (
                        <>
                          {iBack && payout && (
                            <button onClick={() => collect(payout)} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-[10px]">
                              Collect &amp; claim as {payout.symbol} · 2 signatures
                            </button>
                          )}
                          <button
                            onClick={() => collect()}
                            disabled={isPending}
                            className={iBack && payout
                              ? 'px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors'
                              : 'btn-primary !px-3 !py-1.5 !text-[10px]'}
                          >
                            {iBack && payout ? 'Just collect' : `Collect ${fmtEth(s.ponsOwed, 5)} ETH`}
                          </button>
                        </>
                      ) : <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">connect to collect</span>,
                      'text-[var(--accent)]')}

                    {iBack && (
                      <div className={waiting ? 'border-t border-[var(--border)]' : ''}>
                        {step(waiting ? '② ' : '', 'Your share',
                          feesOwed > 0n
                            ? <>{fmtEth(feesOwed, 6)} ETH ready to claim{payout ? <> — as {payout.symbol}, ETH, or another stock</> : null}</>
                            : waiting
                              ? <>≈ {fmtEth(s.projectedShare, 6)} ETH after collect{payout && s.projectedShares ? <> ≈ <span className="text-[var(--accent)]">~{fmtShares(s.projectedShares, payout.decimals)} {payout.symbol}</span></> : null}</>
                              : <>no fees yet — every buy and sell pays this token&apos;s creator tax to its backers</>,
                          feesOwed > 0n ? (
                            canRoute ? (
                              <div className="w-full sm:w-auto sm:min-w-[22rem]">
                                <ClaimAsPicker
                                  owed={feesOwed}
                                  account={me}
                                  busy={isPending}
                                  preferred={payout?.address}
                                  onClaimEth={() => { void startAction('claimFees'); writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBacker', args: [ZERO_ADDR], chainId: robinhoodChain.id }); }}
                                  onClaimAs={(a: EquityAsset, minOut: bigint) => { void startAction('claimFeesAs', { asset: a }); writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBackerAs', args: [poolKeyFor(a), minOut], chainId: robinhoodChain.id }); }}
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => { void startAction('claimFees'); writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBacker', args: [s.isV4 ? ZERO_ADDR : RHC_WETH], chainId: robinhoodChain.id }); }}
                                disabled={isPending}
                                className="btn-primary !px-3 !py-1.5 !text-[10px]"
                              >
                                Claim {fmtEth(feesOwed, 6)} {s.isV4 ? 'ETH' : 'WETH'}
                              </button>
                            )
                          ) : !waiting && !s.isV4 ? (
                            <button onClick={() => collect()} disabled={isPending} className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                              Collect from pons
                            </button>
                          ) : null)}
                      </div>
                    )}

                    {!iBack && !waiting && (
                      <div className="px-3 py-3 text-xs font-mono text-[var(--muted)]">
                        No fees waiting. Every buy and sell pays this token&apos;s creator tax to the wallets that backed the raise.
                      </div>
                    )}
                  </div>
                );
              })()}
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
          {lastReceipt && !isPending && !txHash && (
            <p className="mt-4 text-xs font-mono text-[var(--success)] border border-[var(--success)]/40 bg-[var(--success)]/5 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>✓ {lastReceipt.text}</span>
              <a href={`https://robinhoodchain.blockscout.com/tx/${lastReceipt.hash}`} target="_blank" rel="noopener noreferrer"
                className="text-[10px] uppercase tracking-widest text-[var(--accent)] hover:text-[var(--accent-hover)]">
                tx ↗
              </a>
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
