import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

/**
 * GET /api/landing/visibility-counts
 *
 * Aggregate counts of active gated launches (stealth + spectator).
 * Powers the homepage "N stealth launches in progress" widget.
 *
 * Aggregate-only — doesn't leak any identifying info about specific
 * launches (which is the whole point of stealth). Just a count.
 *
 * Backed by the launch_visibility_counts view (migration 029).
 */

export const revalidate = 60;

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('launch_visibility_counts')
      .select('visibility, count');

    if (error) {
      return NextResponse.json(
        { stealth: 0, spectator: 0 },
        { status: 200 },
      );
    }

    const counts = { stealth: 0, spectator: 0 };
    for (const row of data || []) {
      if (row.visibility === 'stealth') counts.stealth = Number(row.count) || 0;
      if (row.visibility === 'spectator') counts.spectator = Number(row.count) || 0;
    }

    return NextResponse.json(counts, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json({ stealth: 0, spectator: 0 });
  }
}
