import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage } from '@/lib/crypto';
import { updateGateContent } from '@/services/keycard';

// Creator-only endpoint to update the content inside a meme's Keycard
// gate ("Backer Vault"). The creator signs an auth message; we then
// use the platform escrow keypair (which is the gate's owner) to PATCH
// the gate on Keycard's side via SIWS.
//
// Auth: signed message "vault-update:{meme_id}:{caller_wallet}:{unix_ms}"
//
// Body:
//   { caller_wallet, signature, message,
//     content_text?, content_filename?, content_mime? }
//
// File size cap: 4MB (Keycard's inline-upload limit). Larger files
// would require their /v1/uploads pre-upload flow — out of scope for
// MVP. We accept text + filename; the service serializes to a Blob.

export const dynamic = 'force-dynamic';

const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { caller_wallet, signature, message, content_text, content_filename, content_mime } = body;

    if (!caller_wallet) return NextResponse.json({ error: 'caller_wallet required' }, { status: 400 });
    if (!signature || !message) return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });

    const auth = verifySignedAuthMessage(
      `vault-update:${id}:${caller_wallet}`,
      message,
      signature,
      caller_wallet,
    );
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    if (typeof content_text !== 'string' || content_text.length === 0) {
      return NextResponse.json({ error: 'content_text required (non-empty string)' }, { status: 400 });
    }
    if (Buffer.byteLength(content_text, 'utf8') > MAX_CONTENT_BYTES) {
      return NextResponse.json(
        { error: `Content exceeds 4MB inline limit. Larger files need the /v1/uploads flow (not yet wired).` },
        { status: 413 },
      );
    }
    const filename = (typeof content_filename === 'string' && content_filename.trim()) || 'vault.md';
    const mime = (typeof content_mime === 'string' && content_mime.trim()) || 'text/markdown';

    const supabase = createServerClient();
    const { data: meme } = await supabase
      .from('memes')
      .select('id, creator_wallet, keycard_gate_id, keycard_admin_url, name, symbol')
      .eq('id', id)
      .single();

    if (!meme) return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    if (meme.creator_wallet !== caller_wallet) {
      return NextResponse.json({ error: 'Only the meme creator can update the vault' }, { status: 403 });
    }
    if (!meme.keycard_gate_id) {
      return NextResponse.json(
        { error: 'No Keycard vault for this meme yet — the sync cron creates one after launch' },
        { status: 400 },
      );
    }

    const res = await updateGateContent(meme.keycard_gate_id, {
      fileContent: content_text,
      fileName: filename,
      fileMime: mime,
    });

    if (!res.ok) {
      return NextResponse.json({ error: res.error || 'Keycard update failed' }, { status: 502 });
    }

    // Touch synced_at so the public panel reflects the update.
    await supabase
      .from('memes')
      .update({ keycard_synced_at: new Date().toISOString() })
      .eq('id', id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
