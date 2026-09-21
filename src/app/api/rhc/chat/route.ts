import { NextRequest, NextResponse } from 'next/server';
import { isAddress, verifyMessage } from 'viem';
import { createServerClient } from '@/lib/supabase';
import { rateLimiters } from '@/lib/rateLimit';

// Campaign chat for Robinhood Chain — the SOL /api/chat route with an
// EIP-191 (personal_sign) proof of wallet ownership instead of ed25519.
// Message format the client signs:  rhc-chat:<campaign>:<wallet>:<unix_ms>
// (both addresses lowercase). Replay window 5 minutes; the client caches
// the signature for 4 so a chatty backer isn't prompted per message.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SIG_AGE_MS = 5 * 60 * 1000;

// Strip tags — this enforces "no rich text", not XSS defense; React
// escapes on render. Do not entity-encode here (see /api/chat history).
function sanitize(message: string): string {
  return message.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').replace(/on\w+=/gi, '').trim();
}

// The table lands with migration 062. Until it is applied the panel says
// "chat opens soon" instead of the page throwing.
function tableMissing(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(e.message ?? ''));
}

export async function GET(req: NextRequest) {
  const campaign = (new URL(req.url).searchParams.get('campaign') ?? '').toLowerCase();
  if (!isAddress(campaign)) return NextResponse.json({ error: 'campaign required' }, { status: 400 });
  try {
    const db = createServerClient();
    const { data, error } = await db
      .from('rhc_chat_messages')
      .select('id, campaign, wallet, message, created_at')
      .eq('campaign', campaign)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ messages: [], disabled: true });
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }
    return NextResponse.json({ messages: data ?? [] }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ messages: [], disabled: true });
  }
}

export async function POST(req: NextRequest) {
  let body: { campaign?: unknown; wallet?: unknown; message?: unknown; auth_message?: unknown; auth_signature?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const campaign = typeof body.campaign === 'string' ? body.campaign.toLowerCase() : '';
  const wallet = typeof body.wallet === 'string' ? body.wallet.toLowerCase() : '';
  const message = typeof body.message === 'string' ? body.message : '';
  const authMessage = typeof body.auth_message === 'string' ? body.auth_message : '';
  const authSignature = typeof body.auth_signature === 'string' ? body.auth_signature : '';

  if (!isAddress(campaign) || !isAddress(wallet)) return NextResponse.json({ error: 'bad address' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });
  if (message.length > 500) return NextResponse.json({ error: 'Message too long (max 500 characters)' }, { status: 400 });

  // Wallet ownership proof — without it anyone could post as any wallet.
  const prefix = `rhc-chat:${campaign}:${wallet}:`;
  if (!authMessage.startsWith(prefix) || !authSignature.startsWith('0x')) {
    return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
  }
  const ts = parseInt(authMessage.slice(prefix.length), 10);
  if (!Number.isFinite(ts) || ts <= 0 || Math.abs(Date.now() - ts) > MAX_SIG_AGE_MS) {
    return NextResponse.json({ error: 'Signature expired — please retry' }, { status: 401 });
  }
  let ok = false;
  try {
    ok = await verifyMessage({ address: wallet as `0x${string}`, message: authMessage, signature: authSignature as `0x${string}` });
  } catch { ok = false; }
  if (!ok) return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });

  if (!rateLimiters.chat(`rhc:${wallet}`).success) {
    return NextResponse.json({ error: 'Too many messages. Please wait before sending another.' }, { status: 429 });
  }

  const clean = sanitize(message);
  if (!clean) return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });

  try {
    const db = createServerClient();
    const { data, error } = await db
      .from('rhc_chat_messages')
      .insert({ campaign, wallet, message: clean })
      .select('id, campaign, wallet, message, created_at')
      .single();
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ error: 'Chat is not open yet' }, { status: 503 });
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
    return NextResponse.json({ message: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Chat is not open yet' }, { status: 503 });
  }
}
