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
  | 'distribute_sol_backers';

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
const BOT_ACTIONS: BotActionMeta[] = [
  { value: 'burn',                       label: 'BURN',                short: 'Burn',                tag: 'Deflationary', emoji: '🔥', desc: 'Buy tokens, burn them. Permanent supply reduction.' },
  { value: 'hold',                       label: 'VAULT',               short: 'Vault',               tag: 'Treasury',     emoji: '🏦', desc: 'Buy tokens, park them in a labeled vault wallet you can withdraw from anytime (e.g. Marketing, DAO, Liquidity).' },
  { value: 'distribute_tokens_holders',  label: 'TOKENS → HOLDERS',    short: 'Tokens→Holders',      tag: 'Loyalty',      emoji: '🪙', desc: 'Buy tokens, airdrop pro-rata to every current holder. Drives volume + rewards holding.' },
  { value: 'distribute_tokens_backers',  label: 'TOKENS → BACKERS',    short: 'Tokens→Backers',      tag: 'OG reward',    emoji: '🎯', desc: 'Buy tokens, airdrop pro-rata to the genesis backers who launched this token.' },
  { value: 'distribute_sol_holders',     label: 'SOL → HOLDERS',       short: 'SOL→Holders',         tag: 'Yield',        emoji: '💸', desc: 'Skip the swap. Send delegated SOL pro-rata to every current holder. Pure cash flow.' },
  { value: 'distribute_sol_backers',     label: 'SOL → BACKERS',       short: 'SOL→Backers',         tag: 'OG yield',     emoji: '💰', desc: 'Skip the swap. Send delegated SOL pro-rata to the genesis backers.' },
];
const BOT_ACTION_BY_VALUE = Object.fromEntries(BOT_ACTIONS.map((a) => [a.value, a]));

// Label rules MUST match supabase/migrations/042_vault_labels.sql:
// 1-24 chars, alphanumerics + space/underscore/hyphen only.
const VAULT_LABEL_PATTERN = /^[A-Za-z0-9 _\-]+$/;
function isValidVaultLabel(s: string): boolean {
  return s.length >= 1 && s.length <= 24 && VAULT_LABEL_PATTERN.test(s);
}

// Bot stack item — `label` is required + non-empty for action='hold',
// undefined for all other actions (DB CHECK enforces this).
type BotStackItem = { action: BotActionT; fee_pct: number; label?: string };

