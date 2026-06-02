import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { createServerClient } from '@/lib/supabase';

// Metaplex-compliant token metadata JSON, served per-meme by mint pubkey.
//
// The mint pubkey is UNIQUE FOREVER and known at launch time (we
// generate the mint keypair before the launch tx). The previous
// symbol-keyed route had a fatal flaw: two memes with the same symbol
// (e.g. multiple BONKD submissions) would overwrite each other's
// metadata, breaking the on-chain reference for the older token.
// The mint-keyed route eliminates that class of bug entirely.
//
// URL shape: /api/token-metadata/<MINT_PUBKEY>
//
// Cached for 1 hour at the CDN edge so wallets/explorers that pull
// this URL repeatedly aren't constantly hitting our DB.

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ mint: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { mint: raw } = await params;

  // Validate the mint param is a real Solana pubkey before touching
  // the DB. Cheap guardrail against scraper noise + malformed inputs.
  try {
    new PublicKey(raw);
  } catch {
    return NextResponse.json({ error: 'invalid mint' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: meme, error } = await supabase
    .from('memes')
    .select('name, symbol, description, image_url, twitter, telegram, discord, website, mint_address')
    .eq('mint_address', raw)
    .maybeSingle();

  if (error) {
    console.error('[token-metadata] db error:', error);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
  if (!meme) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://prooflaunch.fun';
  const externalUrl = `${baseUrl}/meme/${raw}`;

  // Defensive: only serve real image URLs. data: URLs ballooning the
  // metadata JSON to MB would be terrible for wallets/explorers (and
  // the audit found that all production memes are now backfilled to
  // CDN URLs — but this guard means a future regression can't bleed
  // through silently).
  const isRealImage = typeof meme.image_url === 'string'
    && meme.image_url.length > 0
    && !meme.image_url.startsWith('data:');
  const image = isRealImage ? meme.image_url : '';

  const metadata = {
    name: meme.name,
    symbol: meme.symbol,
    description: meme.description ?? '',
    image,
    external_url: externalUrl,
    extensions: {
      ...(meme.twitter ? { twitter: meme.twitter } : {}),
      ...(meme.telegram ? { telegram: meme.telegram } : {}),
      ...(meme.discord ? { discord: meme.discord } : {}),
      ...(meme.website ? { website: meme.website } : {}),
    },
  };

  return new NextResponse(JSON.stringify(metadata), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
