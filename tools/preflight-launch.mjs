#!/usr/bin/env node
// preflight-launch.mjs — run through every "is the platform ready to launch this meme?"
// check in one shot. Green/yellow/red per line. Exit 0 = launch, 1 = fix something first.
//
// Usage:
//   node tools/preflight-launch.mjs <meme_id>
//   node tools/preflight-launch.mjs --by-symbol PPAYS
//   node tools/preflight-launch.mjs --by-mint <mint_address>
//
// Idempotent, read-only. Safe to run repeatedly.

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';

// ── env + clients ──────────────────────────────────────────────
const env = readFileSync('.env.local', 'utf-8');
const g = (k) => {
  const raw = env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
  return raw ? raw.replace(/\\n/g, '\n') : null;
};
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const conn = new Connection(g('NEXT_PUBLIC_SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com', 'confirmed');
const BURNER = g('BURNER_ENCRYPTION_KEY');

// ── argv ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
let lookupKind = 'id';
let lookupValue = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--by-symbol') { lookupKind = 'symbol'; lookupValue = args[++i]; continue; }
  if (args[i] === '--by-mint')   { lookupKind = 'mint';   lookupValue = args[++i]; continue; }
  if (!lookupValue) lookupValue = args[i];
}
if (!lookupValue) {
  console.error('usage: node tools/preflight-launch.mjs <meme_id>');
  console.error('       node tools/preflight-launch.mjs --by-symbol PPAYS');
  process.exit(2);
}

// ── output helpers ─────────────────────────────────────────────
const OK = '\x1b[32m✓\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36mi\x1b[0m';

let failCount = 0;
let warnCount = 0;
function pass(msg) { console.log(`  ${OK} ${msg}`); }
function warn(msg) { console.log(`  ${WARN} ${msg}`); warnCount++; }
function fail(msg) { console.log(`  ${FAIL} ${msg}`); failCount++; }
function info(msg) { console.log(`  ${INFO} ${msg}`); }
function section(name) { console.log(`\n\x1b[1m${name}\x1b[0m`); }

function derivePub(secretB58) {
  if (!secretB58) return null;
  try { return Keypair.fromSecretKey(bs58.decode(secretB58)).publicKey.toBase58(); } catch { return null; }
}

