'use client';

import { useState, useEffect, useCallback } from 'react';
import { MemeCard } from '@/components/MemeCard';
import { Loader2 } from 'lucide-react';
import type { Meme } from '@/types/database';

export default function LaunchedPage() {
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ launchedCount: 0, totalBacked: 0 });

  const fetchMemes = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/memes?status=live');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setMemes(data.memes || []);

      const totalBacked = (data.memes || []).reduce(
        (sum: number, m: Meme) => sum + Number(m.current_backing_sol || 0),
        0
      );

      setStats({
        launchedCount: (data.memes || []).length,
        totalBacked,
      });
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

  const statsDisplay = [
    { label: 'Launched Tokens', value: stats.launchedCount.toString() },
    { label: 'Total Raised', value: `${stats.totalBacked.toFixed(1)} SOL` },
    { label: 'Trading on Pump.fun', value: stats.launchedCount.toString() },
  ];

  return (
    <div className="space-y-6">
      {/* Header — terminal block */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // PROOF_LAUNCH.SYS // LAUNCHED
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
            [LIVE]
          </span>
        </div>
        <div className="p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
            &gt; HALL_OF_LAUNCHES
          </div>
          <h1 className="text-2xl sm:text-3xl font-mono font-semibold uppercase tracking-tight">
            Launched Tokens
          </h1>
          <p className="text-xs font-mono text-[var(--muted)] mt-2">
            Memes that hit all slots and went live on Pump.fun
          </p>
        </div>
      </div>

      {/* Stats — terminal readout */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // METRICS
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

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Token Grid */}
      {!loading && memes.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-3 px-1">
            // LIVE_TOKENS [{memes.length}]
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {memes.map((meme) => (
              <MemeCard key={meme.id} meme={meme as any} />
            ))}
          </div>
        </div>
      )}

      {!loading && memes.length === 0 && (
        <div className="border border-[var(--border)] bg-[var(--card)] p-12 text-center">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-3">
            [!] NO_LAUNCHES
          </div>
          <h3 className="font-mono uppercase tracking-tight text-base mb-2">No launches yet</h3>
          <p className="text-xs font-mono text-[var(--muted)]">
            &gt; Be the first to launch a meme
          </p>
        </div>
      )}
    </div>
  );
}
