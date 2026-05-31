'use client';

import { Copy, Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { Meme } from '@/types/database';

// Slim identity strip for the meme dashboard. Replaces the big MemeHero
// so the dashboard grid can sit higher in the viewport. One horizontal
// band with: image · $SYMBOL · NAME · STATUS · creator · key metrics
// · social pills · pump link. Description moves into the dashboard's
// HOW section so this strip stays compact (~88px tall on desktop).

interface Props {
  meme: Meme;
  backerCount: number;
  totalBackingSol: number;
  totalSlots: number;
  timeRemaining: string;
}

export const MemeIdentityBar: React.FC<Props> = ({
  meme, backerCount, totalBackingSol, totalSlots, timeRemaining,
}) => {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const statusBadge = (() => {
    switch (meme.status) {
      case 'live':      return { label: '● LIVE',       cls: 'text-[var(--success)] border-[var(--success)]' };
      case 'backing':   return { label: '⏳ BACKING',   cls: 'text-[var(--accent)] border-[var(--accent)]' };
      case 'funded':    return { label: '⚡ FUNDED',    cls: 'text-[var(--accent-gold)] border-[var(--accent-gold)]' };
      case 'launching': return { label: '⚡ LAUNCHING', cls: 'text-[var(--accent-gold)] border-[var(--accent-gold)]' };
      default:          return { label: meme.status.toUpperCase(), cls: 'text-[var(--muted)] border-[var(--muted)]' };
    }
  })();

  const isLive = meme.status === 'live';

  return (
    <div className="border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* Image */}
        {meme.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meme.image_url}
            alt={meme.name}
            className="w-12 h-12 sm:w-14 sm:h-14 object-cover border border-[var(--border)] flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 sm:w-14 sm:h-14 border border-[var(--accent)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
            <span className="font-mono font-semibold text-[var(--accent)] text-lg">
              {meme.symbol.charAt(0)}
            </span>
          </div>
        )}

        {/* Name + symbol + status */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono font-semibold text-[var(--accent)]">
              ${meme.symbol}
            </span>
            <h1 className="text-base sm:text-lg font-mono font-semibold uppercase tracking-tight truncate">
              {meme.name}
            </h1>
            <span className={`shrink-0 text-[9px] font-mono uppercase tracking-widest border px-1.5 py-0.5 ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mt-1">
            <span>by</span>
            <code className="bg-[var(--background)] border border-[var(--border)] px-1.5 py-0.5 normal-case tracking-normal">
              {meme.creator_wallet.slice(0, 4)}…{meme.creator_wallet.slice(-4)}
            </code>
            <button
              onClick={() => copy(meme.creator_wallet)}
              className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              aria-label="Copy creator wallet"
            >
              {copied ? <Check className="w-3 h-3 text-[var(--success)]" /> : <Copy className="w-3 h-3" />}
            </button>
            {meme.creator_twitter && (
              <a
                href={meme.creator_twitter}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--accent)] transition-colors normal-case tracking-normal"
              >
                @{meme.creator_twitter.split('/').pop()}
              </a>
            )}
          </div>
        </div>

        {/* Key metrics — at-a-glance, right-aligned. Hidden on mobile to
            keep the strip from wrapping; the dashboard cards below
            re-surface them on small screens. */}
        <div className="hidden md:flex items-center gap-4 flex-shrink-0 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          <div className="text-right">
            <div>Backers</div>
            <div className="text-[var(--foreground)] text-base normal-case tracking-tight">
              {backerCount}<span className="text-[var(--muted)]">/{totalSlots}</span>
            </div>
          </div>
          <div className="text-right">
            <div>Backed</div>
            <div className="text-[var(--foreground)] text-base normal-case tracking-tight">
              {totalBackingSol.toFixed(2)} <span className="text-[var(--muted)]">SOL</span>
            </div>
          </div>
          {!isLive && (
            <div className="text-right">
              <div>Ends</div>
              <div className="text-[var(--accent-gold)] text-base normal-case tracking-tight">{timeRemaining}</div>
            </div>
          )}
        </div>

        {/* Socials — tiny pill row */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {meme.twitter && <SocialIcon href={meme.twitter} label="X">{twitterSvg}</SocialIcon>}
          {meme.telegram && <SocialIcon href={meme.telegram} label="TG">{telegramSvg}</SocialIcon>}
          {meme.discord && <SocialIcon href={meme.discord} label="DC">{discordSvg}</SocialIcon>}
          {meme.website && <SocialIcon href={meme.website} label="WEB">{globeSvg}</SocialIcon>}
          {meme.mint_address && (
            <a
              href={meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors p-1.5 border border-[var(--border)] hover:border-[var(--accent)]"
              title="pump.fun"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

const SocialIcon: React.FC<{ href: string; label: string; children: React.ReactNode }> = ({ href, label, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    title={label}
    className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors p-1.5 border border-[var(--border)] hover:border-[var(--accent)]"
  >
    {children}
  </a>
);

const twitterSvg = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
const telegramSvg = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);
const discordSvg = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
  </svg>
);
const globeSvg = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
