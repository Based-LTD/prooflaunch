'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MemeCard } from '@/components/MemeCard';
import { Star, TrendingUp, Users, Search, Loader2, ArrowUpDown, SlidersHorizontal, ChevronLeft, ChevronRight, Copy, Check, Rocket, Zap } from 'lucide-react';
import { useRealtimeMemes } from '@/hooks/useRealtimeMemes';
import type { Meme } from '@/types/database';

type SortOption = 'newest' | 'progress' | 'ending_soon';

const ITEMS_PER_PAGE = 20;

const PLATFORM_TOKEN_CA: string = '';

export default function Home() {
  const [filter, setFilter] = useState<'all' | 'backing' | 'live'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [caCopied, setCaCopied] = useState(false);
  const [tickerOpen, setTickerOpen] = useState(false);

  const handleCopyCA = () => {
    navigator.clipboard.writeText(PLATFORM_TOKEN_CA);
    setCaCopied(true);
    setTimeout(() => setCaCopied(false), 2000);
  };

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
      switch (sortBy) {
        case 'progress':
          const progressA = Number(a.current_backing_sol) / Number(a.backing_goal_sol);
          const progressB = Number(b.current_backing_sol) / Number(b.backing_goal_sol);
          return progressB - progressA;
        case 'ending_soon':
          return new Date(a.backing_deadline).getTime() - new Date(b.backing_deadline).getTime();
        case 'newest':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return result;
  }, [memes, search, sortBy]);

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


  return (
    <div className="space-y-5 -mt-10">
      {/* Hero Banner - Propaganda Style */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pb-3 border-b-4 border-[var(--accent)]">
        <div className="max-w-4xl mx-auto text-center space-y-2">
          {/* Header Logo */}
          <div className="relative w-full max-w-5xl mx-auto h-[200px] md:h-[320px]">
            <Image
              src="/images/New Hero Text.png"
              alt="Commie Launch - Seize the Memes of Production"
              fill
              className="object-contain"
              priority
            />
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link
              href="/submit"
              className="btn-primary flex items-center justify-center gap-2 px-8 py-4 text-lg"
            >
              <Rocket className="w-5 h-5" />
              Start a Revolution
            </Link>
            <Link
              href="/docs"
              className="btn-secondary flex items-center justify-center gap-2 px-8 py-4 text-lg"
            >
              Read the Manifesto
            </Link>
          </div>

          {/* CA and Social */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            {PLATFORM_TOKEN_CA && (
              <button
                onClick={handleCopyCA}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--card)] border border-[var(--border)] hover:border-[var(--accent)] cursor-pointer transition-colors group"
              >
                <span className="text-xs text-[var(--muted)]">$COMMIE:</span>
                <code className="text-xs font-mono text-[var(--foreground)]">
                  {`${PLATFORM_TOKEN_CA.slice(0, 8)}...${PLATFORM_TOKEN_CA.slice(-4)}`}
                </code>
                {caCopied ? (
                  <Check className="w-4 h-4 text-[var(--success)]" />
                ) : (
                  <Copy className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--accent)]" />
                )}
              </button>
            )}
            <a
              href="https://x.com/CommieLaunch"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-[var(--card)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors group"
            >
              <svg className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--accent)]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              <span className="text-sm text-[var(--muted)] group-hover:text-[var(--accent)]">@CommieLaunch</span>
            </a>
          </div>
        </div>
      </div>

      {/* Stats - Collapsible Side Ticker */}
      <div className={`fixed left-0 top-1/2 -translate-y-1/2 z-40 transition-transform duration-300 ${tickerOpen ? 'translate-x-0' : '-translate-x-[calc(100%-40px)]'}`}>
        <div className="flex items-stretch">
          {/* Stats Panel */}
          <div className="bg-[var(--card)] border-2 border-[var(--accent)] border-l-4 py-4 px-4 space-y-4">
            <div className="text-center border-b border-[var(--border)] pb-3 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">Live Stats</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Star className="w-5 h-5 text-[var(--accent)]" />
              <span className="text-3xl font-black text-[var(--accent)]">{stats.activeProving}</span>
              <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide">Active</span>
            </div>
            <div className="h-px bg-[var(--border)]" />
            <div className="flex flex-col items-center gap-1">
              <TrendingUp className="w-5 h-5 text-[var(--success)]" />
              <span className="text-3xl font-black text-[var(--success)]">{stats.totalBacked.toFixed(1)}</span>
              <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide">SOL</span>
            </div>
            <div className="h-px bg-[var(--border)]" />
            <div className="flex flex-col items-center gap-1">
              <Users className="w-5 h-5 text-[var(--warning)]" />
              <span className="text-3xl font-black text-[var(--warning)]">{stats.totalBackers}</span>
              <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide">Comrades</span>
            </div>
          </div>
          {/* Toggle Tab */}
          <button
            onClick={() => setTickerOpen(!tickerOpen)}
            className="w-10 bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-[var(--accent)] border-l-0"
          >
            <ChevronRight className={`w-5 h-5 text-white transition-transform duration-300 ${tickerOpen ? 'rotate-180' : ''}`} />
            <span className="text-white text-xs font-bold uppercase tracking-wider writing-vertical">Stats</span>
          </button>
        </div>
      </div>

      {/* Section Header - Active Revolutions */}
      <div className="border-l-4 border-[var(--accent)] pl-4">
        <h2 className="text-2xl font-black uppercase tracking-wide">
          {filter === 'all' ? 'All Memes' : filter === 'backing' ? 'Active Revolutions' : 'Victorious Launches'}
        </h2>
        <p className="text-[var(--muted)] text-sm mt-1">
          {filter === 'all' ? 'Browse all memes in the collective' :
           filter === 'backing' ? 'Join the cause before it launches' :
           'Tokens that achieved their goal'}
        </p>
      </div>

      {/* Search and Filter */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search the archives..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-[var(--card)] border-2 border-[var(--border)] focus:border-[var(--accent)] focus:outline-none transition-colors"
            />
          </div>
          <div className="flex gap-2">
            {([
              { key: 'all', label: 'All', icon: null },
              { key: 'backing', label: 'Proving', icon: Zap },
              { key: 'live', label: 'Live', icon: TrendingUp },
            ] as const).map((f) => (
              <button
                key={f.key}
                onClick={() => handleFilterChange(f.key)}
                className={`px-4 py-2 text-sm font-bold uppercase transition-colors flex items-center gap-2 ${
                  filter === f.key
                    ? 'bg-[var(--accent)] text-white border-2 border-[var(--accent)]'
                    : 'bg-[var(--card)] text-[var(--muted)] border-2 border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--foreground)]'
                }`}
              >
                {f.icon && <f.icon className="w-4 h-4" />}
                {f.label}
              </button>
            ))}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2 text-sm font-bold uppercase transition-colors flex items-center gap-2 ${
                showFilters
                  ? 'bg-[var(--accent)] text-white border-2 border-[var(--accent)]'
                  : 'bg-[var(--card)] text-[var(--muted)] border-2 border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--foreground)]'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="p-4 bg-[var(--card)] border-2 border-[var(--border)] flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <div className="flex items-center gap-3">
              <ArrowUpDown className="w-4 h-4 text-[var(--muted)]" />
              <span className="text-sm text-[var(--muted)] uppercase">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => handleSortChange(e.target.value as SortOption)}
                className="px-3 py-2 bg-[var(--background)] border-2 border-[var(--border)] text-sm focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="newest">Newest</option>
                <option value="progress">Progress</option>
                <option value="ending_soon">Ending Soon</option>
              </select>
            </div>

            {sortBy !== 'newest' && (
              <button
                onClick={() => {
                  setSortBy('newest');
                  setCurrentPage(1);
                }}
                className="text-sm text-[var(--accent)] hover:underline uppercase font-bold"
              >
                Reset
              </button>
            )}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-12 h-12 animate-spin text-[var(--accent)] mb-4" />
          <span className="text-[var(--muted)] uppercase tracking-wider">Loading the collective...</span>
        </div>
      )}

      {/* Results Count */}
      {!loading && filteredMemes.length > 0 && (
        <div className="flex justify-between items-center text-sm text-[var(--muted)] uppercase">
          <span>
            Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredMemes.length)} of {filteredMemes.length}
          </span>
          {totalPages > 1 && (
            <span>Page {currentPage} of {totalPages}</span>
          )}
        </div>
      )}

      {/* Meme Grid */}
      {!loading && paginatedMemes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {paginatedMemes.map((meme) => (
            <MemeCard key={meme.id} meme={meme as any} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-2 bg-[var(--card)] border-2 border-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed hover:border-[var(--accent)] transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(page => {
                if (page === 1 || page === totalPages) return true;
                if (Math.abs(page - currentPage) <= 2) return true;
                return false;
              })
              .map((page, index, array) => {
                const showEllipsisBefore = index > 0 && page - array[index - 1] > 1;
                return (
                  <div key={page} className="flex items-center gap-1">
                    {showEllipsisBefore && (
                      <span className="px-2 text-[var(--muted)]">...</span>
                    )}
                    <button
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[40px] h-10 font-bold transition-colors ${
                        currentPage === page
                          ? 'bg-[var(--accent)] text-white border-2 border-[var(--accent)]'
                          : 'bg-[var(--card)] border-2 border-[var(--border)] hover:border-[var(--accent)]'
                      }`}
                    >
                      {page}
                    </button>
                  </div>
                );
              })}
          </div>

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-2 bg-[var(--card)] border-2 border-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed hover:border-[var(--accent)] transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredMemes.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-[var(--border)]">
          <Star className="w-16 h-16 mx-auto text-[var(--accent)] mb-4" />
          <h3 className="text-xl font-bold uppercase mb-2">No Memes Found</h3>
          <p className="text-[var(--muted)] mb-6">
            {search ? 'The archives contain no match for your query.' : 'The revolution awaits its first meme.'}
          </p>
          <Link href="/submit" className="btn-primary inline-flex items-center gap-2">
            <Rocket className="w-4 h-4" />
            Be the First
          </Link>
        </div>
      )}

      {/* How It Works - Propaganda Poster Style */}
      <div className="mt-8 py-12 border-t-4 border-b-4 border-[var(--accent)] bg-[var(--card)]/50">
        <h2 className="text-3xl font-black text-center mb-2 uppercase tracking-wider">
          <span className="gradient-text">Join the Movement</span>
        </h2>
        <p className="text-center text-[var(--muted)] mb-10">Four steps to meme coin glory</p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 max-w-5xl mx-auto">
          {[
            { step: '01', title: 'Submit', desc: 'A creator presents their meme to the collective', icon: Rocket },
            { step: '02', title: 'Unite', desc: 'Comrades pool SOL to prove the meme worthy', icon: Users },
            { step: '03', title: 'Launch', desc: 'Goal reached - token deploys on Pump.fun', icon: Zap },
            { step: '04', title: 'Profit', desc: 'Trading fees flow back to the people', icon: TrendingUp },
          ].map((item) => (
            <div key={item.step} className="text-center group">
              <div className="w-16 h-16 bg-[var(--accent)] flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                <item.icon className="w-8 h-8 text-white" />
              </div>
              <div className="text-xs text-[var(--accent)] font-bold mb-1">STEP {item.step}</div>
              <h3 className="font-black text-lg uppercase mb-2">{item.title}</h3>
              <p className="text-sm text-[var(--muted)]">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
