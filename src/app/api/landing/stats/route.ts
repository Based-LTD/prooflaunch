import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

/**
 * Landing-page hero ticker — one server call returns all five numbers.
 *
 * Aggregating server-side (instead of fan-out from the client) keeps the
 * hero render to a single network hop and prevents partial flickering
 * states as five fetches resolve at different times.
 *
 * Cached 60s. None of these numbers change faster than a minute in
 * practice (buybacks are batched, airdrops are daily, MC moves slowly
 * at this stage).
 *
 * Each metric fails independently — a single source going down returns
 * 0 for that field rather than 500-ing the whole hero.
 */

export const revalidate = 60;
export const dynamic = 'force-dynamic'; // Always fresh in dev; CDN cache handled by Cache-Control

const LAMPORTS_PER_SOL = 1_000_000_000;
const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';

interface LandingStats {
  burnedProof: number;       // UI-amount of PROOF destroyed across all buybacks
  distributedSol: number;    // SOL airdropped to PROOF holders (cumulative)
  backersCount: number;      // Unique wallets that have backed any meme
  launchedCount: number;     // Memes that reached launch (launched + migrated)
  marketCapUsd: number;      // PROOF market cap from Dexscreener
}

export async function GET() {
  const supabase = createServerClient();

  // Run all five lookups in parallel. settled = no single failure kills the response.
  const [burned, distributed, backers, launched, mc] = await Promise.allSettled([
    burnedProofTotal(supabase),
    distributedSolTotal(supabase),
    uniqueBackersCount(supabase),
    launchedMemesCount(supabase),
    proofMarketCapUsd(),
  ]);

  const stats: LandingStats = {
    burnedProof: burned.status === 'fulfilled' ? burned.value : 0,
    distributedSol: distributed.status === 'fulfilled' ? distributed.value : 0,
    backersCount: backers.status === 'fulfilled' ? backers.value : 0,
    launchedCount: launched.status === 'fulfilled' ? launched.value : 0,
    marketCapUsd: mc.status === 'fulfilled' ? mc.value : 0,
  };

  return NextResponse.json(stats, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}

// ── Individual metric queries ───────────────────────────────────────

async function burnedProofTotal(supabase: ReturnType<typeof createServerClient>): Promise<number> {
  const { data, error } = await supabase
    .from('proof_buybacks')
    .select('proof_burned_raw, proof_decimals')
    .eq('status', 'completed');
  if (error) throw error;
  let raw = 0;
  for (const r of data || []) {
    const decimals = r.proof_decimals ?? 6;
    raw += Number(r.proof_burned_raw || 0) / 10 ** decimals;
  }
  return raw;
}

async function distributedSolTotal(supabase: ReturnType<typeof createServerClient>): Promise<number> {
  const { data, error } = await supabase
    .from('holder_distribution_payouts')
    .select('share_lamports')
    .eq('status', 'sent');
  if (error) throw error;
  const lamports = (data || []).reduce((s, p) => s + Number(p.share_lamports || 0), 0);
  return lamports / LAMPORTS_PER_SOL;
}

async function uniqueBackersCount(supabase: ReturnType<typeof createServerClient>): Promise<number> {
  // Count distinct backer wallets across all backings ever. Set-based dedup
  // in JS is fine — backing volume is well under the 1k-row cap that would
  // require pagination here.
  const { data, error } = await supabase
    .from('backings')
    .select('backer_wallet');
  if (error) throw error;
  const set = new Set<string>();
  for (const r of data || []) {
    if (r.backer_wallet) set.add(r.backer_wallet);
  }
  return set.size;
}

async function launchedMemesCount(supabase: ReturnType<typeof createServerClient>): Promise<number> {
  // "Launched" = a real token mint exists on chain. In our schema the
  // post-launch state is `live` (on bonding curve). `funded` means the
  // SOL target was hit but the mint hasn't been created yet — doesn't
  // count. There's no separate `migrated` state today; if/when PumpSwap
  // graduation gets its own status, add it here.
  const { count, error } = await supabase
    .from('memes')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'live');
  if (error) throw error;
  return count ?? 0;
}

async function proofMarketCapUsd(): Promise<number> {
  // Dexscreener gives us FDV directly — no need to multiply price × supply ourselves.
  // 5s timeout: if Dexscreener is sluggish, fall back to 0 rather than holding the hero.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${PROOF_MINT}`,
      { signal: controller.signal, next: { revalidate: 60 } },
    );
    if (!res.ok) return 0;
    const json = await res.json();
    const pair = json?.pairs?.[0];
    return Number(pair?.marketCap || pair?.fdv || 0);
  } finally {
    clearTimeout(timer);
  }
}
