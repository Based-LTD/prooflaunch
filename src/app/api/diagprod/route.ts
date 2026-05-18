import { NextRequest, NextResponse } from 'next/server';
import { diagnoseProductionLaunch } from '@/services/pumpfun';

// TEMPORARY — full production-path validation on a throwaway. DELETE after gate passes.
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const s = process.env.CRON_SECRET;
  if (s && request.headers.get('authorization') !== `Bearer ${s}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await diagnoseProductionLaunch());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'fail', stack: e instanceof Error ? e.stack : undefined },
      { status: 500 }
    );
  }
}
