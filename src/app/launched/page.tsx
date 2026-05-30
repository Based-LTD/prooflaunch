'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MemeCard } from '@/components/MemeCard';
import { Loader2, Search, RefreshCw } from 'lucide-react';
import type { Meme } from '@/types/database';

// Dashboard-style tokens page. The earlier layout had a tall header + a
// separate metrics block + a single-status grid, which forced creators
// browsing across statuses to scroll a lot. This version collapses the
// chrome into one sticky bar (stats + filters) and renders a denser
// 4-column grid so 16+ tokens are visible per viewport.

type StatusFilter = 'all' | 'backing' | 'funded' | 'live';
type ExtraFilter = 'all' | 'bots' | 'team';

interface ListedMeme extends Meme {
  bot_count?: number;
  backer_count?: number;
  progress_percent?: number;
}

export default function LaunchedPage() {
  const [memes, setMemes] = useState<ListedMeme[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [extraFilter, setExtraFilter] = useState<ExtraFilter>('all');
  const [search, setSearch] = useState('');

  const fetchMemes = useCallback(async () => {
    setLoading(true);
    try {
      // Pull every public status in one shot — client-side filtering
      // is cheap at the scale we're at and lets the tab switch instantly
      // without a round-trip.
      const response = await fetch('/api/memes?limit=200');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setMemes((data.memes || []) as ListedMeme[]);
    } catch (error) {
      console.error('Failed to fetch memes:', error);
      setMemes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemes();
  }, [fetchMemes]);

  // ── Per-status counts for the tabs + global stats ──
  const counts = useMemo(() => {
    const c = { all: memes.length, backing: 0, funded: 0, live: 0, bots: 0, team: 0 };
    for (const m of memes) {
      if (m.status === 'backing') c.backing++;
      else if (m.status === 'funded') c.funded++;
      else if (m.status === 'live') c.live++;
      if ((m.bot_count ?? 0) > 0) c.bots++;
      if ((m.reserved_slots ?? 0) > 0) c.team++;
    }
    return c;
  }, [memes]);

  const totalSolBacked = useMemo(
    () => memes.reduce((sum, m) => sum + Number(m.current_backing_sol || 0), 0),
    [memes],
  );

  // ── Filter pipeline: status → extra → search ──
  const filtered = useMemo(() => {
    let out = memes;
    if (statusFilter !== 'all') out = out.filter((m) => m.status === statusFilter);
    if (extraFilter === 'bots') out = out.filter((m) => (m.bot_count ?? 0) > 0);
    if (extraFilter === 'team') out = out.filter((m) => (m.reserved_slots ?? 0) > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (m) =>
          m.name?.toLowerCase().includes(q) ||
          m.symbol?.toLowerCase().includes(q),
      );
    }
    return out;
  }, [memes, statusFilter, extraFilter, search]);

  return (
    <div className="space-y-3">
      {/* Sticky dashboard header — status tabs + global stats + search.
          Sticks to the top of the viewport so creators browsing a long
          list can switch tabs without scrolling back up. */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 bg-[var(--background)] border-b border-[var(--border)] pb-3 pt-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base sm:text-lg font-mono font-semibold uppercase tracking-tight">
              Tokens
            </h1>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              {counts.all} total · {totalSolBacked.toFixed(1)} SOL backed
            </span>
          </div>
          <button
            onClick={fetchMemes}
            className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] hover:text-[var(--accent)] flex items-center gap-1"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {/* Tabs row */}
        <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono uppercase tracking-widest">
          {(
            [
              { v: 'all',     label: `All ${counts.all}` },
              { v: 'backing', label: `Proving ${counts.backing}` },
              { v: 'funded',  label: `Funded ${counts.funded}` },
              { v: 'live',    label: `Live ${counts.live}` },
            ] as { v: StatusFilter; label: string }[]
          ).map((tab) => {
            const active = statusFilter === tab.v;
            return (
              <button
                key={tab.v}
                onClick={() => setStatusFilter(tab.v)}
                className={`px-2.5 py-1 border transition-colors ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/60'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
          <span className="mx-1 text-[var(--muted)]">·</span>
          {(
            [
              { v: 'all',  label: 'Any' },
              { v: 'bots', label: `Bots ${counts.bots}` },
              { v: 'team', label: `Team ${counts.team}` },
            ] as { v: ExtraFilter; label: string }[]
          ).map((tab) => {
            const active = extraFilter === tab.v;
            return (
              <button
                key={tab.v}
                onClick={() => setExtraFilter(tab.v)}
                className={`px-2.5 py-1 border transition-colors ${
                  active
                    ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent-gold)]/60'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1 border border-[var(--border)] bg-[var(--card)] px-2 py-0.5">
            <Search className="w-3 h-3 text-[var(--muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="name or $symbol"
              className="bg-transparent outline-none text-[11px] font-mono w-32 sm:w-40"
            />
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Dense grid: 4-wide on lg, 3 on md, 2 on sm */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((meme) => (
            <MemeCard key={meme.id} meme={meme as any} />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-2">
            [ no results ]
          </div>
          <p className="text-xs font-mono text-[var(--muted)]">
            &gt; {memes.length === 0
              ? 'No tokens yet — be the first to launch'
              : 'No tokens match these filters'}
          </p>
        </div>
      )}
    </div>
  );
}
