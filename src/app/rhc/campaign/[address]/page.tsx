'use client';

// Campaign detail + lifecycle actions, in the house style (CSS vars,
// bordered card shells, "// LABEL" section headers, btn-primary CTAs).
// Every action is the user's own transaction against an ownerless
// contract — the site is a convenience view, never a custodian.
import { use, useEffect, useState, useCallback } from 'react';
import { useAccount, useWalletClient, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useBalance } from 'wagmi';
import { parseEther, formatEther, isAddress } from 'viem';
import {
  rhcPublicClient, campaignAbi, campaignV3Abi, campaignV4Abi, splitterAbi, curveAbi, erc20Abi, fmtEth, explorerUrl, lockMultiplier,
  RHC_WETH, robinhoodChain, QUOTE_ASSETS,
  isTestCampaign, shortAddr } from '@/lib/rhc';
import { RhcHeader, StatusPill, Modal, TestTag } from '../../components';
import { MetadataCard } from '../../MetadataCard';
import { CurveStats } from '../../CurveStats';
import { ClaimAsPicker } from '../../ClaimAsPicker';
import { EQUITY_ROUTER_LIVE, EQUITY_ASSETS, poolKeyFor, fmtShares, quoteEquityOut, minOutFrom, type EquityAsset } from '@/lib/rhcEquity';
import { WpPanel } from '../../walletproof';
import { BackerRoster } from '../../BackerRoster';
import { CampaignChat } from '../../CampaignChat';
import { CreatorLaunches } from '../../CreatorLaunches';
import { CampaignIdentityBar } from '../../CampaignIdentityBar';
import { BannerManager, SoftMetaEditor, useCampaignMedia } from '../../CampaignBanner';
import { BotLegsPanel } from '../../BotLegsPanel';
import { MobileStickyCta } from '../../MobileStickyCta';
import { OnChainMetaEditor } from '../../OnChainMetaEditor';
import { DashboardCard } from '@/components/meme/DashboardCard';
import { FlywheelPanel } from '../../FlywheelPanel';

