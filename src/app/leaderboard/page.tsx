'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy, Sparkles, Loader2 } from 'lucide-react';

interface LeaderRow {
  rank: number;
  creator_wallet: string;
  total_points: number;
  meme_count: number;
  best_meme_id: string | null;
  best_meme_mc: number | null;
  best_meme: {
    id: string;
    name: string;
    symbol: string;
    mint_address: string | null;
    image_url: string | null;
  } | null;
  in_top_10: boolean;
}

interface LeaderboardResponse {
  leaders: LeaderRow[];
  snapshotDate: string;
}

const SNAPSHOT_DATE = new Date('2026-10-22T00:00:00Z');

function formatPoints(p: number): string {
  if (p >= 1_000_000) return `${(p / 1_000_000).toFixed(2)}M`;
  if (p >= 1_000) return `${(p / 1_000).toFixed(0)}K`;
  return `${p}`;
}

function formatMc(mc: number | null): string {
  if (!mc || mc <= 0) return '—';
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
  if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function daysUntilSnapshot(): number {
  const ms = SNAPSHOT_DATE.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/leaderboard?limit=100');
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const leaders = data?.leaders ?? [];
  const days = daysUntilSnapshot();

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            {'// DEV_LEADERBOARD'}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)] border border-[var(--accent-gold)]/60 bg-[var(--accent-gold)]/5 px-1.5 py-0.5">
            UNLOCK · OCT 22
          </span>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 text-[var(--accent-gold)]" />
            <h1 className="text-xl font-mono font-semibold uppercase tracking-tight">
              Top 10 Devs Win
            </h1>
          </div>
          <p className="text-xs font-mono text-[var(--muted)] leading-relaxed max-w-2xl">
            10% of PROOF supply unlocks on <span className="text-[var(--accent-gold)]">Oct 22, 2026</span>. The top 10 devs by leaderboard points share it equally, streamed linearly over 6 months. Every $10K of market cap your launched tokens hit awards <span className="text-[var(--accent)]">10,000 points</span>. Points are cumulative across all your launches — every winner adds up.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] px-2 py-1 text-[var(--foreground)]">
              {days} days left
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] px-2 py-1 text-[var(--foreground)]">
              {leaders.length} devs ranked
            </span>
            <Link
              href="/submit"
              className="text-[10px] font-mono uppercase tracking-widest border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--background)] px-2 py-1 transition-colors"
            >
              [+] Launch a token →
            </Link>
          </div>
        </div>
      </section>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Empty */}
      {!loading && leaders.length === 0 && (
        <div className="border border-[var(--border)] bg-[var(--card)] p-8 text-center">
          <Sparkles className="w-8 h-8 text-[var(--accent)] mx-auto mb-3" />
          <h2 className="font-mono font-semibold uppercase tracking-tight text-sm mb-2">
            The race begins now
          </h2>
          <p className="text-xs font-mono text-[var(--muted)] mb-4">
            No devs have crossed a $10K milestone yet. Be the first.
          </p>
          <Link
            href="/submit"
            className="inline-block text-xs font-mono uppercase tracking-widest border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--background)] px-3 py-2 transition-colors"
          >
            Launch a token
          </Link>
        </div>
      )}

      {/* Top 10 — highlighted */}
      {!loading && leaders.length > 0 && (
        <section className="border border-[var(--border)] bg-[var(--card)]">
          <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
              {'// TOP_10 · WINNERS_LINE'}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              EQUAL SPLIT · 6-MONTH VEST
            </span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {leaders.slice(0, 10).map((row) => (
              <LeaderRowEl key={row.creator_wallet} row={row} highlight />
            ))}
            {leaders.length < 10 && (
              Array.from({ length: 10 - leaders.length }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="px-4 py-3 flex items-center justify-between text-[var(--muted)]"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-widest w-8">
                      #{leaders.length + i + 1}
                    </span>
                    <span className="text-[10px] font-mono uppercase tracking-widest opacity-50">
                      open slot
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* The rest — ranks 11+ */}
      {!loading && leaders.length > 10 && (
        <section className="border border-[var(--border)] bg-[var(--card)]">
          <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              {'// RANKED · CHASING'}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              {leaders.length - 10} below the cut
            </span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {leaders.slice(10).map((row) => (
              <LeaderRowEl key={row.creator_wallet} row={row} highlight={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LeaderRowEl({ row, highlight }: { row: LeaderRow; highlight: boolean }) {
  const meme = row.best_meme;
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--background)]/60 transition-colors">
      {/* Left: rank + wallet + best meme */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span
          className={`text-[10px] font-mono uppercase tracking-widest w-8 shrink-0 ${
            highlight ? 'text-[var(--accent-gold)]' : 'text-[var(--muted)]'
          }`}
        >
          #{row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-sm text-[var(--foreground)] truncate">
              {shortAddr(row.creator_wallet)}
            </span>
            {highlight && (
              <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--accent-gold)] border border-[var(--accent-gold)]/40 bg-[var(--accent-gold)]/5 px-1 py-0.5 shrink-0">
                ★
              </span>
            )}
          </div>
          {meme ? (
            <Link
              href={`/meme/${meme.id}`}
              className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)] transition-colors flex items-center gap-1 truncate"
            >
              <span className="truncate">best: ${meme.symbol} · {formatMc(row.best_meme_mc)}</span>
            </Link>
          ) : (
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              {row.meme_count} {row.meme_count === 1 ? 'launch' : 'launches'}
            </span>
          )}
        </div>
      </div>

      {/* Right: points + meme count */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <div className={`font-mono font-semibold text-sm ${highlight ? 'text-[var(--accent-gold)]' : 'text-[var(--foreground)]'}`}>
            {formatPoints(row.total_points)}
          </div>
          <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
            pts
          </div>
        </div>
        <div className="text-right hidden sm:block">
          <div className="font-mono text-sm text-[var(--foreground)]">
            {row.meme_count}
          </div>
          <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
            launches
          </div>
        </div>
      </div>
    </div>
  );
}
