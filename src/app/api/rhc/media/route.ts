import { NextRequest, NextResponse } from 'next/server';
import { isAddress, verifyMessage } from 'viem';
import { createServerClient } from '@/lib/supabase';
import { rhcPublicClient, campaignAbi } from '@/lib/rhc';

// Campaign banner + creator-editable soft metadata (description, socials) —
// the pieces of a launch page that are not on-chain.
// Message the creator signs:  rhc-banner:<campaign>:<wallet>:<unix_ms>
// (both addresses lowercase). The signer must be campaign.creator() on
// the chain, checked here on write AND on read, so a row can only ever be
// set by, and shown for, the wallet that created the campaign.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 15 min: the creator signs BEFORE the create tx, so this has to cover
// grinding + wallet confirmation + block inclusion, not just a click.
const MAX_SIG_AGE_MS = 15 * 60 * 1000;
const BANNER_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/token-assets/banners/`;

function tableMissing(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(e.message ?? ''));
}

async function creatorOf(campaign: `0x${string}`): Promise<string | null> {
  try {
    const c = await rhcPublicClient.readContract({ address: campaign, abi: campaignAbi, functionName: 'creator' });
    return (c as string).toLowerCase();
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const campaign = (new URL(req.url).searchParams.get('campaign') ?? '').toLowerCase();
  if (!isAddress(campaign)) return NextResponse.json({ error: 'campaign required' }, { status: 400 });
  try {
    const db = createServerClient();
    const { data, error } = await db.from('rhc_campaign_media').select('banner_url, description, twitter, telegram, discord, website, github, set_by').eq('campaign', campaign).maybeSingle();
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ banner_url: null, disabled: true });
      return NextResponse.json({ banner_url: null }, { status: 500 });
    }
    const empty = { banner_url: null, description: null, twitter: null, telegram: null, discord: null, website: null, github: null };
    if (!data) return NextResponse.json(empty, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
    // Read-time check: only the on-chain creator's row is ever shown.
    const creator = await creatorOf(campaign as `0x${string}`);
    const ok = !!creator && creator === data.set_by.toLowerCase();
    const { set_by: _sb, ...fields } = data; void _sb;
    return NextResponse.json(ok ? fields : empty, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch {
    return NextResponse.json({ banner_url: null, disabled: true });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const campaign = typeof body.campaign === 'string' ? body.campaign.toLowerCase() : '';
  const wallet = typeof body.wallet === 'string' ? body.wallet.toLowerCase() : '';
  const bannerUrl = typeof body.banner_url === 'string' ? body.banner_url : null; // null = remove
  // Soft fields: undefined = leave alone, '' = clear, string = set. Bounded and URL-shaped.
  const soft: Record<string, string | null> = {};
  const urlOk = (v: string) => /^https?:\/\/[^\s]{3,200}$/i.test(v);
  for (const k of ['description', 'twitter', 'telegram', 'discord', 'website', 'github'] as const) {
    const v = body[k];
    if (v === undefined) continue;
    if (v === null || v === '') { soft[k] = null; continue; }
    if (typeof v !== 'string') return NextResponse.json({ error: `bad ${k}` }, { status: 400 });
    if (k === 'description') { if (v.length > 600) return NextResponse.json({ error: 'description too long (600)' }, { status: 400 }); soft[k] = v.replace(/<[^>]*>/g, '').trim(); }
    else { if (!urlOk(v)) return NextResponse.json({ error: `${k} must be a full https:// link` }, { status: 400 }); soft[k] = v.trim(); }
  }
  const touchesBanner = body.banner_url !== undefined;
  const authMessage = typeof body.auth_message === 'string' ? body.auth_message : '';
  const authSignature = typeof body.auth_signature === 'string' ? body.auth_signature : '';
  if (!isAddress(campaign) || !isAddress(wallet)) return NextResponse.json({ error: 'bad address' }, { status: 400 });
  if (bannerUrl !== null && (!bannerUrl.startsWith(BANNER_PREFIX) || bannerUrl.length > 512)) {
    return NextResponse.json({ error: 'banner must be uploaded through /api/upload/image (kind=banner)' }, { status: 400 });
  }

  // One signature scope for the whole media row; the message names the campaign.
  const prefix = `rhc-banner:${campaign}:${wallet}:`;
  if (!authMessage.startsWith(prefix) || !authSignature.startsWith('0x')) {
    return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
  }
  const ts = parseInt(authMessage.slice(prefix.length), 10);
  if (!Number.isFinite(ts) || ts <= 0 || Math.abs(Date.now() - ts) > MAX_SIG_AGE_MS) {
    return NextResponse.json({ error: 'Signature expired — please retry' }, { status: 401 });
  }
  let sigOk = false;
  try { sigOk = await verifyMessage({ address: wallet as `0x${string}`, message: authMessage, signature: authSignature as `0x${string}` }); } catch { sigOk = false; }
  if (!sigOk) return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });

  const creator = await creatorOf(campaign as `0x${string}`);
  if (!creator) return NextResponse.json({ error: 'Campaign not found on chain yet — try again in a moment' }, { status: 404 });
  if (creator !== wallet) return NextResponse.json({ error: 'Only the campaign creator can set its banner' }, { status: 403 });

  try {
    const db = createServerClient();
    const row: Record<string, unknown> = { campaign, set_by: wallet, updated_at: new Date().toISOString(), ...soft };
    if (touchesBanner) row.banner_url = bannerUrl;
    const { error } = await db.from('rhc_campaign_media').upsert(row, { onConflict: 'campaign' });
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ error: 'Banners are not open yet' }, { status: 503 });
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Banners are not open yet' }, { status: 503 });
  }
}
