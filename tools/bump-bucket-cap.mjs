// Bump the token-assets bucket file_size_limit to handle the legacy
// PNG token logos that ballooned past 2 MB (TREX/NUTCRACKER/TWICH).
// 4 MB cap is still safely below realtime payload concerns since the
// images live in Storage, not in the row.

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const { data, error } = await sb.storage.updateBucket('token-assets', {
  public: true,
  fileSizeLimit: 4 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
});
if (error) { console.error('updateBucket error:', error); process.exit(1); }
console.log('Updated:', data);
