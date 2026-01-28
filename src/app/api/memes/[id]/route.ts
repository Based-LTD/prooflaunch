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

    // Get meme with stats
    const { data: meme, error: memeError } = await supabase
      .from('memes_with_stats')
      .select('*')
      .eq('id', id)
      .single();

    if (memeError) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // Get backings for this meme
    const { data: backings, error: backingsError } = await supabase
      .from('backings')
      .select('*')
      .eq('meme_id', id)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false });

    if (backingsError) {
      console.error('Backings fetch error:', backingsError);
    }

    return NextResponse.json({
      meme: {
        ...meme,
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
