'use client';

// Slim identity strip — the SOL page's MemeIdentityBar for Robinhood
// Chain. One band: logo · $SYMBOL · NAME · status · creator · key metrics
// · social pills, so the dashboard grid sits high in the viewport.
import { type ReactNode, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { explorerUrl } from '@/lib/rhc';
import { SocialRow } from '@/components/SocialIcons';

interface Socials { twitter?: string; telegram?: string; discord?: string; website?: string; farcaster?: string; github?: string }

export function CampaignIdentityBar({ logo, name, symbol, creator, status, metrics, socials, token }: {
  logo: string; name: string; symbol: string; creator: `0x${string}`;
  status: ReactNode;
  metrics: { k: string; v: string; accent?: boolean }[];
  socials?: Socials;
  token?: `0x${string}`;
}) {
  const [copied, setCopied] = useState(false);
  const copy = (t: string) => { try { void navigator.clipboard.writeText(t); } catch { /* no clipboard */ } setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex items-center gap-3 min-w-0">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={name} className="w-12 h-12 sm:w-14 sm:h-14 object-cover border border-[var(--border)] flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 sm:w-14 sm:h-14 border border-[var(--accent)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
            <span className="font-mono font-semibold text-[var(--accent)] text-lg">{symbol.charAt(0)}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono font-semibold text-[var(--accent)]">${symbol}</span>
            <h1 className="text-base sm:text-lg font-mono font-semibold uppercase tracking-tight truncate">{name}</h1>
            {status}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mt-1">
            <span>by</span>
            <a href={explorerUrl(creator)} target="_blank" rel="noopener noreferrer" className="bg-[var(--background)] border border-[var(--border)] px-1.5 py-0.5 normal-case tracking-normal hover:text-[var(--accent)]">
              {creator.slice(0, 6)}…{creator.slice(-4)}
            </a>
            <button onClick={() => copy(creator)} className="hover:text-[var(--accent)] transition-colors" aria-label="Copy creator address">
              {copied ? <Check className="w-3 h-3 text-[var(--success)]" /> : <Copy className="w-3 h-3" />}
            </button>
            {token && (
              <a href={explorerUrl(token)} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] normal-case tracking-normal">
                token {token.slice(0, 6)}…{token.slice(-4)} ↗
              </a>
            )}
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4 flex-shrink-0 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          {metrics.map((m) => (
            <div key={m.k} className="text-right">
              <div>{m.k}</div>
              <div className={`${m.accent ? 'text-[var(--accent-gold)]' : 'text-[var(--foreground)]'} text-base normal-case tracking-tight`}>{m.v}</div>
            </div>
          ))}
        </div>
        {socials && <SocialRow links={socials} className="hidden sm:flex flex-shrink-0" />}
      </div>
      {socials && <SocialRow links={socials} className="sm:hidden mt-2" />}
      {/* Metrics re-surface on small screens, under the strip. */}
      <div className="md:hidden mt-2 grid grid-cols-3 gap-2">
        {metrics.map((m) => (
          <div key={m.k} className="border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">
            <div className={`font-mono text-sm ${m.accent ? 'text-[var(--accent-gold)]' : ''}`}>{m.v}</div>
            <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">{m.k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