// Single source of truth for bot-stack validation. Used both inside the
// stack-builder UI and to gate the submit button at the form level.
function validateBotStack(stack: BotStackItem[]): { ok: boolean; reason?: string } {
  const total = stack.reduce((s, b) => s + b.fee_pct, 0);
  if (total > 90) return { ok: false, reason: 'total delegation > 90%' };
  if (stack.some((b) => b.fee_pct < 5 || b.fee_pct > 90))
    return { ok: false, reason: 'bot fee out of 5-90% range' };
  // Non-hold actions must be unique (DB enforces). Vaults can repeat.
  const seenNonHold = new Set<string>();
  for (const b of stack) {
    if (b.action === 'hold') continue;
    if (seenNonHold.has(b.action)) return { ok: false, reason: 'duplicate non-vault action' };
    seenNonHold.add(b.action);
  }
  // Every vault must have a valid label.
  for (const b of stack) {
    if (b.action === 'hold') {
      if (!b.label || !isValidVaultLabel(b.label))
        return { ok: false, reason: 'invalid vault label' };
    } else if (b.label !== undefined) {
      return { ok: false, reason: 'non-vault bot must not have a label' };
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
  return { ok: true };
}

import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Upload, AlertCircle, X, CheckCircle, ChevronDown, Zap, Loader2 } from 'lucide-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { CreatorPastLaunches } from '@/components/CreatorPastLaunches';

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

interface ValidationErrors {
  name?: string;
  symbol?: string;
  description?: string;
  creatorTwitter?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  discord?: string;
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
  const { connected, publicKey, signTransaction } = useWallet();
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
    // Phase 3.5 — Optional per-backer ceiling. 0 (UI sentinel) = uncapped.
    // When set, applies universally so no wallet can out-back any other.
    maxBackingSol: 0,
    creatorTwitter: '',
    twitter: '',
    website: '',
    telegram: '',
    discord: '',
    // Launch Configuration v2 — visibility mode
    // 'open'      → standard public launch, anyone can back (default)
    // 'stealth'   → hidden from proving grounds, allowlist-only backing
    // 'spectator' → public listing, allowlist-only backing
    visibility: 'open' as 'open' | 'stealth' | 'spectator',
    // Newline-separated wallet addresses for the initial allowlist.
    // Creator's own wallet is auto-added by the API so they don't need
    // to include it here. Ignored when visibility === 'open'.
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
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
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
    }
    setFieldErrors(prev => ({ ...prev, [field]: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !publicKey) return;
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
      if (imageFile) imageUrl = imagePreview || imageUrl;
      // If the partner supplied an image URL via the session and the user
      // didn't override with their own upload, use the partner's URL.
      if (!imageFile && imagePreview && partnerSession?.image_url) {
        imageUrl = partnerSession.image_url;
      }

      const response = await fetch('/api/memes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_wallet: publicKey.toBase58(),
          name: formData.name.trim(),
          symbol: formData.symbol.toUpperCase().trim(),
          description: formData.description.trim(),
          image_url: imageUrl,
          creator_twitter: formData.creatorTwitter || undefined,
          twitter: formData.twitter || undefined,
          telegram: formData.telegram || undefined,
          discord: formData.discord || undefined,
          website: formData.website || undefined,
          total_slots: formData.totalSlots,
          reserved_slots: formData.reservedSlots,
          min_backing_sol: formData.minBackingSol,
          max_backing_sol: formData.maxBackingSol > 0 ? formData.maxBackingSol : null,
          backing_days: 3,
          creation_fee_signature: signature,
          creation_fee_sol: signature ? CREATION_FEE_SOL : undefined,
          // Partner attribution — when present the API will look up the
          // session, verify it's pending + not expired + creator matches,
          // attach partner_id/partner_session_id to the meme row, and mark
          // the session submitted (triggering any partner webhook).
          partner_session_id: partnerSession?.session_id,
          // Launch Config v2 — visibility + initial allowlist.
          // Allowlist is sent when EITHER visibility is gated OR there
          // are reserved slots (Phase 7 reuses the allowlist table to
          // gate the reserved positions within open launches).
          visibility: formData.visibility,
          initial_allowlist:
            formData.visibility === 'open' && formData.reservedSlots === 0
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
            ? formData.botStack.map((b) =>
                b.action === 'hold'
                  ? { action: b.action, fee_pct: b.fee_pct, label: (b.label ?? '').trim() }
                  : { action: b.action, fee_pct: b.fee_pct },
              )
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
        : ['totalSlots', 'minBackingSol', 'maxBackingSol', 'reservedSlots'].includes(name) ? Number(value) : value
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
    <div className="max-w-2xl mx-auto pb-8">
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
            Configure · Rally backers · Launch on pump.fun
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
        <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
          {/* Creator's past launches — shows welcome state for new wallets, history for repeat creators */}
          {publicKey && <CreatorPastLaunches wallet={publicKey.toBase58()} />}

          {/* Error display */}
          {error && (
            <div className="border border-[var(--error)] bg-[var(--card)] px-4 py-3 flex gap-3 items-center">
              <AlertCircle className="w-4 h-4 text-[var(--error)] shrink-0" />
              <p className="text-[var(--error)] font-mono text-xs uppercase tracking-widest">{error}</p>
            </div>
          )}

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

              {/* Optional per-backer maximum (Phase 3.5).
                  When set, applies to allowlisted + public alike — every
                  backing is bounded by the same SOL ceiling, so no whale
                  can out-back any team member. 0 = uncapped (default). */}
              <div>
                <label className={labelClass}>Maximum per backer (optional)</label>
                <select
                  name="maxBackingSol"
                  value={formData.maxBackingSol}
                  onChange={handleChange}
                  className={inputClass()}
                >
                  <option value={0}>No cap — anyone can back any amount</option>
                  {[0.1, 0.25, 0.5, 1, 2, 5, 10, 25].filter((n) => n >= formData.minBackingSol).map((n) => (
                    <option key={n} value={n}>{n} SOL max per backer</option>
                  ))}
                </select>
                <span className="text-[10px] font-mono text-[var(--muted)] mt-1 block">
                  &gt; Team-fairness lock: every backing bounded equally, no whale exceeds your team.
                </span>
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

                {formData.reservedSlots > 0 && (
                  <div className="space-y-2">
                    <label className={labelClass}>
                      Allowlist wallets (one per line, need at least {formData.reservedSlots})
                    </label>
                    <textarea
                      name="allowlistText"
                      value={formData.allowlistText}
                      onChange={handleChange}
                      placeholder={'Wallet1...\nWallet2...\nWallet3...'}
                      rows={Math.max(3, Math.min(formData.reservedSlots + 1, 8))}
                      className="w-full text-xs font-mono bg-[var(--background)] border border-[var(--border)] p-2 focus:outline-none focus:border-[var(--accent)]"
                    />
                    <p className="text-[10px] font-mono text-[var(--muted)] leading-snug">
                      Your own wallet is auto-added — don't include it here. Allowlisted wallets can back either open OR reserved slots (their reservation guarantees entry). You can add/remove wallets later from your creator dashboard.
                    </p>
                  </div>
                )}
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
                  Covers token creation on pump.fun. Back your own token separately to receive supply at launch.
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
              other bots are sealed. Total delegation ≤ 90%. */}
          {(() => {
            const totalBotPct = formData.botStack.reduce((sum, b) => sum + b.fee_pct, 0);
            const backerPct = Math.max(0, 90 - totalBotPct);
            // For UNIQUE-per-action: count only non-hold actions, since
            // VAULTs (hold) can repeat unlimited times.
            const usedNonHoldActions = new Set(
              formData.botStack.filter((b) => b.action !== 'hold').map((b) => b.action),
            );
            const availableActions = BOT_ACTIONS.filter(
              (a) => a.value === 'hold' || !usedNonHoldActions.has(a.value),
            );
            // Soft cap to prevent UI runaway; the real limit is the
            // 90% budget. 12 = practical max under 90% / 5% min per bot,
            // plus headroom for vault label experimentation.
            const HARD_CAP = 12;
            const canAddMore =
              formData.botStack.length < HARD_CAP &&
              availableActions.length > 0 &&
              totalBotPct < 90;
            const overBudget = totalBotPct > 90;
            const anyInvalidPct = formData.botStack.some((b) => b.fee_pct < 5 || b.fee_pct > 90);
            // Vault label validation — required + format-restricted (1-24
            // chars, alphanumerics + space/_/-). Matches the DB CHECK in
            // migration 042. Empty inputs are also collected here so the
            // submit button stays disabled until every vault has a label.
            const invalidVaultLabels = formData.botStack
              .map((b, i) => ({ b, i }))
              .filter(({ b }) => b.action === 'hold' && (!b.label || !isValidVaultLabel(b.label)));
            // Duplicate vault labels within the same stack — DB allows
            // duplicates (it doesn't enforce label uniqueness) but the
            // creator's UX is worse with two "Marketing" vaults.
            const labelCounts = new Map<string, number>();
            for (const b of formData.botStack) {
              if (b.action === 'hold' && b.label) {
                const k = b.label.trim().toLowerCase();
                labelCounts.set(k, (labelCounts.get(k) || 0) + 1);
              }
            }
            const duplicateVaultLabels = [...labelCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
            const botStackInvalid =
              overBudget || anyInvalidPct || invalidVaultLabels.length > 0 || duplicateVaultLabels.length > 0;

            const addBot = (action?: BotActionT) => {
              if (!canAddMore) return;
              const nextAction = action ?? availableActions[0]?.value;
              if (!nextAction) return;
              const remaining = Math.max(5, Math.min(20, 90 - totalBotPct));
              setFormData((prev) => ({
                ...prev,
                botStack: [
                  ...prev.botStack,
                  nextAction === 'hold'
                    ? { action: nextAction, fee_pct: remaining, label: '' }
                    : { action: nextAction, fee_pct: remaining },
                ],
              }));
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
                  // When switching action to/from 'hold', sync the label field.
                  const next: BotStackItem = { ...b, ...patch };
                  if (next.action === 'hold' && next.label === undefined) next.label = '';
                  if (next.action !== 'hold') delete next.label;
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
                        Non-vault tiles disable once their action is in
                        the stack (DB uniqueness on non-hold actions).
                        VAULT tile always enabled (unlimited vaults). */}
                    <div className="space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                        ADD A BOT
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {BOT_ACTIONS.map((opt) => {
                          const isVaultTile = opt.value === 'hold';
                          const alreadyUsed = !isVaultTile && usedNonHoldActions.has(opt.value);
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
                          const meta = BOT_ACTION_BY_VALUE[bot.action];
                          const isVault = bot.action === 'hold';
                          const labelInvalid =
                            isVault && (!bot.label || !isValidVaultLabel(bot.label));
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
                          const meta = BOT_ACTION_BY_VALUE[bot.action];
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
                <p>&gt; Once all backer slots fill, the token launches on pump.fun.</p>
                <p>&gt; The pool makes <span className="text-[var(--accent)]">ONE atomic buy</span> — every backer enters at the same price, no dev allocation, no sniper gap.</p>
                <p>&gt; Each backer&apos;s proportional share of tokens is sent straight to their wallet.</p>
                <p>&gt; If slots don&apos;t fill within 3 days, backers get refunds automatically.</p>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
