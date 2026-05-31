'use client';

// Live token preview rail for /submit. Sits on the right side of the
// form as a glass-card that scroll-locks to the viewport so creators see
// exactly how their token will read as they fill the form. Mirrors the
// meme detail page's identity bar + key stats so what they see here is
// what they'll get post-submit.

type BotActionT =
  | 'burn' | 'hold'
  | 'distribute_tokens_holders' | 'distribute_tokens_backers'
  | 'distribute_sol_holders'    | 'distribute_sol_backers';

interface BotStackItem { action: BotActionT; fee_pct: number; label?: string }

interface FormData {
  name: string;
  symbol: string;
  description: string;
  totalSlots: number;
  reservedSlots: number;
  minBackingSol: number;
  maxBackingSol: number;
  // Creator's personal X handle — kept off the preview surface (it
  // belongs on the detail page once launched, not duplicated here).
  creatorTwitter: string;
  // Token socials — go into the token metadata + render on the meme card.
  twitter: string;
  telegram: string;
  discord: string;
  website: string;
  botStackEnabled: boolean;
  botStack: BotStackItem[];
}

interface Props {
  formData: FormData;
  imagePreview: string | null;
  creatorWallet?: string;
}

const BOT_ICON: Record<string, string> = {
  burn: '🔥',
  hold: '🏦',
  distribute_tokens_holders: '🪙',
  distribute_tokens_backers: '🎯',
  distribute_sol_holders: '💸',
  distribute_sol_backers: '💰',
};
const BOT_SHORT: Record<string, string> = {
  burn: 'BURN',
  hold: 'VAULT',
  distribute_tokens_holders: 'TOK→H',
  distribute_tokens_backers: 'TOK→B',
  distribute_sol_holders: 'SOL→H',
  distribute_sol_backers: 'SOL→B',
};

