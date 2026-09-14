'use client';

// Create a pooled campaign — the SOL /submit page, twinned: same header
// card, same section skeleton (LAUNCH_PLATFORM / BASICS / SOCIALS /
// RAISE_TERMS / LAUNCH_BOTS), same sticky live-preview rail, same bot
// stack picker UX. Terms become immutable at creation.
import { useState, useEffect, useMemo } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, decodeEventLog } from 'viem';
import { AlertCircle } from 'lucide-react';
import { POOLLAUNCH_FACTORY, PONS_FACTORY, AIRDROP_OPERATOR, factoryAbi } from '@/lib/rhc';

// Soft-launch guardrail: contracts allow any goal (oversized raises are
// proven safe — they graduate at birth), but until the external contract
// review completes we cap UI-created campaigns. Raise/remove after P3.
const BETA_GOAL_CAP_ETH = 2;

const inputClass = (hasError?: boolean) =>
  `w-full px-3 py-2.5 bg-[var(--background)] border ${
    hasError ? 'border-[var(--error)]' : 'border-[var(--border)]'
  } focus:border-[var(--accent)] focus:outline-none text-sm font-mono`;
const labelClass =
  'block text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5';

// ── Bot stack — the RHC twin of the SOL launch bots ─────────────────
// burn / feed_lp run as ownerless contracts (trustless — world-firsts);
// vault legs are named wallets; the holder airdrop is a vault leg
// pointed at the platform operator (platform-run, honestly labeled).
type BotKind = 'burn' | 'feed_lp' | 'vault' | 'airdrop';
interface BotItem { kind: BotKind; pct: string; addr?: string }

const BOT_ACTIONS: { kind: BotKind; label: string; tag: string; emoji: string; desc: string }[] = [
  { kind: 'burn',    label: 'BURN',           tag: 'Deflationary · Trustless', emoji: '🔥', desc: 'Ownerless contract buys the token with its fee share and sends it to the dead address. Anyone can crank it; nobody — including us — can stop it. Supply cuts reward every holder pro-rata.' },
  { kind: 'feed_lp', label: 'POOL FEEDER',    tag: 'Liquidity · Trustless',    emoji: '🌊', desc: 'Ownerless contract mints full-range liquidity with its fee share and compounds the position\'s own trading fees. It has NO withdraw function — protocol-owned liquidity locked by construction. World first.' },
  { kind: 'vault',   label: 'VAULT',          tag: 'Treasury',                 emoji: '🏦', desc: 'A wallet you name (marketing / DAO / treasury) becomes a fee leg and pulls its share anytime. Address locked at creation — can never be changed.' },
  { kind: 'airdrop', label: 'HOLDER AIRDROP', tag: 'Loyalty · Platform-run',   emoji: '📸', desc: 'PoolLaunch snapshots your token\'s holders and airdrops this leg\'s fees pro-rata — the same machinery as our Solana launches. Platform-operated, not trustless; 🔥 BURN is the trustless holder reward.' },
];
const SINGLE_KINDS = new Set<BotKind>(['burn', 'feed_lp', 'airdrop']);
const BOT_EMOJI: Record<BotKind, string> = { burn: '🔥', feed_lp: '🌊', vault: '🏦', airdrop: '📸' };
const BOT_SHORT: Record<BotKind, string> = { burn: 'BURN', feed_lp: 'POOL FEED', vault: 'VAULT', airdrop: 'AIRDROP' };

