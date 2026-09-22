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
import { AlertCircle, Upload, X } from 'lucide-react';
import {
  POOLLAUNCH_FACTORY_V6, POOLLAUNCH_FACTORY_V7, V7_LIVE, QUOTE_ASSETS, clearBoardCache,
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
type BotKind = 'burn' | 'feed_lp' | 'vault' | 'airdrop';
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
  { kind: 'airdrop', label: 'HOLDER AIRDROP', tag: 'Loyalty · Platform-run',   emoji: '📸', desc: 'ProofLaunch snapshots your token\'s holders and airdrops this leg\'s fees pro-rata — the same machinery as our Solana launches. Platform-operated and labeled so; 🔥 BURN is the trustless holder reward.' },
];
const SINGLE_KINDS = new Set<string>(['burn', 'feed_lp', 'airdrop']);
const BOT_EMOJI: Record<BotKind, string> = { burn: '🔥', feed_lp: '🌊', vault: '🏦', airdrop: '📸' };
const BOT_SHORT: Record<BotKind, string> = { burn: 'BURN', feed_lp: 'POOL FEED', vault: 'VAULT', airdrop: 'AIRDROP' };
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
    twitter: '', telegram: '', discord: '', website: '', farcaster: '',
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
  const [botsEnabled, setBotsEnabled] = useState(false);
  const [stack, setStack] = useState<BotItem[]>([]);
  // pons V2 creator tax: 0–10% of every trade, immutable at launch, earned
  // by the FeeSplitter — i.e. by the backers (90/7/3 of it).
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
  const [allowlistText, setAllowlistText] = useState('');
  const [gateAddr, setGateAddr] = useState('');
  const [gateMin, setGateMin] = useState('');
  const [vanity, setVanity] = useState<{ address: string; attempts: number; ms: number } | null>(null);
  const [grinding, setGrinding] = useState(false);

  const allowlist = allowlistText
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  const allowlistValid = allowlist.every((w) => isAddress(w));
  const gateValid = !gateAddr.trim() || isAddress(gateAddr.trim());
  const [taxPct, setTaxPct] = useState('1');
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
  const bindBanner = async (campaign: string) => {
    if (!bannerUrlRef.current || !address) return;
    setBannerState('signing');
    try { await attachBanner(campaign as `0x${string}`, address, bannerUrlRef.current, signMessageAsync); setBannerState('done'); }
    catch { setBannerState('failed'); }
  };

  const activeStack = botsEnabled ? stack : [];
  const botsPct = activeStack.reduce((s, b) => s + (Number(b.pct) || 0), 0);
  const backerPct = Math.max(0, 90 - botsPct);
  const overBudget = botsPct > 90;
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
            if (bannerUrlRef.current) void bindBanner(campaignAddr);
          }
        } catch { /* not ours */ }
      }
    }
  }, [isSuccess, receipt]);

  const submit = async () => {
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
    const vaultLegs = activeStack.filter((b) => (b.kind === 'vault' || b.kind === 'airdrop') && Number(b.pct) > 0);
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
      socials: { twitter: f.twitter, telegram: f.telegram, discord: f.discord, website: f.website, farcaster: f.farcaster },
      feeWallet: '0x0000000000000000000000000000000000000000' as `0x${string}`, // unused on V2 — the contract sets creatorFeeRecipient = FeeSplitter
    };
    const vaultAddrs = vaultLegs.map((b) => (b.kind === 'airdrop' ? AIRDROP_OPERATOR : (b.addr as `0x${string}`)));
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
      try {
        setGrinding(true);
        const [deployerAddr, legDeployerAddr] = await Promise.all([
          rhcPublicClient.readContract({ address: POOLLAUNCH_FACTORY_V7, abi: factoryV5Abi, functionName: 'campaignDeployer' }),
          rhcPublicClient.readContract({ address: POOLLAUNCH_FACTORY_V7, abi: factoryV5Abi, functionName: 'legDeployer' }),
        ]);
        const legNonce = await rhcPublicClient.getTransactionCount({ address: legDeployerAddr });
        const { burnLeg, lpLeg } = predictLegAddresses(legDeployerAddr, BigInt(legNonce), burnBps > 0, lpBps > 0);
        const initCodeHash = await rhcPublicClient.readContract({
          address: POOLLAUNCH_FACTORY_V7,
          abi: factoryV5Abi,
          functionName: 'previewInitCodeHash',
          args: [address as `0x${string}`, params, burnBps, lpBps, vaultAddrs, vaultBpsArr, burnLeg, lpLeg],
        });
        const g = grindVanitySalt({ deployer: deployerAddr, initCodeHash });
        salt = g.salt;
        if (g.found) setVanity({ address: g.address, attempts: g.attempts, ms: g.ms });
      } catch { /* no signature this time; the raise is unaffected */ }
      setGrinding(false);

      // ERC20-quoted raises escrow the pons launch fee (native ETH) at
      // creation; it comes back via refundLaunchFee if the raise dies.
      const launchFeeEscrow = isNativeQuote ? 0n : PONS_LAUNCH_FEE_WEI;
      writeContract({
        address: POOLLAUNCH_FACTORY_V7,
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
            <h2 className="text-base font-mono font-semibold uppercase tracking-tight mb-2">Campaign is live</h2>
            <p className="text-xs font-mono text-[var(--muted)]">&gt; Share this link with your backers:</p>
            <a
              href={`/rhc/campaign/${created}`}
              className="mt-2 block font-mono text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] break-all"
            >
              prooflaunch.fun/rhc/campaign/{created}
            </a>
            {bannerState !== 'none' && (
              <p className="mt-3 text-[10px] font-mono uppercase tracking-widest">
                {bannerState === 'signing' && <span className="text-[var(--accent)] animate-pulse">&gt; Sign once to attach your banner…</span>}
                {bannerState === 'done' && <span className="text-[var(--success)]">✓ Banner attached</span>}
                {(bannerState === 'failed' || bannerState === 'pending') && (
                  <button type="button" onClick={() => void bindBanner(created)} className="text-[var(--accent)] underline underline-offset-4">
                    Banner not attached yet — sign to attach it
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-8">
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
                          <div>
                            <label className={labelClass}>
                              Allowlist {allowlist.length > 0 && `(${allowlist.length})`}
                            </label>
                            <textarea
                              value={allowlistText}
                              onChange={(e) => setAllowlistText(e.target.value)}
                              placeholder="0xabc…  0xdef…  (one per line)"
                              rows={3}
                              className={`${inputClass(!allowlistValid)} resize-none normal-case tracking-normal`}
                            />
                          </div>
                        </div>
                        {!allowlistValid && (
                          <p className="text-xs font-mono text-[var(--error)]">
                            One of those is not a valid address.
                          </p>
                        )}
                        {reservedN > 0 && allowlist.length < reservedN && (
                          <p className="text-[10px] font-mono text-[var(--warning)] uppercase tracking-widest">
                            {reservedN} seats reserved but only {allowlist.length} wallet
                            {allowlist.length === 1 ? '' : 's'} allowlisted — the rest would sit
                            unclaimable until the deadline.
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
                    LAUNCH BOTS · PROGRAMMABLE TOKENOMICS
                  </div>
                  <div className="text-sm font-mono text-[var(--foreground)]">
                    Stack actions + named vault legs
                  </div>
                  <p className="text-xs font-mono text-[var(--muted)] leading-relaxed max-w-md">
                    Each bot becomes a fee leg on your campaign&apos;s splitter, carved from the
                    backer share — immutable from creation, pull-based forever. Burn and Pool
                    Feeder run as ownerless contracts on the Uniswap-v4 pool: anyone can crank
                    them, nobody can stop them, nobody can change them.
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={botsEnabled}
                    onChange={(e) => setBotsEnabled(e.target.checked)}
                    className="w-4 h-4 accent-[var(--accent)]"
                  />
                  <span className="text-xs font-mono uppercase tracking-wider text-[var(--foreground)]">
                    {botsEnabled ? 'ON' : 'OFF'}
                  </span>
                </label>
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
                        <span className="text-[var(--muted)]">Platform 10%</span>
                      </div>
                      <div className={`text-[10px] font-mono uppercase tracking-widest ${overBudget ? 'text-red-400' : botsPct >= 90 ? 'text-[var(--muted)]' : 'text-[var(--accent)]'}`}>
                        {overBudget ? 'over budget' : botsPct >= 90 ? 'budget full' : `${90 - botsPct}% left`}
                      </div>
                    </div>
                    <div className="flex h-1.5 mt-1.5 border border-[var(--border)] overflow-hidden">
                      <div className="bg-[var(--accent)]/60" style={{ width: `${Math.min(botsPct, 90)}%` }} />
                      <div className="bg-[var(--foreground)]/20" style={{ width: `${backerPct}%` }} />
                      <div className="bg-[var(--muted)]/40" style={{ width: '10%' }} />
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

                  {/* Action picker — always-visible tiles. Tap to add. */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      ADD A BOT
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
                      {BOT_ACTIONS.map((opt) => {
                        const alreadyUsed = SINGLE_KINDS.has(opt.kind) && stack.some((b) => b.kind === opt.kind);
                        const vaultsFull = (opt.kind === 'vault' || opt.kind === 'airdrop') && vaultCount >= 3;
                        const disabled = !!opt.disabled || alreadyUsed || vaultsFull || botsPct >= 90;
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
                7% platform · 3% holder rewards{botsPct > 0 ? ` · ${botsPct}% bots` : ''}. The pooled
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
                  onClick={submit}
                  disabled={isPending || uploading || grinding || !f.name || !f.symbol || !f.description || effGoalEth <= 0 || effGoalEth > betaCap || overBudget || !stackValid || !taxValid || !allowlistValid || !gateValid}
                  className="btn-primary"
                >
                  {uploading ? 'Uploading Image…' : grinding ? `Grinding 0x…${SIGNATURE_SUFFIX.toUpperCase()} address…` : isPending ? 'Confirm in Wallet…' : 'Create Campaign'}
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
  f: { name: string; symbol: string; description: string; twitter: string; telegram: string; discord: string; website: string; farcaster: string; goal: string; min: string; max: string; slots: string };
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

        {/* Fee distribution bar — 90/7/3 with bots carved from the 90 */}
        <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
            <span className="text-[var(--muted)]">Fee split</span>
            <span className="text-[var(--accent)]">{botTotal}% bots</span>
          </div>
          <div className="flex h-2 border border-[var(--border)] overflow-hidden">
            <div className="bg-[var(--accent)]/60" style={{ width: `${Math.min(botTotal, 90)}%` }} />
            <div className="bg-[var(--foreground)]/30" style={{ width: `${backerPct}%` }} />
            <div className="bg-[var(--muted)]/50" style={{ width: '10%' }} />
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
              <div className="text-[var(--muted)]">Platform + Rewards</div>
              <div className="text-[var(--foreground)]">10%</div>
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
