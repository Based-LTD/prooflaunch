'use client';

// Create a pooled campaign — the SOL /submit page, twinned: same header
// card, same section skeleton (LAUNCH_PLATFORM / BASICS / SOCIALS /
// RAISE_TERMS / LAUNCH_BOTS), same sticky live-preview rail, same bot
// stack picker UX. Terms become immutable at creation.
import { useState, useEffect, useRef } from 'react';
import { useAccount, useReadContract, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, parseUnits, formatUnits, decodeEventLog, isAddress } from 'viem';
import { useSignMessage } from 'wagmi';
import { uploadBanner, attachBanner, BANNER_MAX_BYTES } from '../CampaignBanner';
import { Modal } from '../components';

// Links are immutable once minted. Normalize at submit: add https:// when
// the scheme is missing, drop stray spaces; leave empties empty.
const normUrl = (v: string) => { const t = v.trim(); if (!t) return ''; return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`; };
import { AlertCircle, Upload, X } from 'lucide-react';
import {
  POOLLAUNCH_FACTORY_V6, V7_LIVE, ACTIVE_FACTORY, FIXED_LEGS_PCT, FIXED_LEGS_NOTE, QUOTE_ASSETS, clearBoardCache,
  AIRDROP_OPERATOR, factoryV4Abi, factoryV5Abi, robinhoodChain, rhcPublicClient,
} from '@/lib/rhc';
import { EQUITY_ASSETS, PRICEY_FEE_BPS } from '@/lib/rhcEquity';
import { grindVanitySalt, predictLegAddresses, SIGNATURE_SUFFIX } from '@/lib/rhcVanity';

// Soft-launch guardrail: contracts allow any goal (oversized raises are
// proven safe — they graduate at birth), but until the external contract
// review completes we cap UI-created campaigns. Raise/remove after P3.
const BETA_GOAL_CAP_ETH = 2;
// The v6 factory's immutable creation fee. The page still reads
// creationFeeFor(you) live (it goes to 0 once the holder waiver arms),
// but this constant is the fallback so a slow RPC read can NEVER make
// us submit with value 0 and revert BadFee at gas estimation.
const CREATION_FEE_WEI = 1_000_000_000_000_000n; // 0.001 ETH
// pons' own launch fee, native ETH. ERC20-quoted raises escrow it in the
// campaign at creation (the pool itself is not ETH), refundable to the
// creator if the raise never launches.
const PONS_LAUNCH_FEE_WEI = 500_000_000_000_000n; // 0.0005 ETH

const inputClass = (hasError?: boolean) =>
  `w-full px-3 py-2.5 bg-[var(--background)] border ${
    hasError ? 'border-[var(--error)]' : 'border-[var(--border)]'
  } focus:border-[var(--accent)] focus:outline-none text-sm font-mono`;
const labelClass =
  'block text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5';

// ── Bot stack — the RHC twin of the SOL launch bots ─────────────────
// burn / feed_lp run as ownerless contracts (trustless — first on RHC);
// vault legs are named wallets; the holder airdrop is a vault leg
// pointed at the platform operator (platform-run, honestly labeled).
type BotKind = 'burn' | 'feed_lp' | 'vault' | 'airdrop' | 'creator';
// A creator fee is already possible today as a VAULT leg pointed at your
// own wallet — which renders as an anonymous treasury address. Making it
// a named leg is a transparency change, not a new capability: backers see
// CREATOR and a percentage instead of a wallet they have to go look up.
const CREATOR_MAX_PCT = 20;
interface BotItem { kind: BotKind; pct: string; addr?: string }

// The full stack on pons V2: the trustless Burn and Pool Feeder run as
// ownerless contracts on the Uniswap-v4 graduated pools (dual-phase —
// they buy on the bonding curve pre-graduation, talk to the PoolManager
// directly after; proven on live-pool forks). First of their kind on
// this chain; globally we say "we believe first" and mean the hedge.
const BOT_ACTIONS: { kind: BotKind; label: string; tag: string; emoji: string; desc: string; disabled?: boolean }[] = [
  { kind: 'burn',    label: 'BURN',           tag: 'Deflationary · Trustless', emoji: '🔥', desc: 'Ownerless contract buys the token with its fee share — on the bonding curve before graduation, directly on the Uniswap-v4 pool after — and sends everything to the dead address. Anyone can crank it; nobody, including us, can stop it.' },
  { kind: 'feed_lp', label: 'POOL FEEDER',    tag: 'Liquidity · Trustless',    emoji: '🌊', desc: 'Ownerless contract mints full-range liquidity on the graduated v4 pool and compounds the position\'s own trading fees. It has NO withdraw function — protocol-owned liquidity locked by construction, not by promise.' },
  { kind: 'vault',   label: 'VAULT',          tag: 'Treasury',                 emoji: '🏦', desc: 'A wallet you name (marketing / DAO / treasury) becomes a fee leg and pulls its share anytime. Address locked at creation — can never be changed.' },
  { kind: 'airdrop', label: 'HOLDER AIRDROP', tag: 'Loyalty · Platform-run',   emoji: '📸', desc: 'ProofLaunch snapshots your token\'s holders and airdrops this leg\'s fees pro-rata Platform-operated and labeled so; 🔥 BURN is the trustless holder reward.' },
  { kind: 'creator', label: 'CREATOR FEE',    tag: `Your wallet · max ${CREATOR_MAX_PCT}%`, emoji: '👤', desc: 'Pay yourself a fixed share of the fee stream, locked at creation and pointed at your connected wallet. It comes straight out of what backers keep, and your campaign page shows it as CREATOR with the percentage, so everyone funding you sees the trade before they do.' },
];
const SINGLE_KINDS = new Set<string>(['burn', 'feed_lp', 'airdrop', 'creator']);
const BOT_EMOJI: Record<BotKind, string> = { burn: '🔥', feed_lp: '🌊', vault: '🏦', airdrop: '📸', creator: '👤' };
const BOT_SHORT: Record<BotKind, string> = { burn: 'BURN', feed_lp: 'POOL FEED', vault: 'VAULT', airdrop: 'AIRDROP', creator: 'CREATOR' };
// One-tap fee presets on each bot card — most creators think in these.
const PCT_PRESETS = ['5', '10', '20', '30'];

// Whole-stack presets. Defaults set the meta: Flywheel is what the board
// should mostly look like; the other two are for creators who already know
// what they want. Only the coin's own burn moves — the platform legs are
// factory policy and the backers get whatever is left.
const STACK_PRESETS: { id: string; label: string; burn: string; blurb: string }[] = [
  { id: 'flywheel', label: 'Flywheel', burn: '10', blurb: '10% buys and burns your own token. Backers keep the rest.' },
  { id: 'backers', label: 'Backer Max', burn: '', blurb: 'No coin burn. Every point not fixed by the factory goes to backers.' },
  { id: 'burn', label: 'Burn Heavy', burn: '30', blurb: '30% buys and burns your own token. Tightest float, smallest backer share.' },
];

export default function CreateCampaignPage() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const onRhc = chainId === robinhoodChain.id;
  const [f, setF] = useState({
    name: '', symbol: '', description: '',
    twitter: '', telegram: '', discord: '', website: '', farcaster: '', github: '',
    goal: '1', min: '0.05', max: '0', slots: '0', days: '3',
  });
  // Token image — uploaded to /api/upload/image at submit (same route as
  // the SOL page); the public URL becomes the on-chain pons logo.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setImageError('Max 2MB'); return; }
    setImageError(null);
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };
  const removeImage = () => {
    setImageFile(null); setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  // Flywheel is the default: a creator who never touches this section gets
  // the 10% coin burn. Backer Max is the off switch; there is no toggle.
  const botsEnabled = true;
  const [stack, setStack] = useState<BotItem[]>([{ kind: 'burn', pct: '10', addr: '' }]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // pons V2 creator tax: 0–10% of every trade, immutable at launch, earned
  // by the FeeSplitter — i.e. by the backers (after the fixed legs).
  // Two raise styles, both riding the same goal-based contract:
  //   open  — ETH goal, unlimited backers, optional per-backer whale cap
  //   seats — N identical seats at a fixed price; goal = seats x price and
  //           min = max = price, so "last seat fills" IS "goal met": the
  //           SOL launch mechanic, enforced by the contract by construction
  const [raiseStyle, setRaiseStyle] = useState<'open' | 'seats'>('open');
  const [seatPrice, setSeatPrice] = useState('0.1');
  // ── v7 options (inert until V7_LIVE) ──
  // The quote asset a raise is denominated in. ETH is native; USDG and
  // the tokenized stocks are pons-approved pair tokens with their own
  // decimals, so every amount below is parsed against THIS, never 18.
  const [quoteIdx, setQuoteIdx] = useState(0);
  // 0 = ETH; otherwise EQUITY_ASSETS[payoutIdx - 1]. A DEFAULT for fee
  // claims — every claimer can override at claim time, so nobody is ever
  // trapped in an asset. It's the line on the poster, not a lock.
  const [payoutIdx, setPayoutIdx] = useState(0);
  const quote = QUOTE_ASSETS[quoteIdx];
  const isNativeQuote = quote.address === '0x0000000000000000000000000000000000000000';
  const [reservedSeats, setReservedSeats] = useState('0');
  // One slot per reserved seat. A free-text blob made it too easy to ship a
  // short or duplicated list; numbered slots make the count self-evident.
  const [teamWallets, setTeamWallets] = useState<string[]>([]);
  const [gateAddr, setGateAddr] = useState('');
  const [gateMin, setGateMin] = useState('');
  const [vanity, setVanity] = useState<{ address: string; attempts: number; ms: number } | null>(null);
  const [grinding, setGrinding] = useState(false);

  const setTeamWallet = (i: number, v: string) =>
    setTeamWallets((prev) => {
      const next = prev.slice();
      while (next.length <= i) next.push('');
      // A paste of several addresses fills this slot and the ones after it.
      const parts = v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      if (parts.length > 1) parts.forEach((pt, k) => { while (next.length <= i + k) next.push(''); next[i + k] = pt; });
      else next[i] = v.trim();
      return next;
    });
  const allowlist = teamWallets.map((w) => w.trim()).filter(Boolean);
  const allowlistValid =
    allowlist.every((w) => isAddress(w)) &&
    new Set(allowlist.map((w) => w.toLowerCase())).size === allowlist.length;
  const gateValid = !gateAddr.trim() || isAddress(gateAddr.trim());
  // Default 2%: 0% makes the flywheel a lie, 5%+ loses listings to raw pons.
  const [taxPct, setTaxPct] = useState('2');
  const [buyback, setBuyback] = useState(false);
  const taxValid = (Number(taxPct) || 0) >= 0 && (Number(taxPct) || 0) <= 10;
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  // Creation buy-in — read live from the factory (0 for waived holders
  // once the platform token exists and a waiver-armed factory ships).
  const { data: myCreationFee } = useReadContract({
    address: POOLLAUNCH_FACTORY_V6,
    abi: factoryV4Abi,
    functionName: 'creationFeeFor',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
  });
  const { data: receipt, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const [created, setCreated] = useState<string | null>(null);
  // Optional 3:1 banner — off-chain (pons meta has no banner field). It is
  // uploaded before the tx and bound to the new campaign by one signature
  // right after the CampaignCreated event lands.
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const bannerUrlRef = useRef<string | null>(null);
  const [bannerState, setBannerState] = useState<'none' | 'pending' | 'signing' | 'done' | 'failed'>('none');
  const { signMessageAsync } = useSignMessage();
  // Banner + GitHub live off-chain (pons' meta has neither); one signature
  // binds both to the new campaign right after it exists.
  // Signature taken before the create tx, keyed to the predicted address.
  const preSigRef = useRef<{ campaign: string; message: string; signature: `0x${string}` } | null>(null);
  const bindBanner = async (campaign: string) => {
    const gh = f.github.trim();
    if ((!bannerUrlRef.current && !gh) || !address) return;
    setBannerState('signing');
    const pre = preSigRef.current;
    const usable = pre && pre.campaign === campaign.toLowerCase() ? pre : undefined;
    try {
      await attachBanner(campaign as `0x${string}`, address, bannerUrlRef.current, signMessageAsync, gh ? { github: gh } : {}, usable);
      setBannerState('done');
    } catch { setBannerState('failed'); }
  };

  const activeStack = botsEnabled ? stack : [];
  const botsPct = activeStack.reduce((s, b) => s + (Number(b.pct) || 0), 0);
  // Backers get whatever the fixed legs and the creator's bots leave.
  const budget = 100 - FIXED_LEGS_PCT.total;
  const backerPct = Math.max(0, budget - botsPct);
  const overBudget = botsPct > budget;
  const creatorPct = Number(activeStack.find((b) => b.kind === 'creator')?.pct) || 0;
  // Two guards, both deliberate. The cap keeps "backers keep most of the
  // creator tax" true by construction, and the second stops a stack where
  // the creator out-earns the people who funded them.
  const creatorValid = creatorPct <= CREATOR_MAX_PCT && creatorPct <= backerPct;
  const vaultCount = activeStack.filter((b) => b.kind === 'vault' || b.kind === 'airdrop').length;
  const stackValid = activeStack.every((b) => {
    const p = Number(b.pct) || 0;
    if (p < 0) return false;
    // Well-formed is not enough: a zero-address vault leg strands its fee
    // share in the splitter forever (nothing can claim as address(0)).
    if (b.kind === 'vault' && p > 0 && (!/^0x[0-9a-fA-F]{40}$/.test(b.addr || '') || /^0x0{40}$/i.test(b.addr || ''))) return false;
    return true;
  });

  // Effective raise terms — what actually goes on-chain for each style.
  const seatCount = Math.max(2, Number(f.slots) || 8);
  const effGoalEth = raiseStyle === 'seats'
    ? Number((seatCount * Number(seatPrice)).toFixed(6))
    : Number(f.goal) || 0;
  // The beta cap travels with the quote asset (2 ETH and 2 USDG are not
  // the same guardrail). Pre-v7 there is only ever ETH.
  const betaCap = V7_LIVE ? quote.betaCap : BETA_GOAL_CAP_ETH;
  const goalPresets = V7_LIVE ? quote.goalPresets : QUOTE_ASSETS[0].goalPresets;
  const minPresets = V7_LIVE ? quote.minPresets : QUOTE_ASSETS[0].minPresets;
  const seatPresets = V7_LIVE ? quote.seatPresets : QUOTE_ASSETS[0].seatPresets;
  const unitSym = V7_LIVE ? quote.symbol : 'ETH';
  const reservedN = Math.min(Number(reservedSeats) || 0, seatCount);

  useEffect(() => {
    if (isSuccess && receipt) {
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: factoryV4Abi, data: log.data, topics: log.topics });
          if (ev.eventName === 'CampaignCreated') {
            const campaignAddr = (ev.args as { campaign: string }).campaign;
            setCreated(campaignAddr);
            clearBoardCache(); // the board must show this campaign on the very next visit
            if (bannerUrlRef.current || f.github.trim()) void bindBanner(campaignAddr);
          }
        } catch { /* not ours */ }
      }
    }
  }, [isSuccess, receipt]);

  // Every term is read back to the creator before the wallet opens. The
  // \$PLAUNCH dry run went out with the wrong preset and payout because the
  // form let a click through; a review step is the only honest fix.
  const [review, setReview] = useState(false);
  const submit = async () => {
    // Links: same rule as the server, applied before anything is immutable.
    const fixed = { ...f, twitter: normUrl(f.twitter), telegram: normUrl(f.telegram), discord: normUrl(f.discord), website: normUrl(f.website), farcaster: normUrl(f.farcaster), github: normUrl(f.github) };
    if (JSON.stringify(fixed) !== JSON.stringify(f)) setF(fixed);
    const L = fixed;
    // Upload the token image first — its public URL is baked into the
    // immutable on-chain metadata, so it has to exist before the tx.
    let logoUrl = '';
    if (imageFile) {
      try {
        setUploading(true);
        const fd = new FormData();
        fd.append('file', imageFile);
        const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Image upload failed');
        logoUrl = (await res.json()).url;
      } catch (e) {
        setImageError(e instanceof Error ? e.message : String(e));
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    if (bannerFile) {
      try { setUploading(true); bannerUrlRef.current = await uploadBanner(bannerFile); setBannerState('pending'); }
      catch (e) { setBannerError(e instanceof Error ? e.message : String(e)); setUploading(false); return; }
      setUploading(false);
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(f.days) * 86400);
    const pctOf = (k: BotKind) => Math.round((Number(activeStack.find((b) => b.kind === k)?.pct) || 0) * 100);
    const vaultLegs = activeStack.filter((b) => (b.kind === 'vault' || b.kind === 'airdrop' || b.kind === 'creator') && Number(b.pct) > 0);
    // Amounts are parsed against the QUOTE asset's decimals, never a
    // hardcoded 18 — USDG is 6. On the v6 path the quote is always ETH,
    // so this reduces to exactly the previous parseEther behavior.
    const dec = V7_LIVE ? quote.decimals : 18;
    const unit = (v: string) => parseUnits(v || '0', dec);
    const seatUnits = unit(seatPrice);
    const goalUnits = raiseStyle === 'seats' ? seatUnits * BigInt(seatCount) : unit(f.goal);
    const minUnits = raiseStyle === 'seats' ? seatUnits : unit(f.min);
    const maxUnits = raiseStyle === 'seats' ? seatUnits : (f.max === '0' || !Number(f.max) ? 0n : unit(f.max));
    const slotsN = raiseStyle === 'seats' ? BigInt(seatCount) : 0n;

    const meta = {
      name: f.name, symbol: f.symbol.toUpperCase(), logo: logoUrl, description: f.description,
      socials: { twitter: L.twitter, telegram: L.telegram, discord: L.discord, website: L.website, farcaster: L.farcaster },
      feeWallet: '0x0000000000000000000000000000000000000000' as `0x${string}`, // unused on V2 — the contract sets creatorFeeRecipient = FeeSplitter
    };
    const vaultAddrs = vaultLegs.map((b) => (b.kind === 'airdrop' ? AIRDROP_OPERATOR : b.kind === 'creator' ? (address as `0x${string}`) : (b.addr as `0x${string}`)));
    const vaultBpsArr = vaultLegs.map((b) => Math.round(Number(b.pct) * 100));

    if (V7_LIVE) {
      const params = {
        goal: goalUnits,
        minDeposit: minUnits,
        maxDeposit: maxUnits,
        maxBackers: slotsN,
        deadline,
        launchConfigId: 0n,
        creatorTaxBps: Math.round((Number(taxPct) || 0) * 100),
        buybackEnabled: buyback,
        quoteToken: quote.address,
        gateToken: (gateAddr.trim() || '0x0000000000000000000000000000000000000000') as `0x${string}`,
        gateMinBalance: gateAddr.trim() ? parseEther(gateMin || '0') : 0n,
        reservedSeats: raiseStyle === 'seats' ? Math.min(Number(reservedSeats) || 0, seatCount) : 0,
        allowlist: (raiseStyle === 'seats' ? allowlist : []) as `0x${string}`[],
        payoutAsset: (payoutIdx === 0 ? '0x0000000000000000000000000000000000000000' : EQUITY_ASSETS[payoutIdx - 1].address) as `0x${string}`,
        meta,
      };
      const burnBps = pctOf('burn');
      const lpBps = pctOf('feed_lp');

      // Grind the 0x…5EED signature. One read for the init-code hash
      // (so the encoding can never drift from what deploys), then a
      // local keccak loop. Missing it is cosmetic — if anything here
      // fails we still create at a perfectly good address.
      let salt = ('0x' + Math.floor(Math.random() * 1e15).toString(16).padStart(64, '0')) as `0x${string}`;
      let predicted: string | null = null;
      try {
        setGrinding(true);
        const [deployerAddr, legDeployerAddr] = await Promise.all([
          rhcPublicClient.readContract({ address: ACTIVE_FACTORY, abi: factoryV5Abi, functionName: 'campaignDeployer' }),
          rhcPublicClient.readContract({ address: ACTIVE_FACTORY, abi: factoryV5Abi, functionName: 'legDeployer' }),
        ]);
        const legNonce = await rhcPublicClient.getTransactionCount({ address: legDeployerAddr });
        const { burnLeg, lpLeg } = predictLegAddresses(legDeployerAddr, BigInt(legNonce), burnBps > 0, lpBps > 0);
        const initCodeHash = await rhcPublicClient.readContract({
          address: ACTIVE_FACTORY,
          abi: factoryV5Abi,
          functionName: 'previewInitCodeHash',
          args: [address as `0x${string}`, params, burnBps, lpBps, vaultAddrs, vaultBpsArr, burnLeg, lpLeg],
        });
        const g = grindVanitySalt({ deployer: deployerAddr, initCodeHash });
        salt = g.salt;
        predicted = g.address;
        if (g.found) setVanity({ address: g.address, attempts: g.attempts, ms: g.ms });
      } catch { /* no signature this time; the raise is unaffected */ }
      setGrinding(false);

      // Banner and GitHub live off-chain, so the server needs proof it is
      // talking to the creator. CREATE2 means we already know the campaign
      // address, so take that signature HERE — before the tx, while the
      // creator is still in approve-things mode — and abort the whole
      // launch if it is declined. A prompt after the tx got missed three
      // times running and each miss cost a cancelled campaign.
      preSigRef.current = null;
      if ((bannerUrlRef.current || L.github.trim()) && predicted && address) {
        try {
          const message = `rhc-banner:${predicted.toLowerCase()}:${address.toLowerCase()}:${Date.now()}`;
          const signature = await signMessageAsync({ message });
          preSigRef.current = { campaign: predicted.toLowerCase(), message, signature };
        } catch {
          setBannerError('Signature declined — nothing was created. Submit again and approve both prompts, or clear the banner and GitHub fields first.');
          return;
        }
      }

      // ERC20-quoted raises escrow the pons launch fee (native ETH) at
      // creation; it comes back via refundLaunchFee if the raise dies.
      const launchFeeEscrow = isNativeQuote ? 0n : PONS_LAUNCH_FEE_WEI;
      // v8's createCampaign has the v7 signature exactly, so one ABI serves both.
      writeContract({
        address: ACTIVE_FACTORY,
        abi: factoryV5Abi,
        functionName: 'createCampaign',
        chainId: robinhoodChain.id,
        value: (myCreationFee ?? CREATION_FEE_WEI) + launchFeeEscrow,
        args: [params, burnBps, lpBps, vaultAddrs, vaultBpsArr, salt],
      });
      return;
    }

    writeContract({
      address: POOLLAUNCH_FACTORY_V6,
      abi: factoryV4Abi,
      functionName: 'createCampaign',
      // Pin the chain: Phantom's EVM side defaults to Ethereum mainnet,
      // and an unpinned write gets built THERE (factory absent, balance
      // 0 → "exceeds balance"). Belt: wagmi switches when pinned;
      // braces: the button below refuses to submit off-chain at all.
      chainId: robinhoodChain.id,
      value: myCreationFee ?? CREATION_FEE_WEI,
      args: [
        goalUnits,
        minUnits,
        maxUnits,
        slotsN,
        deadline,
        0n,
        Math.round((Number(taxPct) || 0) * 100),
        buyback,
        meta,
        pctOf('burn'),
        pctOf('feed_lp'),
        vaultAddrs,
        vaultBpsArr,
      ],
    });
  };

  // ── Success state ──────────────────────────────────────────────
  if (created) {
    return (
      <div className="max-w-2xl mx-auto pb-8">
        <div className="border border-[var(--success)] bg-[var(--card)]">
          <div className="border-b border-[var(--success)] px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
              {'// CAMPAIGN_LIVE'}
            </span>
          </div>
          <div className="p-6">
            <h2 className="text-base font-mono font-semibold uppercase tracking-tight mb-2">Campaign created</h2>
            {bannerState !== 'none' && bannerState !== 'done' ? (
              <div className="border border-[var(--accent-gold)]/60 bg-[var(--accent-gold)]/5 p-4 space-y-2">
                <p className="text-xs font-mono text-[var(--foreground)]">
                  <span className="text-[var(--accent-gold)]">One step left:</span> your banner{f.github.trim() ? ' and GitHub link' : ''} live off-chain and need one signature from this wallet to attach to the campaign. Without it the page shows no banner.
                </p>
                <button type="button" onClick={() => void bindBanner(created)} disabled={bannerState === 'signing'} className="btn-primary">
                  {bannerState === 'signing' ? 'Sign in your wallet…' : bannerState === 'failed' ? 'Try the signature again' : 'Attach banner & links · 1 signature'}
                </button>
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">You can also do this later from the campaign page&apos;s creator controls.</p>
              </div>
            ) : bannerState === 'done' ? (
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">✓ Banner and links attached</p>
            ) : null}
            <p className="mt-4 text-xs font-mono text-[var(--muted)]">&gt; Your campaign page:</p>
            <a
              href={`/rhc/campaign/${created}`}
              className="mt-2 block font-mono text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] break-all"
            >
              prooflaunch.fun/rhc/campaign/{created}
            </a>
            <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">Check the METADATA card on that page before you share it — everything the token will say is listed there.</p>
          </div>
        </div>
      </div>
    );
  }

  const payoutName = payoutIdx === 0 ? 'ETH (backers may still pick a stock at claim)' : `${EQUITY_ASSETS[payoutIdx - 1].symbol} · ${EQUITY_ASSETS[payoutIdx - 1].label} (ETH always available)`;
  const burnPct = Number(activeStack.find((x) => x.kind === 'burn')?.pct ?? '') || 0;
  const presetName = (() => { const b = activeStack.find((x) => x.kind === 'burn')?.pct ?? ''; const hit = STACK_PRESETS.find((ps) => ps.burn === b); return hit ? hit.label : 'Custom'; })();
  const reviewRows: [string, string, boolean?][] = [
    ['name / symbol', `${f.name.trim()} · $${f.symbol.trim().toUpperCase()}`],
    ['logo', imageFile ? imageFile.name : 'none', !imageFile],
    ['banner', bannerFile ? `${bannerFile.name} (attached after creation, 1 signature)` : 'none', !bannerFile],
    ['description', f.description.trim().slice(0, 90) + (f.description.trim().length > 90 ? '…' : '')],
    ['links', ['twitter', 'telegram', 'discord', 'website', 'farcaster', 'github'].filter((k) => (f as Record<string, string>)[k].trim()).map((k) => `${k}: ${normUrl((f as Record<string, string>)[k])}`).join('  ·  ') || 'none', !['twitter', 'telegram', 'discord', 'website', 'farcaster', 'github'].some((k) => (f as Record<string, string>)[k].trim())],
    ['raise', raiseStyle === 'seats' ? `${seatCount} seats × ${seatPrice} ${unitSym} = ${effGoalEth} ${unitSym}${reservedN ? ` · ${reservedN} team seats → ${allowlist.map((w) => `${w.slice(0, 6)}…${w.slice(-4)}`).join(', ') || 'NONE NAMED'}, ${seatCount - reservedN} public` : ''}` : `open · goal ${f.goal} ${unitSym} · min ${f.min} · max ${f.max === '0' ? 'none' : f.max}`],
    ['creator tax', `${taxPct}% · traders pay ${(Number(taxPct) + 1).toFixed(Number(taxPct) % 1 ? 1 : 0)}% with pons' 1%`],
    ['fee payout', payoutName],
    ['coin burn', `${burnPct}% of the fee stream buys and burns $${f.symbol.trim().toUpperCase() || 'YOUR TOKEN'}${presetName === 'Custom' ? '' : ` — the ${presetName} preset`}`, burnPct === 0],
    ...(creatorPct > 0 ? [['creator fee', `${creatorPct}% of the fee stream to YOUR wallet (${address?.slice(0, 6)}…${address?.slice(-4)}), shown as CREATOR on your campaign page`, true] as [string, string, boolean]] : []),
    ['rest of stack', `${botsPct - burnPct - creatorPct}% other bots · ${backerPct}% backers · ${FIXED_LEGS_PCT.total}% fixed (${FIXED_LEGS_PCT.burn > 0 ? `${FIXED_LEGS_PCT.burn}% $PLAUNCH burn + ${FIXED_LEGS_PCT.platform}% platform` : `${FIXED_LEGS_PCT.platform}% platform + ${FIXED_LEGS_PCT.rewards}% retired`})`],
    ['deadline', `${f.days} days`],
  ];

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <Modal open={review} onClose={() => setReview(false)} label="REVIEW YOUR LAUNCH" wide>
        <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
          Read it once. Name, symbol, logo, links, tax, payout, fee stack and the raise terms become <span className="text-[var(--foreground)]">immutable</span> the moment you confirm in your wallet. Banner, GitHub and the description override can be edited later; nothing else can.
        </p>
        <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs font-mono">
          {reviewRows.map(([k, v, warn]) => (
            <div key={k} className="contents">
              <dt className="text-[10px] uppercase tracking-widest text-[var(--muted)] pt-0.5">{k}</dt>
              <dd className={warn ? 'text-[var(--warning,#c9a227)]' : 'text-[var(--foreground)]'}>{v}{warn ? ' — ok?' : ''}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => { setReview(false); void submit(); }} className="btn-primary">Looks right — create it</button>
          <button onClick={() => setReview(false)} className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] text-[var(--muted)]">Go back and change something</button>
        </div>
      </Modal>
      {/* Header — kept compact, same shell as the SOL submit page */}
      <div className="border border-[var(--border)] bg-[var(--card)] mb-5">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// PROOF_LAUNCH.SYS // SUBMIT'}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            [INPUT]
          </span>
        </div>
        <div className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
            &gt; NEW_TOKEN
          </div>
          <h1 className="text-xl sm:text-2xl font-mono font-semibold uppercase tracking-tight">
            Submit a Token<span className="cursor-blink" />
          </h1>
          <p className="text-xs font-mono text-[var(--muted)] mt-1.5">
            Configure · Rally backers · Launch on pons — terms enforced by ownerless contracts
          </p>
        </div>
      </div>

      {!isConnected ? (
        <div className="border border-[var(--warning)] bg-[var(--card)]">
          <div className="border-b border-[var(--warning)] px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
              [!] WALLET_REQUIRED
            </span>
          </div>
          <div className="p-6">
            <h2 className="text-base font-mono font-semibold uppercase tracking-tight mb-2">Wallet required</h2>
            <p className="text-xs font-mono text-[var(--muted)]">
              &gt; Connect your wallet (top right) to submit a token
            </p>
          </div>
        </div>
      ) : (
        // 2-column grid: form left, sticky live preview right — the SOL
        // submit layout. On mobile the preview stacks above the form.
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 lg:gap-6">
          <div className="lg:order-2">
            <CampaignPreviewPanel f={f} imagePreview={imagePreview} stack={activeStack} backerPct={backerPct} creatorWallet={address} taxPct={Number(taxPct) || 0} buyback={buyback} raiseStyle={raiseStyle} seatPrice={seatPrice} effGoalEth={effGoalEth} />
          </div>

          <div className="space-y-5 lg:order-1 min-w-0">
            {error && (
              <div className="border border-[var(--error)] bg-[var(--card)] px-4 py-3 flex gap-3 items-center">
                <AlertCircle className="w-4 h-4 text-[var(--error)] shrink-0" />
                <p className="text-[var(--error)] font-mono text-xs">
                  {(error as Error).message.split('\n')[0].slice(0, 160)}
                </p>
              </div>
            )}

            {/* ── LAUNCH PLATFORM ── */}
            <section className="border border-[var(--border)] bg-[var(--card)]">
              <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                  {'// LAUNCH_PLATFORM'}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  1 LIVE
                </span>
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  aria-pressed
                  className="border px-3 py-3 flex flex-col items-start gap-1 border-[var(--accent)] bg-[var(--accent)]/5"
                >
                  <span className="text-sm font-mono font-semibold text-[var(--accent)]">PONS</span>
                  <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">LIVE</span>
                </button>
              </div>
              <div className="border-t border-[var(--border)] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] bg-[var(--accent-gold)]/5">
                &gt; Pooled buy fires snipe-exempt on the launch block · graduates to a locked Uniswap-v4 pool at 4.2 ETH
              </div>
            </section>

            {/* ── BASICS ── */}
            <section className="border border-[var(--border)] bg-[var(--card)]">
              <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                  {'// BASICS'}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--error)] border border-[var(--error)] px-1.5 py-0.5">
                  REQUIRED
                </span>
              </div>
              <div className="p-4 sm:p-5 space-y-4">
                {/* Image + name/symbol — image left, fields right (mirrors how the campaign card renders) */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="shrink-0">
                    {imagePreview ? (
                      <div className="relative w-28 h-28">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imagePreview}
                          alt="Token preview"
                          className="w-28 h-28 object-cover border border-[var(--accent)]"
                        />
                        <button
                          type="button"
                          onClick={removeImage}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-[var(--error)] flex items-center justify-center hover:opacity-90 transition-opacity"
                          aria-label="Remove image"
                        >
                          <X className="w-3 h-3 text-[#0a0a0a]" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-28 h-28 border border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors flex flex-col items-center justify-center gap-1.5 text-[var(--muted)] hover:text-[var(--accent)]"
                      >
                        <Upload className="w-5 h-5" />
                        <span className="text-[9px] font-mono uppercase tracking-widest">Upload</span>
                        <span className="text-[9px] font-mono text-[var(--muted)]">PNG/JPG · 2MB</span>
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleImageChange}
                      className="hidden"
                    />
                    {imageError && (
                      <span className="block mt-1 text-[10px] font-mono text-[var(--error)] max-w-28">{imageError}</span>
                    )}
                  </div>

                  <div className="flex-1 space-y-3 min-w-0">
                    <div>
                      <label className={labelClass}>Name *</label>
                      <input
                        type="text"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={f.name}
                        onChange={(e) => setF({ ...f, name: e.target.value })}
                        placeholder="e.g., Bonk Dog"
                        maxLength={32}
                        required
                        className={inputClass()}
                      />
                      <div className="flex justify-between mt-1 text-[10px] font-mono text-[var(--muted)]">
                        <span>Letters, numbers, spaces, hyphens</span>
                        <span>{f.name.length}/32</span>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Symbol *</label>
                      <input
                        type="text"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={f.symbol}
                        onChange={(e) => setF({ ...f, symbol: e.target.value })}
                        placeholder="e.g., BONKD"
                        maxLength={10}
                        required
                        className={`${inputClass()} uppercase`}
                      />
                      <div className="flex justify-between mt-1 text-[10px] font-mono text-[var(--muted)]">
                        <span>Letters and numbers only</span>
                        <span>{f.symbol.length}/10</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Banner — optional, like the SOL submit page. Off-chain; bound
                    to the campaign by one signature after creation. */}
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5 block">Banner <span className="text-[var(--muted-soft)]">(optional · 1500×500 · under 2 MB)</span></span>
                  {bannerPreview ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={bannerPreview} alt="Banner preview" className="w-full block border border-[var(--accent)]" style={{ aspectRatio: '3 / 1', objectFit: 'cover' }} />
                      <button type="button" aria-label="Remove banner"
                        onClick={() => { setBannerFile(null); setBannerPreview(null); if (bannerInputRef.current) bannerInputRef.current.value = ''; }}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-[var(--error)] flex items-center justify-center hover:opacity-90">
                        <X className="w-3 h-3 text-[#0a0a0a]" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => bannerInputRef.current?.click()}
                      className="w-full border border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors flex items-center justify-center gap-2 text-[var(--muted)] hover:text-[var(--accent)] py-4">
                      <Upload className="w-4 h-4" />
                      <span className="text-[9px] font-mono uppercase tracking-widest">Upload banner · 3:1</span>
                    </button>
                  )}
                  <input ref={bannerInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                    onChange={(e) => {
                      setBannerError(null);
                      const file = e.target.files?.[0]; if (!file) return;
                      if (file.size > BANNER_MAX_BYTES) { setBannerError(`Banner must be under 2 MB (you have ${(file.size / 1024 / 1024).toFixed(1)} MB)`); return; }
                      setBannerFile(file); setBannerPreview(URL.createObjectURL(file));
                    }} />
                  {bannerError && <span className="block mt-1 text-[10px] font-mono text-[var(--error)]">{bannerError}</span>}
                </div>

                {/* Description — full width below */}
                <div>
                  <label className={labelClass}>Description *</label>
                  <textarea
                    autoComplete="off"
                    value={f.description}
                    onChange={(e) => setF({ ...f, description: e.target.value })}
                    placeholder="Tell the community about your project..."
                    maxLength={500}
                    rows={3}
                    className={`${inputClass()} resize-none`}
                  />
                  <div className="flex justify-between mt-1 text-[10px] font-mono text-[var(--muted)]">
                    <span>What this project is about</span>
                    <span>{f.description.length}/500</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ── LINKS · all optional ── */}
            <section className="border border-[var(--border)] bg-[var(--card)]">
              <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
                  {'// LINKS'}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] border border-[var(--border)] px-1.5 py-0.5">
                  ALL OPTIONAL
                </span>
              </div>
              <div className="p-4 sm:p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-3">
                  &gt; Token socials · written to on-chain metadata
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    ['twitter', 'Token X', 'https://x.com/...'],
                    ['website', 'Website', 'https://...'],
                    ['telegram', 'Telegram', 'https://t.me/...'],
                    ['discord', 'Discord', 'https://discord.gg/...'],
                    ['farcaster', 'Farcaster', 'https://farcaster.xyz/...'],
                    ['github', 'GitHub (off-chain, attached after creation)', 'https://github.com/...'],
                  ] as const).map(([key, lbl, ph]) => (
                    <div key={key}>
                      <label className={labelClass}>{lbl}</label>
                      <input
                        type="text"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={f[key]}
                        onChange={(e) => setF({ ...f, [key]: e.target.value })}
                        placeholder={ph}
                        className={inputClass()}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── QUOTE ASSET — what the raise is pooled in ── */}
            {V7_LIVE && (
              <section className="border border-[var(--border)] bg-[var(--card)]">
                <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                    {'// QUOTE_ASSET'}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    PONS-APPROVED PAIRS
                  </span>
                </div>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {QUOTE_ASSETS.map((q, i) => {
                    const active = quoteIdx === i;
                    return (
                      <button
                        key={q.address}
                        type="button"
                        onClick={() => {
                          setQuoteIdx(i);
                          // amounts are asset-relative; reset to that
                          // asset's own presets rather than carrying
                          // an ETH-sized number into a USDG raise
                          setF((d) => ({ ...d, goal: q.goalPresets[2], min: q.minPresets[2], max: '0' }));
                          setSeatPrice(q.seatPresets[2]);
                        }}
                        aria-pressed={active}
                        className={`border px-3 py-3 flex flex-col items-start gap-1 text-left transition-colors ${
                          active
                            ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                            : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                        }`}
                      >
                        <span className={`text-sm font-mono font-semibold ${active ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'}`}>
                          {q.label}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--muted)] normal-case leading-snug">
                          {q.blurb}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!isNativeQuote && (
                  <div className="border-t border-[var(--border)] px-3 py-2.5 text-[10px] font-mono text-[var(--muted)] leading-relaxed">
                    <span className="text-[var(--accent-gold)] uppercase tracking-widest">Heads up:</span>{' '}
                    backers deposit {quote.symbol} (one approval, then deposit), refunds and the
                    fee stream pay in {quote.symbol}, and pons&apos; 0.0005 ETH launch fee is
                    escrowed from your wallet at creation — refundable to you if the raise never
                    launches. Trustless 🔥/🌊 bots are ETH-quoted only for now.
                  </div>
                )}
              </section>
            )}

            {/* ── FEE PAYOUT — the creator's DEFAULT asset for fee claims.
                Renders for BOTH raise styles: it's about how fees leave,
                not how the raise is shaped. Every claimer can override. ── */}
            {V7_LIVE && (
              <section className="border border-[var(--border)] bg-[var(--card)]">
                <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                    {'// FEE_PAYOUT'}
                  </span>
                  <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    default only · claimers choose
                  </span>
                </div>
                <div className="p-4">
                  <label className={labelClass}>Pay fees in</label>
                  <select
                    value={payoutIdx}
                    onChange={(e) => setPayoutIdx(Number(e.target.value))}
                    className={inputClass()}
                  >
                    <option value={0}>ETH (default)</option>
                    {EQUITY_ASSETS.map((a, i) => (
                      <option key={a.symbol} value={i + 1}>
                        {a.symbol} — {a.label}{a.feeBps >= PRICEY_FEE_BPS ? ` (pool fee ${(a.feeBps / 100).toFixed(1)}%)` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[10px] font-mono text-[var(--muted)] leading-relaxed">
                    The default asset your backers&apos; fee share arrives as. &ldquo;Holders earn SpaceX&rdquo; is a real claim once you pick it —
                    but every backer can still take ETH or any other stock at claim time. Nobody is locked in.
                  </p>
                </div>
              </section>
            )}

            {/* ── RAISE STYLE — two presets, both riding the goal engine ── */}
            <section className="border border-[var(--border)] bg-[var(--card)]">
              <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                  {'// RAISE_STYLE'}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  {f.days}-DAY DEADLINE
                </span>
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  { key: 'open' as const,  label: '⚡ OPEN RAISE', sub: 'ETH GOAL · UNLIMITED BACKERS', desc: 'Anyone can back with any amount. Launches when the pool hits the goal. Optional whale cap.' },
                  { key: 'seats' as const, label: '🎟 SEAT ROUND', sub: 'N SEATS · FIXED PRICE · EQUAL ENTRY', desc: 'Every seat identical — same price, same share. The last seat filling IS the launch trigger, enforced by contract. The SOL mechanic, trustless.' },
                ]).map((t) => {
                  const active = raiseStyle === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setRaiseStyle(t.key);
                        if (t.key === 'seats' && !(Number(f.slots) >= 2)) setF({ ...f, slots: '8' });
                      }}
                      aria-pressed={active}
                      className={`border px-3 py-3 flex flex-col items-start gap-1 text-left transition-colors ${
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                          : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                      }`}
                    >
                      <span className={`text-sm font-mono font-semibold ${active ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'}`}>
                        {t.label}
                      </span>
                      <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">{t.sub}</span>
                      <span className="text-[10px] font-mono text-[var(--muted)] normal-case leading-snug">{t.desc}</span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-[var(--border)] p-4 sm:p-5 space-y-4">
                {raiseStyle === 'open' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className={labelClass}>Raise goal</label>
                        <select
                          value={f.goal}
                          onChange={(e) => setF({ ...f, goal: e.target.value })}
                          className={inputClass()}
                        >
                          {goalPresets.map((n) => (
                            <option key={n} value={n}>{n} {unitSym}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                          &gt; Launchable once the pool reaches this
                        </span>
                      </div>
                      <div>
                        <label className={labelClass}>Minimum per backer</label>
                        <select
                          value={f.min}
                          onChange={(e) => setF({ ...f, min: e.target.value })}
                          className={inputClass()}
                        >
                          {minPresets.map((n) => (
                            <option key={n} value={n}>{n} {unitSym}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                          &gt; Keeps dust out
                        </span>
                      </div>
                      <div>
                        <label className={labelClass}>Deadline</label>
                        <select
                          value={f.days}
                          onChange={(e) => setF({ ...f, days: e.target.value })}
                          className={inputClass()}
                        >
                          {[['1', '1 day'], ['3', '3 days'], ['5', '5 days'], ['7', '7 days']].map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                          &gt; Goal unmet by then → refunds open
                        </span>
                      </div>
                    </div>

                    {/* Whale cap — the creator's choice, off by default */}
                    <div className="space-y-3 border border-[var(--border)] p-3">
                      <div>
                        <div className="text-xs font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
                          Whale cap (optional)
                        </div>
                        <p className="text-[10px] font-mono text-[var(--muted)] leading-snug">
                          Cap any single wallet&apos;s deposit so no whale can own the raise. Leave at 0 for uncapped.
                        </p>
                      </div>
                      <div>
                        <label className={labelClass}>Max per backer ({unitSym})</label>
                        <input
                          type="number"
                          value={f.max}
                          onChange={(e) => setF({ ...f, max: e.target.value })}
                          min={0}
                          step="any"
                          placeholder="0 = uncapped"
                          className={inputClass()}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className={labelClass}>Seats</label>
                        <select
                          value={f.slots}
                          onChange={(e) => setF({ ...f, slots: e.target.value })}
                          className={inputClass()}
                        >
                          {[2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24].map((n) => (
                            <option key={n} value={String(n)}>{n} seats</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                          &gt; Each seat = one wallet, one equal share
                        </span>
                      </div>
                      <div>
                        <label className={labelClass}>Seat price</label>
                        <select
                          value={seatPrice}
                          onChange={(e) => setSeatPrice(e.target.value)}
                          className={inputClass()}
                        >
                          {seatPresets.map((n) => (
                            <option key={n} value={n}>{n} {unitSym}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                          &gt; Exact deposit — no more, no less
                        </span>
                      </div>
                      <div>
                        <label className={labelClass}>Deadline</label>
                        <select
                          value={f.days}
                          onChange={(e) => setF({ ...f, days: e.target.value })}
                          className={inputClass()}
                        >
                          {[['1', '1 day'], ['3', '3 days'], ['5', '5 days'], ['7', '7 days']].map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                          &gt; Seats unfilled by then → refunds open
                        </span>
                      </div>
                    </div>
                    {V7_LIVE && (
                      <div className="border border-[var(--border)] p-3 space-y-3">
                        <div>
                          <div className="text-xs font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
                            🏟 Team round (optional)
                          </div>
                          <p className="text-[10px] font-mono text-[var(--muted)] leading-snug">
                            Reserve seats for wallets you name. The contract enforces it: nobody
                            else can take a reserved seat, and the public&apos;s remaining seats are
                            a guarantee, not a leftover. Reserve every seat for a pure team round.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className={labelClass}>Reserved seats</label>
                            <select
                              value={reservedSeats}
                              onChange={(e) => setReservedSeats(e.target.value)}
                              className={inputClass()}
                            >
                              {Array.from({ length: seatCount + 1 }).map((_, n) => (
                                <option key={n} value={String(n)}>
                                  {n === 0
                                    ? '0 — fully open'
                                    : n === seatCount
                                      ? `${n} of ${seatCount} — TEAM ROUND`
                                      : `${n} of ${seatCount} — ${seatCount - n} open to public`}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="self-end text-[11px] font-mono text-[var(--muted)] leading-relaxed">
                            {reservedN === 0
                              ? 'Pick a number above to name the wallets.'
                              : `Name the ${reservedN} wallet${reservedN === 1 ? '' : 's'} below. Only these can take a reserved seat.`}
                          </div>
                        </div>
                        {reservedN > 0 && (
                          <div className="space-y-1.5">
                            {Array.from({ length: reservedN }).map((_, i) => {
                              const v = (teamWallets[i] ?? '').trim();
                              const ok = isAddress(v);
                              const dupe = ok && allowlist.filter((w) => w.toLowerCase() === v.toLowerCase()).length > 1;
                              return (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="w-16 shrink-0 text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
                                    Seat {String(i + 1).padStart(2, '0')}
                                  </span>
                                  <input
                                    value={teamWallets[i] ?? ''}
                                    onChange={(e) => setTeamWallet(i, e.target.value)}
                                    placeholder="0x…"
                                    spellCheck={false}
                                    className={`${inputClass(v.length > 0 && (!ok || dupe))} flex-1 normal-case tracking-normal`}
                                  />
                                  <span className="w-20 shrink-0 text-[10px] font-mono uppercase tracking-widest text-right">
                                    {!v ? <span className="text-[var(--muted-soft)]">empty</span>
                                      : dupe ? <span className="text-[var(--error)]">duplicate</span>
                                      : ok ? <span className="text-[var(--success)]">✓ valid</span>
                                      : <span className="text-[var(--error)]">bad address</span>}
                                  </span>
                                </div>
                              );
                            })}
                            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
                              Paste several at once into any slot and they fill downward.
                            </p>
                          </div>
                        )}
                        {reservedN > 0 && allowlist.length < reservedN && (
                          <p className="text-[10px] font-mono text-[var(--warning)] uppercase tracking-widest">
                            {reservedN - allowlist.length} slot{reservedN - allowlist.length === 1 ? '' : 's'} still
                            empty — those seats would sit unclaimable until the deadline.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-3 py-2.5 text-[11px] font-mono text-[var(--muted)] leading-relaxed">
                      <span className="text-[var(--accent)] font-semibold">{seatCount} seats × {seatPrice} {unitSym} = {effGoalEth} {unitSym} raise.</span>{' '}
                      Every backer deposits exactly the seat price, owns exactly 1/{seatCount} of the
                      backer pool and fee stream — and the last seat filling meets the goal, so{' '}
                      <span className="text-[var(--foreground)]">filling the round IS the launch trigger</span>.
                    </div>
                  </>
                )}

                {effGoalEth > betaCap && (
                  <p className="text-xs font-mono text-[var(--warning)]">
                    BETA CAP: raises are limited to {betaCap} {unitSym} total until the external
                    contract review completes{raiseStyle === 'seats' ? ' — lower the seat count or price' : ''}.
                  </p>
                )}
              </div>
            </section>

            {/* ── CREATOR TAX — the pons V2 dial, earned by your backers ── */}
            <section className="border border-[var(--border)] bg-[var(--card)]">
              <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                  {'// CREATOR_TAX'}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  0–10% · IMMUTABLE
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.25}
                    value={Number(taxPct) || 0}
                    onChange={(e) => setTaxPct(e.target.value)}
                    className="flex-1 accent-[var(--accent)]"
                    aria-label="Creator tax percent"
                  />
                  <label className="flex items-center gap-2 shrink-0">
                    <input
                      value={taxPct}
                      onChange={(e) => setTaxPct(e.target.value)}
                      className={`${inputClass(!taxValid)} w-20 text-right`}
                    />
                    <span className="text-sm font-mono text-[var(--muted)]">%</span>
                  </label>
                </div>
                {/* pons charges its own 1% protocol fee on every trade on top
                    of the creator tax; a creator should learn that here, not
                    on Axiom after launch (punch list #6). */}
                <p className="text-[11px] font-mono text-[var(--foreground)] leading-relaxed">
                  Traders pay <span className="text-[var(--accent)] font-semibold">{((Number(taxPct) || 0) + 1).toFixed(2).replace(/\.?0+$/, '')}%</span> on every buy and sell:
                  your {taxPct || 0}% + pons&apos; 1% protocol fee. The 1% is pons revenue — it funds $PONS buybacks, the flywheel every launch here feeds.
                </p>
                <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
                  The pons trading tax on every buy and sell — same dial as launching on pons
                  directly, with one difference: here the tax flows to your campaign&apos;s
                  FeeSplitter, so <span className="text-[var(--accent)]">your backers earn it</span>{' '}
                  ({backerPct}% of it, on top of the standard creator-fee share). Locked at launch;
                  can never be raised.
                </p>
                {!taxValid && (
                  <p className="text-xs font-mono text-[var(--error)]">Tax must be between 0 and 10%.</p>
                )}
                {/* pons buybackEnabled — DISABLED until fully characterized.
                    Fork measurement 2026-09-15: with the flag ON, the pons
                    curve diverted ~20%+ of buy volume into curve-held fee/
                    buyback pools (vs 1% with it off) on identical trades.
                    Backer tax income was unchanged, but where that extra
                    take lands isn't proven yet — no creator should flip a
                    switch we can't fully explain. Nearly every live pons
                    launch runs with it off, too. */}
                <label className="flex items-start gap-3 border-t border-[var(--border)] pt-3 opacity-50 cursor-not-allowed">
                  <input type="checkbox" checked={false} disabled className="w-4 h-4 mt-0.5" />
                  <span className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
                    <span className="text-[var(--foreground)] uppercase tracking-widest text-[10px]">💠 pons Buyback</span>
                    {' '}— temporarily disabled: our fork measurements show this pons-side flag
                    diverting far more of the trade flow than their docs suggest. It stays off
                    until we can publish exactly what it takes and where it goes.
                  </span>
                </label>
              </div>
            </section>

            {/* ── TOKEN GATE — hold to back ── */}
            {V7_LIVE && (
              <section className="border border-[var(--border)] bg-[var(--card)]">
                <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                    {'// TOKEN_GATE'}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    OPTIONAL
                  </span>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
                    Require backers to hold a token before they can enter. Anti-bot armor for a
                    hyped raise, and the reason to hold a community&apos;s token. Checked by the
                    contract at deposit, not by us.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Gate token address</label>
                      <input
                        value={gateAddr}
                        onChange={(e) => setGateAddr(e.target.value)}
                        placeholder="0x… (leave empty for no gate)"
                        className={`${inputClass(!gateValid)} normal-case tracking-normal`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Minimum balance</label>
                      <input
                        value={gateMin}
                        onChange={(e) => setGateMin(e.target.value)}
                        placeholder="e.g. 500000"
                        disabled={!gateAddr.trim()}
                        className={`${inputClass()} disabled:opacity-40`}
                      />
                      <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                        &gt; Whole tokens (18-decimal assumed)
                      </span>
                    </div>
                  </div>
                  {!gateValid && (
                    <p className="text-xs font-mono text-[var(--error)]">That is not a valid address.</p>
                  )}
                </div>
              </section>
            )}

            {/* ── LAUNCH BOTS — the SOL bot-stack UX ── */}
            <div className="border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    FEE STACK · WHERE YOUR TOKEN&apos;S CREATOR TAX GOES
                  </div>
                  <div className="text-sm font-mono text-[var(--foreground)]">
                    Pick a preset. Tune it under Advanced if you care.
                  </div>
                  <p className="text-xs font-mono text-[var(--muted)] leading-relaxed max-w-md">
                    {FIXED_LEGS_PCT.burn > 0 ? (
                      <>Two legs are fixed and never move: <span className="text-[var(--accent-gold)]">{FIXED_LEGS_PCT.burn}% buys and burns $PLAUNCH</span>, {FIXED_LEGS_PCT.platform}% platform. </>
                    ) : (
                      <>{FIXED_LEGS_PCT.total}% is fixed and never moves: {FIXED_LEGS_PCT.platform}% platform, {FIXED_LEGS_PCT.rewards}% retired holder-rewards. </>
                    )}
                    The other {100 - FIXED_LEGS_PCT.total}% is yours to split between backers and ownerless bots — burn, locked liquidity, named vaults —
                    immutable from creation, pull-based forever. Anyone can crank the bots; nobody can stop or change them.
                  </p>
                  {FIXED_LEGS_NOTE && (
                    <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] max-w-md">{FIXED_LEGS_NOTE}</p>
                  )}
                </div>
              </div>

              {botsEnabled && (
                <div className="space-y-4 pt-3 border-t border-[var(--border)]">
                  {/* Budget bar — bots / backers / platform+rewards */}
                  <div className={`sticky top-0 z-10 -mx-4 sm:-mx-5 px-4 sm:px-5 py-2 bg-[var(--card)] border-b border-[var(--border)] ${overBudget ? 'border-red-400/60' : ''}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest">
                        <span className={overBudget ? 'text-red-400' : 'text-[var(--accent)]'}>
                          Bots {botsPct}%
                        </span>
                        <span className="text-[var(--muted)]">/</span>
                        <span className="text-[var(--foreground)]">Backers {backerPct}%</span>
                        <span className="text-[var(--muted)]">/</span>
                        {FIXED_LEGS_PCT.burn > 0 && (
                          <>
                            <span className="text-[var(--accent-gold)]">$PLAUNCH burn {FIXED_LEGS_PCT.burn}%</span>
                            <span className="text-[var(--muted)]">/</span>
                          </>
                        )}
                        <span className="text-[var(--muted)]">Fixed {FIXED_LEGS_PCT.total}%</span>
                      </div>
                      <div className={`text-[10px] font-mono uppercase tracking-widest ${overBudget ? 'text-red-400' : botsPct >= budget ? 'text-red-400' : 'text-[var(--success)]'}`}>
                        {overBudget ? `over by ${botsPct - budget}% — bots can take at most ${budget}%` : botsPct >= budget ? 'backers get nothing — lower a bot' : `backers keep ${backerPct}%`}
                      </div>
                    {creatorPct > 0 && !creatorValid && (
                      <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-red-400 leading-relaxed">
                        {creatorPct > CREATOR_MAX_PCT
                          ? `Creator fee is capped at ${CREATOR_MAX_PCT}% — backers keep most of the stream here, by design.`
                          : `Creator fee (${creatorPct}%) cannot exceed what backers keep (${backerPct}%).`}
                      </p>
                    )}
                    {creatorPct > 0 && creatorValid && (
                      <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[var(--warning,#c9a227)] leading-relaxed">
                        You take {creatorPct}% · backers keep {backerPct}% · your campaign page shows this as CREATOR FEE
                      </p>
                    )}
                    </div>
                    <div className="flex h-1.5 mt-1.5 border border-[var(--border)] overflow-hidden">
                      <div className="bg-[var(--accent)]" style={{ width: `${Math.min(botsPct, budget)}%` }} title={`Bots ${botsPct}%`} />
                      <div className="bg-[var(--success)]/70" style={{ width: `${backerPct}%` }} title={`Backers ${backerPct}%`} />
                      {FIXED_LEGS_PCT.burn > 0 && <div className="bg-[var(--accent-gold)]/80" style={{ width: `${FIXED_LEGS_PCT.burn}%` }} title={`$PLAUNCH burn ${FIXED_LEGS_PCT.burn}%`} />}
                      <div className="bg-[var(--muted)]/60" style={{ width: `${FIXED_LEGS_PCT.total - FIXED_LEGS_PCT.burn}%` }} title={`Fixed ${FIXED_LEGS_PCT.total - FIXED_LEGS_PCT.burn}%`} />
                    </div>
                  </div>

                  {/* Whole-stack presets — one tap, then tune if you care. */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      PRESETS
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {STACK_PRESETS.map((ps) => {
                        const burnNow = stack.find((b) => b.kind === 'burn')?.pct ?? '';
                        const active = burnNow === ps.burn && stack.every((b) => b.kind === 'burn' || !Number(b.pct));
                        return (
                          <button key={ps.id} type="button"
                            onClick={() => setStack(ps.burn ? [{ kind: 'burn', pct: ps.burn, addr: '' }, ...stack.filter((b) => b.kind !== 'burn')] : stack.filter((b) => b.kind !== 'burn'))}
                            className={`text-left p-3 border transition-colors ${active ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)] hover:border-[var(--accent)]'}`}>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--foreground)]">{ps.label}{ps.id === 'flywheel' ? <span className="ml-2 text-[var(--accent)]">default</span> : null}</div>
                            <div className="text-[10px] font-mono text-[var(--muted)] mt-1 leading-relaxed">{ps.blurb}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Advanced — the tiles and per-leg dials, collapsed by default. */}
                  <button type="button" onClick={() => setAdvancedOpen((v) => !v)} aria-expanded={advancedOpen}
                    className="flex items-center justify-between w-full text-left text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)] border-t border-[var(--border)] pt-3">
                    <span>Advanced — add or tune legs ({stack.filter((b) => Number(b.pct) > 0).length} active)</span>
                    <span>{advancedOpen ? '▴' : '▾'}</span>
                  </button>
                  <div className={advancedOpen ? 'space-y-2' : 'hidden'}>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      ADD A BOT
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
                      {BOT_ACTIONS.map((opt) => {
                        const alreadyUsed = SINGLE_KINDS.has(opt.kind) && stack.some((b) => b.kind === opt.kind);
                        const vaultsFull = (opt.kind === 'vault' || opt.kind === 'airdrop') && vaultCount >= 3;
                        const disabled = !!opt.disabled || alreadyUsed || vaultsFull || botsPct >= budget;
                        return (
                          <button
                            key={opt.kind}
                            type="button"
                            onClick={() => !disabled && setStack([...stack, { kind: opt.kind as BotKind, pct: '', addr: '' }])}
                            disabled={disabled}
                            className={`text-left p-2.5 border transition-colors ${
                              disabled
                                ? 'border-[var(--border)] bg-[var(--background)] opacity-40 cursor-not-allowed'
                                : 'border-[var(--border)] bg-[var(--background)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-base" aria-hidden>{opt.emoji}</span>
                              <span className="text-xs font-mono font-semibold text-[var(--foreground)] truncate">{opt.label}</span>
                            </div>
                            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
                              {alreadyUsed ? 'added' : opt.tag}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bot cards */}
                  <div className="space-y-2 pt-3 border-t border-[var(--border)]">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      YOUR STACK · {stack.length} BOT{stack.length === 1 ? '' : 'S'}
                    </div>
                    {stack.length === 0 ? (
                      <div className="border border-dashed border-[var(--border)] p-4 text-center">
                        <div className="text-xs font-mono text-[var(--muted)]">
                          Pick an action above to add your first bot.
                        </div>
                      </div>
                    ) : (
                      stack.map((bot, idx) => {
                        const meta = BOT_ACTIONS.find((a) => a.kind === bot.kind)!;
                        const badAddr = bot.kind === 'vault' && Number(bot.pct) > 0 && !/^0x[0-9a-fA-F]{40}$/.test(bot.addr || '');
                        return (
                          <div key={idx} className="border border-[var(--border)] bg-[var(--background)] p-3 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-base" aria-hidden>{meta.emoji}</span>
                                <span className="text-xs font-mono font-semibold">{meta.label}</span>
                                <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--accent)] border border-[var(--accent)]/40 px-1.5 py-0.5 shrink-0">
                                  {meta.tag}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStack(stack.filter((_, j) => j !== idx))}
                                className="px-2 text-[var(--muted)] hover:text-[var(--error)] font-mono"
                                aria-label="Remove bot"
                              >×</button>
                            </div>
                            <p className="text-[10px] font-mono text-[var(--muted)] leading-snug">{meta.desc}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              {bot.kind === 'vault' && (
                                <input
                                  value={bot.addr}
                                  onChange={(e) => setStack(stack.map((x, j) => j === idx ? { ...x, addr: e.target.value } : x))}
                                  placeholder="0x… (marketing / DAO / treasury wallet)"
                                  className={`${inputClass(badAddr)} min-w-[200px] flex-1`}
                                />
                              )}
                              {/* one-tap presets — the fastest way to configure a leg */}
                              <div className="flex gap-1 shrink-0">
                                {PCT_PRESETS.map((pv) => {
                                  const active = bot.pct === pv;
                                  return (
                                    <button
                                      key={pv}
                                      type="button"
                                      onClick={() => setStack(stack.map((x, j) => j === idx ? { ...x, pct: active ? '' : pv } : x))}
                                      aria-pressed={active}
                                      className={`px-2.5 py-1.5 text-[10px] font-mono border transition-colors ${
                                        active
                                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                                          : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50 hover:text-[var(--foreground)]'
                                      }`}
                                    >
                                      {pv}%
                                    </button>
                                  );
                                })}
                              </div>
                              <label className="flex items-center gap-2 shrink-0">
                                <input
                                  value={bot.pct}
                                  onChange={(e) => setStack(stack.map((x, j) => j === idx ? { ...x, pct: e.target.value } : x))}
                                  placeholder="0"
                                  className={`${inputClass()} w-20`}
                                />
                                <span className="text-xs font-mono text-[var(--muted)]">% of fees</span>
                              </label>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Immutable-terms note + submit */}
            <div className="border border-[var(--border)] bg-[var(--card)]/40 p-4 sm:p-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] leading-relaxed">
                Fixed at creation, forever: {backerPct}% of creator trading fees → backers pro-rata ·
                {FIXED_LEGS_PCT.burn > 0 ? `${FIXED_LEGS_PCT.burn}% $PLAUNCH burn · ${FIXED_LEGS_PCT.platform}% platform` : `${FIXED_LEGS_PCT.platform}% platform · ${FIXED_LEGS_PCT.rewards}% retired leg`}{botsPct > 0 ? ` · ${botsPct}% bots` : ''}. The pooled
                buy fires snipe-exempt on the launch block. Goal unmet by deadline → refunds open
                automatically. No admin keys exist.
              </p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
                Creation fee: {myCreationFee !== undefined ? `${Number(myCreationFee) / 1e18} ETH` : '0.001 ETH'} —
                spam control, paid on-chain to the platform. Waived for platform-token holders once it launches.
              </p>
              {!onRhc ? (
                <button
                  onClick={() => switchChain({ chainId: robinhoodChain.id })}
                  disabled={switching}
                  className="btn-primary"
                >
                  {switching ? 'Switching…' : 'Switch to Robinhood Chain First'}
                </button>
              ) : (
                <button
                  onClick={() => setReview(true)}
                  disabled={isPending || uploading || grinding || !f.name || !f.symbol || !f.description || effGoalEth <= 0 || effGoalEth > betaCap || overBudget || !stackValid || !taxValid || !allowlistValid || !gateValid || !creatorValid}
                  className="btn-primary"
                >
                  {uploading ? 'Uploading Image…' : grinding ? `Grinding 0x…${SIGNATURE_SUFFIX.toUpperCase()} address…` : isPending ? 'Confirm in Wallet…' : 'Review & Create'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Live preview rail — the SOL TokenPreviewPanel, twinned ──────────
function CampaignPreviewPanel({ f, imagePreview, stack, backerPct, creatorWallet, taxPct, buyback, raiseStyle, seatPrice, effGoalEth }: {
  f: { name: string; symbol: string; description: string; twitter: string; telegram: string; discord: string; website: string; farcaster: string; github: string; goal: string; min: string; max: string; slots: string };
  imagePreview: string | null;
  stack: BotItem[];
  backerPct: number;
  creatorWallet?: string;
  taxPct: number;
  buyback: boolean;
  raiseStyle: 'open' | 'seats';
  seatPrice: string;
  effGoalEth: number;
}) {
  const displaySymbol = f.symbol.trim() ? f.symbol.trim().toUpperCase() : '???';
  const displayName = f.name.trim() || 'Unnamed Token';
  const botTotal = stack.reduce((s, b) => s + (Number(b.pct) || 0), 0);
  const socials = [
    { label: 'X',   href: f.twitter.trim() },
    { label: 'TG',  href: f.telegram.trim() },
    { label: 'DC',  href: f.discord.trim() },
    { label: 'WEB', href: f.website.trim() },
    { label: 'FC',  href: f.farcaster.trim() },
    { label: 'GH',  href: f.github.trim() },
  ].filter((s) => !!s.href);

  return (
    <aside className="lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] overflow-auto">
      <div
        className="border border-[var(--accent)]/30 bg-[var(--card)]/70 p-4 space-y-4 shadow-xl"
        style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            {'// LIVE_PREVIEW'}
          </span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] border border-[var(--muted)] px-1.5 py-0.5">
            DRAFT
          </span>
        </div>

        {/* Identity row */}
        <div className="flex items-center gap-3">
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt="preview" className="w-14 h-14 object-cover border border-[var(--border)] flex-shrink-0" />
          ) : (
            <div className="w-14 h-14 border border-dashed border-[var(--border)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">IMG</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-mono font-semibold text-[var(--accent)]">${displaySymbol}</div>
            <div className="text-base font-mono font-semibold uppercase tracking-tight truncate text-[var(--foreground)]">
              {displayName}
            </div>
            {creatorWallet && (
              <div className="text-[10px] font-mono text-[var(--muted)] mt-0.5">
                by {creatorWallet.slice(0, 6)}…{creatorWallet.slice(-4)}
              </div>
            )}
          </div>
        </div>

        {socials.length > 0 && (
          <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Token socials</div>
            <div className="flex flex-wrap gap-1">
              {socials.map((s) => (
                <span key={s.label} className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent)]/40 text-[var(--accent)]" title={s.href}>
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {f.description.trim() && (
          <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed border-t border-[var(--border)] pt-2 line-clamp-4">
            {f.description.trim()}
          </p>
        )}

        {/* Key stats — per raise style */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono uppercase tracking-widest border-t border-[var(--border)] pt-3">
          <PreviewStat label="Raise" value={`${effGoalEth} ETH`} tone="accent" />
          {raiseStyle === 'seats' ? (
            <>
              <PreviewStat label="Seat price" value={`${seatPrice} ETH`} tone="gold" />
              <PreviewStat label="Seats" value={f.slots} />
              <PreviewStat label="Entry" value="Equal" />
            </>
          ) : (
            <>
              <PreviewStat label="Backers" value="Unlimited" />
              <PreviewStat label="Min per backer" value={`${f.min || '0'} ETH`} />
              <PreviewStat label="Whale cap" value={Number(f.max) > 0 ? `${f.max} ETH` : 'None'} tone={Number(f.max) > 0 ? 'gold' : 'default'} />
            </>
          )}
          <PreviewStat label="Creator tax" value={`${taxPct}%`} tone="accent" />
          <PreviewStat label="Trader pays" value={`${taxPct + 1}%`} />
          <PreviewStat label="pons buyback" value={buyback ? 'ON' : 'OFF'} tone={buyback ? 'gold' : 'default'} />
        </div>

        {/* Seat grid preview — what the campaign card will show */}
        {raiseStyle === 'seats' && Number(f.slots) >= 2 && Number(f.slots) <= 24 && (
          <div className="border-t border-[var(--border)] pt-3">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Seats</span>
              <span className="text-xs font-mono text-[var(--accent)]">0 / {f.slots}</span>
            </div>
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${Number(f.slots)}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: Number(f.slots) }).map((_, i) => (
                <div key={i} className="h-3 border border-[var(--accent)]" />
              ))}
            </div>
          </div>
        )}

        {/* Fee distribution bar — fixed legs + bots carved from the backer share */}
        <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
            <span className="text-[var(--muted)]">Fee split</span>
            <span className="text-[var(--accent)]">{botTotal}% bots</span>
          </div>
          <div className="flex h-2 border border-[var(--border)] overflow-hidden">
            <div className="bg-[var(--accent)]" style={{ width: `${Math.min(botTotal, 100 - FIXED_LEGS_PCT.total)}%` }} />
            <div className="bg-[var(--success)]/70" style={{ width: `${backerPct}%` }} />
            {FIXED_LEGS_PCT.burn > 0 && <div className="bg-[var(--accent-gold)]/80" style={{ width: `${FIXED_LEGS_PCT.burn}%` }} />}
            <div className="bg-[var(--muted)]/60" style={{ width: `${FIXED_LEGS_PCT.total - FIXED_LEGS_PCT.burn}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-1 text-[9px] font-mono uppercase tracking-widest text-center">
            <div>
              <div className="text-[var(--accent)]">Bots</div>
              <div className="text-[var(--foreground)]">{botTotal}%</div>
            </div>
            <div>
              <div className="text-[var(--muted)]">Backers</div>
              <div className="text-[var(--foreground)]">{backerPct}%</div>
            </div>
            <div>
              <div className="text-[var(--muted)]">{FIXED_LEGS_PCT.burn > 0 ? '$PLAUNCH burn + Platform' : 'Platform + retired'}</div>
              <div className="text-[var(--foreground)]">{FIXED_LEGS_PCT.burn > 0 ? `${FIXED_LEGS_PCT.burn} + ${FIXED_LEGS_PCT.platform}` : `${FIXED_LEGS_PCT.platform} + ${FIXED_LEGS_PCT.rewards}`}%</div>
            </div>
          </div>
        </div>

        {/* Bot stack chips */}
        {stack.length > 0 && (
          <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              Bot stack · {stack.length}
            </div>
            <div className="flex flex-wrap gap-1">
              {stack.map((b, i) => {
                const addr = b.kind === 'vault' ? b.addr?.trim() : undefined;
                const shortAddr = addr && addr.length >= 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : null;
                return (
                  <span key={i} className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--border)] text-[var(--foreground)] flex items-center gap-1">
                    <span aria-hidden>{BOT_EMOJI[b.kind]}</span>
                    <span>{BOT_SHORT[b.kind]}</span>
                    {shortAddr && <span className="text-[var(--muted)] normal-case tracking-normal">→ {shortAddr}</span>}
                    <span className="text-[var(--accent)]">{Number(b.pct) || 0}%</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-[9px] font-mono italic text-[var(--muted)] leading-snug border-t border-[var(--border)] pt-2">
          Preview updates as you fill the form. Every term here becomes immutable contract state at creation.
        </div>
      </div>
    </aside>
  );
}

function PreviewStat({ label, value, tone }: { label: string; value: string; tone?: 'accent' | 'gold' | 'default' }) {
  const cls = tone === 'accent'
    ? 'text-[var(--accent)]'
    : tone === 'gold'
      ? 'text-[var(--accent-gold)]'
      : 'text-[var(--foreground)]';
  return (
    <div>
      <div className="text-[var(--muted)]">{label}</div>
      <div className={`${cls} normal-case tracking-normal text-sm`}>{value}</div>
    </div>
  );
}
