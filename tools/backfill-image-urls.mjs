// One-shot backfill: for every meme whose image_url is a `data:` URL
// (base64-inlined image), decode the bytes, upload to the `token-assets`
// Supabase Storage bucket under `logos/<sha256>.<ext>`, and replace
// image_url with the resulting public CDN URL.
//
// Why: legacy submits stored uploaded images as base64 data URLs
// directly in the row. The landing page payload hit ~10 MB for 8 tokens
// (TTFB ~6s). New submits now upload to Storage; this backfill cleans
// up the historical rows so they render again on the landing page
// (the list endpoint nulls out data: URLs to keep payload small).
//
// Usage:
//   node tools/backfill-image-urls.mjs            # dry run (lists what would change)
//   node tools/backfill-image-urls.mjs --execute  # actually upload + update rows
//
// Idempotent: rows already on a real URL are skipped. Same-byte uploads
// dedupe via sha256 path.

import { readFileSync } from 'fs';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const EXECUTE = process.argv.includes('--execute');

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const SUPABASE_URL = g('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = g('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function parseDataUrl(s) {
  const m = s.match(/^data:([^;,]+)(?:;([^,]+))?,(.+)$/s);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const encoding = m[2] || '';
  const data = m[3];
  const bytes = encoding.includes('base64')
    ? Buffer.from(data, 'base64')
    : Buffer.from(decodeURIComponent(data), 'utf-8');
  return { mime, bytes };
}

const { data: rows, error } = await sb
  .from('memes')
  .select('id, symbol, image_url')
  .like('image_url', 'data:%');
if (error) { console.error('Query error:', error); process.exit(1); }

console.log(`Found ${rows.length} meme(s) with data: image_url\n`);

let updated = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const parsed = parseDataUrl(row.image_url);
  if (!parsed) {
    console.log(`  [skip] ${row.symbol} (${row.id}): unparseable data URL`);
    skipped++;
    continue;
  }
  const ext = MIME_EXT[parsed.mime];
  if (!ext) {
    console.log(`  [skip] ${row.symbol}: unsupported mime ${parsed.mime}`);
    skipped++;
    continue;
  }
  const sizeKb = (parsed.bytes.length / 1024).toFixed(0);
  const hash = crypto.createHash('sha256').update(parsed.bytes).digest('hex');
  const path = `logos/${hash}.${ext}`;

  if (!EXECUTE) {
    console.log(`  [dry] ${row.symbol} → ${path} (${sizeKb} KB, ${parsed.mime})`);
    continue;
  }

  // Map gif → png? token-assets bucket only allows png/jpeg/webp. Keep
  // the bucket strict — flag GIFs as skips so we can decide manually.
  if (ext === 'gif') {
    console.log(`  [skip] ${row.symbol}: GIF not allowed in token-assets bucket`);
    skipped++;
    continue;
  }

  const { error: upErr } = await sb.storage
    .from('token-assets')
    .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: true });
  if (upErr) {
    console.error(`  [fail] ${row.symbol} upload: ${upErr.message}`);
    failed++;
    continue;
  }
  const { data: pub } = sb.storage.from('token-assets').getPublicUrl(path);
  const newUrl = pub.publicUrl;

  const { error: updErr } = await sb
    .from('memes')
    .update({ image_url: newUrl })
    .eq('id', row.id);
  if (updErr) {
    console.error(`  [fail] ${row.symbol} db update: ${updErr.message}`);
    failed++;
    continue;
  }
  console.log(`  [ok]   ${row.symbol} → ${newUrl} (${sizeKb} KB)`);
  updated++;
}

console.log(`\nSummary: updated=${updated} skipped=${skipped} failed=${failed} total=${rows.length}`);
if (!EXECUTE) console.log('(dry run — re-run with --execute to apply)');
