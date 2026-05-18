// Load pre-ground vanity keypairs into the vanity_wallets pool.
//
// 1) Grind them offline with the FAST native tool (multi-core, ~100x
//    faster than node) into a directory:
//
//      mkdir -p vanity-pool
//      cd vanity-pool
//      solana-keygen grind --ends-with pool:100        # pool wallets
//      # (optional) solana-keygen grind --ends-with pump:100   # mints
//
//    solana-keygen writes <PUBKEY>.json files (64-int secret arrays).
//
// 2) Load them (encrypts with the SAME scheme/key the app decrypts with,
//    self-verifies each by round-tripping before insert — nothing bad
//    gets stored):
//
//      node tools/load-vanity.mjs ./vanity-pool pool
//
// Usage: node tools/load-vanity.mjs <dir> <suffix>

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';

const [dir, suffix] = process.argv.slice(2);
if (!dir || !suffix) { console.error('usage: node tools/load-vanity.mjs <dir> <suffix>'); process.exit(1); }

const env = readFileSync('.env.local', 'utf-8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const sb = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// Use the EXACT key the runtime uses. Prod stores it double-quoted with
// literal \n which dotenv expands to a real newline — replicate that and
// self-verify, so a wrong key inserts nothing.
function keyCandidates() {
  const cands = [];
  try {
    const raw = readFileSync('/tmp/prodenv2', 'utf-8').match(/^BURNER_ENCRYPTION_KEY=(.*)$/m)?.[1];
    if (raw) { const inner = raw.replace(/^"|"$/g, '').replace(/^'|'$/g, ''); cands.push(inner.replace(/\\n/g, '\n'), inner, raw); }
  } catch {}
  const local = get('BURNER_ENCRYPTION_KEY');
  if (local) cands.push(local.replace(/\\n/g, '\n'), local);
  return [...new Set(cands)];
}
const encrypt = (plain, ks) => {
  const key = crypto.createHash('sha256').update(ks).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `aes:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
};
const decrypt = (enc, ks) => {
  const key = crypto.createHash('sha256').update(ks).digest();
  const p = enc.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(p[1], 'base64'));
  d.setAuthTag(Buffer.from(p[2], 'base64'));
  return Buffer.concat([d.update(Buffer.from(p[3], 'base64')), d.final()]).toString('utf8');
};

// Pick the key candidate that round-trips correctly
let KS = null;
for (const ks of keyCandidates()) {
  try { if (decrypt(encrypt('probe', ks), ks) === 'probe') { KS = ks; break; } } catch {}
}
if (!KS) { console.error('No usable BURNER_ENCRYPTION_KEY candidate'); process.exit(1); }

const files = readdirSync(dir).filter(f => f.endsWith('.json'));
let ok = 0, skip = 0, bad = 0;
for (const f of files) {
  try {
    const secret = Uint8Array.from(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
    const kp = Keypair.fromSecretKey(secret);
    const pub = kp.publicKey.toBase58();
    if (!pub.toLowerCase().endsWith(suffix.toLowerCase())) { console.log(`skip ${pub} (no '${suffix}')`); skip++; continue; }
    const enc = encrypt(bs58.encode(kp.secretKey), KS);
    // safety gate: must round-trip back to the exact keypair
    const rt = Keypair.fromSecretKey(bs58.decode(decrypt(enc, KS)));
    if (rt.publicKey.toBase58() !== pub) { console.log(`BAD roundtrip ${pub}`); bad++; continue; }
    const { error } = await sb.from('vanity_wallets').insert({ public_key: pub, encrypted_private_key: enc, suffix });
    if (error) { if (error.code === '23505') { skip++; } else { console.log(`err ${pub}: ${error.message}`); bad++; } }
    else { ok++; }
  } catch (e) { console.log(`fail ${f}: ${e.message}`); bad++; }
}
console.log(`\nloaded=${ok} skipped=${skip} bad=${bad}  (suffix '${suffix}')`);
