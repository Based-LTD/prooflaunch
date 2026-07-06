'use client';

import { useState, useMemo } from 'react';
import { MemeCard } from '@/components/MemeCard';
import { LandingHero } from '@/components/LandingHero';
import { ContestPopup } from '@/components/ContestPopup';
import { Loader2, Search, Flame, Zap, Rocket } from 'lucide-react';
import { useRealtimeMemes } from '@/hooks/useRealtimeMemes';
import type { Meme } from '@/types/database';

// Each column can sort independently. The option sets differ because
// "ending soon" only matters for backing (the deadline is meaningful)
// and "progress" only applies to columns where slots are still filling.
type ProvingSort = 'ending_soon' | 'newest' | 'progress';
type FundedSort = 'newest' | 'oldest';
type LiveSort = 'newest' | 'oldest';

interface MemeWithCount extends Meme {
  backer_count?: number;
  progress_percent?: number;
}

const newestFirst = (a: MemeWithCount, b: MemeWithCount) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
const oldestFirst = (a: MemeWithCount, b: MemeWithCount) =>
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
const endingSoon = (a: MemeWithCount, b: MemeWithCount) =>
  new Date(a.backing_deadline).getTime() - new Date(b.backing_deadline).getTime();
const byProgress = (a: MemeWithCount, b: MemeWithCount) => {
  const aSlots = Number(a.total_slots) || 8;
  const bSlots = Number(b.total_slots) || 8;
  const pa = aSlots > 0 ? (Number(a.backer_count) || 0) / aSlots : 0;
  const pb = bSlots > 0 ? (Number(b.backer_count) || 0) / bSlots : 0;
  return pb - pa;
};