export function TokenPreviewPanel({ formData, imagePreview, creatorWallet }: Props) {
  const {
    name, symbol, description, totalSlots, reservedSlots,
    minBackingSol, maxBackingSol,
    twitter, telegram, discord, website,
    botStackEnabled, botStack,
  } = formData;

  const tokenSocials = [
    { label: 'X',        href: twitter.trim() },
    { label: 'TG',       href: telegram.trim() },
    { label: 'DC',       href: discord.trim() },
    { label: 'WEB',      href: website.trim() },
  ].filter((s) => !!s.href);

  const displaySymbol = symbol.trim() ? symbol.trim().toUpperCase() : '???';
  const displayName = name.trim() || 'Unnamed Token';
  const isTeamRound = reservedSlots > 0 && reservedSlots === totalSlots;
  const hasReservedSlots = reservedSlots > 0;

  // Fee distribution math — totals must round to 100. Bot total comes
  // first because the slider can change it; backers get the remainder.
  const botTotal = botStackEnabled
    ? botStack.reduce((s, b) => s + (b.fee_pct || 0), 0)
    : 0;
  const platformPct = 10;
  const backersPct = Math.max(0, 90 - botTotal);

  return (
    <aside className="lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] overflow-auto">
      <div
        className="border border-[var(--accent)]/30 bg-[var(--card)]/70 p-4 space-y-4 shadow-xl"
        style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            // LIVE_PREVIEW
          </span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] border border-[var(--muted)] px-1.5 py-0.5">
            DRAFT
          </span>
        </div>

        {/* Identity row (mirrors MemeIdentityBar on the detail page) */}
        <div className="flex items-center gap-3">
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imagePreview}
              alt="preview"
              className="w-14 h-14 object-cover border border-[var(--border)] flex-shrink-0"
            />
          ) : (
            <div className="w-14 h-14 border border-dashed border-[var(--border)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
                IMG
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-mono font-semibold text-[var(--accent)]">
              ${displaySymbol}
            </div>
            <div className="text-base font-mono font-semibold uppercase tracking-tight truncate text-[var(--foreground)]">
              {displayName}
            </div>
            {creatorWallet && (
              <div className="text-[10px] font-mono text-[var(--muted)] mt-0.5">
                by {creatorWallet.slice(0, 4)}…{creatorWallet.slice(-4)}
              </div>
            )}
          </div>
        </div>

        {/* Token socials — chips for each filled-in URL. These flow into the
            on-chain token metadata when launched. */}
        {tokenSocials.length > 0 && (
          <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              Token socials
            </div>
            <div className="flex flex-wrap gap-1">
              {tokenSocials.map((s) => (
                <span
                  key={s.label}
                  className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent)]/40 text-[var(--accent)]"
                  title={s.href}
                >
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {description.trim() && (
          <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed border-t border-[var(--border)] pt-2 line-clamp-4">
            {description.trim()}
          </p>
        )}

        {/* Key stats */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono uppercase tracking-widest border-t border-[var(--border)] pt-3">
          <Stat label="Slots" value={`${totalSlots}`} />
          <Stat label="Min per backer" value={`${minBackingSol} SOL`} />
          <Stat
            label="Max per backer"
            value={maxBackingSol > 0 ? `${maxBackingSol} SOL` : 'Uncapped'}
            tone={maxBackingSol > 0 ? 'gold' : 'default'}
          />
          <Stat
            label="Min raise"
            value={`${(totalSlots * minBackingSol).toFixed(2)} SOL`}
          />
        </div>

        {/* Team / reserved indicator */}
        {hasReservedSlots && (
          <div className="border border-[var(--accent-gold)]/40 bg-[var(--accent-gold)]/5 p-2 text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] text-center">
            {isTeamRound
              ? `★ TEAM ROUND · ALL ${totalSlots} RESERVED`
              : `★ TEAM · ${reservedSlots}/${totalSlots} RESERVED`}
          </div>
        )}

        {/* Fee distribution bar (always visible — even at default it
            shows the 90/10 split so the creator sees the baseline). */}
        <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
            <span className="text-[var(--muted)]">Fee split</span>
            <span className="text-[var(--accent)]">{botTotal}% bots</span>
          </div>
          <div className="flex h-2 border border-[var(--border)] overflow-hidden">
            <div className="bg-[var(--accent)]/60" style={{ width: `${Math.min(botTotal, 90)}%` }} />
            <div className="bg-[var(--foreground)]/30" style={{ width: `${backersPct}%` }} />
            <div className="bg-[var(--muted)]/50" style={{ width: `${platformPct}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-1 text-[9px] font-mono uppercase tracking-widest text-center">
            <div>
              <div className="text-[var(--accent)]">Bots</div>
              <div className="text-[var(--foreground)]">{botTotal}%</div>
            </div>
            <div>
              <div className="text-[var(--muted)]">Backers</div>
              <div className="text-[var(--foreground)]">{backersPct}%</div>
            </div>
            <div>
              <div className="text-[var(--muted)]">Platform</div>
              <div className="text-[var(--foreground)]">{platformPct}%</div>
            </div>
          </div>
        </div>

        {/* Bot stack preview chips */}
        {botStackEnabled && botStack.length > 0 && (
          <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              Bot stack · {botStack.length}
            </div>
            <div className="flex flex-wrap gap-1">
              {botStack.map((b, i) => (
                <span
                  key={i}
                  className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--border)] text-[var(--foreground)] flex items-center gap-1"
                >
                  <span aria-hidden>{BOT_ICON[b.action]}</span>
                  <span>
                    {b.action === 'hold' && b.label ? b.label : BOT_SHORT[b.action]}
                  </span>
                  <span className="text-[var(--accent)]">{b.fee_pct}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="text-[9px] font-mono italic text-[var(--muted)] leading-snug border-t border-[var(--border)] pt-2">
          Preview updates as you fill the form. Whatever you see here is what backers will see post-submit.
        </div>
      </div>
    </aside>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'accent' | 'gold' | 'default';
}) {
  const cls = tone === 'accent'
    ? 'text-[var(--accent)]'
    : tone === 'gold'
      ? 'text-[var(--accent-gold)]'
      : 'text-[var(--foreground)]';
  return (
    <div>
      <div className="text-[var(--muted)]">{label}</div>
      <div className={`${cls} normal-case tracking-normal text-sm`}>{value}</div>
      {sub && <div className="text-[var(--muted)] text-[9px]">{sub}</div>}
    </div>
  );
}
