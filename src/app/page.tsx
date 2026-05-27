'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { MemeCard } from '@/components/MemeCard';
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
  const [proofPaidOut, setProofPaidOut] = useState<number | null>(null);

  // Pull every status in one query so the page renders all three columns
  // in a single round-trip. The realtime hook already streams updates.
  const { memes, loading } = useRealtimeMemes({ status: 'all' });

  // Fetch the live "PROOF airdropped to holders" total for the ticker.
  // Quietly fails — if the API is down the chip is hidden rather than
  // showing a dash that looks broken.
  useEffect(() => {
    let cancelled = false;
    const fetchPaidOut = async () => {
      try {
        const r = await fetch('/api/proof/paid-out');
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && typeof j.totalPaidOutSol === 'number') {
          setProofPaidOut(j.totalPaidOutSol);
        }
      } catch {}
    };
    fetchPaidOut();
    const id = setInterval(fetchPaidOut, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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

    // Total counts use the pre-filter set so the hero strip reads the
    // platform state, not the search results.
    const allUnfiltered = memes as MemeWithCount[];
    const totals = {
      proving: allUnfiltered.filter((m) => m.status === 'backing').length,
      funded: allUnfiltered.filter((m) => m.status === 'funded' || m.status === 'launching').length,
      live: allUnfiltered.filter((m) => m.status === 'live').length,
      backers: allUnfiltered.reduce((s, m) => s + (Number(m.backer_count) || 0), 0),
      backed: allUnfiltered.reduce((s, m) => s + Number(m.current_backing_sol || 0), 0),
    };

    return { proving, funded, live, totals };
  }, [memes, search, provingSort, fundedSort, liveSort]);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Hero — headline + two-line mechanic + CTAs below + live counts. */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// PROOF_LAUNCH.SYS // PROVING_GROUNDS'}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              LAUNCHES ON <span className="text-[var(--accent)]">pump.fun</span>
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
              [ACTIVE]
            </span>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-[var(--muted)] mb-2">
            &gt; SYSTEM
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-mono font-semibold uppercase leading-[1.1] tracking-tight">
            Launch infrastructure for token teams.<span className="cursor-blink" />
          </h1>

          {/* Action layer — preserves the Prove/Launch/Earn brand DNA
              beneath the positioning headline. Smaller + separated by
              a rule so the hierarchy reads as "what we are" / "what
              you do with it". */}
          <div className="mt-5 sm:mt-6 pt-4 sm:pt-5 border-t border-[var(--border)]">
            <p className="font-mono text-lg sm:text-xl md:text-2xl uppercase tracking-tight font-semibold">
              <span className="text-[var(--accent)]">Prove</span>.{' '}
              <span className="text-[var(--accent-gold)]">Launch</span>.{' '}
              <span className="text-[var(--success)]">Earn</span>.
            </p>
          </div>

          {/* Two-line mechanic — arrows read as a system diagram */}
          <div className="mt-4 sm:mt-5 space-y-1.5 font-mono text-sm sm:text-base text-[var(--foreground)]/85 leading-relaxed">
            <p>
              <span className="text-[var(--muted)]">&gt;</span> Back a token{' '}
              <span className="text-[var(--accent)]">→</span> buy the first supply + earn from its trades.
            </p>
            <p>
              <span className="text-[var(--muted)]">&gt;</span> Hold{' '}
              <span className="text-[var(--accent-gold)]">$PROOF</span>{' '}
              <span className="text-[var(--accent)]">→</span> earn from every launch on the platform.
            </p>
          </div>

          {/* CTAs — full row beneath, full-width on mobile */}
          <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:gap-3">
            <Link href="/submit" className="btn-primary inline-flex items-center justify-center gap-2">
              [&gt;] Submit Token
            </Link>
            <Link href="/docs" className="btn-secondary inline-flex items-center justify-center gap-2">
              [?] Read Docs
            </Link>
            <Link href="/roadmap" className="btn-secondary inline-flex items-center justify-center gap-2">
              [→] Roadmap
            </Link>
          </div>
        </div>

        {/* Live counts — terminal readout strip across the bottom */}
        <div className="border-t border-[var(--border)] px-4 py-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          <span><span className="text-[var(--accent)]">{totals.proving}</span> proving</span>
          <span>·</span>
          <span><span className="text-[var(--accent-gold)]">{totals.funded}</span> funded</span>
          <span>·</span>
          <span><span className="text-[var(--success)]">{totals.live}</span> live</span>
          <span>·</span>
          <span><span className="text-[var(--foreground)]">{totals.backers}</span> backers</span>
          <span>·</span>
          <span><span className="text-[var(--foreground)]">{totals.backed.toFixed(1)}</span> SOL backed</span>
          {proofPaidOut !== null && (
            <>
              <span>·</span>
              <span>
                <span className="text-[var(--success)]">{proofPaidOut.toFixed(2)}</span>{' '}
                SOL airdropped to <span className="text-[var(--accent-gold)]">$PROOF</span> holders
              </span>
            </>
          )}
        </div>
      </div>

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

      {/* 3-column board */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            { step: '03', title: 'LAUNCH', desc: 'All slots filled = token launches on Pump.fun' },
            { step: '04', title: 'EARN', desc: 'Backers earn from every trade — proportional to holdings' },
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
