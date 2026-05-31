import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServerClient } from '@/lib/supabase';

// Upload a token image to the `token-assets` Supabase Storage bucket.
//
// History: token logos used to be inlined into `memes.image_url` as
// base64 data URLs. On the landing page that meant ~10 MB JSON payloads
// for 8 tokens (TTFB ~6s). Logos now go through this route → Storage,
// and image_url just holds the public CDN URL.
//
// Path layout mirrors migration 028's banner pattern:
//   token-assets/logos/<sha256>.<ext>
// Content-addressed so two creators uploading the same file dedupe
// automatically (and re-uploads are idempotent).
//
// Auth: open. The bucket has a 2 MB cap + mime allowlist at the
// Storage layer (migration 028), so abuse upside is bounded. No
// privileged data is reachable through this route.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024; // matches bucket file_size_limit
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'empty file' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `file too large (${(file.size / 1024 / 1024).toFixed(1)} MB; max 2 MB)` },
        { status: 413 },
      );
    }
    const mime = file.type || '';
    if (!ALLOWED_MIME.has(mime)) {
      return NextResponse.json(
        { error: `unsupported type: ${mime || 'unknown'}. Use PNG, JPEG, or WebP.` },
        { status: 415 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const ext = MIME_EXT[mime];
    const path = `logos/${hash}.${ext}`;

    const supabase = createServerClient();
    const { error: uploadErr } = await supabase.storage
      .from('token-assets')
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (uploadErr) {
      console.error('[upload/image] storage upload failed:', uploadErr);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from('token-assets').getPublicUrl(path);
    return NextResponse.json({ url: pub.publicUrl, path });
  } catch (e) {
    console.error('[upload/image] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
