// How many pre-ground vanity mints are left, by suffix. Read-only.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await db.from('vanity_wallets').select('suffix, used, used_at, used_by');
if (error) throw error;

const by = {};
for (const r of data) {
  const k = r.suffix ?? '(null)';
  by[k] ??= { free: 0, used: 0, lastUsed: null };
  if (r.used) { by[k].used++; if (!by[k].lastUsed || (r.used_at ?? '') > by[k].lastUsed) by[k].lastUsed = r.used_at; }
  else by[k].free++;
}
console.log('suffix        free   used   total   last consumed');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].free - a[1].free)) {
  console.log(
    k.padEnd(12),
    String(v.free).padStart(5),
    String(v.used).padStart(6),
    String(v.free + v.used).padStart(7),
    '  ' + (v.lastUsed ? v.lastUsed.slice(0, 16).replace('T', ' ') : '—'),
  );
}
console.log('\ntotal rows:', data.length);
