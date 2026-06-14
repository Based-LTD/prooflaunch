'use client';

import { useState, useRef, useEffect, Suspense } from 'react';

// Phase B — Bot stack action type. Keep in sync with VALID_BOT_ACTIONS
// in /api/memes/route.ts and src/services/buybackBot.ts.
type BotActionT =
  | 'burn'
  | 'hold'
  | 'distribute_tokens_holders'
  | 'distribute_tokens_backers'
  | 'distribute_sol_holders'
  | 'distribute_sol_backers'
  | 'donate_sol'
  | 'donate_tokens'
  | 'feed_lp';

interface BotActionMeta {
  value: BotActionT;
  label: string;
  tag: string;
  short: string;
  desc: string;
  emoji: string;
}
// Action display metadata. DB enum value stays as `hold` but the UI
// surfaces it as VAULT — vaults are labeled, multiple-per-meme, and
// creator-withdrawable (operational bots are sealed).
// Action label/desc text varies with the meme's quote currency: SOL memes
// see 'SOL → HOLDERS' / 'DONATE SOL'; USDC memes see 'USDC → HOLDERS' /
// 'DONATE USDC'. The action enum stays the same so the DB schema and
// downstream code don't need to know the difference.
function botActionsForQuote(qc: 'sol' | 'usdc'): BotActionMeta[] {
  const Q = qc === 'usdc' ? 'USDC' : 'SOL';
  const ql = qc === 'usdc' ? 'USDC' : 'SOL';
  return [
    { value: 'burn',                       label: 'BURN',                short: 'Burn',                tag: 'Deflationary', emoji: '🔥', desc: `Swap delegated ${Q} → token then burnChecked the result. Every cycle permanently removes supply from the circulating set.` },
    { value: 'hold',                       label: 'HOLD',                short: 'Vault',               tag: 'Treasury',     emoji: '🏦', desc: `Swap delegated ${Q} → token and HOLD the tokens in a labeled vault wallet. Creator-withdrawable; supports unlimited labeled vaults (Marketing, DAO, Liquidity).` },
    { value: 'distribute_tokens_holders',  label: 'TOKENS → HOLDERS',    short: 'Tokens→Holders',      tag: 'Loyalty',      emoji: '🪙', desc: `Swap delegated ${Q} → token, airdrop pro-rata to current holders. Every cycle deepens the loyalty ladder.` },
    { value: 'distribute_tokens_backers',  label: 'TOKENS → BACKERS',    short: 'Tokens→Backers',      tag: 'OG reward',    emoji: '🎯', desc: `Swap delegated ${Q} → token, airdrop pro-rata to genesis backers. OG-reward incentive that rewards the people who funded the launch.` },
    { value: 'distribute_sol_holders',     label: `${ql} → HOLDERS`,     short: `${ql}→Holders`,       tag: 'Distribution', emoji: '💸', desc: `Skip the swap. Route delegated ${Q} pro-rata to every current holder as a protocol distribution.` },
    { value: 'distribute_sol_backers',     label: `${ql} → BACKERS`,     short: `${ql}→Backers`,       tag: 'Distribution', emoji: '💰', desc: `Skip the swap. Route delegated ${Q} pro-rata to the genesis backers as a protocol distribution.` },
    { value: 'donate_sol',                 label: `DONATE ${ql}`,        short: `Donate ${ql}`,        tag: 'Commitment',   emoji: '🎁', desc: `Send ${Q} straight to a fixed destination wallet you name (charity, DAO, partner). Address is locked in at submit — can never be changed.` },
    { value: 'donate_tokens',              label: 'DONATE TOKENS',       short: 'Donate Tokens',       tag: 'Commitment',   emoji: '🎀', desc: `Buy tokens, send them to a fixed destination wallet. Same immutable-address commitment as DONATE ${ql}.` },
    { value: 'feed_lp',                    label: 'POOL FEEDER',         short: 'Pool Feeder',         tag: 'Liquidity',    emoji: '🌊', desc: `Deepen the LP after graduation. Bot swaps half ${Q} into tokens, deposits both as locked liquidity, owns the LP position forever. Activates the moment the token graduates from the bonding curve to a full AMM pool.` },
  ];
}

// Default action list (SOL) — used by validation helpers that don't have
// access to the current form state. The display picker uses the quote-
// aware function above.
const BOT_ACTIONS: BotActionMeta[] = [
  { value: 'burn',                       label: 'BURN',                short: 'Burn',                tag: 'Deflationary', emoji: '🔥', desc: 'Buy tokens, burn them. Permanent supply reduction.' },
  { value: 'hold',                       label: 'VAULT',               short: 'Vault',               tag: 'Treasury',     emoji: '🏦', desc: 'Buy tokens, park them in a labeled vault wallet you can withdraw from anytime (e.g. Marketing, DAO, Liquidity).' },
  { value: 'distribute_tokens_holders',  label: 'TOKENS → HOLDERS',    short: 'Tokens→Holders',      tag: 'Loyalty',      emoji: '🪙', desc: 'Buy tokens, airdrop pro-rata to every current holder. Drives volume + rewards holding.' },
  { value: 'distribute_tokens_backers',  label: 'TOKENS → BACKERS',    short: 'Tokens→Backers',      tag: 'OG reward',    emoji: '🎯', desc: 'Buy tokens, airdrop pro-rata to the genesis backers who launched this token.' },
  { value: 'distribute_sol_holders',     label: 'SOL → HOLDERS',       short: 'SOL→Holders',         tag: 'Distribution', emoji: '💸', desc: 'Skip the swap. Route delegated SOL pro-rata to every current holder as a protocol distribution.' },
  { value: 'distribute_sol_backers',     label: 'SOL → BACKERS',       short: 'SOL→Backers',         tag: 'Distribution', emoji: '💰', desc: 'Skip the swap. Route delegated SOL pro-rata to the genesis backers as a protocol distribution.' },
  // DONATE — fire-and-forget to a fixed wallet (charity, DAO, partner).
  // Destination is set at submit and immutable: the entire commitment
  // value comes from publicly burning the optionality to redirect.
  { value: 'donate_sol',                 label: 'DONATE SOL',          short: 'Donate SOL',          tag: 'Commitment',   emoji: '🎁', desc: 'Send SOL straight to a fixed destination wallet you name (charity, DAO, partner). Address is locked in at submit — can never be changed.' },
  { value: 'donate_tokens',              label: 'DONATE TOKENS',       short: 'Donate Tokens',       tag: 'Commitment',   emoji: '🎀', desc: 'Buy tokens, send them to a fixed destination wallet. Same immutable-address commitment as DONATE SOL.' },
  // POOL_FEEDER — protocol-owned liquidity. Pre-graduation: accumulates SOL.
  // Post-graduation: swaps half SOL → tokens, deposits both into the AMM,
  // bot wallet owns the LP position forever. Every batch deepens the pool.
  { value: 'feed_lp',                    label: 'POOL FEEDER',         short: 'Pool Feeder',         tag: 'Liquidity',    emoji: '🌊', desc: 'Deepen the LP after graduation. Bot swaps half SOL into tokens, deposits both as locked liquidity, owns the LP position forever. Activates the moment the token graduates from the bonding curve to a full AMM pool (PumpSwap for Pump.fun, DAMM v2 for Meteora).' },
];
const BOT_ACTION_BY_VALUE = Object.fromEntries(BOT_ACTIONS.map((a) => [a.value, a]));

// Label rules MUST match supabase/migrations/042_vault_labels.sql:
// 1-24 chars, alphanumerics + space/underscore/hyphen only.
const VAULT_LABEL_PATTERN = /^[A-Za-z0-9 _\-]+$/;
function isValidVaultLabel(s: string): boolean {
  return s.length >= 1 && s.length <= 24 && VAULT_LABEL_PATTERN.test(s);
}

// Solana base58 pubkey: 32-44 chars, alphabet excludes 0/I/O/l.
const SOL_PUBKEY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function isValidSolPubkey(s: string): boolean {
  return SOL_PUBKEY_PATTERN.test(s);
}

const REPEATABLE_ACTIONS: ReadonlySet<BotActionT> = new Set(['hold', 'donate_sol', 'donate_tokens']);
const DONATE_ACTIONS: ReadonlySet<BotActionT> = new Set(['donate_sol', 'donate_tokens']);

// Bot stack item — `label` required for hold, optional for donate, absent
// for others. `destination_wallet` required for donate, absent otherwise.
// Mirrors what /api/memes accepts + the DB CHECK in migration 043.
type BotStackItem = {
  action: BotActionT;
  fee_pct: number;
  label?: string;
  destination_wallet?: string;
  // Optional bot lifetime in months. undefined = forever. The submit
  // route converts months → an ISO timestamp before persisting to
  // meme_bots.expires_at (migration 055). Once expired, the bot is
  // skipped by both the buyback cron and the fee-delegation path.
  duration_months?: number;
};

// Lifetime presets the picker offers per bot. `null` = forever.
const BOT_DURATION_OPTIONS: Array<{ months: number | null; label: string }> = [
  { months: null, label: 'Forever' },
  { months: 1,    label: '1 month' },
  { months: 3,    label: '3 months' },
  { months: 6,    label: '6 months' },
  { months: 12,   label: '12 months' },
];

