import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage } from '@/lib/crypto';

/**
 * PATCH /api/memes/{id}/metadata
 *
 * Creator-only endpoint to edit soft metadata on a meme while it's
 * still in the `backing` phase. Designed for "I forgot to add my
 * GitHub link" / "let me swap the banner" cases where the creator
 * wants to refine presentation without re-submitting.
 *
 * Editable fields (all optional in the request, only present fields
 * get touched — pass `null` to clear):
 *   - github
 *   - twitter
 *   - telegram
 *   - discord
 *   - website
 *   - banner_url
 *   - description
 *
 * NOT editable from this endpoint:
 *   - name, symbol, image_url (token identity — would mess up the
 *     pump.fun/meteora metadata that already references them)
 *   - slot config (total_slots, reserved_slots, etc.) — separate
 *     endpoint with stricter rules since backings already exist
 *   - launch_platform — committed at submit
 *
 * Auth: timestamped signed message:
 *   "metadata-edit:{meme_id}:{caller_wallet}:{unix_ms}"
 *
 * Restrictions:
 *   - Only the creator can call this
 *   - Meme must be in `backing` status (post-launch metadata is
 *     fixed on-chain anyway — editing the DB row wouldn't change
 *     what wallets/explorers fetched at launch time)
 */

const URL_PATTERN = /^https?:\/\/[^\s]+$/;
const TWITTER_PATTERN = /^https?:\/\/(x\.com|twitter\.com)\/[^\s]+$/i;
const TELEGRAM_PATTERN = /^https?:\/\/t\.me\/[^\s]+$/i;
const DISCORD_PATTERN = /^https?:\/\/discord\.(gg|com)\/[^\s]+$/i;
const GITHUB_PATTERN = /^https?:\/\/(www\.)?github\.com\/[^\s]+$/i;

// Forgiving normalization: if the value looks like a bare domain
// (e.g. "github.com/proof", "x.com/foo") prepend `https://` so the
// pattern matches. Saves users from form-rejection on a missing
// scheme — the canonical stored value is always https://...
function autoPrependScheme(v: string, hostPrefixes: string[]): string {
  if (/^https?:\/\//i.test(v)) return v;
  const lower = v.toLowerCase().replace(/^www\./, '');
  for (const host of hostPrefixes) {
    if (lower.startsWith(host.toLowerCase() + '/') || lower === host.toLowerCase()) {
      return 'https://' + v;
    }
  }
  return v;
}

// banner_url comes from /api/upload/image which returns a Supabase
// Storage URL on the token-assets bucket. Validate by prefix instead
// of leaving it wide-open — prevents the field from being abused to
// inject arbitrary URLs as banners.
function isValidBannerUrl(s: string): boolean {
  if (!s) return false;
  // Allow any https URL — the upload endpoint is the choke point.
  // We don't want to bind to a specific Supabase project URL since
  // that changes across environments.
  return /^https:\/\//.test(s);
}

interface EditableFields {
  github?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  discord?: string | null;
  website?: string | null;
  banner_url?: string | null;
  description?: string | null;
}

function pickAndValidate(body: Record<string, unknown>): {
  ok: true; update: EditableFields;
} | { ok: false; error: string } {
  const update: EditableFields = {};

  const stringOrNull = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  if ('github' in body) {
    const raw = stringOrNull(body.github);
    if (raw === undefined) return { ok: false, error: 'github must be a string' };
    const v = raw === null ? null : autoPrependScheme(raw, ['github.com']);
    if (v !== null && !GITHUB_PATTERN.test(v)) {
      return { ok: false, error: 'github must be a github.com/... or https://github.com/... URL' };
    }
    update.github = v;
  }
  if ('twitter' in body) {
    const raw = stringOrNull(body.twitter);
    if (raw === undefined) return { ok: false, error: 'twitter must be a string' };
    const v = raw === null ? null : autoPrependScheme(raw, ['x.com', 'twitter.com']);
    if (v !== null && !TWITTER_PATTERN.test(v)) {
      return { ok: false, error: 'twitter must be a x.com/... or twitter.com/... URL' };
    }
    update.twitter = v;
  }
  if ('telegram' in body) {
    const raw = stringOrNull(body.telegram);
    if (raw === undefined) return { ok: false, error: 'telegram must be a string' };
    const v = raw === null ? null : autoPrependScheme(raw, ['t.me']);
    if (v !== null && !TELEGRAM_PATTERN.test(v)) {
      return { ok: false, error: 'telegram must be a t.me/... URL' };
    }
    update.telegram = v;
  }
  if ('discord' in body) {
    const raw = stringOrNull(body.discord);
    if (raw === undefined) return { ok: false, error: 'discord must be a string' };
    const v = raw === null ? null : autoPrependScheme(raw, ['discord.gg', 'discord.com']);
    if (v !== null && !DISCORD_PATTERN.test(v)) {
      return { ok: false, error: 'discord must be a discord.gg/... or discord.com/... URL' };
    }
    update.discord = v;
  }
  if ('website' in body) {
    const raw = stringOrNull(body.website);
    if (raw === undefined) return { ok: false, error: 'website must be a string' };
    // Website is generic — only prepend if the input has a dot and
    // no scheme, so "myproject.com" becomes "https://myproject.com".
    const v = raw === null
      ? null
      : (/^https?:\/\//i.test(raw) ? raw : (/\./.test(raw) ? `https://${raw}` : raw));
    if (v !== null && !URL_PATTERN.test(v)) {
      return { ok: false, error: 'website must be a valid URL' };
    }
    update.website = v;
  }
  if ('banner_url' in body) {
    const v = stringOrNull(body.banner_url);
    if (v === undefined) return { ok: false, error: 'banner_url must be a string' };
    if (v !== null && !isValidBannerUrl(v)) {
      return { ok: false, error: 'banner_url must be a https URL (upload via /api/upload/image first)' };
    }
    update.banner_url = v;
  }
  if ('description' in body) {
    const v = stringOrNull(body.description);
    if (v === undefined) return { ok: false, error: 'description must be a string' };
    if (v !== null && v.length > 500) {
      return { ok: false, error: 'description must be 500 chars or less' };
    }
    update.description = v;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: 'No editable fields in request body' };
  }
  return { ok: true, update };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { caller_wallet, signature, message, ...editFields } = body;

    if (!caller_wallet) {
      return NextResponse.json({ error: 'caller_wallet required' }, { status: 400 });
    }
    if (!signature || !message) {
      return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
    }

    const auth = verifySignedAuthMessage(
      `metadata-edit:${id}:${caller_wallet}`,
      message,
      signature,
      caller_wallet,
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const validated = pickAndValidate(editFields);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: meme } = await supabase
      .from('memes')
      .select('creator_wallet, status')
      .eq('id', id)
      .single();

    if (!meme) return NextResponse.json({ error: 'Meme not found' }, { status: 404 });

    if (meme.creator_wallet !== caller_wallet) {
      return NextResponse.json({ error: 'Only the meme creator can edit metadata' }, { status: 403 });
    }

    if (meme.status !== 'backing') {
      return NextResponse.json(
        { error: `Metadata can only be edited during the backing phase (current status: ${meme.status})` },
        { status: 400 },
      );
    }

    const { error: updateErr, data: updated } = await supabase
      .from('memes')
      .update(validated.update)
      .eq('id', id)
      .select('id, github, twitter, telegram, discord, website, banner_url, description')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, meme: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
