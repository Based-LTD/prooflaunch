import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { reconcileAll, reconcileMemeById } from '@/services/reconcile';
import { authorizeCron } from '@/lib/cronAuth';

// Reconciliation + auto-recovery endpoint.
//
//   GET  (x-vercel-cron: 1)        -> scheduled sweep of all live/launching memes
//   POST (Bearer CRON_SECRET)      -> manual sweep, or targeted { meme_id }
//   GET  (no cron header)          -> dry status: which memes are in scope
//
// Auto-actions (idempotent): correct false-negative distributions, and
// auto-refund any burner whose buy never landed. See services/reconcile.ts.

export async function POST(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createServerClient();

    let memeId: string | undefined;
    try {
      const body = await request.json();
      memeId = body?.meme_id;
    } catch {
      /* no body = sweep all */
    }

    if (memeId) {
      const result = await reconcileMemeById(supabase, memeId);
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ mode: 'targeted', result });
    }

    const { scanned, results } = await reconcileAll(supabase);
    return NextResponse.json({ mode: 'sweep', scanned, actioned: results.length, results });
  } catch (error) {
    console.error('Reconcile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Vercel cron auth: accept either `x-vercel-cron: 1` OR
  // `Authorization: Bearer CRON_SECRET` (Vercel uses Authorization
  // when CRON_SECRET is in env — old gate only checked x-vercel-cron
  // so every cron silently fell into the status branch).
  const auth = authorizeCron(request);
  if (auth.ok) {
    try {
      const supabase = createServerClient();
      const { scanned, results } = await reconcileAll(supabase);
      return NextResponse.json({ mode: 'cron', scanned, actioned: results.length, results });
    } catch (error) {
      console.error('Cron reconcile error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  // Otherwise: read-only status of what's in reconciliation scope.
  try {
    const supabase = createServerClient();
    const { data: memes, error } = await supabase
      .from('memes')
      .select('id, name, status, mint_address, launched_at, updated_at')
      .in('status', ['live', 'launching'])
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      inScope: memes?.length || 0,
      memes: memes || [],
      note: 'POST with Bearer CRON_SECRET to run recovery, or { meme_id } to target one.',
    });
  } catch (error) {
    console.error('Reconcile status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
