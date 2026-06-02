// Smoke-test the metadata route end-to-end:
//   1. pick any real meme from the DB with mint_address set
//   2. hit GET /api/token-metadata/<mint> on the local dev server
//   3. assert the JSON shape + that image is an https URL (not data:)
//
// Why: catches regressions where the route changes shape, where the
// edge runtime can't reach Supabase, or where image_url filtering
// silently breaks.

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');

const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const { data: meme, error } = await sb
  .from('memes')
  .select('mint_address, symbol, name, image_url')
  .not('mint_address', 'is', null)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (error || !meme) { console.error('no launched meme to test against:', error); process.exit(1); }

console.log(`testing with: ${meme.symbol} (${meme.mint_address})`);

const url = `http://localhost:3000/api/token-metadata/${meme.mint_address}`;
console.log(`GET ${url}`);

const res = await fetch(url);
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

const json = await res.json();
console.log('response:');
console.log(JSON.stringify(json, null, 2).split('\n').slice(0, 20).join('\n'));

// Assertions
const checks = [
  ['name', json.name === meme.name],
  ['symbol', json.symbol === meme.symbol],
  ['image is real URL', typeof json.image === 'string' && (json.image === '' || json.image.startsWith('http'))],
  ['no data: in image', !json.image.startsWith('data:')],
  ['external_url present', typeof json.external_url === 'string' && json.external_url.length > 0],
  ['extensions object', typeof json.extensions === 'object' && json.extensions !== null],
];

console.log('\nchecks:');
let allPass = true;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (!ok) allPass = false;
}

if (!allPass) process.exit(1);
console.log('\n✅ metadata route healthy');
