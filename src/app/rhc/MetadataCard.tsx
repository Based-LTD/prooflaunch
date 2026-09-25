'use client';

// Everything a campaign says about itself, in one place, after submission:
// what is on-chain (pons will mint it exactly like this), what is off-chain
// (banner, GitHub, overrides — creator-signed, shown here), and every term
// of the raise. Laid out like the SOL token pages — logo, name, social icon
// row, then a terms grid — instead of a column of naked URLs. Missing
// fields are called out so nothing is discovered after the fact. Contract
// addresses stay off this card before launch on purpose.
import { DashboardCard } from '@/components/meme/DashboardCard';
import { SocialRow } from '@/components/SocialIcons';
import type { CampaignMedia } from './CampaignBanner';
import { EQUITY_ASSETS } from '@/lib/rhcEquity';

type Term = { k: string; v: React.ReactNode };

export function MetadataCard({ meta, media, terms }: {
  meta: { name: string; symbol: string; logo: string; description: string; socials?: { twitter?: string; telegram?: string; discord?: string; website?: string; farcaster?: string } };
  media: CampaignMedia;
  terms: { tax: number; payoutAsset: `0x${string}`; quote: string; seats: number; reserved: number; seatPrice: string; minDeposit: string; maxDeposit: string; deadline: bigint; legs: string; launched: boolean };
}) {
  const payout = EQUITY_ASSETS.find((a) => a.address.toLowerCase() === terms.payoutAsset.toLowerCase());
  const s = meta.socials ?? {};
  // Off-chain overrides win where they exist; the tag row below says which.
  const links = {
    twitter: media.twitter || s.twitter,
    telegram: media.telegram || s.telegram,
    discord: media.discord || s.discord,
    website: media.website || s.website,
    farcaster: s.farcaster,
    github: media.github,
  };
  const linkCount = Object.values(links).filter((v) => v && v.trim()).length;
  const description = media.description || meta.description;
  const pct = (bps: number) => (bps / 100).toFixed(bps % 100 ? 1 : 0);

  const termRows: Term[] = [
    { k: 'raise', v: terms.seats > 0
      ? <>{terms.seats} seats × {terms.seatPrice} {terms.quote}{terms.reserved > 0 && <span className="text-[var(--muted)]"> · {terms.reserved} team, {terms.seats - terms.reserved} public</span>}</>
      : <>open · min {terms.minDeposit} {terms.quote}{terms.maxDeposit !== '0' && ` · max ${terms.maxDeposit}`}</> },
    { k: 'creator tax', v: <>{pct(terms.tax)}%<span className="text-[var(--muted)]"> · traders pay {pct(terms.tax + 100)}% with pons&apos; 1%</span></> },
    { k: 'fee payout', v: payout
      ? <>{payout.symbol}<span className="text-[var(--muted)]"> · {payout.label} · ETH always available</span></>
      : <>ETH<span className="text-[var(--muted)]"> · backers may pick a stock at claim</span></> },
    { k: 'fee stack', v: terms.legs },
    { k: 'deadline', v: new Date(Number(terms.deadline) * 1000).toLocaleString() },
  ];

  const gaps = [
    !meta.logo && 'logo',
    !description && 'description',
    linkCount === 0 && 'links',
    !media.banner_url && 'banner',
  ].filter(Boolean) as string[];

  return (
    <DashboardCard label="METADATA" meta={gaps.length ? `${gaps.length} not set` : 'complete'}>
      {/* Identity — logo, name, ticker, icon row. The SOL page's shape. */}
      <div className="flex items-start gap-3">
        {meta.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.logo} alt="" className="w-14 h-14 object-cover border border-[var(--border)] shrink-0" />
        ) : (
          <div className="w-14 h-14 border border-dashed border-[var(--border)] shrink-0 flex items-center justify-center text-[9px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
            no logo
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-base text-[var(--foreground)] truncate">{meta.name || <span className="italic text-[var(--muted-soft)]">unnamed</span>}</span>
            <span className="font-mono text-sm text-[var(--accent)]">${meta.symbol || '???'}</span>
          </div>
          {linkCount > 0 ? (
            <SocialRow links={links} />
          ) : (
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">no links set</p>
          )}
        </div>
      </div>

      {description ? (
        <p className="mt-3 text-xs font-mono text-[var(--muted)] leading-relaxed whitespace-pre-wrap">{description}</p>
      ) : (
        <p className="mt-3 text-xs font-mono italic text-[var(--muted-soft)]">No description set.</p>
      )}

      {/* Banner — shown as the strip it will be, not as a URL. */}
      <div className="mt-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">Banner</div>
        {media.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.banner_url} alt="" className="w-full h-16 object-cover border border-[var(--border)]" />
        ) : (
          <div className="w-full h-16 border border-dashed border-[var(--border)] flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)]">
            not set — add one from the creator controls
          </div>
        )}
      </div>

      {/* Raise terms — immutable, so they get their own block. */}
      <dl className="mt-4 pt-3 border-t border-[var(--border)] grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-xs font-mono">
        {termRows.map((r) => (
          <div key={r.k} className="contents">
            <dt className="text-[10px] uppercase tracking-widest text-[var(--muted)] pt-0.5">{r.k}</dt>
            <dd className="text-[var(--foreground)]">{r.v}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] leading-relaxed">
        Name, symbol, logo, description and the on-chain socials are
        {terms.launched ? ' minted and immutable' : ' what pons mints at launch'}. Banner
        {media.github ? ', GitHub' : ''} and any description override are creator-signed and editable.
        Raise terms never change.
        {gaps.length > 0 && <span className="text-[var(--warning,#c9a227)]"> Not set: {gaps.join(', ')}.</span>}
      </p>
    </DashboardCard>
  );
}
