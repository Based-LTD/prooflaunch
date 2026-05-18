import { NextRequest, NextResponse } from 'next/server';
import { runDriftCheck } from '@/services/driftCheck';

// READ-ONLY drift detector endpoint.
//
//   GET (x-vercel-cron: 1) -> scheduled daily check, persists result
//   GET (manual)           -> on-demand check (also persists)
//
// Returns HTTP 200 when in sync, 503 when drift is detected, so an
// external uptime monitor can alert off the status code with zero
// extra wiring. Never touches the launch path.

export async function GET(_request: NextRequest) {
  try {
    const result = await runDriftCheck(true);
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (error) {
    console.error('Drift check error:', error);
    return NextResponse.json(
      { ok: false, error: 'drift check failed to run' },
      { status: 500 }
    );
  }
}
