import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// Metaplex-compliant token metadata JSON, served per-meme by symbol.
//
// Pump.fun's launch flow uploads its own metadata JSON to its IPFS
// service and the resulting URI gets embedded on-chain. Meteora's DBC
// just takes any URL — so we serve the JSON ourselves from the meme
// row. Cheaper, faster, and survives long-term because the row is the
// source of truth.
//
// URL shape: /api/token-metadata/<SYMBOL>
//   GET returns application/json matching the Metaplex Token Metadata
//   off-chain JSON schema: { name, symbol, description, image,
//   external_url, extensions: { twitter, telegram, website } }.
//
// Cached for 1 hour at the CDN edge so wallets/explorers that pull
// this URL repeatedly aren't constantly hitting our DB.

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ symbol: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { symbol: raw } = await params;
  const symbol = (raw || '').toUpperCase().slice(0, 32);
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  const supabase = createServerClient();
  // Most recent meme for this symbol — symbols aren't unique in our
  // DB (a creator could submit the same ticker twice if their first
  // attempt failed), so we use the latest row that has a launch_platform
  // matching where metadata is needed.
  const { data: meme, error } = await supabase
    .from('memes')
    .select('name, symbol, description, image_url, twitter, telegram, discord, website, mint_address, launch_platform')
    .eq('symbol', symbol)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[token-metadata] db error:', error);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
  if (!meme) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://prooflaunch.fun';
  const externalUrl = meme.mint_address
    ? `${baseUrl}/meme/${meme.mint_address}`
    : `${baseUrl}/launched`;

  // Metaplex off-chain JSON. The `extensions` object is the de-facto
  // standard for socials; wallets that don't know about it ignore it.
  const metadata = {
    name: meme.name,
    symbol: meme.symbol,
    description: meme.description ?? '',
    image: meme.image_url ?? '',
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
      // CDN caches for 1h; clients re-validate to pick up symbol/image
      // edits creators make through admin tools.
      'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
