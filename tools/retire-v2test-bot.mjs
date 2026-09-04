#!/usr/bin/env node
// retire-v2test-bot.mjs — V2TEST is a dead test token whose bot has been
// failure-looping (TOKEN_NOT_TRADABLE) every cron tick. Founder-approved
// 2026-09-04: "dead issue, whatever we need to do there."
//
//   1. Set expires_at = now on all V2TEST bots (dispatcher skips expired
//      bots by design — reversible by NULLing expires_at)
//   2. Sweep each bot wallet's accrued SOL back to the platform escrow
//      (decrypt encrypted_bot_key, leave 0 — wallet has no further use)
//
//   node tools/retire-v2test-bot.mjs            # dry-run
//   node tools/retire-v2test-bot.mjs --execute  # do it

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import crypto from 'crypto';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const bs58Mod = require('bs58');
const bs58 = bs58Mod.default || bs58Mod;

const EXECUTE = process.argv.includes('--execute');
const ESCROW_DEST = 'DRwYbZuhD8VLvgU18TKx4jm8rZaoUudoMQQzuziGqnrx';

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(envText.split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const conn = new Connection(env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');

function decryptKey(encrypted) {
  if (encrypted.startsWith('enc:')) return Buffer.from(encrypted.slice(4), 'base64').toString('utf-8');
  const key = crypto.createHash('sha256').update(env.BURNER_ENCRYPTION_KEY).digest();
  const [, ivB64, tagB64, ctB64] = encrypted.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ctB64, 'base64')), d.final()]).toString('utf8');
}

const { data: meme } = await supabase.from('memes').select('id, symbol').eq('symbol', 'V2TEST').single();
if (!meme) { console.error('V2TEST not found'); process.exit(1); }
const { data: bots } = await supabase.from('meme_bots').select('id, action, bot_wallet, encrypted_bot_key, expires_at').eq('meme_id', meme.id);
console.log(`V2TEST (${meme.id}) — ${bots?.length || 0} bot(s)\n`);

for (const b of bots || []) {
  console.log(`BOT ${b.id.slice(0, 8)} (${b.action}) wallet=${b.bot_wallet} expires_at=${b.expires_at || 'never'}`);
  // Key may be encrypted under a pre-rotation BURNER_ENCRYPTION_KEY that no
  // longer exists in any env (verified 2026-09-04: local === prod, no legacy
  // fallback). Decrypt failure → funds stranded; expire still proceeds.
  let kp = null;
  try {
    kp = Keypair.fromSecretKey(bs58.decode(decryptKey(b.encrypted_bot_key)));
    if (kp.publicKey.toBase58() !== b.bot_wallet) { console.log('  ✗ key derives to wrong wallet — treating as stranded'); kp = null; }
    else console.log('  ✓ key decrypts and matches');
  } catch (e) {
    console.log(`  ✗ key does not decrypt under current BURNER_ENCRYPTION_KEY (${e.message.slice(0, 40)}) — funds stranded until old key found`);
  }
  const bal = await conn.getBalance(new PublicKey(b.bot_wallet));
  const FEE_HEADROOM = 10_000; // priority + base fee
  const sweep = kp ? Math.max(0, bal - FEE_HEADROOM) : 0;
  console.log(`  balance: ${(bal / 1e9).toFixed(6)} SOL → ${kp ? `sweep ${(sweep / 1e9).toFixed(6)} to escrow` : 'cannot sweep (no key)'}`);

  if (!EXECUTE) { console.log('  (dry-run)\n'); continue; }

  // 1. expire the bot
  const { error: upErr } = await supabase.from('meme_bots').update({ expires_at: new Date().toISOString() }).eq('id', b.id);
  console.log(upErr ? `  expire FAILED: ${upErr.message}` : '  ✓ expired (dispatcher skips from next tick)');

  // 2. sweep
  if (kp && sweep > 0) {
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }))
      .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(ESCROW_DEST), lamports: sweep }));
    const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: 'confirmed', maxRetries: 5 });
    console.log(`  ✓ swept: https://solscan.io/tx/${sig}`);
  }
  console.log();
}
console.log(EXECUTE ? 'Done.' : '\nDry-run complete. Re-run with --execute.');
