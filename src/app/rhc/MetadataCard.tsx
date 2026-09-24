'use client';

// Everything a campaign says about itself, in one place, after submission:
// what is on-chain (pons will mint it exactly like this), what is off-chain
// (banner, GitHub, overrides — creator-signed, shown here), and every term
// of the raise. Missing fields show as "not set" so nothing is discovered
// after the fact. Addresses stay off this card before launch on purpose.
import { DashboardCard } from '@/components/meme/DashboardCard';
import type { CampaignMedia } from './CampaignBanner';
import { EQUITY_ASSETS } from '@/lib/rhcEquity';

type Row = { k: string; v: React.ReactNode; tag: 'on-chain' | 'off-chain' | 'term'; missing?: boolean };

export function MetadataCard({ meta, media, terms }: {
  meta: { name: string; symbol: string; logo: string; description: string; socials?: { twitter?: string; telegram?: string; discord?: string; website?: string; farcaster?: string } };
  media: CampaignMedia;
  terms: { tax: number; payoutAsset: `0x${string}`; quote: string; seats: number; reserved: number; seatPrice: string; minDeposit: string; maxDeposit: string; deadline: bigint; legs: string; launched: boolean };
}) {
  const link = (u?: string | null) => u ? <a href={u.startsWith('http') ? u : `https://${u}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline break-all">{u}</a> : null;
  const payout = EQUITY_ASSETS.find((a) => a.address.toLowerCase() === terms.payoutAsset.toLowerCase());
  const rows: Row[] = [
    { k: 'name', v: meta.name, tag: 'on-chain', missing: !meta.name },
    { k: 'symbol', v: meta.symbol ? `$${meta.symbol}` : '', tag: 'on-chain', missing: !meta.symbol },
    { k: 'logo', v: meta.logo ? <img src={meta.logo} alt="" className="w-8 h-8 object-cover border border-[var(--border)] inline-block" /> : '', tag: 'on-chain', missing: !meta.logo },
    { k: 'description', v: <span className="whitespace-pre-wrap">{media.description || meta.description}</span>, tag: media.description ? 'off-chain' : 'on-chain', missing: !(media.description || meta.description) },
    { k: 'x', v: link(media.twitter || meta.socials?.twitter), tag: media.twitter ? 'off-chain' : 'on-chain', missing: !(media.twitter || meta.socials?.twitter) },
    { k: 'telegram', v: link(media.telegram || meta.socials?.telegram), tag: media.telegram ? 'off-chain' : 'on-chain', missing: !(media.telegram || meta.socials?.telegram) },
    { k: 'discord', v: link(media.discord || meta.socials?.discord), tag: media.discord ? 'off-chain' : 'on-chain', missing: !(media.discord || meta.socials?.discord) },
    { k: 'website', v: link(media.website || meta.socials?.website), tag: media.website ? 'off-chain' : 'on-chain', missing: !(media.website || meta.socials?.website) },
    { k: 'farcaster', v: link(meta.socials?.farcaster), tag: 'on-chain', missing: !meta.socials?.farcaster },
    { k: 'github', v: link(media.github), tag: 'off-chain', missing: !media.github },
    { k: 'banner', v: media.banner_url ? <img src={media.banner_url} alt="" className="h-8 w-24 object-cover border border-[var(--border)] inline-block" /> : '', tag: 'off-chain', missing: !media.banner_url },
    { k: 'creator tax', v: `${(terms.tax / 100).toFixed(terms.tax % 100 ? 1 : 0)}% · traders pay ${((terms.tax + 100) / 100).toFixed(terms.tax % 100 ? 1 : 0)}% with pons' 1%`, tag: 'term' },
    { k: 'fee payout', v: payout ? `${payout.symbol} (${payout.label}) · ETH always available` : 'ETH · backers may pick a stock at claim', tag: 'term' },
    { k: 'fee stack', v: terms.legs, tag: 'term' },
    { k: 'raise', v: terms.seats > 0 ? `${terms.seats} seats × ${terms.seatPrice} ${terms.quote}${terms.reserved ? ` · ${terms.reserved} team, ${terms.seats - terms.reserved} public` : ''}` : `open · min ${terms.minDeposit} ${terms.quote}${terms.maxDeposit !== '0' ? ` · max ${terms.maxDeposit}` : ''}`, tag: 'term' },
    { k: 'deadline', v: new Date(Number(terms.deadline) * 1000).toLocaleString(), tag: 'term' },
  ];
  const missing = rows.filter((r) => r.missing).length;
  return (
    <DashboardCard label="METADATA" meta={missing ? `${missing} not set` : 'complete'}>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs font-mono">
        {rows.map((r) => (
          <div key={r.k} className="contents">
            <dt className="text-[10px] uppercase tracking-widest text-[var(--muted)] pt-0.5 flex items-start gap-1.5">
              <span className={`inline-block w-1.5 h-1.5 mt-1.5 shrink-0 ${r.tag === 'on-chain' ? 'bg-[var(--accent)]' : r.tag === 'off-chain' ? 'bg-[var(--accent-gold)]' : 'bg-[var(--muted)]'}`} title={r.tag} />
              {r.k}
            </dt>
            <dd className={r.missing ? 'text-[var(--muted-soft)] italic' : 'text-[var(--foreground)]'}>{r.missing ? 'not set' : r.v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] flex flex-wrap gap-x-4 gap-y-1">
        <span><span className="inline-block w-1.5 h-1.5 bg-[var(--accent)] mr-1.5" />on-chain{terms.launched ? ' · minted, immutable' : ' · pons mints this at launch'}</span>
        <span><span className="inline-block w-1.5 h-1.5 bg-[var(--accent-gold)] mr-1.5" />off-chain · creator-signed, editable</span>
        <span><span className="inline-block w-1.5 h-1.5 bg-[var(--muted)] mr-1.5" />raise terms · immutable</span>
      </p>
    </DashboardCard>
  );
}
