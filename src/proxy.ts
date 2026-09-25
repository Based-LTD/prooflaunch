import { NextRequest, NextResponse } from 'next/server';

// Two front doors, one codebase. The site already knows which chain a page
// belongs to from its path (/rhc/... is Robinhood Chain, everything else is
// Solana), so splitting the audiences is a hostname rule, not a rewrite:
//
//   prooflaunch.fun       -> Robinhood Chain only. "/" goes to /rhc; any
//                            Solana path bounces to the SOL host.
//   sol.prooflaunch.fun   -> Solana only. Any /rhc path bounces back.
//
// Two chains under one roof with a toggle confused every room the launch
// was shared in (2026-09-25). Localhost and preview deployments are left
// exactly as they were, so nothing about development changes.
const RHC_HOST = 'prooflaunch.fun';
const SOL_HOST = 'sol.prooflaunch.fun';

// Paths that are shared infrastructure, never chain pages.
// roadmap is cross-chain (mostly Robinhood Chain) and belongs on both hosts.
const SHARED = /^\/(api|_next|images|favicon\.ico|robots\.txt|sitemap\.xml|legal|roadmap|banner-image|opengraph-image|icon)/;

// Armed by SPLIT_HOSTS=1 in the Vercel project env. Deployed inert on
// purpose: flipping it before sol.prooflaunch.fun resolves would bounce
// every Solana visitor to a dead hostname.
const ARMED = (process.env.SPLIT_HOSTS ?? '').trim() === '1';

export function proxy(req: NextRequest) {
  if (!ARMED) return NextResponse.next();
  const host = (req.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
  const { pathname, search } = req.nextUrl;
  if (SHARED.test(pathname)) return NextResponse.next();

  const isRhcPath = pathname === '/rhc' || pathname.startsWith('/rhc/');

  if (host === RHC_HOST || host === `www.${RHC_HOST}`) {
    if (pathname === '/') return NextResponse.redirect(new URL('/rhc', req.url), 308);
    if (!isRhcPath) return NextResponse.redirect(`https://${SOL_HOST}${pathname}${search}`, 308);
    return NextResponse.next();
  }

  if (host === SOL_HOST) {
    if (isRhcPath) return NextResponse.redirect(`https://${RHC_HOST}${pathname}${search}`, 308);
    return NextResponse.next();
  }

  // Any other host (localhost, *.vercel.app previews): unchanged.
  return NextResponse.next();
}

export const config = {
  // Skip static assets outright so the function never runs for them.
  matcher: ['/((?!_next/static|_next/image|images/|favicon.ico).*)'],
};
