import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { createGate, keycardConfigured } from '@/services/keycard';

// Phase 4 — Keycard backer-lounge sync.
//
// Cron + manual trigger. Iterates live memes that don't yet have a
// keycard_gate_id and creates a gate scoped to >0 balance of the
// meme's mint. Idempotent: once a meme has a gate_id, it's skipped
// forever (only re-run if you NULL the column manually).
//
// No-op when KEYCARD_API_KEY env is unset — the service layer returns
// { ok: false, skipped }, we log + move on. Safe to deploy without the
// key; just won't actually create gates.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorize(request: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const expectedKey = process.env.CRON_SECRET || 'prooflaunch-fees';
  if (isVercelCron) return { ok: true };
  if (authHeader === `Bearer ${expectedKey}`) return { ok: true };
  return { ok: false, status: 401, error: 'Unauthorized' };
}

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!keycardConfigured()) {
    return NextResponse.json({ success: true, skipped: 'KEYCARD_API_KEY not set', scanned: 0, created: 0 });
  }

  try {
    const supabase = createServerClient();
    const { data: memes } = await supabase
      .from('memes')
      .select('id, name, symbol, mint_address, twitter, website')
      .eq('status', 'live')
      .is('keycard_gate_id', null)
      .not('mint_address', 'is', null)
      .limit(20);

    const results: Array<{ memeId: string; symbol: string; ok: boolean; gateUrl?: string; error?: string }> = [];

    for (const m of memes || []) {
      if (!m.mint_address) continue;
      const res = await createGate({
        title: `${m.symbol} backer lounge`,
        description: `Private space for ${m.name} holders. Verify your wallet to enter.`,
        rule: { type: 'spl-balance', mint: m.mint_address, min: 1 },
      });
      if (res.ok && res.gate) {
        await supabase
          .from('memes')
          .update({
            keycard_gate_id: res.gate.gateId,
            keycard_gate_url: res.gate.url,
            keycard_synced_at: new Date().toISOString(),
          })
          .eq('id', m.id);
        results.push({ memeId: m.id, symbol: m.symbol, ok: true, gateUrl: res.gate.url });
      } else {
        results.push({ memeId: m.id, symbol: m.symbol, ok: false, error: res.error || res.skipped });
      }
    }

    return NextResponse.json({
      success: true,
      scanned: memes?.length || 0,
      created: results.filter((r) => r.ok).length,
      results,
    });
  } catch (e) {
    console.error('[keycard/sync] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}
