// Shared auth gate for cron-triggered routes. Centralizes the
// "is this caller allowed to invoke a cron job?" check so we cannot
// accidentally weaken one endpoint while hardening the others.
//
// Accepts EITHER:
//   - x-vercel-cron: 1     (Vercel's signed cron header)
//   - Authorization: Bearer <CRON_SECRET>
//
// Hard-fails (returns 500 server error, never auth-bypass) if
// CRON_SECRET is unset. This is deliberate: a missing env var must
// never produce a publicly-accessible cron endpoint.

import { NextRequest, NextResponse } from 'next/server';

export type CronAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

export function authorizeCron(request: NextRequest): CronAuthResult {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return { ok: true };

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Misconfiguration — refuse to serve rather than fail-open.
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 500 }
      ),
    };
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return { ok: true };

  return {
    ok: false,
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
}

// For internal self-POST dispatchers (e.g. coordinator → worker).
// Returns the secret string or throws if unset. Callers should let
// the throw propagate to a 500 — never substitute a fallback.
export function requireCronSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error('CRON_SECRET env var is required');
  }
  return secret;
}
