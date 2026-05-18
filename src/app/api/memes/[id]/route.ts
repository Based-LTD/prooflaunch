import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// GET /api/memes/[id] - Get a single meme with backings
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerClient();

    // Get meme with stats. memes_with_stats is a curated VIEW that
    // intentionally omits sensitive columns (encrypted_pool_key) — never
    // switch this to the base `memes` table or that key leaks to clients.
    const { data: meme, error: memeError } = await supabase
      .from('memes_with_stats')
      .select('*')
      .eq('id', id)
      .single();

    if (memeError) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // The view predates the pooled model and doesn't expose the pooled
    // columns the client needs. Pull just the safe ones from the base
    // table (NOT encrypted_pool_key) and merge them in.
    const { data: poolFields } = await supabase
      .from('memes')
      .select('pool_wallet, pool_token_balance')
      .eq('id', id)
      .single();

    // Get backings for this meme. Select only client-safe columns so a
    // legacy burner key column (if it still exists on the table) can
    // never be serialized to the client.
    const { data: backings, error: backingsError } = await supabase
      .from('backings')
      .select(
        'id, meme_id, backer_wallet, amount_sol, status, created_at, ' +
          'claim_tokens, claim_tx, claimed_at, tokens_received'
      )
      .eq('meme_id', id)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false });

    if (backingsError) {
      console.error('Backings fetch error:', backingsError);
    }

    return NextResponse.json({
      meme: {
        ...meme,
        pool_wallet: poolFields?.pool_wallet ?? null,
        pool_token_balance: poolFields?.pool_token_balance ?? null,
        backings: backings || [],
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
