import { NextRequest, NextResponse, after } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { executeBuybackBot } from '@/services/buybackBot';
import { authorizeCron, requireCronSecret } from '@/lib/cronAuth';

// Vercel cron + manual-trigger endpoint for per-bot buyback execution.
//
// GET  → enumerate every bot in every live meme's stack and FAN OUT.
//        Each bot's actual execution is dispatched as a fire-and-forget
//        POST to this same route via Next.js `after()` (the official
//        primitive for post-response background work). That gives every
//        bot run its own 60s budget instead of all of them sharing
//        ONE 60s budget. Coordinator returns quickly with the list of
//        dispatched bots.
//
//        Auth: x-vercel-cron:1 (cron) OR Bearer CRON_SECRET (manual).
//
// POST → single-bot or single-meme trigger. Body:
//          { bot_id }   → execute that one bot synchronously
//          { meme_id }  → fan out every bot in that meme's stack
//
// The actual flow (claim escrow → swap via Jupiter → action) lives in
// src/services/buybackBot.ts so it can be tested/triggered independently.
//
// SCALE NOTE — when total bots crosses ~50, swap the fan-out dispatcher
// from self-POST + after() to an external queue (QStash). The worker
// route shape (POST { bot_id }) already matches what a queue would
// invoke, so the swap is a 30-min change.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Resolve the deployment's own origin so coordinator → worker self-POSTs
// reach the same Vercel deployment they came from (preview vs prod).
// Vercel sets VERCEL_URL automatically (e.g. proof-of-meme.vercel.app);
// localhost falls back to the request's origin.
function selfOrigin(request: NextRequest): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// Dispatch one fire-and-forget worker invocation. Each child gets its
// own 60s budget. We pass the cron secret as the Bearer token so the
// child's `authorizeCron()` accepts it.
//
// Returns the actual HTTP outcome so callers in `after()` can log
// failures — a silent dispatcher led to a ~30min debugging tangent on
// 2026-06-15 when a CRON_SECRET drift caused every child to 401 while
// the parent kept reporting "dispatched: N". Always log non-ok results.
async function dispatchBot(origin: string, botId: string): Promise<{ botId: string; dispatched: boolean; status?: number; error?: string }> {
  const secret = requireCronSecret();
  try {
    const res = await fetch(`${origin}/api/buyback/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ bot_id: botId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[buyback/process] dispatch FAILED bot=${botId} status=${res.status} body=${body.slice(0, 300)}`);
      return { botId, dispatched: false, status: res.status, error: body.slice(0, 300) };
    }
    return { botId, dispatched: true, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[buyback/process] dispatch THREW bot=${botId} error=${msg}`);
    return { botId, dispatched: false, error: msg };
  }
}

// Run a batch of dispatches and summarize. Used inside `after()` so the
// per-bot HTTP outcomes show up in logs even though the parent response
// has already been sent.
async function runDispatches(origin: string, botIds: string[], context: string): Promise<void> {
  const CONCURRENCY = 10;
  const results: Array<{ botId: string; dispatched: boolean; status?: number; error?: string }> = [];
  for (let i = 0; i < botIds.length; i += CONCURRENCY) {
    const slice = botIds.slice(i, i + CONCURRENCY);
    const batch = await Promise.all(slice.map((id) => dispatchBot(origin, id)));
    results.push(...batch);
  }
  const ok = results.filter((r) => r.dispatched).length;
  const failed = results.length - ok;
  console.log(`[buyback/process] ${context}: dispatched=${ok}/${results.length} failed=${failed}`);
}

export async function GET(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createServerClient();

    // Enumerate every bot belonging to a live meme.
    const { data: bots, error } = await supabase
      .from('meme_bots')
      .select('id, meme_id, action, label, memes!inner(symbol, status)')
      .eq('memes.status', 'live');
    if (error) {
      console.error('[buyback/process GET] enumerate error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const botIds = (bots || []).map((b) => b.id as string);
    if (botIds.length === 0) {
      return NextResponse.json({ success: true, dispatched: 0, bots: [] });
    }

    const origin = selfOrigin(request);

    // Fan out via `after()` — Next.js' supported way to keep async work
    // alive past the response. Each dispatch is independent; one failing
    // doesn't cascade. The coordinator returns ~immediately, so we can
    // only report what we QUEUED — not what succeeded. Failures land in
    // Vercel logs via dispatchBot's console.error.
    after(() => runDispatches(origin, botIds, 'GET fan-out'));

    return NextResponse.json({
      success: true,
      queued: botIds.length,
      bots: botIds,
      mode: 'fanout',
      note: 'queued is fire-and-forget; check logs for per-bot dispatch outcomes',
    });
  } catch (e) {
    console.error('[buyback/process] top-level error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const botId = typeof body?.bot_id === 'string' ? body.bot_id : null;
    const memeId = typeof body?.meme_id === 'string' ? body.meme_id : null;
    if (!botId && !memeId) {
      return NextResponse.json({ error: 'bot_id or meme_id required' }, { status: 400 });
    }
    const supabase = createServerClient();

    if (botId) {
      // Single-bot trigger — synchronous within this worker invocation.
      const result = await executeBuybackBot(supabase, botId);
      return NextResponse.json(result, { status: result.ok ? 200 : 500 });
    }

    // Per-meme — fan out every bot in that meme's stack via the same
    // self-POST pattern as GET so each bot gets its own 60s budget.
    const { data: bots } = await supabase
      .from('meme_bots')
      .select('id')
      .eq('meme_id', memeId);
    if (!bots || bots.length === 0) {
      return NextResponse.json({ error: 'no bots configured for this meme' }, { status: 404 });
    }
    const botIds = bots.map((b) => b.id as string);
    const origin = selfOrigin(request);
    after(() => runDispatches(origin, botIds, `POST meme=${memeId}`));
    return NextResponse.json({
      memeId,
      queued: botIds.length,
      bots: botIds,
      note: 'queued is fire-and-forget; check logs for per-bot dispatch outcomes',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}
