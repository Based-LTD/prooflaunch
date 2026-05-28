import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// Public read of recent buyback runs for a meme. Powers the on-page
// BuybackBotPanel "Recent runs" list. RLS on meme_buybacks already
// allows anon SELECT, but routing through an API gives us a place to
// cap the limit and shape the response.

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const memeId = searchParams.get('meme_id');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '5', 10), 1), 50);
    if (!memeId) return NextResponse.json({ error: 'meme_id required' }, { status: 400 });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('meme_buybacks')
      .select('executed_at, action, status, sol_spent_lamports, tokens_acted_raw, swap_tx, action_tx')
      .eq('meme_id', memeId)
      .order('executed_at', { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ rows: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}