// Single source of truth for bot-stack validation. Used both inside the
// stack-builder UI and to gate the submit button at the form level.
function validateBotStack(stack: BotStackItem[]): { ok: boolean; reason?: string } {
  const total = stack.reduce((s, b) => s + b.fee_pct, 0);
  if (total > 90) return { ok: false, reason: 'total delegation > 90%' };
  if (stack.some((b) => b.fee_pct < 5 || b.fee_pct > 90))
    return { ok: false, reason: 'bot fee out of 5-90% range' };

  // Single-instance actions (burn, distribute_*) can't repeat. Hold +
  // donate variants are allowed to repeat (different label / destination).
  const seenSingleAction = new Set<string>();
  for (const b of stack) {
    if (REPEATABLE_ACTIONS.has(b.action)) continue;
    if (seenSingleAction.has(b.action)) return { ok: false, reason: 'duplicate single-instance action' };
    seenSingleAction.add(b.action);
  }

  // VAULT label rules.
  for (const b of stack) {
    if (b.action === 'hold') {
      if (!b.label || !isValidVaultLabel(b.label))
        return { ok: false, reason: 'invalid vault label' };
    }
  }
  // Duplicate vault labels (UX, not DB).
  const labelKeys = new Map<string, number>();
  for (const b of stack) {
    if (b.action === 'hold' && b.label) {
      const k = b.label.trim().toLowerCase();
      labelKeys.set(k, (labelKeys.get(k) || 0) + 1);
    }
  }
  if ([...labelKeys.values()].some((n) => n > 1))
    return { ok: false, reason: 'duplicate vault labels' };

  // DONATE rules: destination_wallet required + valid pubkey; optional
  // label must pass the same alphabet rule as vault labels; no two
  // donate bots of same action+destination.
  const seenDonate = new Set<string>();
  for (const b of stack) {
    if (!DONATE_ACTIONS.has(b.action)) continue;
    if (!b.destination_wallet || !isValidSolPubkey(b.destination_wallet.trim()))
      return { ok: false, reason: 'invalid donate destination wallet' };
    if (b.label && !isValidVaultLabel(b.label))
      return { ok: false, reason: 'invalid donate label' };
    const key = `${b.action}::${b.destination_wallet.trim()}`;
    if (seenDonate.has(key))
      return { ok: false, reason: 'duplicate donate destination' };
    seenDonate.add(key);
  }

  return { ok: true };
}

import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Upload, AlertCircle, X, CheckCircle, ChevronDown, Zap, Loader2 } from 'lucide-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { CreatorPastLaunches } from '@/components/CreatorPastLaunches';
import { TokenPreviewPanel } from '@/components/submit/TokenPreviewPanel';

// Creation fee in SOL (goes to escrow to cover launch costs like metadata rent)
const CREATION_FEE_SOL = 0.02;

// Launch Config v2 — fee distribution presets.
//
// SHIPPED v1 (only backer + platform splits are honored at distribution
// time right now). Holder rewards / burn / charity will light up as
// Phase 3 ships the infrastructure (buyback bot for burn, etc.).
// Until then, the DB schema accepts them but UI only exposes the two
// destinations we can actually move SOL to. No false promises.
type FeePreset = 'standard' | 'community_first' | 'deflationary' | 'charity_aligned' | 'custom';
const FEE_PRESETS: Record<'standard', {
  label: string; tagline: string;
  backer: number; holder: number; platform: number; burn: number; charity: number;
}> = {
  standard: {
    label: 'STANDARD',
    tagline: '90% to backers, 10% to platform. The default.',
    backer: 90, holder: 0, platform: 10, burn: 0, charity: 0,
  },
};

// Validation helpers
// Forbidden-words filter removed — created false positives on legit
// token names like "Rug Proof", "Scam Protection", "Hack Defense",
// "Stealth Mode", etc. Pump.fun + the broader market handle
// quality/legitimacy signals already; we don't add value by
// pre-filtering names here.
const URL_PATTERN = /^https?:\/\/[^\s]+$/;
const TWITTER_PATTERN = /^https?:\/\/(x\.com|twitter\.com)\/[^\s]+$/i;
const TELEGRAM_PATTERN = /^https?:\/\/t\.me\/[^\s]+$/i;
const DISCORD_PATTERN = /^https?:\/\/discord\.(gg|com)\/[^\s]+$/i;
const GITHUB_PATTERN = /^https?:\/\/(www\.)?github\.com\/[^\s]+$/i;

interface ValidationErrors {
  name?: string;
  symbol?: string;
  description?: string;
  creatorTwitter?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  discord?: string;
  github?: string;
}

function validateName(name: string): string | undefined {
  if (!name.trim()) return 'Name is required';
  if (name.trim().length < 2) return 'Name must be at least 2 characters';
  if (name.trim().length > 32) return 'Name must be 32 characters or less';
  if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return 'Name can only contain letters, numbers, spaces, hyphens, and underscores';
  }
  return undefined;
}

function validateSymbol(symbol: string): string | undefined {
  if (!symbol.trim()) return 'Symbol is required';
  if (symbol.trim().length < 2) return 'Symbol must be at least 2 characters';
  if (symbol.trim().length > 10) return 'Symbol must be 10 characters or less';
  if (!/^[A-Za-z0-9]+$/.test(symbol)) {
    return 'Symbol can only contain letters and numbers';
  }
  return undefined;
}

function validateDescription(description: string): string | undefined {
  if (description.length > 500) return 'Description must be 500 characters or less';
  return undefined;
}

function validateUrl(url: string, pattern?: RegExp, name?: string): string | undefined {
  if (!url) return undefined; // Optional field
  if (!URL_PATTERN.test(url)) return `Please enter a valid URL starting with http:// or https://`;
  if (pattern && !pattern.test(url)) return `Please enter a valid ${name} URL`;
  return undefined;
}

interface PartnerSessionPrefill {
  session_id: string;
  status: string;
  name: string;
  symbol: string;
  description: string;
  image_url: string | null;
  creator_wallet: string;
  total_slots: number;
  min_backing_sol: number;
  socials: { twitter?: string; telegram?: string; discord?: string; website?: string };
  return_url: string | null;
  partner: { slug: string; display_name: string } | null;
}

// Next 15 requires useSearchParams to live inside a <Suspense> boundary —
// otherwise it bails the entire page out of static rendering AND fails
// the production build. Splitting the page in two: the default export is
// the Suspense wrapper, and SubmitPageInner holds all the real logic.
export default function SubmitPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
      </div>
    }>
      <SubmitPageInner />
    </Suspense>
  );
}

