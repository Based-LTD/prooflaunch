import { NextRequest, NextResponse } from 'next/server';
import { diagnoseBundleLanding } from '@/services/pumpfun';

// TEMPORARY diagnostic — auth-gated. Submits one real Jito bundle to
// capture why bundles don't land. DELETE after diagnosis.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await diagnoseBundleLanding();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'diag failed', stack: error instanceof Error ? error.stack : undefined },
      { status: 500 }
    );
  }
}