function tryDecryptPoolKey(encrypted) {
  if (!encrypted) return { ok: false, error: 'no encrypted_pool_key' };
  if (!BURNER) return { ok: false, error: 'BURNER_ENCRYPTION_KEY missing in local env' };
  try {
    if (encrypted.startsWith('enc:')) {
      const sk = Buffer.from(encrypted.slice(4), 'base64').toString('utf-8');
      return { ok: true, secret: sk };
    }
    if (encrypted.startsWith('aes:')) {
      const key = crypto.createHash('sha256').update(BURNER).digest();
      const parts = encrypted.split(':');
      const iv = Buffer.from(parts[1], 'base64');
      const authTag = Buffer.from(parts[2], 'base64');
      const ct = Buffer.from(parts[3], 'base64');
      const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
      dec.setAuthTag(authTag);
      return { ok: true, secret: Buffer.concat([dec.update(ct), dec.final()]).toString('utf8') };
    }
    return { ok: false, error: 'unknown encryption format' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log(`\n\x1b[1;36m═══ Prooflaunch Preflight Check ═══\x1b[0m`);
  console.log(`Lookup: ${lookupKind}=${lookupValue}\n`);

  // ── Load meme ──────────────────────────────────────────────
  section('1. Meme record');
  let memeQuery = sb.from('memes').select('*');
  if (lookupKind === 'id') memeQuery = memeQuery.eq('id', lookupValue);
  else if (lookupKind === 'symbol') memeQuery = memeQuery.eq('symbol', lookupValue);
  else if (lookupKind === 'mint') memeQuery = memeQuery.eq('mint_address', lookupValue);
  const { data: memeRow, error: memeErr } = await memeQuery.limit(1).maybeSingle();

  if (memeErr || !memeRow) {
    fail(`meme not found (${memeErr?.message || 'no row'})`);
    process.exit(1);
  }
  const meme = memeRow;
  pass(`found: ${meme.symbol} (${meme.name}) id=${meme.id.slice(0, 8)}`);
  info(`status: ${meme.status}   launch_platform: ${meme.launch_platform || '(default pumpfun)'}   quote: ${meme.quote_currency || 'sol'}`);
  info(`created: ${meme.created_at?.slice(0, 16)}   deadline: ${meme.backing_deadline?.slice(0, 16)}`);
  info(`goal: ${meme.backing_goal_sol} SOL   current: ${meme.current_backing_sol} SOL   slots: ${meme.total_slots}`);

  if (!['backing', 'funded'].includes(meme.status)) {
    warn(`status='${meme.status}' — expected 'backing' or 'funded' for a preflight`);
  }

  // ── Backings sanity ────────────────────────────────────────
  section('2. Backings');
  const { data: backings } = await sb.from('backings')
    .select('id, backer_wallet, amount_sol, status, slot_number, deposit_tx, claim_tx')
    .eq('meme_id', meme.id)
    .order('slot_number', { ascending: true });

  if (!backings || backings.length === 0) {
    fail('no backings yet');
  } else {
    const confirmedSum = backings.filter(b => b.status === 'confirmed').reduce((s, b) => s + Number(b.amount_sol), 0);
    const distributedCount = backings.filter(b => b.status === 'distributed').length;
    const confirmedCount = backings.filter(b => b.status === 'confirmed').length;
    pass(`${backings.length} backing rows (confirmed=${confirmedCount}, distributed=${distributedCount})`);
    if (Math.abs(confirmedSum - Number(meme.current_backing_sol)) > 0.0001 && meme.status === 'backing') {
      warn(`sum of confirmed (${confirmedSum}) ≠ current_backing_sol (${meme.current_backing_sol}) — DB drift`);
    }
    const missingSlots = backings.filter(b => !b.slot_number);
    if (missingSlots.length) fail(`${missingSlots.length} row(s) missing slot_number`);
    const missingDeposits = backings.filter(b => !b.deposit_tx);
    if (missingDeposits.length) fail(`${missingDeposits.length} row(s) missing deposit_tx (data integrity)`);
    // Duplicate slot check
    const slotSeen = new Set();
    const dupeSlots = [];
    for (const b of backings) {
      if (b.slot_number && slotSeen.has(b.slot_number)) dupeSlots.push(b.slot_number);
      slotSeen.add(b.slot_number);
    }
    if (dupeSlots.length) fail(`duplicate slot_numbers: ${dupeSlots.join(', ')}`);
  }

  // ── Pool wallet ────────────────────────────────────────────
  section('3. Pool wallet');
  if (!meme.pool_wallet) {
    fail('no pool_wallet on record');
  } else {
    pass(`address: ${meme.pool_wallet}`);
    try {
      const poolBal = await conn.getBalance(new PublicKey(meme.pool_wallet), 'confirmed');
      const solAmount = poolBal / LAMPORTS_PER_SOL;
      info(`SOL balance: ${solAmount.toFixed(6)}`);
      if (meme.status === 'funded' && solAmount < Number(meme.current_backing_sol) * 0.95) {
        fail(`pool has ${solAmount.toFixed(4)} SOL but backed ${meme.current_backing_sol} SOL — funds missing`);
      }
    } catch (e) {
      fail(`pool balance check failed: ${e.message}`);
    }
    // Encrypted key
    const dec = tryDecryptPoolKey(meme.encrypted_pool_key);
    if (!dec.ok) {
      fail(`encrypted_pool_key decrypt: ${dec.error}`);
    } else {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(dec.secret));
        if (kp.publicKey.toBase58() === meme.pool_wallet) {
          pass('encrypted_pool_key decrypts and matches pool_wallet');
        } else {
          fail(`key derives to ${kp.publicKey.toBase58()} but pool_wallet is ${meme.pool_wallet}`);
        }
      } catch (e) {
        fail(`key parse: ${e.message}`);
      }
    }
    // Wallet-claim seal
    if (meme.creator_sealed_pool_key) {
      pass('creator_sealed_pool_key present (wallet-claim enabled)');
    } else {
      info('no creator_sealed_pool_key (wallet-claim disabled — creator can NOT claim pool key post-launch)');
    }
  }

  // ── Sub-escrow (Phase 2+ fee routing) ──────────────────────
  section('4. Sub-escrow (per-meme fee routing)');
  if (!meme.creator_subescrow_pubkey) {
    warn('no creator_subescrow_pubkey — legacy pre-P2 meme, fees route to shared platform escrow');
  } else {
    pass(`pubkey: ${meme.creator_subescrow_pubkey}`);
    const dec = tryDecryptPoolKey(meme.encrypted_creator_subescrow_key);
    if (!dec.ok) {
      fail(`sub-escrow key decrypt: ${dec.error}`);
    } else {
      const kp = Keypair.fromSecretKey(bs58.decode(dec.secret));
      if (kp.publicKey.toBase58() === meme.creator_subescrow_pubkey) {
        pass('sub-escrow key decrypts and matches');
      } else {
        fail('sub-escrow key mismatch');
      }
    }
  }

  // ── Bot stack ──────────────────────────────────────────────
  section('5. Bot stack');
  const { data: bots } = await sb.from('meme_bots')
    .select('id, action, fee_pct, bot_wallet, encrypted_bot_key, expires_at')
    .eq('meme_id', meme.id);
  if (!bots || bots.length === 0) {
    warn('no bots configured — fees will not route to holders/backers via bot actions');
  } else {
    pass(`${bots.length} bot(s) configured`);
    let totalPct = 0;
    for (const b of bots) {
      totalPct += Number(b.fee_pct);
      const dec = tryDecryptPoolKey(b.encrypted_bot_key);
      if (!dec.ok) {
        fail(`bot ${b.id.slice(0,8)} (${b.action}): key decrypt failed — ${dec.error}`);
        continue;
      }
      const kp = Keypair.fromSecretKey(bs58.decode(dec.secret));
      if (kp.publicKey.toBase58() !== b.bot_wallet) {
        fail(`bot ${b.id.slice(0,8)} (${b.action}): key derives to wrong wallet`);
      } else {
        pass(`${b.action} @ ${b.fee_pct}% → ${b.bot_wallet.slice(0,8)}...${b.bot_wallet.slice(-4)}`);
      }
    }
    if (totalPct > 100) {
      fail(`bot fee_pct sum = ${totalPct}% > 100% — will over-allocate the backer pool`);
    }
  }

  // ── Platform wallets (escrow + holder rewards) ─────────────
  section('6. Platform wallet gas');
  const escrowLocalPub = derivePub(g('ESCROW_WALLET_PRIVATE_KEY'));
  const rewardsLocalPub = derivePub(g('HOLDER_REWARDS_WALLET_PRIVATE_KEY'));
  const escrowPubEnv = g('NEXT_PUBLIC_ESCROW_WALLET');
  const rewardsPubEnv = g('HOLDER_REWARDS_WALLET_ADDRESS');

  // Escrow
  if (!escrowLocalPub) {
    warn('ESCROW_WALLET_PRIVATE_KEY missing/invalid in local .env.local — cannot verify balance (may be OK if prod has different key)');
  } else {
    const escrowBal = await conn.getBalance(new PublicKey(escrowLocalPub), 'confirmed');
    const escSol = escrowBal / LAMPORTS_PER_SOL;
    info(`escrow ${escrowLocalPub}: ${escSol.toFixed(6)} SOL`);
    if (escSol < 0.02) fail(`escrow < 0.02 SOL — fee-claim tx will fail with AccountNotFound (PPAYS incident 2026-07-27)`);
    else if (escSol < 0.1) warn(`escrow < 0.1 SOL — top up before launch (each fee cycle burns ~5-10k lamports)`);
    else pass(`escrow has ≥ 0.1 SOL (${escSol.toFixed(4)})`);
    // Match check
    if (escrowPubEnv && escrowPubEnv !== escrowLocalPub) {
      warn(`NEXT_PUBLIC_ESCROW_WALLET (${escrowPubEnv.slice(0,8)}...) doesn't match private key derivation (${escrowLocalPub.slice(0,8)}...) — deposits go one place, signer is another`);
    }
  }

  // Holder rewards
  if (!rewardsLocalPub) {
    warn('HOLDER_REWARDS_WALLET_PRIVATE_KEY missing');
  } else {
    const rewBal = await conn.getBalance(new PublicKey(rewardsLocalPub), 'confirmed');
    const rewSol = rewBal / LAMPORTS_PER_SOL;
    info(`holder-rewards ${rewardsLocalPub}: ${rewSol.toFixed(6)} SOL`);
    if (rewSol < 0.02) fail(`holder-rewards < 0.02 SOL — daily airdrop cron will fail`);
    else if (rewSol < 0.05) warn(`holder-rewards < 0.05 SOL — top up soon`);
    else pass(`holder-rewards has ≥ 0.05 SOL`);
  }

  // ── Creator wallet ────────────────────────────────────────
  section('7. Creator wallet');
  if (!meme.creator_wallet) {
    fail('no creator_wallet — cannot verify creator can trigger launch');
  } else {
    pass(`address: ${meme.creator_wallet}`);
    const cBal = await conn.getBalance(new PublicKey(meme.creator_wallet), 'confirmed');
    const cSol = cBal / LAMPORTS_PER_SOL;
    info(`creator SOL: ${cSol.toFixed(6)}`);
    if (cSol < 0.005) fail(`creator wallet has < 0.005 SOL — cannot sign launch tx`);
    else if (cSol < 0.02) warn(`creator wallet low on gas (${cSol.toFixed(4)} SOL)`);
    else pass(`creator has gas for launch`);
  }

  // ── Post-launch state (if already live) ────────────────────
  if (meme.status === 'live' && meme.mint_address) {
    section('8. Post-launch state');
    pass(`mint: ${meme.mint_address}`);
    const undistributed = backings?.filter(b => b.status === 'confirmed') || [];
    if (undistributed.length > 0) {
      fail(`${undistributed.length} backing(s) STUCK at status=confirmed — never got their tokens`);
      for (const b of undistributed) {
        console.log(`    - slot ${b.slot_number}  ${b.backer_wallet.slice(0,8)}...${b.backer_wallet.slice(-4)}  ${b.amount_sol} SOL`);
      }
      info(`fix: POST /api/claim with creator sig, or wait for reconcile cron`);
    } else {
      pass('all backings distributed');
    }
  }

  // ── Verdict ────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  if (failCount === 0 && warnCount === 0) {
    console.log('\x1b[1;32m🟢 GREEN — launch this meme when ready.\x1b[0m');
    process.exit(0);
  } else if (failCount === 0) {
    console.log(`\x1b[1;33m🟡 YELLOW — ${warnCount} warning(s). Launch is possible but fix warnings first if you can.\x1b[0m`);
    process.exit(0);
  } else {
    console.log(`\x1b[1;31m🔴 RED — ${failCount} failure(s), ${warnCount} warning(s). Do NOT launch until failures are fixed.\x1b[0m`);
    process.exit(1);
  }
}

main().catch(e => { console.error('fatal:', e); process.exit(2); });