export default function Home() {
  const [search, setSearch] = useState('');
  const [provingSort, setProvingSort] = useState<ProvingSort>('ending_soon');
  const [fundedSort, setFundedSort] = useState<FundedSort>('newest');
  const [liveSort, setLiveSort] = useState<LiveSort>('newest');

  // Mobile-only: which column is visible. The three columns collapse
  // to one column on narrow screens; without a switcher you have to
  // scroll through Proving + Funded to reach Live. Tabs jump you
  // straight to what you want. Ignored on md+ where all three render
  // side-by-side.
  const [mobileTab, setMobileTab] = useState<'proving' | 'funded' | 'live'>('proving');

  // Pull every status in one query so the page renders all three columns
  // in a single round-trip. The realtime hook already streams updates.
  const { memes, loading } = useRealtimeMemes({ status: 'all' });

  const { proving, funded, live, totals } = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchesSearch = (m: Meme) =>
      !term || m.name.toLowerCase().includes(term) || m.symbol.toLowerCase().includes(term);

    const all = (memes as MemeWithCount[]).filter(matchesSearch);

    const provingFn =
      provingSort === 'ending_soon' ? endingSoon :
      provingSort === 'progress' ? byProgress :
      newestFirst;
    const fundedFn = fundedSort === 'oldest' ? oldestFirst : newestFirst;
    const liveFn = liveSort === 'oldest' ? oldestFirst : newestFirst;

    const proving = all.filter((m) => m.status === 'backing').sort(provingFn);
    const funded = all.filter((m) => m.status === 'funded' || m.status === 'launching').sort(fundedFn);
    const live = all.filter((m) => m.status === 'live').sort(liveFn);

    // Total counts use the pre-filter set so column headers can show
    // "N of TOTAL" even when search is narrowing the visible cards.
    const allUnfiltered = memes as MemeWithCount[];
    const totals = {
      proving: allUnfiltered.filter((m) => m.status === 'backing').length,
      funded: allUnfiltered.filter((m) => m.status === 'funded' || m.status === 'launching').length,
      live: allUnfiltered.filter((m) => m.status === 'live').length,
    };

    return { proving, funded, live, totals };
  }, [memes, search, provingSort, fundedSort, liveSort]);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* First-visit contest popup — 5 SOL bounty for the first
          community launch to bond. Self-gated via localStorage;
          returns null after the user dismisses OR on SSR. */}
      <ContestPopup />

      {/* Landing hero — MAINNET chip + headline + subtext + stats +
          SUBMIT TOKEN CTA. Self-contained; no scroll-to-grounds button
          (the board below scrolls into view naturally). */}
      <LandingHero />

      {/* Search — single row (sort is per-column now, in column headers) */}
      <div className="border border-[var(--border)] bg-[var(--card)] flex items-center gap-2 px-3 py-2">
        <Search className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
        <input
          type="text"
          placeholder="search tokens by name or symbol..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent border-0 outline-none text-sm font-mono placeholder:text-[var(--muted)] focus:ring-0"
          style={{ border: 'none', background: 'transparent' }}
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Mobile-only column switcher — sticky beneath the navbar so
          it stays thumb-accessible while you scroll through cards.
          Hidden on md+ where the 3-column grid renders everything
          side-by-side and a switcher would be redundant.
          The 80px sticky offset matches the fixed chrome height
          (24px top bar + 56px navbar). The mobile hamburger row
          beneath the navbar is part of the inline nav, not fixed,
          so it doesn't add to the offset. */}
      {!loading && (
        <div
          className="md:hidden sticky top-20 z-30 -mx-4 sm:-mx-6 lg:-mx-8 border-y border-[var(--border)] bg-[var(--background)]/95"
          style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
        >
          <div className="flex">
            {([
              { key: 'proving' as const, label: 'Proving', count: totals.proving, color: 'var(--accent)' },
              { key: 'funded' as const,  label: 'Funded',  count: totals.funded,  color: 'var(--accent-gold)' },
              { key: 'live' as const,    label: 'Live',    count: totals.live,    color: 'var(--success)' },
            ]).map((tab, i) => {
              const active = mobileTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setMobileTab(tab.key)}
                  className={`flex-1 py-3 text-[11px] font-mono uppercase tracking-widest transition-colors ${
                    i > 0 ? 'border-l border-[var(--border)]' : ''
                  } ${active ? 'bg-[var(--card)]' : ''}`}
                  style={{ color: active ? tab.color : 'var(--muted)' }}
                  aria-pressed={active}
                >
                  {tab.label}{' '}
                  <span className="opacity-60">({tab.count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3-column board.
          On md+ the grid renders all three cells. On mobile the grid
          becomes single-column; we toggle each cell's display so only
          the active mobileTab is visible. Wrapping each Column in a
          div (instead of editing Column itself) keeps the visibility
          concern at the call site. */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={mobileTab === 'proving' ? 'block' : 'hidden md:block'}>
            <Column
              label="Proving"
              icon={Flame}
              iconColor="text-[var(--accent)]"
              count={proving.length}
              totalCount={totals.proving}
              isFiltered={!!search.trim()}
              memes={proving}
              emptyHint={search ? 'No matches' : 'No active provings'}
              sortValue={provingSort}
              onSortChange={(v) => setProvingSort(v as ProvingSort)}
              sortOptions={[
                { value: 'ending_soon', label: 'ENDING_SOON' },
                { value: 'progress', label: 'PROGRESS' },
                { value: 'newest', label: 'NEWEST' },
              ]}
            />
          </div>
          <div className={mobileTab === 'funded' ? 'block' : 'hidden md:block'}>
            <Column
              label="Funded"
              icon={Zap}
              iconColor="text-[var(--accent-gold)]"
              count={funded.length}
              totalCount={totals.funded}
              isFiltered={!!search.trim()}
              memes={funded}
              emptyHint={search ? 'No matches' : 'No funded tokens waiting'}
              sortValue={fundedSort}
              onSortChange={(v) => setFundedSort(v as FundedSort)}
              sortOptions={[
                { value: 'newest', label: 'NEWEST' },
                { value: 'oldest', label: 'OLDEST' },
              ]}
            />
          </div>
          <div className={mobileTab === 'live' ? 'block' : 'hidden md:block'}>
            <Column
              label="Live"
              icon={Rocket}
              iconColor="text-[var(--success)]"
              count={live.length}
              totalCount={totals.live}
              isFiltered={!!search.trim()}
              memes={live}
              emptyHint={search ? 'No matches' : 'No launched tokens yet'}
              sortValue={liveSort}
              onSortChange={(v) => setLiveSort(v as LiveSort)}
              sortOptions={[
                { value: 'newest', label: 'NEWEST' },
                { value: 'oldest', label: 'OLDEST' },
              ]}
            />
          </div>
        </div>
      )}

      {/* How It Works — small terminal block at the bottom, doesn't compete with the board */}
      <div className="border border-[var(--border)] bg-[var(--card)] mt-6">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// SEQUENCE.HOW_IT_WORKS'}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            4 STEPS
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
          {[
            { step: '01', title: 'SUBMIT', desc: 'Creator submits a token to the Proving Grounds' },
            { step: '02', title: 'BACK', desc: 'Community backs with SOL to prove demand' },
            { step: '03', title: 'LAUNCH', desc: 'All slots filled = token launches on Pump.fun, Meteora, or LaunchLab' },
            { step: '04', title: 'TRADE', desc: 'Tokens land in backer wallets at launch and trade on the chosen AMM' },
          ].map((item) => (
            <div key={item.step} className="p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-2">
                STEP {item.step}
              </div>
              <h3 className="font-mono font-semibold uppercase text-sm mb-1">{item.title}</h3>
              <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────
// Header has icon + label on the left, sort selector + count on the
// right. Scrollable card stack below. On mobile the columns stack
// vertically and lose their max-height (the page itself becomes
// scrollable instead).
interface SortOption { value: string; label: string }
interface ColumnProps {
  label: string;
  icon: typeof Flame;
  iconColor: string;
  count: number;            // post-filter count
  totalCount: number;       // pre-filter count (for the platform-truth chip)
  isFiltered: boolean;
  memes: MemeWithCount[];
  emptyHint: string;
  sortValue: string;
  onSortChange: (v: string) => void;
  sortOptions: SortOption[];
}

const Column: React.FC<ColumnProps> = ({
  label, icon: Icon, iconColor, count, totalCount, isFiltered, memes, emptyHint,
  sortValue, onSortChange, sortOptions,
}) => {
  return (
    <div className="border border-[var(--border)] bg-[var(--card)] flex flex-col md:max-h-[75vh]">
      <div className="border-b border-[var(--border)] px-3 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-3 h-3 ${iconColor} shrink-0`} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// '}{label.toUpperCase()}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] shrink-0">
            {isFiltered ? <><span className={iconColor}>{count}</span>/{totalCount}</> : <span className={iconColor}>{totalCount}</span>}
          </span>
        </div>
        <select
          value={sortValue}
          onChange={(e) => onSortChange(e.target.value)}
          className="bg-transparent border-0 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)] outline-none cursor-pointer pr-1 shrink-0"
          aria-label={`Sort ${label}`}
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[var(--background)] text-[var(--foreground)]">
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 md:overflow-y-auto p-2 space-y-2">
        {memes.length === 0 ? (
          <div className="p-6 text-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            &gt; {emptyHint}
          </div>
        ) : (
          memes.map((m) => <MemeCard key={m.id} meme={m} />)
        )}
      </div>
    </div>
  );
};
