'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Meme } from '@/types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseRealtimeMemesOptions {
  status?: 'all' | 'backing' | 'live' | 'failed';
  enabled?: boolean;
}

export function useRealtimeMemes({ status = 'all', enabled = true }: UseRealtimeMemesOptions = {}) {
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch memes from API
  const fetchMemes = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      params.set('limit', '1000'); // Fetch up to 1000 memes

      const response = await fetch(`/api/memes?${params}`);
      if (!response.ok) throw new Error('Failed to fetch memes');

      const data = await response.json();
      setMemes(data.memes || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [status]);

  // Initial fetch
  useEffect(() => {
    fetchMemes();
  }, [fetchMemes]);

  // Set up realtime subscription
  useEffect(() => {
    if (!enabled || !supabase) return;

    let channel: RealtimeChannel;

    try {
      channel = supabase
        .channel('memes-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'memes',
          },
          (payload) => {
            console.log('Meme change received:', payload);

            if (payload.eventType === 'INSERT') {
              const newMeme = payload.new as Meme;
              // Only add if matches current filter
              if (status === 'all' || newMeme.status === status) {
                setMemes((prev) => [newMeme, ...prev]);
              }
            } else if (payload.eventType === 'UPDATE') {
              const updatedMeme = payload.new as Meme;
              setMemes((prev) => {
                // If meme no longer matches filter, remove it
                if (status !== 'all' && updatedMeme.status !== status) {
                  return prev.filter((m) => m.id !== updatedMeme.id);
                }
                // Otherwise update it
                return prev.map((m) => (m.id === updatedMeme.id ? updatedMeme : m));
              });
            } else if (payload.eventType === 'DELETE') {
              const deletedId = (payload.old as { id: string }).id;
              setMemes((prev) => prev.filter((m) => m.id !== deletedId));
            }
          }
        )
        .subscribe();
    } catch (err) {
      console.error('Failed to set up realtime subscription:', err);
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [enabled, status]);

  return { memes, loading, error, refetch: fetchMemes };
}

// Extended meme type with computed fields from API
type MemeWithStats = Meme & { backer_count?: number };

// Hook for subscribing to a single meme's updates
export function useRealtimeMeme(memeId: string, enabled = true) {
  const [meme, setMeme] = useState<MemeWithStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch single meme
  const fetchMeme = useCallback(async () => {
    try {
      const response = await fetch(`/api/memes/${memeId}`);
      if (!response.ok) throw new Error('Failed to fetch meme');

      const data = await response.json();
      setMeme(data.meme);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [memeId]);

  // Initial fetch
  useEffect(() => {
    fetchMeme();
  }, [fetchMeme]);

  // Set up realtime subscription
  useEffect(() => {
    if (!enabled || !supabase || !memeId) return;

    let channel: RealtimeChannel;

    try {
      channel = supabase
        .channel(`meme-${memeId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'memes',
            filter: `id=eq.${memeId}`,
          },
          (payload) => {
            console.log('Meme update received:', payload);
            setMeme(payload.new as Meme);
          }
        )
        .subscribe();
    } catch (err) {
      console.error('Failed to set up realtime subscription:', err);
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [enabled, memeId]);

  return { meme, loading, error, refetch: fetchMeme };
}

// Hook for subscribing to backings updates for a meme
export function useRealtimeBackings(memeId: string, enabled = true) {
  const [backings, setBackings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch backings
  const fetchBackings = useCallback(async () => {
    try {
      const response = await fetch(`/api/backings?meme_id=${memeId}`);
      if (!response.ok) throw new Error('Failed to fetch backings');

      const data = await response.json();
      setBackings(data.backings || []);
    } catch (err) {
      console.error('Failed to fetch backings:', err);
    } finally {
      setLoading(false);
    }
  }, [memeId]);

  // Initial fetch
  useEffect(() => {
    fetchBackings();
  }, [fetchBackings]);

  // Set up realtime subscription
  useEffect(() => {
    if (!enabled || !supabase || !memeId) return;

    let channel: RealtimeChannel;

    try {
      channel = supabase
        .channel(`backings-${memeId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'backings',
            filter: `meme_id=eq.${memeId}`,
          },
          (payload) => {
            console.log('Backing change received:', payload);

            if (payload.eventType === 'INSERT') {
              setBackings((prev) => [payload.new, ...prev]);
            } else if (payload.eventType === 'UPDATE') {
              setBackings((prev) =>
                prev.map((b) => (b.id === (payload.new as any).id ? payload.new : b))
              );
            }
          }
        )
        .subscribe();
    } catch (err) {
      console.error('Failed to set up realtime subscription:', err);
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [enabled, memeId]);

  return { backings, loading, refetch: fetchBackings };
}