export default function CreateCampaignPage() {
  const { address, isConnected } = useAccount();
  const [f, setF] = useState({
    name: '', symbol: '', logo: '', description: '',
    twitter: '', telegram: '', website: '',
    goal: '1', min: '0.05', max: '0', slots: '0', days: '3',
  });
  const [botsEnabled, setBotsEnabled] = useState(false);
  const [stack, setStack] = useState<BotItem[]>([]);
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { data: receipt, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const [created, setCreated] = useState<string | null>(null);

  const activeStack = botsEnabled ? stack : [];
  const botsPct = activeStack.reduce((s, b) => s + (Number(b.pct) || 0), 0);
  const backerPct = Math.max(0, 90 - botsPct);
  const overBudget = botsPct > 90;
  const vaultCount = activeStack.filter((b) => b.kind === 'vault' || b.kind === 'airdrop').length;
  const stackValid = activeStack.every((b) => {
    const p = Number(b.pct) || 0;
    if (p < 0) return false;
    if (b.kind === 'vault' && p > 0 && !/^0x[0-9a-fA-F]{40}$/.test(b.addr || '')) return false;
    return true;
  });

  useEffect(() => {
    if (isSuccess && receipt) {
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
          if (ev.eventName === 'CampaignCreated') {
            setCreated((ev.args as { campaign: string }).campaign);
          }
        } catch { /* not ours */ }
      }
    }
  }, [isSuccess, receipt]);

  const submit = () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(f.days) * 86400);
    const pctOf = (k: BotKind) => Math.round((Number(activeStack.find((b) => b.kind === k)?.pct) || 0) * 100);
    const vaultLegs = activeStack.filter((b) =>
      (b.kind === 'vault' || b.kind === 'airdrop') && Number(b.pct) > 0
    );
    writeContract({
      address: POOLLAUNCH_FACTORY,
      abi: factoryAbi,
      functionName: 'createCampaign',
      args: [
        PONS_FACTORY,
        parseEther(f.goal),
        parseEther(f.min),
        f.max === '0' ? 0n : parseEther(f.max),
        BigInt(f.slots || '0'),
        deadline,
        0n, 0n,
        {
          name: f.name, symbol: f.symbol.toUpperCase(), logo: f.logo, description: f.description,
          socials: { twitter: f.twitter, telegram: f.telegram, discord: '', website: f.website, farcaster: '' },
          feeWallet: '0x0000000000000000000000000000000000000000', // overwritten by the contract → FeeSplitter
        },
        pctOf('burn'),
        pctOf('feed_lp'),
        vaultLegs.map((b) => (b.kind === 'airdrop' ? AIRDROP_OPERATOR : (b.addr as `0x${string}`))),
        vaultLegs.map((b) => Math.round(Number(b.pct) * 100)),
      ],
    });
  };

  const input = (key: keyof typeof f, lbl: string, placeholder = '') => (
    <label className={labelClass}>
      {lbl}
      <input
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        placeholder={placeholder}
        className={`${inputClass()} mt-1.5 normal-case tracking-normal`}
      />
    </label>
  );

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
            {'// POOL_LAUNCH.SYS // SUBMIT'}
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
            <CampaignPreviewPanel f={f} stack={activeStack} backerPct={backerPct} creatorWallet={address} />
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
                &gt; Pooled buy fires snipe-exempt on the launch block · graduates to a Uniswap-v3 pool at 4.2 ETH
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
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {input('name', 'Token Name', 'e.g. Proof Coin')}
                  {input('symbol', 'Symbol', 'e.g. PROOF')}
                </div>
                {input('logo', 'Logo URL (https)', 'https://…/logo.png')}
                <label className={labelClass}>
                  Description
                  <textarea
                    value={f.description}
                    onChange={(e) => setF({ ...f, description: e.target.value })}
                    rows={3}
                    className={`${inputClass()} mt-1.5 normal-case tracking-normal resize-none`}
                  />
                </label>
              </div>
            </section>

            {/* ── SOCIALS ── */}
            <section className="border border-[var(--border)] bg-[var(--card)]">
              <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                  {'// SOCIALS'}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  OPTIONAL
                </span>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                {input('twitter', 'X / Twitter', 'https://x.com/…')}
                {input('telegram', 'Telegram')}
                {input('website', 'Website')}
              </div>
            </section>

            {/* ── RAISE TERMS ── */}
            <section className="border border-[var(--border)] bg-[var(--card)]">
              <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                  {'// RAISE_TERMS'}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  IMMUTABLE AT CREATION
                </span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  {input('goal', 'Goal (ETH)')}
                  {input('min', 'Min / Backer')}
                  {input('max', 'Max (0 = ∞)')}
                  {input('slots', 'Slots (0 = ∞)')}
                  {input('days', 'Deadline (Days)')}
                </div>
                {Number(f.goal) > BETA_GOAL_CAP_ETH && (
                  <p className="mt-3 text-xs font-mono text-[var(--warning)]">
                    BETA CAP: goals are limited to {BETA_GOAL_CAP_ETH} ETH until the external contract
                    review completes. (A {f.goal} ETH raise would work — oversized raises graduate at
                    launch — we&apos;re just walking before running.)
                  </p>
                )}
              </div>
            </section>

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
                    backer share. Burn and Pool Feeder run as ownerless contracts — the
                    world&apos;s first trustless launch bots: anyone can crank them, nobody can
                    stop them, and the terms can never change.
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

                  {/* Action picker — always-visible tiles. Tap to add. */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                      ADD A BOT
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
                      {BOT_ACTIONS.map((opt) => {
                        const alreadyUsed = SINGLE_KINDS.has(opt.kind) && stack.some((b) => b.kind === opt.kind);
                        const vaultsFull = (opt.kind === 'vault' || opt.kind === 'airdrop') && vaultCount >= 3;
                        const disabled = alreadyUsed || vaultsFull || botsPct >= 90;
                        return (
                          <button
                            key={opt.kind}
                            type="button"
                            onClick={() => !disabled && setStack([...stack, { kind: opt.kind, pct: '', addr: '' }])}
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
                            <div className="flex gap-2">
                              {bot.kind === 'vault' && (
                                <input
                                  value={bot.addr}
                                  onChange={(e) => setStack(stack.map((x, j) => j === idx ? { ...x, addr: e.target.value } : x))}
                                  placeholder="0x… (marketing / DAO / treasury wallet)"
                                  className={inputClass(badAddr)}
                                />
                              )}
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
              <button
                onClick={submit}
                disabled={isPending || !f.name || !f.symbol || Number(f.goal) <= 0 || Number(f.goal) > BETA_GOAL_CAP_ETH || overBudget || !stackValid}
                className="btn-primary"
              >
                {isPending ? 'Confirm in Wallet…' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Live preview rail — the SOL TokenPreviewPanel, twinned ──────────
function CampaignPreviewPanel({ f, stack, backerPct, creatorWallet }: {
  f: { name: string; symbol: string; logo: string; description: string; twitter: string; telegram: string; website: string; goal: string; min: string; max: string; slots: string };
  stack: BotItem[];
  backerPct: number;
  creatorWallet?: string;
}) {
  const displaySymbol = f.symbol.trim() ? f.symbol.trim().toUpperCase() : '???';
  const displayName = f.name.trim() || 'Unnamed Token';
  const botTotal = stack.reduce((s, b) => s + (Number(b.pct) || 0), 0);
  const socials = [
    { label: 'X',   href: f.twitter.trim() },
    { label: 'TG',  href: f.telegram.trim() },
    { label: 'WEB', href: f.website.trim() },
  ].filter((s) => !!s.href);
  // Logo URLs are free text mid-typing; only render once it parses.
  const logoOk = useMemo(() => {
    try { return f.logo.trim().startsWith('https://') && !!new URL(f.logo.trim()) } catch { return false }
  }, [f.logo]);

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
          {logoOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.logo.trim()} alt="preview" className="w-14 h-14 object-cover border border-[var(--border)] flex-shrink-0" />
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

        {/* Key stats */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono uppercase tracking-widest border-t border-[var(--border)] pt-3">
          <PreviewStat label="Goal" value={`${f.goal || '0'} ETH`} tone="accent" />
          <PreviewStat label="Min per backer" value={`${f.min || '0'} ETH`} />
          <PreviewStat label="Max per backer" value={Number(f.max) > 0 ? `${f.max} ETH` : 'Uncapped'} tone={Number(f.max) > 0 ? 'gold' : 'default'} />
          <PreviewStat label="Slots" value={Number(f.slots) > 0 ? f.slots : 'Uncapped'} />
        </div>

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
