import { NextRequest, NextResponse } from 'next/server';

// Geographic restrictions for prooflaunch.fun.
//
// WHY: backing actions, fee-claiming, and launch initiation could be
// characterized as securities-flavored under US law (passive fee
// distribution to backers in exchange for capital contribution).
// Until our legal opinion is finalized, we block these specific
// user-initiated actions from restricted geographies at the IP layer.
// Reading the platform, viewing tokens, auditing launches — all
// remain open to everyone.
//
// LAYERS (defense-in-depth):
//   1. THIS — IP geoblock at the edge. Cheap, catches most cases.
//   2. Frontend "not available in your region" UI (separate component).
//   3. ToS attestation gate at backing/submit time (separate UI).
//   4. (Future) On-chain filter so even VPN-bypassing users don't
//      receive passive fee distributions.

// ISO 3166-1 alpha-2 country codes blocked from gated actions.
// US + classic OFAC sanctioned (Iran/Cuba/NK/Syria). Russia/Belarus
// intentionally NOT included pending lawyer guidance — they're harder
// calls because they have legitimate crypto-native users. Expand from
// here if/when the lawyer signs off on a stricter posture.
const BLOCKED_COUNTRIES = new Set<string>([
  'US',  // United States
  'IR',  // Iran (OFAC SDN)
  'CU',  // Cuba (OFAC SDN)
  'KP',  // North Korea (OFAC SDN)
  'SY',  // Syria (OFAC SDN)
]);

// Gated path patterns + methods.
//
// As of 2026-06-27: /api/fees/claim (backer + creator fee claims) is NOT
// gated. Backers contributed capital to a community launch and claim
// their share via signed pull-claim with a wallet message — they're
// active participants in a shared creation, not passive securities
// holders. Same logic applies to creators claiming their own fees.
// Open globally. The 'shared creator / community launch' theory makes
// the geographic gate the wrong layer for this surface.
//
// /api/bots/[id]/withdraw stays gated as defense-in-depth — those
// bot-action surfaces are themselves paused at the dispatch layer
// (services/buybackBot.ts) and the API gate (/api/memes) for paused
// actions, so this is belt-and-suspenders.
const GATED_PATHS: Array<{ pattern: RegExp; methods: Set<string> }> = [
  // Withdrawing accrued bot earnings — paused upstream too, this is
  // belt-and-suspenders.
  { pattern: /^\/api\/bots\/[^/]+\/withdraw$/, methods: new Set(['POST']) },
];

function isGated(pathname: string, method: string): boolean {
  for (const g of GATED_PATHS) {
    if (g.pattern.test(pathname) && g.methods.has(method)) return true;
  }
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Fast-path: not a gated endpoint
  if (!isGated(pathname, method)) return NextResponse.next();

  // Cron bypass — Vercel cron requests come from Vercel's infra
  // (not user IPs) and must run regardless of geo. Same header
  // pattern as our cronAuth helper accepts.
  if (request.headers.get('x-vercel-cron') === '1') return NextResponse.next();

  // Staff bypass for QA/testing in production. Set GEOBLOCK_BYPASS_TOKEN
  // in Vercel env (rotate it like a secret); staff pass it via the
  // X-Geo-Bypass header to test gated flows without spoofing geo.
  const bypassToken = process.env.GEOBLOCK_BYPASS_TOKEN;
  if (bypassToken && request.headers.get('x-geo-bypass') === bypassToken) {
    return NextResponse.next();
  }

  // Vercel sets x-vercel-ip-country on every request in production.
  // Missing in local dev / non-Vercel proxies — fail-open here so legit
  // non-US users on weird ISPs aren't accidentally blocked. The ToS
  // attestation (layer 3) + on-chain filter (layer 4, future) are the
  // backstops against this fail-open being abused.
  const country = (request.headers.get('x-vercel-ip-country') || '').toUpperCase();
  if (!country) return NextResponse.next();

  if (BLOCKED_COUNTRIES.has(country)) {
    return NextResponse.json(
      {
        error: 'This action is not available in your region. See our Terms of Service for details on geographic restrictions.',
        code: 'GEO_RESTRICTED',
        country,
      },
      { status: 451 },
    );
  }

  return NextResponse.next();
}

// Matcher narrows which requests Next.js runs the middleware on at all.
// Performance optimization — the GATED_PATHS regex array does the actual
// filtering. Anything not matched here doesn't even invoke this file.
// Keep this in sync with GATED_PATHS above.
export const config = {
  matcher: [
    '/api/bots/:path*',
  ],
};
