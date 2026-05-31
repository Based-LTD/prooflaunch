import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = readFileSync('.env.local', 'utf-8');
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const { data: buckets, error } = await sb.storage.listBuckets();
if (error) { console.error('listBuckets err:', error); process.exit(1); }
console.log('Existing buckets:');
buckets.forEach(b => console.log(`  ${b.id} (public=${b.public})`));
