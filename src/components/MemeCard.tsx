'use client';

import { FC, useState } from 'react';
import Link from 'next/link';
import { Copy, Check } from 'lucide-react';
import type { Meme } from '@/types/database';

interface MemeCardProps {
  meme: Meme & {
    backer_count?: number;
    progress_percent?: number;
    // Populated by /api/memes (list); counts both Phase B meme_bots rows
    // and legacy single-bot memes (buyback_bot_enabled = 1).
    bot_count?: number;
  };
}

function getTimeRemaining(deadline: string): string {
  const now = new Date();
  const end = new Date(deadline);
  const diff = end.getTime() - now.getTime();

  if (diff <= 0) return 'ENDED';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}D ${hours}H`;
  if (hours > 0) return `${hours}H ${minutes}M`;
  return `${minutes}M`;
}

function getStatusConfig(status: string) {
  const configs: Record<string, { label: string; class: string }> = {
    pending: { label: 'PENDING', class: 'badge-proving' },
    backing: { label: 'PROVING', class: 'badge-proving' },
    funded: { label: 'FUNDED', class: 'badge-launched' },
    launching: { label: 'LAUNCHING', class: 'badge-launched' },
    live: { label: 'LIVE', class: 'badge-launched' },
    failed: { label: 'FAILED', class: 'badge-failed' },
  };
  return configs[status] || { label: status.toUpperCase(), class: 'badge-proving' };
}

export const MemeCard: FC<MemeCardProps> = ({ meme }) => {
  const [caCopied, setCaCopied] = useState(false);

  const {
    id,
    name,
    symbol,
    description,
    status,
    total_slots = 8,
    reserved_slots = 0,
    current_backing_sol,
    backing_deadline,
    launch_deadline,
    creator_wallet,
    image_url,
    pump_fun_url,
    mint_address,
    backer_count = 0,
    bot_count = 0,
    twitter,
    telegram,
    discord,
    website,
    github,
  } = meme;

  // Socials row on the card. Card itself is a <Link>, so each icon
  // needs stopPropagation or the click bubbles into the parent nav.
  const socials: Array<{ label: string; href: string; icon: React.ReactNode }> = [];
  if (twitter) socials.push({ label: 'X', href: twitter, icon: twitterSvg });
  if (telegram) socials.push({ label: 'TG', href: telegram, icon: telegramSvg });
  if (discord) socials.push({ label: 'DC', href: discord, icon: discordSvg });
  if (website) socials.push({ label: 'Web', href: website, icon: globeSvg });
  if (github) socials.push({ label: 'GH', href: github, icon: githubSvg });

  const handleCopyCA = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (mint_address) {
      navigator.clipboard.writeText(mint_address);
      setCaCopied(true);
      setTimeout(() => setCaCopied(false), 2000);
    }
  };

  const totalSlots = Number(total_slots) || 8;
  const reservedSlots = Number(reserved_slots) || 0;
  const isTeamRound = reservedSlots > 0 && reservedSlots === totalSlots;
  const hasReservedSlots = reservedSlots > 0;
  const filledSlots = Number(backer_count) || 0;
  const timeRemaining = getTimeRemaining(backing_deadline);
  const { label: statusLabel, class: statusClass } = getStatusConfig(status);

  // Launch-window countdown for funded memes (migration 027).
  // Tight format — card has very limited space.
  const launchTimeRemaining = launch_deadline ? getTimeRemaining(launch_deadline) : null;
  const launchExpired = launchTimeRemaining === 'ENDED';
  const launchLowTime = launchTimeRemaining
    ? (launchTimeRemaining.endsWith('M') && !launchTimeRemaining.includes('H'))   // <1h
      || (launchTimeRemaining.includes('H') && !launchTimeRemaining.includes('D') // <24h
        && parseInt(launchTimeRemaining) < 6)                                      // and <6h
    : false;

  return (
    <Link href={`/meme/${id}`} className="block">
      <div className="border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] transition-colors">
        {/* Top bar — system path + status + reservation/team-round chip */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
            // {symbol.slice(0, 12)}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isTeamRound && (
              <span
                className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent-gold)]/60 text-[var(--accent-gold)] bg-[var(--accent-gold)]/5"
                title="Team round — all slots reserved for declared wallets, no public slots"
              >
                TEAM ROUND
              </span>
            )}
            {hasReservedSlots && !isTeamRound && (
              <span
                className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent-gold)]/60 text-[var(--accent-gold)] bg-[var(--accent-gold)]/5"
                title={`Team launch — ${reservedSlots} of ${totalSlots} slots reserved for declared wallets · ${totalSlots - reservedSlots} open to public`}
              >
                TEAM · {reservedSlots}/{totalSlots}
              </span>
            )}
            {bot_count > 0 && (
              <span
                className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent)]/60 text-[var(--accent)] bg-[var(--accent)]/5"
                title={`Programmable tokenomics — ${bot_count} active bot${bot_count === 1 ? '' : 's'} (burn / vaults / airdrops)`}
              >
                {bot_count} BOT{bot_count === 1 ? '' : 'S'}
              </span>
            )}
            <span className={statusClass}>{statusLabel}</span>
          </div>
        </div>

        {/* Main */}
        <div className="p-4 space-y-4">
          {/* Avatar + name */}
          <div className="flex items-start gap-3">
            {image_url ? (
              <img
                src={image_url}
                alt={name}
                className="w-12 h-12 object-cover border border-[var(--border)] flex-shrink-0"
              />
            ) : (
              <div className="w-12 h-12 border border-[var(--accent)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
                <span className="font-mono font-semibold text-[var(--accent)] text-sm">
                  {symbol.charAt(0)}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-mono font-semibold uppercase tracking-tight text-base truncate">
                {name}
              </h3>
              <div className="text-xs font-mono text-[var(--accent)]">${symbol}</div>
              {socials.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                  {socials.map((s) => (
                    <CardSocialIcon key={s.label} href={s.href} label={s.label}>
                      {s.icon}
                    </CardSocialIcon>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <p className="text-xs font-mono text-[var(--muted)] line-clamp-2 leading-relaxed">
            {description || 'No description provided.'}
          </p>

          {/* Backing-phase block */}
          {status === 'backing' && (
            <div className="space-y-3 pt-1">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    Slots
                  </span>
                  <span className="text-xs font-mono text-[var(--accent)]">
                    {filledSlots} / {totalSlots}
                  </span>
                </div>
                {/* Slot grid — visual blocks matching the favicon */}
                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: totalSlots }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-3 ${
                        i < filledSlots
                          ? 'bg-[var(--accent)]'
                          : 'border border-[var(--accent)]'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                <span className="text-[var(--muted)]">
                  Pledged: <span className="text-[var(--foreground)]">{Number(current_backing_sol).toFixed(2)} SOL</span>
                </span>
                <span className="text-[var(--muted)]">
                  {timeRemaining} left
                </span>
              </div>
            </div>
          )}

          {/* Live-phase block */}
          {status === 'live' && (
            <div className="space-y-3 pt-1">
              {mint_address && (
                <button
                  onClick={handleCopyCA}
                  className="w-full flex items-center gap-2 px-2 py-1.5 bg-[var(--background)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
                >
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">CA:</span>
                  <code className="flex-1 text-[10px] font-mono truncate text-left">{mint_address}</code>
                  {caCopied ? (
                    <Check className="w-3 h-3 text-[var(--success)] flex-shrink-0" />
                  ) : (
                    <Copy className="w-3 h-3 text-[var(--muted)] flex-shrink-0" />
                  )}
                </button>
              )}
              {pump_fun_url && (
                <div
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(pump_fun_url, '_blank', 'noopener,noreferrer');
                  }}
                  className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
                >
                  [↗] Trade on pump.fun
                </div>
              )}
            </div>
          )}

          {/* Funded block — countdown to launch deadline (migration 027) */}
          {status === 'funded' && (
            <div className={`border bg-[var(--background)] px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest ${
              launchExpired
                ? 'border-[var(--error)] text-[var(--error)]'
                : launchLowTime
                  ? 'border-[var(--warning)] text-[var(--warning)] pulse-glow'
                  : 'border-[var(--accent)] text-[var(--accent)] pulse-glow'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <span>[!] {launchExpired ? 'Window expired' : 'Ready to deploy'}</span>
                {launchTimeRemaining && (
                  <span className="text-[9px] opacity-90">
                    {launchExpired ? 'refund pending' : `${launchTimeRemaining} left`}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          <span>by {creator_wallet.slice(0, 4)}…{creator_wallet.slice(-4)}</span>
          <span>&gt; OPEN</span>
        </div>
      </div>
    </Link>
  );
};

// Card-scale social icon. The card root is a <Link>, so we open via
// window.open + stopPropagation rather than nesting an anchor inside
// an anchor (which is invalid HTML and triggers both navigations).
const CardSocialIcon: React.FC<{ href: string; label: string; children: React.ReactNode }> = ({ href, label, children }) => (
  <button
    type="button"
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(href, '_blank', 'noopener,noreferrer');
    }}
    aria-label={label}
    title={label}
    className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors p-1 border border-[var(--border)] hover:border-[var(--accent)]"
  >
    {children}
  </button>
);

const twitterSvg = (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
const telegramSvg = (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);
const discordSvg = (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
  </svg>
);
const globeSvg = (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
const githubSvg = (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);
