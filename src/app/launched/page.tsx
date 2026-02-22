'use client';

import { useState, useEffect, useCallback } from 'react';
import { MemeCard } from '@/components/MemeCard';
import { BarChart3, TrendingUp, DollarSign, Loader2 } from 'lucide-react';
import type { Meme } from '@/types/database';

export default function LaunchedPage() {
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    launchedCount: 0,
    totalBacked: 0,
  });

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
    { label: 'Launched Tokens', value: stats.launchedCount.toString(), icon: BarChart3, color: 'text-[var(--success)]' },
    { label: 'Total Raised', value: `${stats.totalBacked.toFixed(1)} SOL`, icon: TrendingUp, color: 'text-[var(--accent)]' },
    { label: 'Trading on Pump.fun', value: stats.launchedCount.toString(), icon: DollarSign, color: 'text-[var(--warning)]' },
  ];

  return (
    <div className="space-y-8">
      {/* Header - Victory Banner Style */}
      <div className="relative text-center py-8">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--success)] to-transparent" />
        <div className="inline-block mb-4">
          <div className="w-20 h-20 mx-auto bg-[var(--success)]/20 flex items-center justify-center border-2 border-[var(--success)]">
            <span className="text-4xl">★</span>
          </div>
        </div>
        <h1 className="text-4xl font-black uppercase tracking-tight mb-2">
          <span className="gradient-text">Hall of Victories</span>
        </h1>
        <p className="text-[var(--muted)] max-w-xl mx-auto uppercase tracking-wide text-sm">
          Revolutions that succeeded
        </p>
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--success)] to-transparent" />
      </div>

      {/* Stats - Medal Style */}
      <div className="grid grid-cols-3 gap-4">
        {statsDisplay.map((stat, index) => {
          const Icon = stat.icon;
          const borderColors = ['border-[var(--success)]', 'border-[var(--accent)]', 'border-[var(--accent-gold)]'];
          return (
            <div key={stat.label} className={`relative border-2 ${borderColors[index]} bg-[var(--card)] p-4 text-center`}>
              <div className={`absolute -top-2 left-1/2 -translate-x-1/2 px-2 bg-[var(--card)] ${stat.color} text-xs font-bold uppercase`}>
                {stat.label.split(' ')[0]}
              </div>
              <Icon className={`w-8 h-8 mx-auto mb-2 mt-2 ${stat.color}`} />
              <div className="text-3xl font-black">{stat.value}</div>
              <div className="text-xs text-[var(--muted)] uppercase tracking-wide">{stat.label}</div>
            </div>
          );
        })}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* Token Grid */}
      {!loading && memes.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-8 bg-gradient-to-b from-[var(--success)] to-[var(--accent-gold)]" />
            <h2 className="text-2xl font-black uppercase tracking-tight">Victorious Tokens</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {memes.map((meme) => (
              <MemeCard key={meme.id} meme={meme as any} />
            ))}
          </div>
        </div>
      )}

      {!loading && memes.length === 0 && (
        <div className="relative border-2 border-dashed border-[var(--border)] bg-[var(--card)] text-center py-12">
          <div className="w-16 h-16 mx-auto bg-[var(--background)] flex items-center justify-center border-2 border-[var(--border)] mb-4">
            <BarChart3 className="w-8 h-8 text-[var(--muted)]" />
          </div>
          <h3 className="text-lg font-black uppercase tracking-tight mb-2">No Victories Yet</h3>
          <p className="text-[var(--muted)] uppercase tracking-wide text-sm">The first revolution awaits</p>
        </div>
      )}
    </div>
  );
}
