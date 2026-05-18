import { NextRequest, NextResponse } from 'next/server';
import { diagnoseAltFit } from '@/services/pumpfun';
export const maxDuration = 120;
export async function POST(r: NextRequest) {
  const s = process.env.CRON_SECRET;
  if (s && r.headers.get('authorization') !== `Bearer ${s}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await diagnoseAltFit()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'fail' }, { status: 500 }); }
}