interface State {
  meta: { name: string; symbol: string; description: string; logo: string; socials?: { twitter: string; telegram: string; discord: string; website: string; farcaster: string } };
  creator: `0x${string}`;
  goal: bigint; minDeposit: bigint; maxDeposit: bigint; maxBackers: bigint;
  deadline: bigint; totalRaised: bigint; backerCount: bigint;
  launched: boolean; cancelled: boolean; refundable: boolean;
  token: `0x${string}`; feeSplitter: `0x${string}`;
  tokensAtLaunch: bigint; totalRaisedAtLaunch: bigint;
  myContribution: bigint; myTokensClaimed: boolean;
  myFeeEntitlement: bigint; myFeesClaimed: bigint;
  myTokenBalance: bigint; // live wallet balance, Phantom won't show it, we do
  isV4: boolean; // pons V2 campaign, native-ETH fees, pokeHarvest crank
  curve: `0x${string}` | null;
  curveGraduated: boolean;
  myCurveAllowance: bigint;
  ponsOwed: bigint; // creator fees sitting in pons' escrow, owed to this splitter, not yet collected
  backerBps: number; // splitter's backer share (9000 = 90%), for projecting what a collect yields you
  projectedShare: bigint; // YOUR cut of ponsOwed once collected, shown so 'nothing to claim' can never be the read
  projectedShares: bigint | null; // that cut quoted in the creator's payout asset, if any
  myEth: bigint; // signer's ETH: an empty wallet must be told BEFORE the wallet prompt, not by a red banner inside it
  gasPrice: bigint;
  v7: V7 | null; // null for v1–v6 campaigns; this page serves every generation
  v8: { myLockUntil: number; myLockDays: number; maxLockDays: number } | null; // pre-launch lock (CampaignV4)
  creatorTaxBps: number; // pons V2 tax dial, 0 on pre-v4 campaigns
  splitterV4: boolean; // FeeSplitterV4: hold-weighted fees
  myHeldBps: number;   // 10000 = fully held (only meaningful when splitterV4)
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
  const { address: me, isConnected, chainId: walletChain } = useAccount();
  // The create page has always guarded this; the campaign page never did.
  // Every write here pins chainId, so a wallet sitting on another network
  // fails inside the wallet with a generic "error signing" and the backer
  // has no idea why (2026-09-25, a backer on Phantom still set to Ethereum).
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongChain = isConnected && walletChain !== undefined && walletChain !== robinhoodChain.id;
  // A seat costs exactly minDeposit, so a wallet funded with exactly that
  // cannot pay gas and the wallet reports it as a generic signing failure
  // with no number in it (a backer, 2026-09-25). Check before they sign.
  const { data: myBal } = useBalance({ address: me, chainId: robinhoodChain.id, query: { enabled: !!me } });
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState('0.1');
  const [buyAmt, setBuyAmt] = useState('0.005');
  const [sellAmt, setSellAmt] = useState('');
  const { writeContract, data: txHash, isPending, error: writeErr, reset } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const [watchState, setWatchState] = useState<'idle' | 'asking' | 'ok' | 'nope'>('idle');
  const [bannerKey, setBannerKey] = useState('');
  // Pre-launch lock choice (v8 campaigns): days, 0 = no lock.
  const [lockDays, setLockDays] = useState(0);
  // A lock is irreversible: the deposit waits behind one explicit confirm
  // that repeats the date in words (punch list: fat-finger 2-year lock).
  const [lockConfirm, setLockConfirm] = useState<bigint | null>(null); // units awaiting confirm
  // Creator tools open in modals — a click away, never sprawled on the page.
  const [tool, setTool] = useState<null | 'meta' | 'banner' | 'cancel'>(null);
  const media = useCampaignMedia(addr, bannerKey);
  const banner = media.banner_url;
  const { isSuccess: txConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  // ── action receipts (punch list #5) ─────────────────────────────────
  // A tx that confirms used to produce nothing but a reload. Snapshot what
  // the wallet held when the action was sent; when it confirms, say what
  // actually changed — "Sold 1,000,000 $X for 0.0041 ETH" — with the hash.
  type ActionKind = 'buy' | 'sell' | 'approve' | 'claimTokens' | 'claimFees' | 'claimFeesAs' | 'collect' | 'other';
  interface PendingAction { kind: ActionKind; amount?: bigint; asset?: EquityAsset; tokBefore: bigint; ethBefore: bigint; assetBefore?: bigint; label?: string; then?: { claimAs?: EquityAsset; claimEth?: boolean } }
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ text: string; hash: `0x${string}` } | null>(null);
  const balanceOfAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
  const startAction = async (kind: ActionKind, opts: { amount?: bigint; asset?: EquityAsset; label?: string; then?: { claimAs?: EquityAsset; claimEth?: boolean } } = {}) => {
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
      const creatorTaxBps = isV4 ? Number(await rhcPublicClient.readContract({ ...c, functionName: 'creatorTaxBps' }).catch(() => 0)) : 0;
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
      const [myEth, gasPrice] = await Promise.all([me ? rhcPublicClient.getBalance({ address: me }).catch(() => 0n) : Promise.resolve(0n), rhcPublicClient.getGasPrice().catch(() => 100_000_000n)]);
      const backerBps = Number(await rhcPublicClient.readContract({ address: feeSplitter, abi: splitterAbi, functionName: 'backerBps' }).catch(() => 9000));
      let projectedShare = ponsOwed > 0n && totalRaisedAtLaunch > 0n
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
      // v8 splitter probe: the fee stream follows the tokens. backerOwed is
      // what a claim pays NOW (banked + unjudged × hold); entitlement − claimed
      // would show a seller money they cannot claim. Fold it into the same
      // two fields so every "feesOwed" below stays correct.
      let splitterV4 = false, myHeldBps = 10_000;
      try {
        await rhcPublicClient.readContract({ address: feeSplitter, abi: splitterAbi, functionName: 'forfeitTo' });
        splitterV4 = true;
        if (launched && me) {
          const [owed, held] = await rhcPublicClient.multicall({
            contracts: [
              { address: feeSplitter, abi: splitterAbi, functionName: 'backerOwed', args: [me, feeAsset] },
              { address: feeSplitter, abi: splitterAbi, functionName: 'heldBps', args: [me] },
            ],
            allowFailure: false,
          }) as unknown as [bigint, number];
          myFeeEntitlement = myFeesClaimed + owed;
          myHeldBps = Number(held);
        }
      } catch { /* v1–v7 splitter */ }
      if (splitterV4) projectedShare = (projectedShare * BigInt(myHeldBps)) / 10_000n; // what a collect would actually yield you at your hold
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
      // v8 probe: MAX_LOCK_DAYS() only exists on CampaignV4.
      let v8: State['v8'] = null;
      try {
        const c4 = { address: addr, abi: campaignV4Abi } as const;
        const [maxLockDays, myLockUntil, myLockDays] = await rhcPublicClient.multicall({
          contracts: [{ ...c4, functionName: 'MAX_LOCK_DAYS' }, { ...c4, functionName: 'lockUntil', args: [who] }, { ...c4, functionName: 'lockDays', args: [who] }],
          allowFailure: false,
        }) as unknown as [number, bigint, number];
        v8 = { maxLockDays: Number(maxLockDays), myLockUntil: Number(myLockUntil), myLockDays: Number(myLockDays) };
      } catch { /* v1–v7 campaign */ }

      setS({ meta, creator, goal, minDeposit, maxDeposit, maxBackers, deadline, totalRaised,
        backerCount, launched, cancelled, refundable, token, feeSplitter, tokensAtLaunch,
        totalRaisedAtLaunch, myContribution, myTokensClaimed, myFeeEntitlement, myFeesClaimed, myTokenBalance, isV4,
        curve, curveGraduated, myCurveAllowance, ponsOwed, backerBps, projectedShare, projectedShares: null, myEth, gasPrice, v7, v8, creatorTaxBps, splitterV4, myHeldBps });
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
        else if (a.kind === 'approve') text = `Approved the curve to take $${sym} you sell: now hit Sell`;
        else if (a.kind === 'claimTokens') text = `Claimed ${fmtTok(tokDelta)} $${sym} into your wallet`;
        else if (a.kind === 'claimFees') text = s.splitterV4 && ethNet <= 0n ? 'Nothing paid: you sold your allocation, so that share went to the PROOF burn' : `Claimed ${fmtEth(ethNet, 6)} ETH of fees`;
        else if (a.kind === 'claimFeesAs' && a.asset) text = `Claimed fees as ${a.asset.symbol}: ${fmtShares((assetAfter ?? 0n) - (a.assetBefore ?? 0n), a.asset.decimals)} ${a.asset.symbol} landed in your wallet`;
        else if (a.kind === 'collect') text = 'Collected accrued fees from pons into the splitter. Your share is updated below';
        else if (a.label) text = a.label;
        setLastReceipt({ text: `${text} · gas ${fmtEth(gas, 7)} ETH`, hash: receipt.transactionHash });
      }
      setPendingAction(null);
      reset();
      // One-click "collect & claim": once the collect has landed and the
      // page has reloaded, quote the claimer's now-real share and prompt
      // the second signature. If they reject it, step ② stays on screen.
      if (a?.kind === 'collect' && a.then && me && s) {
        const owed = s.splitterV4
          ? await (rhcPublicClient.readContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'backerOwed', args: [me, ZERO_ADDR] }).catch(() => 0n) as Promise<bigint>)
          : await (async () => {
              const [ent, claimed] = await Promise.all([
                rhcPublicClient.readContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'backerEntitlement', args: [me, ZERO_ADDR] }).catch(() => 0n) as Promise<bigint>,
                rhcPublicClient.readContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'backerClaimed', args: [me, ZERO_ADDR] }).catch(() => 0n) as Promise<bigint>,
              ]);
              return ent > claimed ? ent - claimed : 0n;
            })();
        if (owed > 0n && a.then.claimEth) {
          setTimeout(() => {
            void startAction('claimFees');
            writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBacker', args: [ZERO_ADDR], chainId: robinhoodChain.id });
          }, 150);
        } else if (owed > 0n && a.then.claimAs) {
          const asset = a.then.claimAs;
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
    const labels: Record<string, string> = { withdraw: 'Withdrawn: your seat is free and your deposit is back', launch: 'Launched: token created on pons and the pooled buy executed', refund: 'Refunded: your deposit is back', cancel: 'Campaign cancelled: refunds open' };
    void startAction(kind, { label: labels[functionName] });
    writeContract({ address: addr, abi: campaignAbi, functionName, chainId: robinhoodChain.id });
  };

  const shell = (children: React.ReactNode) => (
    <div className="max-w-6xl mx-auto pb-8"><RhcHeader />{children}</div>
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
  // Native-quote seat rounds only: an ERC20-quoted raise pays the seat in
  // the token, so ETH only has to cover gas and this check does not apply.
  const shortOnGas =
    isConnected && !isErc20Quote && s.myContribution === 0n && s.minDeposit > 0n && !!myBal &&
    myBal.value < s.minDeposit + parseEther('0.0005');
  // ── v8 lock ─────────────────────────────────────────────────────────
  const v8 = s.v8;
  // Locks are DAYS FROM LAUNCH (a year means a year of the token existing).
  const iAmLocked = !!v8 && v8.myLockDays > 0 && (v8.myLockUntil === 0 || v8.myLockUntil > Math.floor(Date.now() / 1000));
  const myLockDate = v8 && v8.myLockUntil > 0
    ? new Date(v8.myLockUntil * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : v8 ? `${v8.myLockDays} days after launch` : '';
  const lockMult = lockMultiplier(lockDays);
  /// One deposit call for every generation: locked v8 deposits go through
  /// depositLocked / depositTokenLocked, everything else is unchanged.
  const depositCall = (units: bigint, confirmed = false) => {
    if (v8 && lockDays > 0 && !confirmed) { setLockConfirm(units); return; }
    setLockConfirm(null);
    if (v8 && lockDays > 0) {
      return isErc20Quote
        ? writeContract({ address: addr, abi: campaignV4Abi, functionName: 'depositTokenLocked', args: [units, lockDays], chainId: robinhoodChain.id })
        : writeContract({ address: addr, abi: campaignV4Abi, functionName: 'depositLocked', args: [lockDays], value: units, chainId: robinhoodChain.id });
    }
    return isErc20Quote
      ? writeContract({ address: addr, abi: campaignV3Abi, functionName: 'depositToken', args: [units], chainId: robinhoodChain.id })
      : writeContract({ address: addr, abi: campaignAbi, functionName: 'deposit', value: units, chainId: robinhoodChain.id });
  };
  const lockPicker = v8 && s.myContribution === 0n ? (
    <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
      <span title="Your tokens stay in this campaign contract for this long AFTER launch. Visible to every backer before launch. Nobody can shorten it, there is no admin. Locking pays: 6 months earns fees at ×1.25, a year or more at ×1.5, out of the same pool sellers forfeit.">🔒 lock my tokens</span>
      <select value={lockDays} onChange={(e) => setLockDays(Number(e.target.value))}
        className="bg-[var(--background)] border border-[var(--border)] px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest focus:border-[var(--accent)] focus:outline-none">
        <option value={0}>no lock · ×1 fees</option>
        <option value={90}>3 months · ×1 fees</option>
        <option value={180}>6 months · ×1.25 fees</option>
        <option value={365}>1 year · ×1.5 fees</option>
        <option value={730}>2 years · ×1.5 fees</option>
      </select>
    </label>
  ) : null;

  return shell(
    <>
      {/* ── banner + identity — the SOL page's shape: wide hero if the
          creator set one, then one slim strip so the dashboard sits high. */}
      {banner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" className="w-full block border border-[var(--border)] mb-3" style={{ aspectRatio: '3 / 1', objectFit: 'cover' }} />
      )}
      {wrongChain && (
        <div className="mb-3 border border-[var(--warning,#c9a227)] bg-[var(--warning,#c9a227)]/10 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning,#c9a227)]">Wrong network</div>
            <p className="text-xs font-mono text-[var(--muted)] mt-0.5">
              Your wallet is not on Robinhood Chain. Backing, claiming and every other action here
              will fail to sign until it is.
            </p>
          </div>
          <button
            onClick={() => switchChain({ chainId: robinhoodChain.id })}
            disabled={switching}
            className="btn-primary !px-3 !py-1.5 !text-[10px] whitespace-nowrap"
          >
            {switching ? 'Switching…' : 'Switch to Robinhood Chain'}
          </button>
        </div>
      )}
      <CampaignIdentityBar
        logo={s.meta.logo} name={s.meta.name} symbol={s.meta.symbol} creator={s.creator}
        token={s.launched ? s.token : undefined}
        socials={{
          twitter: media.twitter ?? s.meta.socials?.twitter, telegram: media.telegram ?? s.meta.socials?.telegram,
          discord: media.discord ?? s.meta.socials?.discord, website: media.website ?? s.meta.socials?.website, farcaster: s.meta.socials?.farcaster,
          github: media.github ?? undefined,
        }}
        status={<>{isTestCampaign(addr) && <TestTag />}<StatusPill launched={s.launched} cancelled={s.cancelled} refundable={s.refundable}
          deadline={s.deadline} totalRaised={s.totalRaised} goal={s.goal} /></>}
        metrics={[
          { k: 'Backers', v: s.backerCount.toString() + (s.maxBackers > 0n ? ` / ${s.maxBackers}` : '') },
          { k: s.launched ? 'Raised' : 'Raised / goal', v: s.launched ? `${q(s.totalRaisedAtLaunch)} ${qSym}` : `${q(s.totalRaised)} / ${q(s.goal)} ${qSym}` },
          ...(s.launched ? [] : [{ k: 'Ends', v: new Date(Number(s.deadline) * 1000).toLocaleDateString(), accent: true }]),
        ]}
      />

      {(media.description || s.meta.description) && (
        <DashboardCard label="DESCRIPTION" className="mt-3">
          <p className="text-sm font-mono text-[var(--foreground)]/85 leading-relaxed whitespace-pre-wrap">{media.description || s.meta.description}</p>
        </DashboardCard>
      )}

      {/* ── RAISE — the action panel, full width, only while there is
          something to do (back, withdraw, launch, refund, cancel). */}
      {!s.launched && (
        <DashboardCard label={s.cancelled ? 'CANCELLED' : s.refundable ? 'REFUNDS OPEN' : 'RAISE'} meta={`${Math.min(100, pct)}% funded · goal ${q(s.goal)} ${qSym}`} className="mt-3 scroll-mt-20" >
        <div id="raise-card" />
          {/* Slot grid — the SOL detail treatment: filled blocks for
              backers in, outlined for open slots. Open raises (maxBackers
              0) show the bar alone. */}
          {!s.launched && s.maxBackers > 0n && s.maxBackers <= 24n && (
            <div className="mb-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  Slots{v7 && v7.reservedSeats > 0 ? ', team round' : ''}
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
                      title={reserved ? (taken ? 'Team seat: taken' : 'Team seat: reserved for the allowlist') : (taken ? 'Public seat: taken' : 'Public seat: open')}
                      className={`h-4 ${
                        taken
                          ? reserved ? 'bg-[var(--accent-gold)]' : 'bg-[var(--accent)]'
                          : reserved
                            ? 'border border-dashed border-[var(--accent-gold)]/70'
                            : 'border border-[var(--accent)]'
                      }`}
                    />
                  );
                })}
              </div>
              {v7 && v7.reservedSeats > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2.5 bg-[var(--accent)]" />public {Number(v7.publicSeatsUsed)}/{publicSeats}{publicSeatsLeft <= 0 ? ' · full' : ''}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2.5 bg-[var(--accent-gold)]" />team {Number(v7.reservedSeatsUsed)}/{v7.reservedSeats}</span>
                  {v7.iAmAllowlisted && <span className="text-[var(--accent-gold)]">you are on the team allowlist</span>}
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
              [`${q(s.totalRaised)} / ${q(s.goal)} ${qSym}`, 'raised / goal to launch'],
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
              {shortOnGas && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--error)] border border-[var(--error)]/40 bg-[var(--error)]/5 px-3 py-2 leading-relaxed">
                  {'> '}Not enough ETH in the connected wallet. A seat costs {q(s.minDeposit)} {qSym}
                  plus gas, and {shortAddr(me)} holds{' '}
                  {myBal ? Number(formatEther(myBal.value)).toFixed(4) : '0'} ETH.
                  {' '}If your funds are in a different wallet, disconnect and pick that one.
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
                    onClick={() => depositCall(s.minDeposit)}
                    disabled={isPending || s.myContribution > 0n || gateBlocked || publicFull || shortOnGas}
                    className="btn-primary"
                  >
                    {s.myContribution > 0n
                      ? `Seat Taken ✓${v7?.mySeatBucket === 2 ? ' (reserved)' : ''}${iAmLocked ? ` · locked → ${myLockDate}` : ''}`
                      : `Take a${takesReserved ? ' Reserved' : ''} Seat: ${q(s.minDeposit)} ${qSym}${lockDays > 0 ? ' · locked' : ''}`}
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
                      Approve {qSym} · step 1 of 2
                    </button>
                  ) : (
                    <button
                      onClick={() => depositCall(wantAmount)}
                      disabled={isPending || gateBlocked || publicFull}
                      className="btn-primary"
                    >
                      Back This Launch{lockDays > 0 ? ' · locked' : ''}
                    </button>
                  )}
                  {isErc20Quote && v7 && (
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      you hold {q(v7.myQuoteBalance)} {qSym}
                    </span>
                  )}
                </>
              )}
              {lockPicker}
              </div>
              {lockConfirm !== null && v8 && (
                <div className="border border-[var(--accent-gold)]/60 bg-[var(--accent-gold)]/5 px-3 py-3 space-y-2">
                  <p className="text-xs font-mono text-[var(--foreground)]">
                    🔒 You are locking your ${s.meta.symbol} for <span className="text-[var(--accent-gold)]">{lockDays >= 365 ? `${lockDays / 365} year${lockDays > 365 ? 's' : ''}` : `${lockDays} days`} after launch</span>{lockMult > 1 ? <> and your fee share is weighted <span className="text-[var(--accent-gold)]">×{lockMult}</span></> : null}.
                    Nobody can shorten it, including us. Withdrawing before launch clears it.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => depositCall(lockConfirm, true)} disabled={isPending} className="btn-primary !px-3 !py-1.5 !text-[10px]">
                      Lock {lockDays >= 365 ? `${lockDays / 365}y` : `${lockDays}d`} after launch and back {q(lockConfirm)} {qSym}
                    </button>
                    <button onClick={() => setLockConfirm(null)} className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
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
              {iAmCreator ? 'Launch Now' : 'Launch (deadline passed: anyone may)'}
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
              until someone calls for it, with no button, a creator sees
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
              onClick={() => setTool('cancel')}
              disabled={isPending}
              className="mt-4 ml-3 px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted-soft)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
            >
              Cancel Campaign
            </button>
          )}

        </DashboardCard>
      )}

      {/* tx status — one strip, whatever card the action came from */}
      {((isPending || txHash) && !txConfirmed) || writeErr || (lastReceipt && !isPending && !txHash) ? (
        <div className="mt-3">
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
      ) : null}

      {/* ── DASHBOARD GRID — the SOL layout: wide column for the roster,
          narrow rail for trade / rewards / chat. */}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 space-y-3">
          <BackerRoster
            address={addr} launched={s.launched} me={me} symbol={s.meta.symbol}
            quoteSymbol={qSym} quoteDecimals={qDec} isErc20Quote={isErc20Quote}
            refreshKey={lastReceipt?.hash ?? ''}
          />
          <MetadataCard
            meta={s.meta} media={media}
            terms={{
              tax: s.creatorTaxBps,
              payoutAsset: v7?.payoutAsset ?? ZERO_ADDR, quote: qSym, launched: s.launched,
              seats: Number(s.maxBackers), reserved: v7?.reservedSeats ?? 0,
              seatPrice: q(s.minDeposit), minDeposit: q(s.minDeposit), maxDeposit: s.maxDeposit === 0n ? '0' : q(s.maxDeposit),
              deadline: s.deadline, legs: `backers ${(s.backerBps / 100).toFixed(0)}% · fixed legs + bots ${(100 - s.backerBps / 100).toFixed(0)}% (see BOTS)`,
            }}
          />
          <BotLegsPanel splitter={s.feeSplitter} feeAsset={s.isV4 ? ZERO_ADDR : RHC_WETH} symbol={s.meta.symbol} launched={s.launched} refreshKey={lastReceipt?.hash ?? ''} creator={s.creator} />
          <CreatorLaunches creator={s.creator} exclude={addr} />
        </div>
        <div className="space-y-3">
          {s.launched && (
            <DashboardCard label="TRADE" meta={s.curveGraduated ? 'GRADUATED' : 'LIVE'}>
              <div className="space-y-3">
              {s.launched && s.curve && (
                <CurveStats curve={s.curve} token={s.token} symbol={s.meta.symbol} taxBps={s.creatorTaxBps ?? 0} graduated={!!s.curveGraduated} />
              )}

              <div>
                <span className={label}>Token</span>
                <a href={explorerUrl(s.token)} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] break-all">
                  {s.token}
                </a>
              </div>
              {s.myTokensClaimed && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
                    ✓ In your wallet: {(Number(s.myTokenBalance) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${s.meta.symbol}
                  </p>
                  {/* EIP-747: ask the wallet to TRACK the token. New tokens
                      on a young chain are invisible in wallet UIs until
                      told: the #1 support question on the SOL side too. */}
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
                    {watchState === 'asking' ? 'Check your wallet…' : watchState === 'ok' ? '✓ Added to wallet' : watchState === 'nope' ? 'Wallet refused: use Explorer →' : '+ Add Token to Wallet'}
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
                <div>
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">your wallet signs · the curve fills · ETH from sells lands instantly</p>
                  <div className="grid grid-cols-1 gap-3">
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
                  <p className="pt-2 text-[9px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
                    Sells pay out to your wallet instantly.
                  </p>
                </div>
              )}
              {s.launched && s.curve && s.curveGraduated && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  {'> '}Graduated: trades on the locked Uniswap v4 pool via pons.
                </p>
              )}

                <WpPanel token={s.token} />
              </div>
            </DashboardCard>
          )}
          {s.launched && (
            <DashboardCard label={s.myContribution > 0n ? 'YOUR REWARDS' : 'FEES'} className="scroll-mt-20">
              <div id="rewards-card" />
              <div className="space-y-3">
              {s.myContribution > 0n && !s.myTokensClaimed && (
                iAmLocked ? (
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] border border-[var(--accent-gold)]/40 bg-[var(--accent-gold)]/5 px-3 py-2">
                    🔒 Your {(Number(myTokenShare) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${s.meta.symbol} are locked in this contract until {myLockDate}. They earn your fee share meanwhile{v8 && lockMultiplier(v8.myLockDays) > 1 ? `, weighted ×${lockMultiplier(v8.myLockDays)}` : ''}.
                  </p>
                ) : (
                  <button onClick={() => act('claimTokens')} disabled={isPending} className="btn-primary">
                    Claim {(Number(myTokenShare) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${s.meta.symbol}
                  </button>
                )
              )}
              {isConnected && s.myEth < 300_000n * s.gasPrice && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning,#c9a227)] border border-[var(--warning,#c9a227)]/40 bg-[var(--warning,#c9a227)]/5 px-3 py-2">
                  {'> '}This wallet holds {fmtEth(s.myEth, 7)} ETH: not enough for gas. Add about 0.0005 ETH before trading or claiming, or the wallet will refuse with a simulation error.
                </p>
              )}
              {/* ── FEES. A backer needs ONE sentence — what they've earned —
                  and ONE button. Collecting from pons is plumbing and happens
                  inside that button. The total waiting and "anyone may
                  collect" only matter to someone who ISN'T a backer. ── */}
              {(() => {
                const payout = v7 && v7.payoutAsset !== ZERO_ADDR && v7.splitterHasRouter && EQUITY_ROUTER_LIVE && isErc20Quote === false
                  ? EQUITY_ASSETS.find((a) => a.address.toLowerCase() === v7.payoutAsset.toLowerCase()) : undefined;
                const canRoute = !!v7 && v7.splitterHasRouter && EQUITY_ROUTER_LIVE && isErc20Quote === false;
                const iBack = s.myContribution > 0n;
                const waiting = s.ponsOwed > 0n;
                const earned = feesOwed + s.projectedShare; // ready + still at pons
                // Two signatures at ~200k + ~400k gas; demand a little margin.
                const gasNeeded = 700_000n * s.gasPrice;
                const lowGas = isConnected && s.myEth < gasNeeded;
                const shortfall = lowGas ? fmtEth(gasNeeded > s.myEth ? gasNeeded - s.myEth : 0n, 5) : '';
                const collect = (then?: { claimAs?: EquityAsset; claimEth?: boolean }) => {
                  void startAction('collect', { then });
                  writeContract({ address: addr, abi: campaignAbi, functionName: s.isV4 ? 'pokeHarvest' : 'pokeCollect', chainId: robinhoodChain.id });
                };
                const gasNote = lowGas && (
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning,#c9a227)] border border-[var(--warning,#c9a227)]/40 bg-[var(--warning,#c9a227)]/5 px-3 py-2 w-full">
                    {'> '}This wallet holds {fmtEth(s.myEth, 7)} ETH: not enough for gas. Add about {shortfall || '0.0005'} ETH (0.0005 is plenty) before claiming.
                  </p>
                );
                return (
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">{(s.backerBps / 100).toFixed(0)}% of every trade&apos;s creator tax goes to backers{s.splitterV4 ? ' · the fee stream follows the tokens' : ''}</p>
                    {s.splitterV4 && iBack && (
                      <p className={`text-[10px] font-mono uppercase tracking-widest mb-2 ${s.myHeldBps >= 9_000 ? 'text-[var(--success)]' : s.myHeldBps > 0 ? 'text-[var(--warning,#c9a227)]' : 'text-[var(--error)]'}`}>
                        {'> '}You hold {(s.myHeldBps / 100).toFixed(0)}% of your allocation{s.myHeldBps < 10_000 ? `, you earn ${(s.myHeldBps / 100).toFixed(0)}% of your share; the rest buys and burns $PLAUNCH` : ', full share'}
                      </p>
                    )}
                    <div className="space-y-3">
                      {iBack ? (
                        earned > 0n ? (
                          <>
                            <div className="font-mono">
                              <span className="text-[10px] uppercase tracking-widest text-[var(--muted)]">You&apos;ve earned </span>
                              <span className="text-lg text-[var(--foreground)]">{fmtEth(earned, 6)} ETH</span>
                            </div>
                            {gasNote}
                            {feesOwed > 0n && !waiting ? (
                              canRoute ? (
                                <div className="sm:min-w-[22rem]">
                                  <ClaimAsPicker
                                    owed={feesOwed}
                                    account={me}
                                    busy={isPending || lowGas}
                                    preferred={payout?.address}
                                    allowOtherAssets={false}
                                    onClaimEth={() => { void startAction('claimFees'); writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBacker', args: [ZERO_ADDR], chainId: robinhoodChain.id }); }}
                                    onClaimAs={(a: EquityAsset, minOut: bigint) => { void startAction('claimFeesAs', { asset: a }); writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBackerAs', args: [poolKeyFor(a), minOut], chainId: robinhoodChain.id }); }}
                                  />
                                </div>
                              ) : (
                                <button onClick={() => { void startAction('claimFees'); writeContract({ address: s.feeSplitter, abi: splitterAbi, functionName: 'claimBacker', args: [s.isV4 ? ZERO_ADDR : RHC_WETH], chainId: robinhoodChain.id }); }} disabled={isPending || lowGas} className="btn-primary !px-3 !py-1.5 !text-[10px]">
                                  Claim {fmtEth(feesOwed, 6)} {s.isV4 ? 'ETH' : 'WETH'}
                                </button>
                              )
                            ) : (
                              // Part (or all) of it is still at pons: one button does
                              // collect + claim. Two wallet prompts; say so.
                              <div className="flex flex-wrap items-center gap-2">
                                {payout && canRoute ? (
                                  <>
                                    <button onClick={() => collect({ claimAs: payout })} disabled={isPending || lowGas} className="btn-primary !px-3 !py-2 !text-[10px]"
                                      title={`Paid as ${payout.symbol}, the creator's pick. Two wallet prompts: the first pulls your fees from pons, the second pays you.`}>
                                      Take {payout.symbol}
                                    </button>
                                    <button onClick={() => collect({ claimEth: true })} disabled={isPending || lowGas} className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40 transition-colors"
                                      title="Take your fee share as plain ETH. Two wallet prompts: the first pulls your fees from pons, the second pays you.">
                                      Take ETH
                                    </button>
                                  </>
                                ) : (
                                  <button onClick={() => collect({ claimEth: true })} disabled={isPending || lowGas} className="btn-primary !px-3 !py-2 !text-[10px]"
                                    title="Two wallet prompts: the first pulls your fees from pons, the second pays you.">
                                    Take {fmtEth(earned, 6)} ETH
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs font-mono text-[var(--muted)]">No fees yet. Every trade pays backers.</p>
                        )
                      ) : waiting ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs font-mono text-[var(--muted)]">{fmtEth(s.ponsOwed, 6)} ETH of creator fees are waiting at pons for this campaign&apos;s backers · anyone may collect</p>
                          {isConnected
                            ? <button onClick={() => collect()} disabled={isPending || lowGas} className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">Collect for them</button>
                            : <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">connect to collect</span>}
                        </div>
                      ) : (
                        <p className="text-xs font-mono text-[var(--muted)]">No fees waiting. Every buy and sell pays this token&apos;s creator tax to the wallets that backed the raise.</p>
                      )}
                    </div>
                  </div>
                );
              })()}
              </div>
            </DashboardCard>
          )}
          <CampaignChat campaign={addr} />
          {s.splitterV4 && <FlywheelPanel compact />}
        </div>
      </div>

      {/* One action in reach on a phone. */}
      <MobileStickyCta
        targetId={s.launched ? 'rewards-card' : 'raise-card'}
        tone={s.launched ? 'gold' : 'primary'}
        label={!isConnected ? null
          : !s.launched && !s.cancelled && !s.refundable && now < s.deadline ? (s.myContribution > 0n ? 'Your seat ↑' : 'Back this launch ↑')
          : s.launched && s.myContribution > 0n && !s.myTokensClaimed && !iAmLocked ? `Claim your $${s.meta.symbol} ↑`
          : s.launched && s.myContribution > 0n && (feesOwed > 0n || s.projectedShare > 0n) ? 'Claim your fees ↑'
          : null}
      />

      {/* Creator controls — full-width row below the grid, like the SOL
          page post-launch. Today: the banner. */}
      {isConnected && iAmCreator && (
        <DashboardCard label="CREATOR CONTROLS" className="mt-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTool('meta')} className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
              [✎] Edit metadata
            </button>
            <button onClick={() => setTool('banner')} className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
              [▭] {banner ? 'Change banner' : 'Add banner'}
            </button>
            {!s.launched && !s.cancelled && (
              <button onClick={() => setTool('cancel')} className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted-soft)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors">
                [✕] Cancel campaign
              </button>
            )}
          </div>
          <p className="mt-2 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
            {v8 && !s.launched ? 'Before launch: name, symbol, logo and links change on-chain (one transaction). ' : 'Name, symbol and logo are what pons minted. '}
            Description, links and banner are yours to edit any time (one signature).
          </p>
        </DashboardCard>
      )}

      <Modal open={tool === 'meta'} onClose={() => setTool(null)} label="EDIT METADATA" wide>
        <div className="space-y-5">
          {v8 && !s.launched && !s.cancelled && (
            <div className="border-b border-[var(--border)] pb-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-2">On-chain · what pons will mint</div>
              <OnChainMetaEditor campaign={addr} onSent={() => { setTool(null); void startAction('other', { label: 'Metadata updated on-chain: what launches is what you see now' }); }}
                current={{ name: s.meta.name, symbol: s.meta.symbol, logo: s.meta.logo, description: s.meta.description,
                  socials: { twitter: s.meta.socials?.twitter ?? '', telegram: s.meta.socials?.telegram ?? '', discord: s.meta.socials?.discord ?? '', website: s.meta.socials?.website ?? '', farcaster: s.meta.socials?.farcaster ?? '' } }} />
            </div>
          )}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] mb-2">Off-chain · shown on this page</div>
            <SoftMetaEditor campaign={addr} current={media} onSaved={() => { setBannerKey(String(Date.now())); setTool(null); }} />
          </div>
        </div>
      </Modal>
      <Modal open={tool === 'banner'} onClose={() => setTool(null)} label="BANNER">
        <BannerManager campaign={addr} current={banner} onChanged={() => { setBannerKey(String(Date.now())); setTool(null); }} />
      </Modal>
      <Modal open={tool === 'cancel'} onClose={() => setTool(null)} label="CANCEL CAMPAIGN">
        <p className="text-xs font-mono text-[var(--foreground)]/85 leading-relaxed">
          Ends the raise for good. Every deposit becomes refundable; the 0.001 ETH creation fee is not.
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => { setTool(null); act('cancel'); }} disabled={isPending} className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--error)] text-[var(--error)] hover:bg-[var(--error)] hover:text-black transition-colors">Yes, cancel it</button>
          <button onClick={() => setTool(null)} className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)]">Keep it</button>
        </div>
      </Modal>

      {/* Contract addresses appear at launch. Before it, nothing on this page
          points at a contract a sniper could watch (founder, 2026-09-24). */}
      {s.launched ? (
        <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] break-all">
          Campaign{' '}
          <a href={explorerUrl(addr)} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--muted)]">{addr}</a>
          {' '}· Splitter{' '}
          <a href={explorerUrl(s.feeSplitter)} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--muted)]">{s.feeSplitter.slice(0, 10)}…</a>
          {' '}· Ownerless contracts: verify everything yourself
        </p>
      ) : (
        <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
          Ownerless contracts · addresses are published the moment the token launches
        </p>
      )}
    </>
  );
}
