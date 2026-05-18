import { NextRequest, NextResponse } from 'next/server';
import { diagnoseCreateV2Bundle } from '@/services/pumpfun';
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await diagnoseCreateV2Bundle()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'fail', stack: e instanceof Error ? e.stack : undefined }, { status: 500 }); }
}
