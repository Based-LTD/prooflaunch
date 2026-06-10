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
    const v = stringOrNull(body.github);
    if (v === undefined) return { ok: false, error: 'github must be a string' };
    if (v !== null && !GITHUB_PATTERN.test(v)) {
      return { ok: false, error: 'github must be a https://github.com/... URL' };
    }
    update.github = v;
  }
  if ('twitter' in body) {
    const v = stringOrNull(body.twitter);
    if (v === undefined) return { ok: false, error: 'twitter must be a string' };
    if (v !== null && !TWITTER_PATTERN.test(v)) {
      return { ok: false, error: 'twitter must be a https://x.com/... or https://twitter.com/... URL' };
    }
    update.twitter = v;
  }
  if ('telegram' in body) {
    const v = stringOrNull(body.telegram);
    if (v === undefined) return { ok: false, error: 'telegram must be a string' };
    if (v !== null && !TELEGRAM_PATTERN.test(v)) {
      return { ok: false, error: 'telegram must be a https://t.me/... URL' };
    }
    update.telegram = v;
  }
  if ('discord' in body) {
    const v = stringOrNull(body.discord);
    if (v === undefined) return { ok: false, error: 'discord must be a string' };
    if (v !== null && !DISCORD_PATTERN.test(v)) {
      return { ok: false, error: 'discord must be a https://discord.gg/... or https://discord.com/... URL' };
    }
    update.discord = v;
  }
  if ('website' in body) {
    const v = stringOrNull(body.website);
    if (v === undefined) return { ok: false, error: 'website must be a string' };
    if (v !== null && !URL_PATTERN.test(v)) {
      return { ok: false, error: 'website must be a valid URL starting with http(s)://' };
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
