'use client';

// RHC home. The page is the tokens: one kicker line, the flywheel strip,
// search, the board. No hero, no stat rows, no explainer — those live on
// /rhc/flywheel and /rhc/docs (founder, 2026-09-22).
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Flame, Zap, Rocket } from 'lucide-react';
import { fetchAllCampaigns, parseRows, readBoardCache, writeBoardCache, takeBoardDirty, CampaignRow } from '@/lib/rhc';
import { CampaignCard } from './components';
import Link from 'next/link';
import { RhcHeader } from './components';
import { FlywheelPanel } from './FlywheelPanel';

type BackingSort = 'ending_soon' | 'newest' | 'progress';
type SimpleSort = 'newest' | 'oldest';

// No created_at on-chain; deadline is the honest recency proxy (newer
// campaigns set later deadlines) and is exactly right for ENDING_SOON.
const endingSoon = (a: CampaignRow, b: CampaignRow) => Number(a.deadline - b.deadline);
const newestFirst = (a: CampaignRow, b: CampaignRow) => Number(b.deadline - a.deadline);
const oldestFirst = (a: CampaignRow, b: CampaignRow) => Number(a.deadline - b.deadline);
// progress = raised/goal, compared by bigint cross-multiplication
const byProgress = (a: CampaignRow, b: CampaignRow) => {
  const l = a.totalRaised * (b.goal === 0n ? 1n : b.goal);
  const r = b.totalRaised * (a.goal === 0n ? 1n : a.goal);
  return l === r ? 0 : l > r ? -1 : 1;
};

export default function RhcBoardPage() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [backingSort, setBackingSort] = useState<BackingSort>('ending_soon');
  const [fundedSort, setFundedSort] = useState<SimpleSort>('newest');
  const [liveSort, setLiveSort] = useState<SimpleSort>('newest');
  const [mobileTab, setMobileTab] = useState<'backing' | 'funded' | 'live'>('backing');

  useEffect(() => {
    // Instant paint from the session cache, then the CDN-cached API
    // (~100ms warm), with direct chain reads as the fallback of last
    // resort — the SOL board's exact loading strategy.
    // After a create/launch the session cache is already cleared and the
    // dirty flag is set: skip the stale paint and bust the CDN key once.
    const dirty = takeBoardDirty();
    const cached = dirty ? null : readBoardCache();
    if (cached) setRows(cached);
    fetch(dirty ? `/api/rhc/campaigns?t=${Date.now()}` : '/api/rhc/campaigns', dirty ? { cache: 'no-store' } : undefined)
      .then(async (res) => {
        if (!res.ok) throw new Error('api ' + res.status);
        return parseRows(await res.text());
      })
      .catch(() => fetchAllCampaigns())
      .then((r) => { setRows(r); writeBoardCache(r); })
      .catch((e) => { if (!cached) setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  const { backing, funded, live, totals } = useMemo(() => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const all = rows || [];
    const isBacking = (r: CampaignRow) => !r.launched && !r.cancelled && r.totalRaised < r.goal && now < r.deadline;
    const isFunded = (r: CampaignRow) => !r.launched && !r.cancelled && r.totalRaised >= r.goal;

    const term = search.trim().toLowerCase();
    const matches = (r: CampaignRow) =>
      !term || r.name.toLowerCase().includes(term) || r.symbol.toLowerCase().includes(term);
    const filtered = all.filter(matches);

    const backingFn =
      backingSort === 'ending_soon' ? endingSoon :
      backingSort === 'progress' ? byProgress :
      newestFirst;
    const fundedFn = fundedSort === 'oldest' ? oldestFirst : newestFirst;
    const liveFn = liveSort === 'oldest' ? oldestFirst : newestFirst;

    return {
      backing: filtered.filter(isBacking).sort(backingFn),
      funded: filtered.filter(isFunded).sort(fundedFn),
      live: filtered.filter((r) => r.launched).sort(liveFn),
      totals: {
        backing: all.filter(isBacking).length,
        funded: all.filter(isFunded).length,
        live: all.filter((r) => r.launched).length,
      },
    };
  }, [rows, search, backingSort, fundedSort, liveSort]);

  const loading = !rows && !error;

  return (
    <div className="space-y-4 sm:space-y-5">
      <RhcHeader />
      <FlywheelPanel strip />

      {/* Search — single row (sort is per-column, in column headers) */}
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

      {error && (
        <p className="text-xs font-mono text-[var(--error)] border border-[var(--error)]/40 bg-[var(--error)]/5 p-3">
          CHAIN READ FAILED: {error} — refresh to retry
        </p>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Mobile-only column switcher — sticky beneath the navbar, same
          offsets and treatment as the SOL board. */}
      {rows && (
        <div
          className="md:hidden sticky top-20 z-30 -mx-4 sm:-mx-6 lg:-mx-8 border-y border-[var(--border)] bg-[var(--background)]/95"
          style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
        >
          <div className="flex">
            {([
              { key: 'backing' as const, label: 'Backing', count: totals.backing, color: 'var(--accent)' },
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

      {/* 3-column board — the SOL Column skeleton with chain-native data. */}
      {rows && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={mobileTab === 'backing' ? 'block' : 'hidden md:block'}>
            <Column
              label="Backing"
              icon={Flame}
              iconColor="text-[var(--accent)]"
              count={backing.length}
              totalCount={totals.backing}
              isFiltered={!!search.trim()}
              items={backing}
              emptyHint={search ? 'No matches' : 'No open raises — create one'}
              sortValue={backingSort}
              onSortChange={(v) => setBackingSort(v as BackingSort)}
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
              items={funded}
              emptyHint={search ? 'No matches' : 'None awaiting launch'}
              sortValue={fundedSort}
              onSortChange={(v) => setFundedSort(v as SimpleSort)}
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
              items={live}
              emptyHint={search ? 'No matches' : 'No launched tokens yet'}
              sortValue={liveSort}
              onSortChange={(v) => setLiveSort(v as SimpleSort)}
              sortOptions={[
                { value: 'newest', label: 'NEWEST' },
                { value: 'oldest', label: 'OLDEST' },
              ]}
            />
          </div>
        </div>
      )}

      {/* How It Works — small terminal block at the bottom, doesn't compete with the board */}
      <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] pt-2">
        New here? <Link href="/rhc/docs" className="underline hover:text-[var(--muted)]">How it works</Link> · <Link href="/rhc/check" className="underline hover:text-[var(--muted)]">WalletProof</Link> · <Link href="/rhc/audit" className="underline hover:text-[var(--muted)]">Audit</Link>
      </p>
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────
// The SOL board Column, verbatim skeleton: icon + label + count chip on
// the left, sort selector on the right, scrollable card stack below.
interface SortOption { value: string; label: string }
interface ColumnProps {
  label: string;
  icon: typeof Flame;
  iconColor: string;
  count: number;
  totalCount: number;
  isFiltered: boolean;
  items: CampaignRow[];
  emptyHint: string;
  sortValue: string;
  onSortChange: (v: string) => void;
  sortOptions: SortOption[];
}

const Column: React.FC<ColumnProps> = ({
  label, icon: Icon, iconColor, count, totalCount, isFiltered, items, emptyHint,
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
        {items.length === 0 ? (
          <div className="p-6 text-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            &gt; {emptyHint}
          </div>
        ) : (
          items.map((r) => <CampaignCard key={r.address} r={r} />)
        )}
      </div>
    </div>
  );
};
