// GET /api/wallet-claim/burn
//
// Hourly cron. Finds memes whose 24h grace period after claim_confirmed
// has expired, and burns the platform's encrypted_pool_key (NULL out the
// column). The sealed blob stays untouched — that's the creator's
// permanent backup.
//
// After this cron runs:
//   - Platform code paths that try to decrypt encrypted_pool_key on a
//     claimed meme will see NULL and must skip cleanly.
//   - Creator can still re-decrypt their sealed_pool_key by signing
//     the derivation message — unlimited, no platform involvement.
//
// Cron auth pattern matches /api/fees/process (x-vercel-cron header
// auto-allowed; manual trigger requires CRON_SECRET).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { authorizeCron } from '@/lib/cronAuth';
import { isWalletClaimEnabled } from '@/lib/walletClaim';

async function burnExpiredKeys() {
  const supabase = createServerClient();

  // 24h ago.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Find memes where:
  //   - claim was confirmed
  //   - confirmation happened > 24h ago
  //   - platform key is still set
  const { data: ready, error } = await supabase
    .from('memes')
    .select('id, symbol, pool_wallet_claimed_at')
    .eq('pool_wallet_claimed', true)
    .lt('pool_wallet_claimed_at', cutoff)
    .not('encrypted_pool_key', 'is', null);
  if (error) {
    console.error('[wallet-claim/burn] query failed:', error);
    return { ok: false, error: error.message };
  }

  const burned: Array<{ id: string; symbol: string }> = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const m of ready || []) {
    try {
      const { error: updateErr } = await supabase
        .from('memes')
        .update({ encrypted_pool_key: null })
        .eq('id', m.id);
      if (updateErr) {
        failed.push({ id: m.id, error: updateErr.message });
        continue;
      }
      await supabase.from('wallet_claim_events').insert({
        meme_id: m.id,
        event: 'platform_key_destroyed',
        details: { burned_at: new Date().toISOString() },
      });
      burned.push({ id: m.id, symbol: m.symbol });
      console.log(`[wallet-claim/burn] platform key destroyed for ${m.symbol} (${m.id})`);
    } catch (e) {
      failed.push({ id: m.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { ok: true, candidates: ready?.length ?? 0, burned: burned.length, failed: failed.length, burnedList: burned, failedList: failed };
}

async function handle(request: NextRequest) {
  if (!isWalletClaimEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'WALLET_CLAIM_ENABLED is off' });
  }
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;
  const result = await burnExpiredKeys();
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