function SubmitPageInner() {
  const { connected, publicKey, signTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: '',
    totalSlots: 4,
    // Reserved slots (Phase 7) — creator can pre-reserve N of total
    // for specific allowlisted wallets; the launch stays publicly
    // visible + publicly backable for the remaining (total - reserved)
    // open slots. 0 = fully open launch.
    reservedSlots: 0,
    minBackingSol: 0.1,
    // Migration 056 — tiered per-backer ceilings. 0 (UI sentinel) =
    // uncapped for that tier. Creator can dial each tier independently:
    //   maxBackingSolCreator → cap on the creator wallet
    //   maxBackingSolTeam    → cap on allowlisted (team) backers
    //   maxBackingSolPublic  → cap on open-bucket public backers
    // Legacy maxBackingSol kept as a uniform fallback when none of the
    // three tier-specific values is set.
    maxBackingSol: 0,
    maxBackingSolCreator: 0,
    maxBackingSolTeam: 0,
    maxBackingSolPublic: 0,
    creatorTwitter: '',
    twitter: '',
    website: '',
    telegram: '',
    discord: '',
    github: '',
    // Visibility removed from the UI 2026-05-30 — all new launches are
    // OPEN. The API still accepts the field for backward compat with
    // legacy memes; we just hardcode 'open' on the payload.
    // Newline-separated wallet addresses for the initial allowlist —
    // only meaningful when reserved_slots > 0. Creator's own wallet is
    // auto-added by the API.
    allowlistText: '',
    // Launch Configuration v2 — fee distribution preset + percentages.
    // Default 'standard' = 90 backer / 10 platform (matches what the
    // existing non-legacy distribution code does today). Other destinations
    // (holder rewards / burn / charity) require infrastructure shipping
    // in Phase 3; UI hides those fields until they actually work.
    feePreset: 'standard' as 'standard' | 'community_first' | 'deflationary' | 'charity_aligned' | 'custom',
    feeBackerPct: 90,
    feeHolderRewardsPct: 0,
    feePlatformPct: 10,
    feeBurnPct: 0,
    feeCharityPct: 0,
    feeCharityWallet: '',
    // Phase B — Bot stack (programmable tokenomics). The creator builds
    // a stack of up to 6 bots; each bot picks one of 6 actions and a
    // fee % delegation. Total stack delegation ≤ 90% (10% always to
    // platform). Whatever's left after bots goes to backers.
    botStackEnabled: false,
    botStack: [] as BotStackItem[],
    // Multi-launchpad selector (migration 046). Pump.fun is the only
    // platform live today; Meteora / Bags / Bonk shown for transparency
    // with "Coming soon" gating in the UI. Default preserves legacy
    // behavior for every existing submission path.
    launchPlatform: 'pumpfun' as 'pumpfun' | 'meteora' | 'bags' | 'bonk' | 'launchlab',
    // Quote currency (migration 053). 'sol' is default. 'usdc' is only
    // valid when launchPlatform='meteora' — the picker cross-validates
    // so the creator can't ship an unlaunchable combo.
    quoteCurrency: 'sol' as 'sol' | 'usdc',
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  // Optional X-style 1500×500 banner. Same upload route as the logo
  // but routes to banners/ via the `kind=banner` form field.
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Partner-checkout session state — populated only when arriving via
  // ?session=pls_xxx (e.g. from a partner-hosted "Launch on Proof" button).
  // When present, we prefill the form with values the partner supplied
  // and surface their identity in the header so the user knows the launch
  // will be attributed back to them.
  const [partnerSession, setPartnerSession] = useState<PartnerSessionPrefill | null>(null);
  const [partnerSessionError, setPartnerSessionError] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/sessions/${sessionId}/prefill`);
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setPartnerSessionError(j?.error?.message || 'Checkout session is no longer valid.');
          return;
        }
        setPartnerSession(j);
        setFormData(prev => ({
          ...prev,
          name: j.name || prev.name,
          symbol: j.symbol || prev.symbol,
          description: j.description || prev.description,
          totalSlots: j.total_slots || prev.totalSlots,
          minBackingSol: j.min_backing_sol || prev.minBackingSol,
          twitter: j.socials?.twitter || prev.twitter,
          telegram: j.socials?.telegram || prev.telegram,
          discord: j.socials?.discord || prev.discord,
          website: j.socials?.website || prev.website,
        }));
        if (j.image_url && !imagePreview) setImagePreview(j.image_url);
      } catch {
        if (!cancelled) setPartnerSessionError('Failed to load checkout session.');
      }
    })();
    return () => { cancelled = true; };
    // imagePreview intentionally excluded — we only set it on initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // PROOF-holder free-submission check (re-evaluates when wallet changes)
  const [submissionCost, setSubmissionCost] = useState<{
    fee_sol: number;
    free: boolean;
    threshold_tokens: number;
    your_balance_tokens: number | null;
  } | null>(null);
  useEffect(() => {
    const w = publicKey?.toBase58();
    const url = w ? `/api/memes/submission-cost?wallet=${w}` : '/api/memes/submission-cost';
    fetch(url)
      .then(r => r.json())
      .then(setSubmissionCost)
      .catch(() => setSubmissionCost(null));
  }, [publicKey]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Allowlist chip-input state. The textarea got replaced by a tag-style
  // input — paste an address, press Enter (or click +), validate as
  // base58 pubkey, append to the chip list. We keep formData.allowlistText
  // as the canonical store (newline-separated) so the submit payload
  // shape is unchanged; the chips are just a derived view.
  const [allowlistInput, setAllowlistInput] = useState('');
  const [allowlistError, setAllowlistError] = useState<string | null>(null);

  const validateForm = (): boolean => {
    const errors: ValidationErrors = {
      name: validateName(formData.name),
      symbol: validateSymbol(formData.symbol),
      description: validateDescription(formData.description),
      creatorTwitter: validateUrl(formData.creatorTwitter, TWITTER_PATTERN, 'X/Twitter'),
      twitter: validateUrl(formData.twitter, TWITTER_PATTERN, 'X/Twitter'),
      website: validateUrl(formData.website),
      telegram: validateUrl(formData.telegram, TELEGRAM_PATTERN, 'Telegram'),
      discord: validateUrl(formData.discord, DISCORD_PATTERN, 'Discord'),
      github: validateUrl(formData.github, GITHUB_PATTERN, 'GitHub'),
    };
    Object.keys(errors).forEach(key => {
      if (errors[key as keyof ValidationErrors] === undefined) {
        delete errors[key as keyof ValidationErrors];
      }
    });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    let error: string | undefined;
    switch (field) {
      case 'name': error = validateName(formData.name); break;
      case 'symbol': error = validateSymbol(formData.symbol); break;
      case 'description': error = validateDescription(formData.description); break;
      case 'creatorTwitter': error = validateUrl(formData.creatorTwitter, TWITTER_PATTERN, 'X/Twitter'); break;
      case 'twitter': error = validateUrl(formData.twitter, TWITTER_PATTERN, 'X/Twitter'); break;
      case 'website': error = validateUrl(formData.website); break;
      case 'telegram': error = validateUrl(formData.telegram, TELEGRAM_PATTERN, 'Telegram'); break;
      case 'discord': error = validateUrl(formData.discord, DISCORD_PATTERN, 'Discord'); break;
      case 'github': error = validateUrl(formData.github, GITHUB_PATTERN, 'GitHub'); break;
    }
    setFieldErrors(prev => ({ ...prev, [field]: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !publicKey || !signMessage) return;
    setTouched({
      name: true, symbol: true, description: true, creatorTwitter: true,
      twitter: true, website: true, telegram: true, discord: true,
    });
    if (!validateForm()) {
      setError('Please fix the errors above before submitting');
      return;
    }
    if (!formData.name.trim()) { setError('Name is required'); return; }
    if (!formData.symbol.trim()) { setError('Symbol is required'); return; }
    if (!formData.description.trim()) { setError('Description is required'); return; }

    setIsSubmitting(true);
    setError(null);
    try {
      const configRes = await fetch('/api/config');
      if (!configRes.ok) throw new Error('Failed to get platform config');
      const config = await configRes.json();
      const escrowAddress = config.escrow_address;
      if (!escrowAddress) throw new Error('Escrow address not configured');

      let signature: string | undefined;
      const qualifiesFree = submissionCost?.free === true;
      if (!qualifiesFree) {
        const creationFeeLamports = CREATION_FEE_SOL * LAMPORTS_PER_SOL;
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(escrowAddress),
            lamports: creationFeeLamports,
          })
        );
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;
        const signed = await signTransaction!(transaction);
        signature = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      }

      let imageUrl = 'https://placehold.co/400x400/1a1a2e/ffffff?text=' + formData.symbol;
      // Upload the user's file to Supabase Storage and use the resulting
      // CDN URL. Historically we shipped the FileReader base64 data URL
      // straight into the DB, which bloated the landing payload to ~10 MB
      // for 8 tokens. /api/upload/image returns a public token-assets URL.
      if (imageFile) {
        const fd = new FormData();
        fd.append('file', imageFile);
        const upRes = await fetch('/api/upload/image', { method: 'POST', body: fd });
        if (!upRes.ok) {
          const j = await upRes.json().catch(() => ({}));
          throw new Error(j.error || 'Image upload failed');
        }
        const upJson = await upRes.json();
        imageUrl = upJson.url;
      } else if (imagePreview && partnerSession?.image_url) {
        // Partner-supplied URL — already a real URL, no upload needed.
        imageUrl = partnerSession.image_url;
      }

      // Optional X-style banner. Same upload route, kind=banner routes
      // the file to banners/<sha256>.<ext> instead of logos/.
      let bannerUrl: string | undefined;
      if (bannerFile) {
        const fd = new FormData();
        fd.append('file', bannerFile);
        fd.append('kind', 'banner');
        const upRes = await fetch('/api/upload/image', { method: 'POST', body: fd });
        if (!upRes.ok) {
          const j = await upRes.json().catch(() => ({}));
          throw new Error(j.error || 'Banner upload failed');
        }
        const upJson = await upRes.json();
        bannerUrl = upJson.url;
      }

      // Sign a wallet-bound auth message so the server can prove this POST
      // was authorized by the holder of creator_wallet (and not a stranger
      // impersonating them). 5-min replay window enforced server-side.
      const authMessage = `create-meme:${publicKey.toBase58()}:${Date.now()}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);

      const response = await fetch('/api/memes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_wallet: publicKey.toBase58(),
          auth_signature: sigB58,
          auth_message: authMessage,
          name: formData.name.trim(),
          symbol: formData.symbol.toUpperCase().trim(),
          description: formData.description.trim(),
          image_url: imageUrl,
          banner_url: bannerUrl,
          creator_twitter: formData.creatorTwitter || undefined,
          twitter: formData.twitter || undefined,
          telegram: formData.telegram || undefined,
          discord: formData.discord || undefined,
          website: formData.website || undefined,
          github: formData.github || undefined,
          total_slots: formData.totalSlots,
          reserved_slots: formData.reservedSlots,
          min_backing_sol: formData.minBackingSol,
          max_backing_sol: formData.maxBackingSol > 0 ? formData.maxBackingSol : null,
          // Tiered caps (migration 056). Each is optional; the backings
          // API picks the right one based on backer tier.
          max_backing_sol_creator: formData.maxBackingSolCreator > 0 ? formData.maxBackingSolCreator : null,
          max_backing_sol_team:    formData.maxBackingSolTeam    > 0 ? formData.maxBackingSolTeam    : null,
          max_backing_sol_public:  formData.maxBackingSolPublic  > 0 ? formData.maxBackingSolPublic  : null,
          backing_days: 3,
          creation_fee_signature: signature,
          creation_fee_sol: signature ? CREATION_FEE_SOL : undefined,
          // Partner attribution — when present the API will look up the
          // session, verify it's pending + not expired + creator matches,
          // attach partner_id/partner_session_id to the meme row, and mark
          // the session submitted (triggering any partner webhook).
          partner_session_id: partnerSession?.session_id,
          // Multi-launchpad dispatch key (migration 046). Pump.fun is
          // the only live platform today; others are gated in the UI
          // so this should always be 'pumpfun' for now, but we wire
          // the round-trip end-to-end so flipping the gate is one PR.
          launch_platform: formData.launchPlatform,
          quote_currency: formData.quoteCurrency,
          // All new launches default to OPEN. Visibility selector removed
          // from the UI 2026-05-30; the API still accepts the field so
          // legacy memes keep their stealth/spectator state until they
          // launch. Allowlist is only meaningful for reserved_slots > 0.
          visibility: 'open',
          initial_allowlist: formData.reservedSlots === 0
            ? []
            : formData.allowlistText
                .split(/[\s,]+/)
                .map((w) => w.trim())
                .filter(Boolean),
          // Launch Config v2 — fee distribution config
          fee_preset: formData.feePreset,
          fee_backer_pct: formData.feeBackerPct,
          fee_holder_rewards_pct: formData.feeHolderRewardsPct,
          fee_platform_pct: formData.feePlatformPct,
          fee_burn_pct: formData.feeBurnPct,
          fee_charity_pct: formData.feeCharityPct,
          fee_charity_wallet: formData.feeCharityPct > 0 ? formData.feeCharityWallet : null,
          // Phase B — Bot stack (programmable tokenomics). API accepts
          // either legacy single-bot fields or `bots[]`. We always send
          // bots[] when the stack is enabled; backend handles legacy
          // backfill for single-bot stacks automatically.
          bots: formData.botStackEnabled
            ? formData.botStack.map((b) => {
                // Common fields for every bot — optional duration_months
                // is passed through unchanged. The API converts it into
                // expires_at (now + months). Omitted → run forever.
                const duration = typeof b.duration_months === 'number' ? { duration_months: b.duration_months } : {};
                if (b.action === 'hold') {
                  return { action: b.action, fee_pct: b.fee_pct, label: (b.label ?? '').trim(), ...duration };
                }
                if (DONATE_ACTIONS.has(b.action)) {
                  return {
                    action: b.action,
                    fee_pct: b.fee_pct,
                    destination_wallet: (b.destination_wallet ?? '').trim(),
                    label: b.label?.trim() || undefined,
                    ...duration,
                  };
                }
                return { action: b.action, fee_pct: b.fee_pct, ...duration };
              })
            : [],
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit token');
      }
      const data = await response.json();
      setSuccess(true);
      // If partner provided a return_url, bounce back to their app with
      // the new meme_id appended so they can route their user to the
      // launched-token view. Otherwise land on our own meme page.
      setTimeout(() => {
        if (partnerSession?.return_url) {
          const url = new URL(partnerSession.return_url);
          url.searchParams.set('meme_id', data.meme.id);
          url.searchParams.set('status', 'submitted');
          window.location.href = url.toString();
        } else {
          router.push(`/meme/${data.meme.id}`);
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox'
        ? checked
        : ['totalSlots', 'minBackingSol', 'maxBackingSol', 'maxBackingSolCreator', 'maxBackingSolTeam', 'maxBackingSolPublic', 'reservedSlots'].includes(name) ? Number(value) : value
    }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be under 5MB');
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Banner upload handler. Same upload route + 2 MB cap (enforced by
  // both the bucket and /api/upload/image). X banner aspect = 3:1
  // (1500×500); we don't reject off-ratio uploads but warn the creator.
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBannerError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setBannerError(`Banner must be under 2 MB (you have ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
    setBannerFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setBannerPreview(dataUrl);
      // Off-ratio warn (3:1 = X banner). Non-blocking — creators can
      // ship any aspect they want.
      const img = new Image();
      img.onload = () => {
        const ratio = img.width / img.height;
        if (Math.abs(ratio - 3) > 0.3) {
          setBannerError(
            `Tip: X banners are 1500×500 (3:1). Yours is ${img.width}×${img.height} — it'll render but may crop.`,
          );
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };
  const removeBanner = () => {
    setBannerPreview(null);
    setBannerFile(null);
    setBannerError(null);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  // ── Success state ──────────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="border border-[var(--success)] bg-[var(--card)]">
          <div className="border-b border-[var(--success)] px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
              {'// STATE: SUBMITTED'}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)] pulse-glow">
              [OK]
            </span>
          </div>
          <div className="p-8 text-center space-y-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              &gt; OUTPUT
            </div>
            <h2 className="text-2xl font-mono font-semibold uppercase tracking-tight">
              Token Submitted<span className="cursor-blink" />
            </h2>
            <p className="text-xs font-mono text-[var(--muted)] uppercase tracking-widest">
              Redirecting to token page…
            </p>
            <div className="w-6 h-6 border-2 border-[var(--accent)]/30 border-t-[var(--accent)] animate-spin mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  const SUBMISSIONS_PAUSED = false;

  // ── Compact input class (shared) ──────────────────────────────
  const inputClass = (hasError?: boolean) =>
    `w-full px-3 py-2.5 bg-[var(--background)] border focus:outline-none text-sm font-mono ${
      hasError
        ? 'border-[var(--error)] focus:border-[var(--error)]'
        : 'border-[var(--border)] focus:border-[var(--accent)]'
    }`;
  const labelClass = 'block text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5';

  return (
    <div className="max-w-6xl mx-auto pb-8">
      {/* Header — kept compact */}
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
            Configure · Rally backers · Launch on Pump.fun, Meteora, or LaunchLab
          </p>
        </div>
      </div>

      {/* Partner attribution banner — only shows when the user arrived via
          a partner checkout URL. Surfaces the partner's identity so the
          user understands their launch will be attributed back to them. */}
      {partnerSession?.partner && (
        <div className="border border-[var(--accent-gold)] bg-[var(--card)] mb-5">
          <div className="border-b border-[var(--accent-gold)] px-4 py-2 flex items-center gap-2">
            <Zap className="w-3 h-3 text-[var(--accent-gold)]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
              {`// PARTNER_LAUNCH // ${partnerSession.partner.slug.toUpperCase()}`}
            </span>
          </div>
          <div className="p-4 text-xs font-mono text-[var(--muted)] leading-relaxed">
            <p>
              &gt; Launching via <span className="text-[var(--accent-gold)] font-semibold">{partnerSession.partner.display_name}</span>.
              Token details below were prefilled — you can edit anything before submitting.
            </p>
          </div>
        </div>
      )}
      {partnerSessionError && (
        <div className="border border-[var(--error)] bg-[var(--card)] mb-5 p-4 text-xs font-mono text-[var(--error)]">
          &gt; {partnerSessionError}
        </div>
      )}

      {SUBMISSIONS_PAUSED ? (
        <div className="border border-[var(--warning)] bg-[var(--card)]">
          <div className="border-b border-[var(--warning)] px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
              [!] SUBMISSIONS_PAUSED
            </span>
          </div>
          <div className="p-6">
            <h2 className="text-base font-mono font-semibold uppercase tracking-tight mb-2">Submissions paused</h2>
            <p className="text-xs font-mono text-[var(--muted)]">
              &gt; Temporarily disabled while we upgrade the launch system. Check back soon.
            </p>
          </div>
        </div>
      ) : !connected ? (
        <div className="border border-[var(--warning)] bg-[var(--card)]">
          <div className="border-b border-[var(--warning)] px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
              [!] WALLET_REQUIRED
            </span>
          </div>
          <div className="p-6">
            <h2 className="text-base font-mono font-semibold uppercase tracking-tight mb-2">Wallet required</h2>
            <p className="text-xs font-mono text-[var(--muted)]">
              &gt; Connect your wallet to submit a token
            </p>
          </div>
        </div>
      ) : (
        // 2-column grid: form on the left (max ~640px so long labels
        // breathe), live token preview on the right as a sticky glass
        // rail that scroll-locks to the viewport. On mobile we stack
        // and put the preview ABOVE the form so the user always sees
        // it without scrolling.
        // No `items-start` here — grid cells need to stretch to row height
        // so the preview wrapper has scroll room for `position: sticky` to
        // work. The preview's own aside is sticky inside the wrapper.
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 lg:gap-6">
          {/* Preview rail — order-first on mobile (above the form),
              right column on desktop. */}
          <div className="lg:order-2">
            <TokenPreviewPanel
              formData={formData}
              imagePreview={imagePreview}
              creatorWallet={publicKey?.toBase58()}
            />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 lg:order-1 min-w-0" autoComplete="off">
          {/* Creator's past launches — shows welcome state for new wallets, history for repeat creators */}
          {publicKey && <CreatorPastLaunches wallet={publicKey.toBase58()} />}

          {/* Error display */}
          {error && (
            <div className="border border-[var(--error)] bg-[var(--card)] px-4 py-3 flex gap-3 items-center">
              <AlertCircle className="w-4 h-4 text-[var(--error)] shrink-0" />
              <p className="text-[var(--error)] font-mono text-xs uppercase tracking-widest">{error}</p>
            </div>
          )}

          {/* ── LAUNCH PLATFORM — which launchpad executes the create + first-buy ── */}
          {/* Pump.fun, Meteora, and Raydium LaunchLab are all live. Creator
              picks at submit. State lives in formData.launchPlatform;
              default 'pumpfun' preserves legacy behavior for clients that
              don't supply it. */}
          <section className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                {'// LAUNCH_PLATFORM'}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                3 LIVE
              </span>
            </div>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(() => {
                // USDC quote constrains the launchpad to Meteora today —
                // Pump.fun's BC is SOL-only at the program level, and
                // Raydium LaunchLab doesn't expose third-party USDC
                // configs. Pickers' enabled state reflects the current
                // quote_currency so the creator can't ship an unlaunchable
                // combo. Phase 1 finding documented in migration 053.
                const isUsdc = formData.quoteCurrency === 'usdc';
                const tiles = [
                  { key: 'pumpfun',   label: 'PUMP.FUN',  sub: isUsdc ? 'SOL ONLY' : 'LIVE', enabled: !isUsdc },
                  { key: 'meteora',   label: 'METEORA',   sub: 'LIVE',                       enabled: true   },
                  { key: 'launchlab', label: 'LAUNCHLAB', sub: isUsdc ? 'SOL ONLY' : 'LIVE', enabled: !isUsdc },
                ] as const;
                return tiles.map((p) => {
                  const active = formData.launchPlatform === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={!p.enabled}
                      onClick={() => p.enabled && setFormData((d) => ({ ...d, launchPlatform: p.key }))}
                      aria-pressed={active}
                      className={`border px-3 py-3 flex flex-col items-start gap-1 transition-colors ${
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                          : p.enabled
                            ? 'border-[var(--border)] hover:border-[var(--accent)]/50'
                            : 'border-[var(--border)] opacity-40 cursor-not-allowed'
                      }`}
                    >
                      <span className={`text-sm font-mono font-semibold ${active ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'}`}>
                        {p.label}
                      </span>
                      <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
                        {p.sub}
                      </span>
                    </button>
                  );
                });
              })()}
            </div>
          </section>

          {/* ── QUOTE CURRENCY — backing + trading + fees denominated here ── */}
          <section className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                {'// QUOTE_CURRENCY'}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                {formData.quoteCurrency === 'usdc' ? 'METEORA ONLY' : '3 LAUNCHPADS'}
              </span>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              {([
                { key: 'sol',  label: 'SOL',  sub: 'WRAPPED SOL · LEGACY DEFAULT' },
                { key: 'usdc', label: 'USDC', sub: 'MAINNET USDC · METEORA-QUOTED' },
              ] as const).map((c) => {
                const active = formData.quoteCurrency === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setFormData((d) => ({
                      ...d,
                      quoteCurrency: c.key,
                      // If USDC + incompatible launchpad, auto-switch
                      // to Meteora so the form is always self-consistent.
                      launchPlatform: c.key === 'usdc' && d.launchPlatform !== 'meteora' ? 'meteora' : d.launchPlatform,
                    }))}
                    aria-pressed={active}
                    className={`border px-3 py-3 flex flex-col items-start gap-1 transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                        : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                    }`}
                  >
                    <span className={`text-sm font-mono font-semibold ${active ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'}`}>
                      {c.label}
                    </span>
                    <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      {c.sub}
                    </span>
                  </button>
                );
              })}
            </div>
            {formData.quoteCurrency === 'usdc' && (
              <div className="border-t border-[var(--border)] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] bg-[var(--accent-gold)]/5">
                &gt; Backers contribute USDC · Token launches on Meteora · Trades as USDC pair on Jupiter post-graduation
              </div>
            )}
          </section>

          {/* ── BASICS — image + name + symbol + description ── */}
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
              {/* Image + name/symbol — image left, fields right (mirrors how meme card renders) */}
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
                      <span className="text-[9px] font-mono text-[var(--muted)]">PNG/JPG · 5MB</span>
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </div>

                <div className="flex-1 space-y-3 min-w-0">
                  <div>
                    <label className={labelClass}>Name *</label>
                    <input
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      onBlur={() => handleBlur('name')}
                      placeholder="e.g., Bonk Dog"
                      maxLength={32}
                      required
                      className={inputClass(touched.name && !!fieldErrors.name)}
                    />
                    <div className="flex justify-between mt-1 text-[10px] font-mono text-[var(--muted)]">
                      <span className={touched.name && fieldErrors.name ? 'text-[var(--error)]' : ''}>
                        {touched.name && fieldErrors.name ? fieldErrors.name : 'Letters, numbers, spaces, hyphens'}
                      </span>
                      <span>{formData.name.length}/32</span>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Symbol *</label>
                    <input
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      name="symbol"
                      value={formData.symbol}
                      onChange={handleChange}
                      onBlur={() => handleBlur('symbol')}
                      placeholder="e.g., BONKD"
                      maxLength={10}
                      required
                      className={`${inputClass(touched.symbol && !!fieldErrors.symbol)} uppercase`}
                    />
                    <div className="flex justify-between mt-1 text-[10px] font-mono text-[var(--muted)]">
                      <span className={touched.symbol && fieldErrors.symbol ? 'text-[var(--error)]' : ''}>
                        {touched.symbol && fieldErrors.symbol ? fieldErrors.symbol : 'Letters and numbers only'}
                      </span>
                      <span>{formData.symbol.length}/10</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Description — full width below */}
              <div>
                <label className={labelClass}>Description *</label>
                <textarea
                  name="description"
                  autoComplete="off"
                  value={formData.description}
                  onChange={handleChange}
                  onBlur={() => handleBlur('description')}
                  placeholder="Tell the community about your project..."
                  maxLength={500}
                  rows={3}
                  className={`${inputClass(touched.description && !!fieldErrors.description)} resize-none`}
                />
                <div className="flex justify-between mt-1 text-[10px] font-mono text-[var(--muted)]">
                  <span className={touched.description && fieldErrors.description ? 'text-[var(--error)]' : ''}>
                    {touched.description && fieldErrors.description ? fieldErrors.description : 'What this project is about'}
                  </span>
                  <span>{formData.description.length}/500</span>
                </div>
              </div>

              {/* Banner upload — optional, X-style 1500×500. Renders
                  full-width at the top of the token detail page when set. */}
              <div className="border-t border-[var(--border)] pt-4 space-y-2">
                <label className={labelClass}>Banner image (optional · X-style 1500×500)</label>
                {bannerPreview ? (
                  <div className="relative w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={bannerPreview}
                      alt="Banner preview"
                      className="w-full border border-[var(--accent)]"
                      style={{ aspectRatio: '3 / 1', objectFit: 'cover' }}
                    />
                    <button
                      type="button"
                      onClick={removeBanner}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-[var(--error)] flex items-center justify-center hover:opacity-90 transition-opacity"
                      aria-label="Remove banner"
                    >
                      <X className="w-3 h-3 text-[#0a0a0a]" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    className="w-full border border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors flex flex-col items-center justify-center gap-1.5 text-[var(--muted)] hover:text-[var(--accent)]"
                    style={{ aspectRatio: '3 / 1' }}
                  >
                    <Upload className="w-5 h-5" />
                    <span className="text-[10px] font-mono uppercase tracking-widest">Upload banner</span>
                    <span className="text-[9px] font-mono text-[var(--muted)]">PNG/JPG/WebP · 1500×500 · 2MB</span>
                  </button>
                )}
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleBannerChange}
                  className="hidden"
                />
                {bannerError && (
                  <span className="text-[10px] font-mono text-[var(--warning)] block">
                    {bannerError}
                  </span>
                )}
                <p className="text-[10px] font-mono text-[var(--muted)] leading-snug">
                  Renders at the top of your token page. Same dimensions as an X profile banner. Leave empty to skip.
                </p>
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
            <div className="p-4 sm:p-5 space-y-4">
              {/* Creator's personal X — Proof Launch profile only */}
              <div>
                <label className={labelClass}>Your X (Proof Launch profile only)</label>
                <input
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  name="creatorTwitter"
                  value={formData.creatorTwitter}
                  onChange={handleChange}
                  onBlur={() => handleBlur('creatorTwitter')}
                  placeholder="https://x.com/yourhandle"
                  className={inputClass(touched.creatorTwitter && !!fieldErrors.creatorTwitter)}
                />
                {touched.creatorTwitter && fieldErrors.creatorTwitter && (
                  <span className="text-[10px] font-mono text-[var(--error)] mt-1 block">
                    {fieldErrors.creatorTwitter}
                  </span>
                )}
                <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                  &gt; Identifies you on Proof Launch. Not included in on-chain metadata.
                </span>
              </div>

              {/* Token socials — written to on-chain metadata */}
              <div className="pt-3 border-t border-[var(--border)]/40">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-3">
                  &gt; Token socials · written to on-chain metadata
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Token X</label>
                    <input
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      name="twitter"
                      value={formData.twitter}
                      onChange={handleChange}
                      onBlur={() => handleBlur('twitter')}
                      placeholder="https://x.com/..."
                      className={inputClass(touched.twitter && !!fieldErrors.twitter)}
                    />
                    {touched.twitter && fieldErrors.twitter && (
                      <span className="text-[10px] font-mono text-[var(--error)] mt-1 block">{fieldErrors.twitter}</span>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Website</label>
                    <input
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      name="website"
                      value={formData.website}
                      onChange={handleChange}
                      onBlur={() => handleBlur('website')}
                      placeholder="https://..."
                      className={inputClass(touched.website && !!fieldErrors.website)}
                    />
                    {touched.website && fieldErrors.website && (
                      <span className="text-[10px] font-mono text-[var(--error)] mt-1 block">{fieldErrors.website}</span>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Telegram</label>
                    <input
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      name="telegram"
                      value={formData.telegram}
                      onChange={handleChange}
                      onBlur={() => handleBlur('telegram')}
                      placeholder="https://t.me/..."
                      className={inputClass(touched.telegram && !!fieldErrors.telegram)}
                    />
                    {touched.telegram && fieldErrors.telegram && (
                      <span className="text-[10px] font-mono text-[var(--error)] mt-1 block">{fieldErrors.telegram}</span>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Discord</label>
                    <input
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      name="discord"
                      value={formData.discord}
                      onChange={handleChange}
                      onBlur={() => handleBlur('discord')}
                      placeholder="https://discord.gg/..."
                      className={inputClass(touched.discord && !!fieldErrors.discord)}
                    />
                    {touched.discord && fieldErrors.discord && (
                      <span className="text-[10px] font-mono text-[var(--error)] mt-1 block">{fieldErrors.discord}</span>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>GitHub</label>
                    <input
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      name="github"
                      value={formData.github}
                      onChange={handleChange}
                      onBlur={() => handleBlur('github')}
                      placeholder="https://github.com/..."
                      className={inputClass(touched.github && !!fieldErrors.github)}
                    />
                    {touched.github && fieldErrors.github && (
                      <span className="text-[10px] font-mono text-[var(--error)] mt-1 block">{fieldErrors.github}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── LAUNCH CONFIG — slots + min backing + compact preview ── */}
          <section className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                {'// LAUNCH CONFIG'}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                3-DAY DEADLINE
              </span>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Backer slots</label>
                  <select
                    name="totalSlots"
                    value={formData.totalSlots}
                    onChange={handleChange}
                    className={inputClass()}
                  >
                    {[2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24].map((n) => (
                      <option key={n} value={n}>{n} slots</option>
                    ))}
                  </select>
                  <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                    &gt; Launches when all slots fill
                  </span>
                </div>
                <div>
                  <label className={labelClass}>Minimum per backer</label>
                  <select
                    name="minBackingSol"
                    value={formData.minBackingSol}
                    onChange={handleChange}
                    className={inputClass()}
                  >
                    {[0.1, 0.25, 0.5, 1, 2, 5].map((n) => (
                      <option key={n} value={n}>{n} SOL</option>
                    ))}
                  </select>
                  <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                    &gt; Each backer pledges at least this
                  </span>
                </div>
              </div>

              {/* Tiered per-backer maximums (migration 056).
                  Three independent optional ceilings — creator dials each
                  tier separately. 0 in any field = uncapped for that
                  tier. Backings API picks the right cap based on backer
                  identity: creator, allowlisted (team), or public. */}
              <div className="space-y-3 border border-[var(--border)] p-3">
                <div>
                  <div className="text-xs font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
                    Per-backer maximums (optional)
                  </div>
                  <p className="text-[10px] font-mono text-[var(--muted)] leading-snug">
                    Set independent caps for the creator wallet, allowlisted (team) backers, and the public. Leave at 0 for uncapped. All three are independent — set the creator and team to the same value if you want.
                  </p>
                </div>

                <div>
                  <label className={labelClass}>Creator cap ({formData.quoteCurrency === 'usdc' ? 'USDC' : 'SOL'})</label>
                  <input
                    type="number"
                    name="maxBackingSolCreator"
                    value={formData.maxBackingSolCreator}
                    onChange={handleChange}
                    min={0}
                    step="any"
                    placeholder="0 = uncapped"
                    className={inputClass()}
                  />
                </div>

                <div>
                  <label className={labelClass}>Team cap ({formData.quoteCurrency === 'usdc' ? 'USDC' : 'SOL'})</label>
                  <input
                    type="number"
                    name="maxBackingSolTeam"
                    value={formData.maxBackingSolTeam}
                    onChange={handleChange}
                    min={0}
                    step="any"
                    placeholder="0 = uncapped"
                    className={inputClass()}
                  />
                  <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                    &gt; Applies to wallets on your allowlist (reserved-slot / declared team backers).
                  </span>
                </div>

                <div>
                  <label className={labelClass}>Public cap ({formData.quoteCurrency === 'usdc' ? 'USDC' : 'SOL'})</label>
                  <input
                    type="number"
                    name="maxBackingSolPublic"
                    value={formData.maxBackingSolPublic}
                    onChange={handleChange}
                    min={0}
                    step="any"
                    placeholder="0 = uncapped"
                    className={inputClass()}
                  />
                  <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                    &gt; Applies to open-bucket public backers. Keeps whales from out-backing the team round.
                  </span>
                </div>
              </div>

              {/* Reserved slots (Phase 7).
                  Creator can reserve N of total_slots for specific
                  allowlisted wallets. Launch stays publicly visible +
                  publicly backable for the open (total - reserved)
                  slots. Reserved positions can only be filled by
                  wallets in the allowlist. Brand-aligned: public
                  always has guaranteed slots, team gets guaranteed
                  entry without blocking anyone. */}
              <div className="border-t border-[var(--border)] pt-4 space-y-3">
                <div>
                  <label className={labelClass}>Reserved slots (optional)</label>
                  <select
                    name="reservedSlots"
                    value={formData.reservedSlots}
                    onChange={handleChange}
                    className={inputClass()}
                  >
                    <option value={0}>0 — fully open launch (anyone backs any slot)</option>
                    {Array.from({ length: Math.max(0, formData.totalSlots - 1) }).map((_, i) => {
                      const n = i + 1;
                      return (
                        <option key={n} value={n}>
                          {n} of {formData.totalSlots} reserved — {formData.totalSlots - n} open to public
                        </option>
                      );
                    })}
                    <option value={formData.totalSlots}>
                      {formData.totalSlots} of {formData.totalSlots} reserved — TEAM ROUND (no public slots)
                    </option>
                  </select>
                  <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                    &gt; Reserved slots can only be backed by wallets you list below. Picking all = TEAM ROUND label.
                  </span>
                </div>

                {formData.reservedSlots > 0 && (() => {
                  // Parse the canonical store into chips. Filter out the
                  // creator's wallet if they pasted it (auto-added server-side).
                  const allowlistChips = formData.allowlistText
                    .split('\n')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0)
                    .filter((s) => !publicKey || s !== publicKey.toBase58());
                  const creatorWalletStr = publicKey?.toBase58() ?? null;
                  const totalCount = allowlistChips.length + (creatorWalletStr ? 1 : 0);
                  const needed = formData.reservedSlots;
                  const addWallet = () => {
                    const candidate = allowlistInput.trim();
                    if (!candidate) return;
                    if (creatorWalletStr && candidate === creatorWalletStr) {
                      setAllowlistError("Your wallet is already included (locked above).");
                      return;
                    }
                    if (allowlistChips.includes(candidate)) {
                      setAllowlistError('Already in the list.');
                      return;
                    }
                    try {
                      new PublicKey(candidate);
                    } catch {
                      setAllowlistError('Not a valid Solana wallet address.');
                      return;
                    }
                    const next = [...allowlistChips, candidate].join('\n');
                    setFormData((d) => ({ ...d, allowlistText: next }));
                    setAllowlistInput('');
                    setAllowlistError(null);
                  };
                  const removeWallet = (w: string) => {
                    const next = allowlistChips.filter((x) => x !== w).join('\n');
                    setFormData((d) => ({ ...d, allowlistText: next }));
                    setAllowlistError(null);
                  };
                  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addWallet();
                    }
                  };
                  return (
                    <div className="space-y-2">
                      <label className={labelClass}>
                        Allowlist wallets · {totalCount}/{needed} added
                      </label>
                      <div className="border border-[var(--border)] bg-[var(--background)] p-2 space-y-2">
                        {/* Chip list */}
                        <div className="flex flex-wrap gap-1.5">
                          {creatorWalletStr && (
                            <span
                              className="inline-flex items-center gap-1.5 px-2 py-1 border border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]"
                              title="Your connected wallet — auto-included, can't be removed"
                            >
                              <span className="text-[8px]">YOU</span>
                              <code className="normal-case tracking-normal">
                                {creatorWalletStr.slice(0, 4)}…{creatorWalletStr.slice(-4)}
                              </code>
                            </span>
                          )}
                          {allowlistChips.map((w) => (
                            <span
                              key={w}
                              className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--border)] bg-[var(--card)] text-[10px] font-mono"
                              title={w}
                            >
                              <code className="normal-case tracking-normal">
                                {w.slice(0, 4)}…{w.slice(-4)}
                              </code>
                              <button
                                type="button"
                                onClick={() => removeWallet(w)}
                                className="text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                                aria-label={`Remove ${w}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                          {allowlistChips.length === 0 && (
                            <span className="text-[10px] font-mono text-[var(--muted)] italic px-1 py-1">
                              No additional wallets yet.
                            </span>
                          )}
                        </div>
                        {/* Add input */}
                        <div className="flex gap-1.5 border-t border-[var(--border)] pt-2">
                          <input
                            type="text"
                            value={allowlistInput}
                            onChange={(e) => { setAllowlistInput(e.target.value); setAllowlistError(null); }}
                            onKeyDown={onKeyDown}
                            placeholder="Paste a wallet address, then Enter"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            className="flex-1 text-xs font-mono bg-[var(--background)] border border-[var(--border)] px-2 py-1 focus:outline-none focus:border-[var(--accent)]"
                          />
                          <button
                            type="button"
                            onClick={addWallet}
                            disabled={!allowlistInput.trim()}
                            className="text-[10px] font-mono uppercase tracking-widest px-3 py-1 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--background)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--accent)] transition-colors"
                          >
                            + Add
                          </button>
                        </div>
                        {allowlistError && (
                          <span className="text-[10px] font-mono text-[var(--error)] block">
                            {allowlistError}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-[var(--muted)] leading-snug">
                        Your connected wallet counts as one reserved slot automatically. Add up to {Math.max(0, needed - 1)} more for the rest. Allowlisted wallets can back either open OR reserved slots. You can edit this list later from your creator dashboard.
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Compact slot preview — single row of boxes + min raise line */}
              <div className="border border-[var(--border)] bg-[var(--background)] p-3 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  <span>Preview</span>
                  <span>
                    Min raise: <span className="text-[var(--accent)]">{(formData.totalSlots * formData.minBackingSol).toFixed(2)} SOL</span>
                  </span>
                </div>
                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${formData.totalSlots}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: formData.totalSlots }).map((_, i) => (
                    <div
                      key={i}
                      className="h-3 border border-[var(--accent)]"
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── FEE chip — thin and inline ── */}
          {submissionCost?.free ? (
            <div className="border border-[var(--success)] bg-[var(--card)] px-4 py-3 flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
              <div className="flex-1 text-[11px] font-mono leading-relaxed">
                <div className="text-[var(--success)] uppercase tracking-widest text-[10px] mb-1">
                  Submission fee waived · $PROOF holder
                </div>
                <div className="text-[var(--muted)]">
                  You hold <span className="text-[var(--success)]">{(submissionCost.your_balance_tokens ?? 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</span> PROOF
                  (threshold: {submissionCost.threshold_tokens.toLocaleString()}). You still need to back your own token to receive supply at launch.
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-[var(--warning)] bg-[var(--card)] px-4 py-3 flex items-start gap-3">
              <div className="w-4 h-4 border border-[var(--warning)] text-[var(--warning)] text-[9px] font-mono flex items-center justify-center shrink-0 mt-0.5">$</div>
              <div className="flex-1 text-[11px] font-mono leading-relaxed">
                <div className="text-[var(--warning)] uppercase tracking-widest text-[10px] mb-1">
                  Submission fee · {CREATION_FEE_SOL} SOL
                </div>
                <div className="text-[var(--muted)]">
                  Covers token creation on the launchpad you choose (Pump.fun, Meteora, or LaunchLab). Back your own token separately to receive supply at launch.
                  {submissionCost && (
                    <> Hold ≥ {submissionCost.threshold_tokens.toLocaleString()} <span className="text-[var(--accent-gold)]">$PROOF</span> for free submissions
                      {submissionCost.your_balance_tokens != null && submissionCost.your_balance_tokens > 0 && (
                        <> (you have {submissionCost.your_balance_tokens.toLocaleString(undefined, {maximumFractionDigits: 0})})</>
                      )}.</>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Launch visibility removed from submit UI 2026-05-29.
              Stealth + spectator modes conflict with Proof Launch's
              "equal entry" thesis (insiders get curve-open prices
              before the public, which reads as front-running regardless
              of intent). Backend wiring + DB columns retained for a
              future structured "Team Round" product (Phase 6) that
              would require time-locked allocations + public disclosure.
              All new submissions default to `open`. */}

          {/* ── Trading Fees (Phase 5: bot delegation lives in the bot section below) ──
              Standard 90/10 split is fixed. If the creator enables the buyback
              bot below, that section's slider routes part of the 90% backer
              pool to the bot instead of distributing to backers. */}
          <div className="border border-[var(--border)] bg-[var(--card)]/40 p-4 sm:p-5 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide">Trading Fees</h3>
              <p className="text-xs text-[var(--muted)]">
                Standard split: <span className="text-[var(--foreground)]">90% to backers · 10% platform</span>.
                Enable the buyback bot below to delegate part of the backer pool to automatic buy + burn / hold.
              </p>
            </div>
          </div>

          {/* ── Buyback Bots (Phase B — programmable bot stack) ──
              Each meme can run BURN + 4 distribute actions (one of each)
              plus UNLIMITED labeled VAULT bots. Each bot has its own
              wallet on Solscan; vaults are creator-withdrawable, all
              other bots are sealed. Total delegation ≤ 90%.
              ──
              USDC parity (commit shipping with this section): action
              labels and the bot pipeline both branch on quote_currency.
              feed_lp is the only action that's still SOL-only — the
              picker shows it but the cron returns a clear "DAMM v2
              USDC LP not yet wired" skip until the LP-add path lands. */}
          {(() => {
            const QUOTE_BOT_ACTIONS = botActionsForQuote(formData.quoteCurrency);
            const totalBotPct = formData.botStack.reduce((sum, b) => sum + b.fee_pct, 0);
            const backerPct = Math.max(0, 90 - totalBotPct);
            // UNIQUE-per-action only applies to single-instance actions.
            // VAULTs (hold) and DONATE bots can repeat (each adds a new
            // labeled vault / new destination).
            const usedSingleActions = new Set(
              formData.botStack.filter((b) => !REPEATABLE_ACTIONS.has(b.action)).map((b) => b.action),
            );
            const availableActions = QUOTE_BOT_ACTIONS.filter(
              (a) => REPEATABLE_ACTIONS.has(a.value) || !usedSingleActions.has(a.value),
            );
            // Soft cap to prevent UI runaway; the real limit is the
            // 90% budget. 12 = practical max under 90% / 5% min per bot,
            // plus headroom for vault / donate experimentation.
            const HARD_CAP = 12;
            const canAddMore =
              formData.botStack.length < HARD_CAP &&
              availableActions.length > 0 &&
              totalBotPct < 90;
            const overBudget = totalBotPct > 90;
            const anyInvalidPct = formData.botStack.some((b) => b.fee_pct < 5 || b.fee_pct > 90);
            // Vault label validation.
            const invalidVaultLabels = formData.botStack
              .map((b, i) => ({ b, i }))
              .filter(({ b }) => b.action === 'hold' && (!b.label || !isValidVaultLabel(b.label)));
            // Duplicate vault labels (UX, not DB).
            const labelCounts = new Map<string, number>();
            for (const b of formData.botStack) {
              if (b.action === 'hold' && b.label) {
                const k = b.label.trim().toLowerCase();
                labelCounts.set(k, (labelCounts.get(k) || 0) + 1);
              }
            }
            const duplicateVaultLabels = [...labelCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
            // Donate validation — destination required + valid pubkey,
            // no duplicate (action, destination) combos.
            const invalidDonateDests = formData.botStack
              .map((b, i) => ({ b, i }))
              .filter(({ b }) => DONATE_ACTIONS.has(b.action) && (!b.destination_wallet || !isValidSolPubkey(b.destination_wallet.trim())));
            const donateKeys = new Map<string, number>();
            for (const b of formData.botStack) {
              if (DONATE_ACTIONS.has(b.action) && b.destination_wallet && isValidSolPubkey(b.destination_wallet.trim())) {
                const k = `${b.action}::${b.destination_wallet.trim()}`;
                donateKeys.set(k, (donateKeys.get(k) || 0) + 1);
              }
            }
            const duplicateDonateDests = [...donateKeys.entries()].filter(([, n]) => n > 1);
            const botStackInvalid =
              overBudget || anyInvalidPct
              || invalidVaultLabels.length > 0 || duplicateVaultLabels.length > 0
              || invalidDonateDests.length > 0 || duplicateDonateDests.length > 0;

            const addBot = (action?: BotActionT) => {
              if (!canAddMore) return;
              const nextAction = action ?? availableActions[0]?.value;
              if (!nextAction) return;
              const remaining = Math.max(5, Math.min(20, 90 - totalBotPct));
              const newItem: BotStackItem =
                nextAction === 'hold'              ? { action: nextAction, fee_pct: remaining, label: '' }
              : DONATE_ACTIONS.has(nextAction)     ? { action: nextAction, fee_pct: remaining, destination_wallet: '' }
              :                                      { action: nextAction, fee_pct: remaining };
              setFormData((prev) => ({ ...prev, botStack: [...prev.botStack, newItem] }));
            };
            const removeBot = (idx: number) => {
              setFormData((prev) => ({
                ...prev,
                botStack: prev.botStack.filter((_, i) => i !== idx),
              }));
            };
            const updateBot = (idx: number, patch: Partial<BotStackItem>) => {
              setFormData((prev) => ({
                ...prev,
                botStack: prev.botStack.map((b, i) => {
                  if (i !== idx) return b;
                  // Sync label + destination_wallet fields when action changes.
                  const next: BotStackItem = { ...b, ...patch };
                  if (next.action === 'hold' && next.label === undefined) next.label = '';
                  if (next.action !== 'hold' && !DONATE_ACTIONS.has(next.action)) delete next.label;
                  if (DONATE_ACTIONS.has(next.action) && next.destination_wallet === undefined) next.destination_wallet = '';
                  if (!DONATE_ACTIONS.has(next.action)) delete next.destination_wallet;
                  return next;
                }),
              }));
            };

            return (
              <div className="border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      BUYBACK BOTS · PROGRAMMABLE TOKENOMICS
                    </div>
                    <div className="text-sm font-mono text-[var(--foreground)]">
                      Stack actions + unlimited labeled vaults
                    </div>
                    <p className="text-xs font-mono text-[var(--muted)] leading-relaxed max-w-md">
                      Each bot gets its own Solscan wallet and a slice of trading fees,
                      then runs one of 5 actions every cycle (burn / airdrop tokens or SOL
                      to holders / backers) — plus any number of labeled VAULT bots that
                      accumulate tokens you can withdraw anytime (Marketing, DAO, Liquidity).
                      Fully on-chain &amp; auditable.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.botStackEnabled}
                      onChange={(e) => {
                        // No auto-seed — creator picks their first action.
                        // Toggling off preserves the stack so flipping
                        // back doesn't lose work.
                        setFormData((prev) => ({
                          ...prev,
                          botStackEnabled: e.target.checked,
                        }));
                      }}
                      className="w-4 h-4 accent-[var(--accent)]"
                    />
                    <span className="text-xs font-mono uppercase tracking-wider text-[var(--foreground)]">
                      {formData.botStackEnabled ? 'ON' : 'OFF'}
                    </span>
                  </label>
                </div>

                {formData.botStackEnabled && (
                  <div className="space-y-4 pt-3 border-t border-[var(--border)]">
                    {/* Sticky budget bar — pins to the top of the viewport
                        as you scroll through bot cards, so the creator always
                        sees how much delegation is left without scrolling
                        back up. Shows bots / backers / platform inline. */}
                    <div className={`sticky top-0 z-10 -mx-4 sm:-mx-5 px-4 sm:px-5 py-2 bg-[var(--card)] border-b border-[var(--border)] ${overBudget ? 'border-red-400/60' : ''}`}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest">
                          <span className={overBudget ? 'text-red-400' : 'text-[var(--accent)]'}>
                            Bots {totalBotPct}%
                          </span>
                          <span className="text-[var(--muted)]">/</span>
                          <span className="text-[var(--foreground)]">
                            Backers {backerPct}%
                          </span>
                          <span className="text-[var(--muted)]">/</span>
                          <span className="text-[var(--muted)]">Platform 10%</span>
                        </div>
                        <div className={`text-[10px] font-mono uppercase tracking-widest ${overBudget ? 'text-red-400' : totalBotPct >= 90 ? 'text-[var(--muted)]' : 'text-[var(--accent)]'}`}>
                          {overBudget ? 'over budget' : totalBotPct >= 90 ? 'budget full' : `${90 - totalBotPct}% left`}
                        </div>
                      </div>
                      <div className="flex h-1.5 mt-1.5 border border-[var(--border)] overflow-hidden">
                        <div className="bg-[var(--accent)]/60" style={{ width: `${Math.min(totalBotPct, 90)}%` }} />
                        <div className="bg-[var(--foreground)]/20" style={{ width: `${backerPct}%` }} />
                        <div className="bg-[var(--muted)]/40" style={{ width: '10%' }} />
                      </div>
                    </div>

                    {/* Action picker — always-visible tiles. Tap to add.
                        Single-instance tiles (burn, distribute_*) disable
                        once their action is in the stack. Repeatable
                        tiles (VAULT, DONATE_*) stay enabled — each new
                        tap adds another labeled vault / dedicated dest. */}
                    <div className="space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                        ADD A BOT
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {QUOTE_BOT_ACTIONS.map((opt) => {
                          const isRepeatable = REPEATABLE_ACTIONS.has(opt.value);
                          const alreadyUsed = !isRepeatable && usedSingleActions.has(opt.value);
                          const disabled = alreadyUsed || totalBotPct >= 90 || formData.botStack.length >= HARD_CAP;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => addBot(opt.value)}
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
                        YOUR STACK · {formData.botStack.length} BOT{formData.botStack.length === 1 ? '' : 'S'}
                      </div>

                      {formData.botStack.length === 0 ? (
                        <div className="border border-dashed border-[var(--border)] p-4 text-center">
                          <div className="text-xs font-mono text-[var(--muted)]">
                            Pick an action above to add your first bot.
                          </div>
                        </div>
                      ) : (
                        formData.botStack.map((bot, idx) => {
                          const meta = QUOTE_BOT_ACTIONS.find((a) => a.value === bot.action) ?? BOT_ACTION_BY_VALUE[bot.action];
                          const isVault = bot.action === 'hold';
                          const isDonate = DONATE_ACTIONS.has(bot.action);
                          const labelInvalid =
                            isVault && (!bot.label || !isValidVaultLabel(bot.label));
                          const destInvalid =
                            isDonate && (!bot.destination_wallet || !isValidSolPubkey(bot.destination_wallet.trim()));
                          const donateLabelInvalid =
                            isDonate && !!bot.label && !isValidVaultLabel(bot.label);
                          // Stepper bounds — min 5 (DB CHECK), max = this
                          // bot's current + whatever's left of the 90%
                          // budget. Stops at the edge; never overshoots.
                          const remaining = Math.max(0, 90 - totalBotPct);
                          const stepperMax = Math.min(90, bot.fee_pct + remaining);
                          const canIncrement = bot.fee_pct < stepperMax;
                          const canDecrement = bot.fee_pct > 5;
                          return (
                            <div key={idx} className="border border-[var(--border)] bg-[var(--background)] p-3 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-base" aria-hidden>{meta?.emoji}</span>
                                  <div>
                                    <div className="text-xs font-mono font-semibold text-[var(--foreground)]">
                                      {meta?.label}
                                    </div>
                                    <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                                      {meta?.tag}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeBot(idx)}
                                  className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] hover:text-red-400 transition-colors flex items-center gap-1"
                                >
                                  <X className="w-3 h-3" /> Remove
                                </button>
                              </div>

                              {/* Fee % stepper — discrete 5% taps, never
                                  rescales when other bots change. The +
                                  is disabled when the global budget is
                                  full; − is disabled at the 5% floor. */}
                              <div className="flex items-center justify-between gap-3">
                                <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                                  Fee delegation
                                </label>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => canDecrement && updateBot(idx, { fee_pct: bot.fee_pct - 5 })}
                                    disabled={!canDecrement}
                                    className="w-7 h-7 border border-[var(--border)] text-sm font-mono text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-[var(--border)] disabled:hover:text-[var(--foreground)] transition-colors"
                                    aria-label="Decrease 5%"
                                  >
                                    −
                                  </button>
                                  <div className="min-w-[3rem] text-center text-sm font-mono text-[var(--accent)] tabular-nums">
                                    {bot.fee_pct}%
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => canIncrement && updateBot(idx, { fee_pct: bot.fee_pct + 5 })}
                                    disabled={!canIncrement}
                                    className="w-7 h-7 border border-[var(--border)] text-sm font-mono text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-[var(--border)] disabled:hover:text-[var(--foreground)] transition-colors"
                                    aria-label="Increase 5%"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Vault label input — required when action='hold'.
                                  Becomes the wallet's public name (e.g. "Marketing")
                                  and shows up on Solscan / the meme detail page. */}
                              {isVault && (
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                                    Vault label · public, on-chain
                                  </label>
                                  <input
                                    type="text"
                                    value={bot.label ?? ''}
                                    onChange={(e) => updateBot(idx, { label: e.target.value })}
                                    maxLength={24}
                                    placeholder="e.g. Marketing, DAO, Liquidity"
                                    className={`w-full bg-[var(--card)] border px-2 py-2 text-xs font-mono text-[var(--foreground)] outline-none focus:border-[var(--accent)] ${
                                      labelInvalid ? 'border-red-400/60' : 'border-[var(--border)]'
                                    }`}
                                  />
                                  {labelInvalid && (
                                    <div className="text-[10px] font-mono text-red-400">
                                      1-24 chars, letters / numbers / spaces / _ / - only
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Donate destination — fixed payout address.
                                  IMMUTABLE after submit. Big visible warning
                                  so the creator doesn't accidentally lock
                                  themselves to a typo. */}
                              {isDonate && (
                                <div className="space-y-1.5 border border-[var(--accent-gold)]/40 bg-[var(--accent-gold)]/5 p-2.5">
                                  <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] flex items-center gap-1.5">
                                    ★ Destination wallet · LOCKED at submit
                                  </label>
                                  <input
                                    type="text"
                                    value={bot.destination_wallet ?? ''}
                                    onChange={(e) => updateBot(idx, { destination_wallet: e.target.value })}
                                    placeholder="Solana wallet address (charity, DAO, partner)"
                                    spellCheck={false}
                                    className={`w-full bg-[var(--card)] border px-2 py-2 text-[11px] font-mono text-[var(--foreground)] outline-none focus:border-[var(--accent)] ${
                                      destInvalid ? 'border-red-400/60' : 'border-[var(--border)]'
                                    }`}
                                  />
                                  {destInvalid ? (
                                    <div className="text-[10px] font-mono text-red-400">
                                      Must be a valid Solana base58 address (32-44 chars)
                                    </div>
                                  ) : (
                                    <div className="text-[10px] font-mono text-[var(--muted)] italic">
                                      Every {bot.action === 'donate_sol' ? (formData.quoteCurrency === 'usdc' ? 'USDC' : 'SOL') : 'token'} payout flows here forever. You cannot change this after submit — the address is locked on-chain.
                                    </div>
                                  )}

                                  {/* Optional display label for this donate bot. */}
                                  <input
                                    type="text"
                                    value={bot.label ?? ''}
                                    onChange={(e) => updateBot(idx, { label: e.target.value })}
                                    maxLength={24}
                                    placeholder="(optional) Label — e.g. Charity, DAO Treasury"
                                    className={`w-full bg-[var(--card)] border px-2 py-2 text-xs font-mono text-[var(--foreground)] outline-none focus:border-[var(--accent)] mt-1 ${
                                      donateLabelInvalid ? 'border-red-400/60' : 'border-[var(--border)]'
                                    }`}
                                  />
                                  {donateLabelInvalid && (
                                    <div className="text-[10px] font-mono text-red-400">
                                      Label: 1-24 chars, letters / numbers / spaces / _ / - only
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Optional lifetime cutoff. Default is "Forever". Picking a
                                  finite duration sets meme_bots.expires_at at submit
                                  time; after that the cron skips the bot and fee
                                  delegation stops routing fees to it. */}
                              <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                                  Run for
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {BOT_DURATION_OPTIONS.map((opt) => {
                                    const active = (opt.months ?? null) === (bot.duration_months ?? null);
                                    return (
                                      <button
                                        key={opt.label}
                                        type="button"
                                        onClick={() => updateBot(idx, opt.months === null ? { duration_months: undefined } : { duration_months: opt.months })}
                                        className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 border transition-colors ${
                                          active
                                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                                            : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/60'
                                        }`}
                                      >
                                        {opt.label}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="text-[9px] font-mono text-[var(--muted)] italic">
                                  After this window, the bot stops collecting new fees. Any balance already in its wallet stays put.
                                </div>
                              </div>

                              <div className="text-[10px] font-mono text-[var(--muted)] leading-snug border-t border-[var(--border)] pt-2">
                                {meta?.desc}
                              </div>
                            </div>
                          );
                        })
                      )}

                    </div>

                    {/* Live distribution bar */}
                    <div className="space-y-2 pt-3 border-t border-[var(--border)]">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                        YOUR FEE DISTRIBUTION
                      </div>
                      <div className="flex h-6 border border-[var(--border)] overflow-hidden">
                        <div
                          className="bg-[var(--muted)]/40 flex items-center justify-center text-[9px] font-mono text-[var(--foreground)]"
                          style={{ width: '10%' }}
                          title="Platform 10%"
                        >
                          {/* Hidden on narrow segments */}
                        </div>
                        {formData.botStack.map((bot, idx) => {
                          const meta = QUOTE_BOT_ACTIONS.find((a) => a.value === bot.action) ?? BOT_ACTION_BY_VALUE[bot.action];
                          return (
                            <div
                              key={idx}
                              className="bg-[var(--accent)]/60 border-l border-[var(--background)] flex items-center justify-center text-[9px] font-mono text-[#0a0a0a] overflow-hidden"
                              style={{ width: `${bot.fee_pct}%` }}
                              title={`${meta?.label} ${bot.fee_pct}%`}
                            >
                              {bot.fee_pct >= 10 ? `${meta?.emoji} ${bot.fee_pct}%` : ''}
                            </div>
                          );
                        })}
                        <div
                          className="bg-[var(--foreground)]/20 border-l border-[var(--background)] flex items-center justify-center text-[9px] font-mono text-[var(--foreground)]"
                          style={{ width: `${backerPct}%` }}
                          title={`Backers ${backerPct}%`}
                        >
                          {backerPct >= 10 ? `B ${backerPct}%` : ''}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono uppercase tracking-widest text-center">
                        <div>
                          <div className="text-[var(--muted)]">Platform</div>
                          <div className="text-[var(--foreground)] mt-0.5">10%</div>
                        </div>
                        <div>
                          <div className="text-[var(--accent)]">Bots ({formData.botStack.length})</div>
                          <div className="text-[var(--accent)] mt-0.5">{totalBotPct}%</div>
                        </div>
                        <div>
                          <div className="text-[var(--muted)]">Backers</div>
                          <div className="text-[var(--foreground)] mt-0.5">{backerPct}%</div>
                        </div>
                      </div>
                    </div>

                    {/* Validation messages */}
                    {botStackInvalid && (
                      <div className="border border-red-400/40 bg-red-400/5 p-2.5 text-[10px] font-mono text-red-400 leading-snug space-y-0.5">
                        {overBudget && <div>★ Total bot delegation exceeds 90%. Reduce a slider.</div>}
                        {anyInvalidPct && <div>★ Each bot must be between 5% and 90%.</div>}
                        {invalidVaultLabels.length > 0 && (
                          <div>★ Every vault needs a label (1-24 chars, alphanumerics / space / _ / -).</div>
                        )}
                        {duplicateVaultLabels.length > 0 && (
                          <div>★ Duplicate vault labels: {duplicateVaultLabels.join(', ')}. Use unique names.</div>
                        )}
                        {invalidDonateDests.length > 0 && (
                          <div>★ Every DONATE bot needs a valid Solana destination wallet (32-44 char base58 address).</div>
                        )}
                        {duplicateDonateDests.length > 0 && (
                          <div>★ Two DONATE bots can't share the same action + destination. Combine their fee % into one.</div>
                        )}
                      </div>
                    )}

                    <div className="text-[10px] font-mono text-[var(--muted)] italic leading-snug border-t border-[var(--border)] pt-2">
                      One dedicated wallet auto-generated per bot. Each becomes a public,
                      verifiable Solscan address. VAULT wallets are withdrawable by you;
                      all other bots are sealed by design.
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Submit ── */}
          <button
            type="submit"
            disabled={
              isSubmitting
              || !formData.name
              || !formData.symbol
              || Object.keys(fieldErrors).some(k => fieldErrors[k as keyof ValidationErrors])
              || (formData.botStackEnabled && !validateBotStack(formData.botStack).ok)
            }
            className="btn-primary w-full text-sm sm:text-base py-3.5"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-[#0a0a0a]/30 border-t-[#0a0a0a] animate-spin" />
                Submitting…
              </span>
            ) : submissionCost?.free ? (
              <>[▶] Submit Free (PROOF Holder)</>
            ) : (
              <>[▶] Pay {CREATION_FEE_SOL} SOL & Submit</>
            )}
          </button>

          {/* ── How it works — collapsible explainer at the bottom ── */}
          <div className="border border-[var(--border)] bg-[var(--card)]">
            <button
              type="button"
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
            >
              <span>{'// HOW_LAUNCH_WORKS'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showHowItWorks ? 'rotate-180' : ''}`} />
            </button>
            {showHowItWorks && (
              <div className="border-t border-[var(--border)] p-4 text-[11px] font-mono text-[var(--muted)] leading-relaxed space-y-2">
                <p>&gt; Once all backer slots fill, the token launches on your chosen platform (Pump.fun, Meteora, or LaunchLab).</p>
                <p>&gt; The pool makes <span className="text-[var(--accent)]">ONE atomic buy</span> — every backer enters at the same price, no dev allocation, no sniper gap.</p>
                <p>&gt; Each backer&apos;s proportional share of tokens is sent straight to their wallet.</p>
                <p>&gt; If slots don&apos;t fill within 3 days, backers get refunds automatically.</p>
              </div>
            )}
          </div>
          </form>
        </div>
      )}
    </div>
  );
}
