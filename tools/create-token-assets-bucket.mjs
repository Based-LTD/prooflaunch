// One-shot: create the `token-assets` Storage bucket that migration 028
// was supposed to create but apparently never landed in this project.
//
// Mirrors the bucket config from 028_token_banners.sql:
//   - public read (so <img src=...> works)
//   - 2 MB cap per file
//   - PNG/JPEG/WebP only

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const { data, error } = await sb.storage.createBucket('token-assets', {
  public: true,
  fileSizeLimit: 2 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
});

if (error) {
  console.error('createBucket error:', error);
  process.exit(1);
}
console.log('Created bucket:', data);
