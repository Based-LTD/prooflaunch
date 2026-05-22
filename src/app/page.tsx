'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { MemeCard } from '@/components/MemeCard';
import { Flame, TrendingUp, Users, Search, Loader2, ArrowUpDown, SlidersHorizontal, ChevronLeft, ChevronRight, Rocket, Zap } from 'lucide-react';
import { useRealtimeMemes } from '@/hooks/useRealtimeMemes';
import type { Meme } from '@/types/database';

type SortOption = 'newest' | 'progress' | 'ending_soon';

const ITEMS_PER_PAGE = 20;

export default function Home() {
  const [filter, setFilter] = useState<'all' | 'backing' | 'live'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const { memes, loading } = useRealtimeMemes({ status: filter });

  const stats = useMemo(() => {
    const backingMemes = memes.filter((m: Meme) => m.status === 'backing');
    const totalBacked = memes.reduce((sum: number, m: Meme) => sum + Number(m.current_backing_sol || 0), 0);
    const totalBackers = memes.reduce((sum: number, m: any) => sum + (m.backer_count || 0), 0);

    return {
      activeProving: backingMemes.length,
      totalBacked,
      totalBackers,
    };
  }, [memes]);

  const filteredMemes = useMemo(() => {
    let result = memes.filter(meme =>
      meme.name.toLowerCase().includes(search.toLowerCase()) ||
       meme.symbol.toLowerCase().includes(search.toLowerCase())
    );

    result.sort((a, b) => {
      // When ALL is selected, float funded memes (slots filled, launch-
      // ready) to the top — they're the most actionable. The chosen
      // sortBy still orders within each group.
      if (filter === 'all') {
        const af = a.status === 'funded' ? 0 : 1;
        const bf = b.status === 'funded' ? 0 : 1;
        if (af !== bf) return af - bf;
      }
      switch (sortBy) {
        case 'progress':
          const aSlots = Number(a.total_slots) || 8;
          const bSlots = Number(b.total_slots) || 8;
          const progressA = aSlots > 0 ? (Number((a as any).backer_count) || 0) / aSlots : 0;
          const progressB = bSlots > 0 ? (Number((b as any).backer_count) || 0) / bSlots : 0;
          return progressB - progressA;
        case 'ending_soon':
          return new Date(a.backing_deadline).getTime() - new Date(b.backing_deadline).getTime();
        case 'newest':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return result;
  }, [memes, search, sortBy, filter]);

  const totalPages = Math.ceil(filteredMemes.length / ITEMS_PER_PAGE);
  const paginatedMemes = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredMemes.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredMemes, currentPage]);

  const handleFilterChange = (newFilter: 'all' | 'backing' | 'live') => {
    setFilter(newFilter);
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const handleSortChange = (value: SortOption) => {
    setSortBy(value);
    setCurrentPage(1);
  };

  const statsDisplay = [
    { label: 'Active in Proving', value: stats.activeProving.toString(), icon: Flame, color: 'text-[var(--accent)]' },
    { label: 'Total Backed', value: `${stats.totalBacked.toFixed(1)} SOL`, icon: TrendingUp, color: 'text-[var(--success)]' },
    { label: 'Genesis Backers', value: stats.totalBackers.toString(), icon: Users, color: 'text-[var(--warning)]' },
  ];

  return (
    <div className="space-y-6">
      {/* Hero — terminal block */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // PROOF_LAUNCH.SYS // PROVING_GROUNDS
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            [ACTIVE]
          </span>
        </div>

        <div className="p-6 sm:p-10 space-y-6">
          <div className="space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-[var(--muted)]">
              &gt; SYSTEM
            </div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-mono font-semibold uppercase leading-[1.05] tracking-tight">
              The Proving<br />
              <span className="text-[var(--accent)]">Grounds<span className="cursor-blink" /></span>
            </h1>
            <p className="text-sm sm:text-base text-[var(--muted)] max-w-2xl font-mono leading-relaxed pt-3">
              Communities form BEFORE tokens launch. Back memes you believe in,
              get the first tokens when they go live on Pump.fun.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link href="/submit" className="btn-primary inline-flex items-center justify-center gap-2">
              [&gt;] Submit Meme
            </Link>
            <Link href="/docs" className="btn-secondary inline-flex items-center justify-center gap-2">
              [?] Read Docs
            </Link>
            <Link href="/roadmap" className="btn-secondary inline-flex items-center justify-center gap-2">
              [→] Roadmap
            </Link>
          </div>
        </div>
      </div>

      {/* Stats — terminal readout */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // LIVE_METRICS
          </span>
        </div>
        <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
          {statsDisplay.map((stat) => (
            <div key={stat.label} className="p-5">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">
                {stat.label}
              </div>
              <div className="text-2xl sm:text-3xl font-mono font-semibold text-[var(--accent)]">
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Search and Filter — terminal command row */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // QUERY
          </span>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)]"
          >
            {showFilters ? '[−] HIDE_FILTERS' : '[+] FILTERS'}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row">
          {/* Search input */}
          <div className="flex items-center gap-2 flex-1 px-3 py-2 border-b sm:border-b-0 sm:border-r border-[var(--border)]">
            <span className="text-[var(--accent)] font-mono">&gt;</span>
            <input
              type="text"
              placeholder="search memes..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="flex-1 bg-transparent border-0 outline-none text-sm font-mono placeholder:text-[var(--muted)] focus:ring-0"
              style={{ border: 'none', background: 'transparent' }}
            />
          </div>

          {/* Filter buttons */}
          <div className="flex">
            {([
              { key: 'all', label: 'ALL' },
              { key: 'backing', label: 'PROVING' },
              { key: 'live', label: 'LIVE' },
            ] as const).map((f) => (
              <button
                key={f.key}
                onClick={() => handleFilterChange(f.key)}
                className={`px-4 py-2 text-[11px] font-mono uppercase tracking-widest border-l border-[var(--border)] first:border-l-0 sm:first:border-l transition-colors ${
                  filter === f.key
                    ? 'bg-[var(--accent)] text-[#0a0a0a]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {filter === f.key && '> '}
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced filters drawer */}
        {showFilters && (
          <div className="border-t border-[var(--border)] px-4 py-3 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                SORT_BY:
              </span>
              <select
                value={sortBy}
                onChange={(e) => handleSortChange(e.target.value as SortOption)}
                className="px-2 py-1 bg-[var(--background)] border border-[var(--border)] text-xs font-mono uppercase focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="newest">NEWEST</option>
                <option value="progress">PROGRESS</option>
                <option value="ending_soon">ENDING_SOON</option>
              </select>
            </div>

            {sortBy !== 'newest' && (
              <button
                onClick={() => {
                  setSortBy('newest');
                  setCurrentPage(1);
                }}
                className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:underline"
              >
                [×] RESET
              </button>
            )}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Results Count */}
      {!loading && filteredMemes.length > 0 && (
        <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          <span>
            [{((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredMemes.length)}] OF {filteredMemes.length}
          </span>
          {totalPages > 1 && (
            <span>PAGE {currentPage}/{totalPages}</span>
          )}
        </div>
      )}

      {/* Meme Grid */}
      {!loading && paginatedMemes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginatedMemes.map((meme) => (
            <MemeCard key={meme.id} meme={meme as any} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex justify-center items-center gap-1 font-mono text-xs">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 h-9 bg-[var(--card)] border border-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors uppercase tracking-widest text-[10px]"
          >
            &lt; PREV
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2)
            .map((page, index, array) => {
              const showEllipsisBefore = index > 0 && page - array[index - 1] > 1;
              return (
                <span key={page} className="flex items-center gap-1">
                  {showEllipsisBefore && (
                    <span className="px-1 text-[var(--muted)]">…</span>
                  )}
                  <button
                    onClick={() => setCurrentPage(page)}
                    className={`min-w-[36px] h-9 font-mono text-xs transition-colors ${
                      currentPage === page
                        ? 'bg-[var(--accent)] text-[#0a0a0a]'
                        : 'bg-[var(--card)] border border-[var(--border)] hover:border-[var(--accent)]'
                    }`}
                  >
                    {page}
                  </button>
                </span>
              );
            })}

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 h-9 bg-[var(--card)] border border-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors uppercase tracking-widest text-[10px]"
          >
            NEXT &gt;
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredMemes.length === 0 && (
        <div className="border border-[var(--border)] bg-[var(--card)] p-12 text-center">
          <div className="text-[var(--accent)] font-mono text-xs uppercase tracking-widest mb-3">
            [!] NO_RESULTS
          </div>
          <h3 className="font-mono uppercase tracking-tight text-base mb-2">No memes found</h3>
          <p className="text-xs font-mono text-[var(--muted)] mb-6">
            {search ? '> try a different search term' : '> be the first to submit a meme'}
          </p>
          <Link href="/submit" className="btn-primary inline-flex items-center gap-2">
            [&gt;] Submit Meme
          </Link>
        </div>
      )}

      {/* How It Works — terminal sequence */}
      <div className="border border-[var(--border)] bg-[var(--card)] mt-8">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // SEQUENCE.HOW_IT_WORKS
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            4 STEPS
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[var(--border)]">
          {[
            { step: '01', title: 'SUBMIT', desc: 'Creator submits a meme to the Proving Grounds' },
            { step: '02', title: 'BACK', desc: 'Community backs with SOL to prove demand' },
            { step: '03', title: 'LAUNCH', desc: 'All slots filled = token launches on Pump.fun' },
            { step: '04', title: 'TRADE', desc: 'Token goes live with instant visibility' },
          ].map((item) => (
            <div key={item.step} className="p-5">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-3">
                STEP {item.step}
              </div>
              <h3 className="font-mono font-semibold uppercase text-base mb-2">{item.title}</h3>
              <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
