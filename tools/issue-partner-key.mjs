#!/usr/bin/env node
/* eslint-disable */
//
// Issue a new partner API key.
//
// Usage:
//   node tools/issue-partner-key.mjs <slug> <display_name> [--env=live|test] [--rev-share-bps=250] [--wallet=<pubkey>] [--email=<email>] [--webhook=<url>]
//
// Example:
//   node tools/issue-partner-key.mjs daemon "DAEMON IDE" --env=live --rev-share-bps=250 --wallet=5q5D... --email=team@daemonide.tech --webhook=https://daemon-app.tech/api/webhooks/proof
//
// Prints the raw API key + webhook secret ONCE — they are NEVER stored or
// recoverable. Capture them immediately and send to the partner securely.
//
// Reads SUPABASE creds from .env.local.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

// ── Parse .env.local ───────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    console.error('[issue-partner-key] could not read .env.local');
    process.exit(1);
  }
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[issue-partner-key] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// ── Parse args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node tools/issue-partner-key.mjs <slug> <display_name> [--env=live|test] [--rev-share-bps=N] [--wallet=PK] [--email=E] [--webhook=URL]');
  process.exit(1);
}
const [slug, displayName, ...rest] = args;
const flags = {};
for (const f of rest) {
  const m = f.match(/^--([a-z-]+)=(.+)$/);
  if (m) flags[m[1]] = m[2];
}

const environment = flags.env || 'live';
if (!['live', 'test'].includes(environment)) {
  console.error('[issue-partner-key] --env must be "live" or "test"');
  process.exit(1);
}
// rev_share_bps is interpreted as % of the platform fee in distribution.ts
// (since 2026-06-20). 5000 = 50% (the standard partner split).
// 10000 = 100% (partner takes the entire platform slice). 0 = attribution
// only, no SOL. Range [0, 10000].
const revShareBps = flags['rev-share-bps'] ? parseInt(flags['rev-share-bps'], 10) : 0;
if (!Number.isInteger(revShareBps) || revShareBps < 0 || revShareBps > 10000) {
  console.error('[issue-partner-key] --rev-share-bps must be an integer 0–10000 (% of platform fee in bps; 5000 = 50%)');
  process.exit(1);
}
const partnerWallet = flags.wallet || null;
const contactEmail = flags.email || null;
const defaultWebhookUrl = flags.webhook || null;

// ── Generate key + secret ──────────────────────────────────────────
// Format: pl_(live|test)_<32 alphanumeric chars>
function genKey(env) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(32);
  let key = '';
  for (let i = 0; i < 32; i++) key += alphabet[bytes[i] % alphabet.length];
  return `pl_${env}_${key}`;
}
const apiKey = genKey(environment);
const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
const apiKeyPrefix = apiKey.slice(0, 12);                  // 'pl_live_abcd'
const webhookSecret = randomBytes(32).toString('hex');     // 64 chars

// ── Insert ─────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await supabase
  .from('partners')
  .insert({
    slug,
    display_name: displayName,
    contact_email: contactEmail,
    api_key_hash: apiKeyHash,
    api_key_prefix: apiKeyPrefix,
    webhook_secret: webhookSecret,
    environment,
    partner_wallet: partnerWallet,
    rev_share_bps: revShareBps,
    default_webhook_url: defaultWebhookUrl,
    enabled: true,
  })
  .select('id, slug, display_name, environment, rev_share_bps, partner_wallet, default_webhook_url, created_at')
  .single();

if (error) {
  console.error('[issue-partner-key] insert failed:');
  console.error(error);
  process.exit(1);
}

// ── Output ─────────────────────────────────────────────────────────
console.log('\n✅ Partner created.\n');
console.log('Partner ID:        ', data.id);
console.log('Slug:              ', data.slug);
console.log('Display name:      ', data.display_name);
console.log('Environment:       ', data.environment);
console.log('Rev-share:         ', `${data.rev_share_bps} bps (${(data.rev_share_bps / 100).toFixed(2)}% of the platform fee)`);
console.log('Partner wallet:    ', data.partner_wallet || '(none — no rev-share routing)');
console.log('Default webhook:   ', data.default_webhook_url || '(none — partner can supply per-session)');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SHOW THESE ONCE TO THE PARTNER, THEN DELETE FROM YOUR TERMINAL.');
console.log('They are NEVER recoverable from the database.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('API key:        ', apiKey);
console.log('Webhook secret: ', webhookSecret);
console.log('');
console.log('Test it:');
console.log(`  curl -X POST https://prooflaunch.fun/api/v1/partners/sessions \\`);
console.log(`    -H "Authorization: Bearer ${apiKey}" \\`);
console.log(`    -H "Content-Type: application/json" \\`);
console.log(`    -d '{`);
console.log(`      "name": "Test Token",`);
console.log(`      "symbol": "TEST",`);
console.log(`      "description": "A test token",`);
console.log(`      "creator_wallet": "5q5DiejKWQT9zWUMGMzp2uAdByS4APLD5a4zRRL2FuRQ",`);
console.log(`      "total_slots": 4,`);
console.log(`      "min_backing_sol": 0.1`);
console.log(`    }'`);
console.log('');
