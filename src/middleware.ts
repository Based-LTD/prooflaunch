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

// Gated path patterns + methods. We block ONLY the passive-fee-collection
// surfaces — the act of CLAIMING accrued fees or withdrawing earned
// returns. Active creation actions (launching, submitting, backing as a
// "shared creator" co-investor) remain open to all users.
//
// IMPORTANT ARCHITECTURAL NOTE: this IP gate is necessary but NOT
// sufficient. distribution.ts auto-pushes fees to backers' wallets
// during drain cycles, so a US backer would receive fees on-chain
// regardless of whether they can hit the /api/claim endpoint. Full
// enforcement requires Layer 4: a per-wallet US flag captured at
// backing time + a filter in distribution.ts that skips flagged
// wallets. The IP gate here is the first defense layer; Layer 4 is
// the actually-load-bearing one for on-chain enforcement.
const GATED_PATHS: Array<{ pattern: RegExp; methods: Set<string> }> = [
  // Claiming accrued fees: the explicit "give me my passive returns" call
  { pattern: /^\/api\/claim(\/|$)/, methods: new Set(['POST']) },
  { pattern: /^\/api\/fees\/claim(\/|$)/, methods: new Set(['POST']) },

  // Withdrawing accrued bot earnings (passive collection variant)
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
    '/api/claim/:path*',
    '/api/fees/claim/:path*',
    '/api/bots/:path*',
  ],
};
