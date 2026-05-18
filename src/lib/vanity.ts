import { createServerClient } from './supabase';

// Atomically claim one unused pre-ground vanity keypair for `suffix`.
// Race-safe compare-and-swap: pick a candidate, then UPDATE guarded by
// `used = false` — if another caller grabbed it first the guarded update
// affects 0 rows and we try the next one. Returns null if the pool is
// empty (callers MUST degrade gracefully — never block a launch on it).
export async function consumeVanityWallet(
  suffix: string,
  usedBy: string
): Promise<{ publicKey: string; encryptedPrivateKey: string } | null> {
  const sb = createServerClient();
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: cand } = await sb
      .from('vanity_wallets')
      .select('id, public_key, encrypted_private_key')
      .eq('suffix', suffix)
      .eq('used', false)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!cand) return null; // pool exhausted for this suffix

    const { data: claimed } = await sb
      .from('vanity_wallets')
      .update({ used: true, used_by: usedBy, used_at: new Date().toISOString() })
      .eq('id', cand.id)
      .eq('used', false) // CAS guard — only the winner flips it
      .select('public_key, encrypted_private_key')
      .maybeSingle();

    if (claimed) {
      return {
        publicKey: claimed.public_key,
        encryptedPrivateKey: claimed.encrypted_private_key,
      };
    }
    // lost the race for this row — loop and try the next candidate
  }
  return null;
}

// How many unused keypairs remain (for monitoring / refill alerts).
export async function vanityPoolRemaining(suffix: string): Promise<number> {
  const sb = createServerClient();
  const { count } = await sb
    .from('vanity_wallets')
    .select('*', { count: 'exact', head: true })
    .eq('suffix', suffix)
    .eq('used', false);
  return count ?? 0;
}
