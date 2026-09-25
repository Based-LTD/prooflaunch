'use client';

// The immutable terms of the raise, in one place. Identity (logo, name,
// ticker, socials, banner, description) lives at the top of the page, so
// this card deliberately does NOT repeat it — the one exception is a single
// line naming anything the creator left unset, which is otherwise invisible
// precisely because an empty field renders as nothing up there.
// Contract addresses stay off this card before launch on purpose.
import { DashboardCard } from '@/components/meme/DashboardCard';
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
  const pct = (bps: number) => (bps / 100).toFixed(bps % 100 ? 1 : 0);

  const rows: Term[] = [
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

  // Only what the page above cannot show by its absence.
  const gaps = [
    !meta.logo && 'logo',
    !(media.description || meta.description) && 'description',
    !(media.twitter || s.twitter || media.telegram || s.telegram || media.discord || s.discord || media.website || s.website || s.farcaster || media.github) && 'links',
    !media.banner_url && 'banner',
  ].filter(Boolean) as string[];

  return (
    <DashboardCard label="TERMS" meta="immutable">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-xs font-mono">
        {rows.map((r) => (
          <div key={r.k} className="contents">
            <dt className="text-[10px] uppercase tracking-widest text-[var(--muted)] pt-0.5">{r.k}</dt>
            <dd className="text-[var(--foreground)]">{r.v}</dd>
          </div>
        ))}
      </dl>
      {gaps.length > 0 && (
        <p className="mt-3 pt-3 border-t border-[var(--border)] text-[10px] font-mono uppercase tracking-widest text-[var(--warning,#c9a227)]">
          Not set: {gaps.join(', ')} — add {gaps.length === 1 ? 'it' : 'them'} from the creator controls.
        </p>
      )}
    </DashboardCard>
  );
}
