// One-off: directly set socials/banner on a meme via service-role.
// Bypasses the edit-panel auth flow when that's misbehaving so we can
// confirm rendering works while we debug the panel.
//
// Usage:
//   node --env-file=.env.local tools/set-meme-socials.mjs \
//     <meme-id> [field=value ...]
//
// Examples:
//   tools/set-meme-socials.mjs 8b71b9a4-... github=https://github.com/Based-LTD
//   tools/set-meme-socials.mjs 8b71b9a4-... banner_url=https://prooflaunch.fun/foo.png

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set');
if (!SERVICE_KEY)  throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');

const ALLOWED = new Set(['github', 'twitter', 'telegram', 'discord', 'website', 'banner_url', 'description']);

const [memeId, ...kvs] = process.argv.slice(2);
if (!memeId) {
  console.error('usage: set-meme-socials.mjs <meme-id> field=value [field=value ...]');
  process.exit(1);
}

const update = {};
for (const kv of kvs) {
  const i = kv.indexOf('=');
  if (i < 0) { console.error(`bad pair: ${kv}`); process.exit(1); }
  const k = kv.slice(0, i);
  const v = kv.slice(i + 1);
  if (!ALLOWED.has(k)) { console.error(`field not allowed: ${k}`); process.exit(1); }
  update[k] = v === '' ? null : v;
}

if (Object.keys(update).length === 0) {
  console.error('no fields to update');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data: before } = await supa.from('memes')
  .select('id, name, symbol, github, twitter, telegram, discord, website, banner_url, description, status')
  .eq('id', memeId).single();
if (!before) { console.error('meme not found'); process.exit(1); }
console.log('BEFORE:', JSON.stringify(before, null, 2));

const { data: after, error } = await supa.from('memes').update(update).eq('id', memeId)
  .select('id, name, symbol, github, twitter, telegram, discord, website, banner_url, description, status').single();
if (error) { console.error('update failed:', error); process.exit(1); }
console.log('\nUPDATE:', JSON.stringify(update, null, 2));
console.log('\nAFTER:', JSON.stringify(after, null, 2));
