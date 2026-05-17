import { createClient } from '@supabase/supabase-js';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '');
const supabase = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const conn = new Connection(get('NEXT_PUBLIC_SOLANA_RPC_URL'), 'confirmed');

const MINT = '6pss27KB1XC4EZr6KZTPfcRE6G7K4v8YRzwuWDsdVtiJ';

const { data: meme, error } = await supabase
  .from('memes')
  .select('id, name, symbol, status, mint_address, pump_fun_url, total_slots, current_backing_sol, launched_at')
  .eq('mint_address', MINT)
  .single();

if (error || !meme) { console.error('Meme not found by mint:', error?.message); process.exit(1); }
console.log('MEME:');
console.log(`  ${meme.name} ($${meme.symbol})  status=${meme.status}`);
console.log(`  id=${meme.id}`);
console.log(`  launched_at=${meme.launched_at}`);
console.log(`  pump=${meme.pump_fun_url}`);

const { data: backings } = await supabase
  .from('backings')
  .select('id, slot_number, status, amount_sol, backer_wallet, burner_wallet, burner_buy_executed, swept')
  .eq('meme_id', meme.id)
  .order('slot_number');

console.log(`\nBACKINGS (${backings?.length || 0}):`);
for (const b of backings || []) {
  let bal = '?';
  try {
    if (b.burner_wallet) bal = ((await conn.getBalance(new PublicKey(b.burner_wallet))) / LAMPORTS_PER_SOL).toFixed(4);
  } catch {}
  console.log(`  slot ${b.slot_number}  ${b.status.padEnd(10)} ${b.amount_sol} SOL  buy_executed=${b.burner_buy_executed}  swept=${b.swept}`);
  console.log(`     burner ${b.burner_wallet}  on-chain=${bal} SOL`);

  // Check if burner holds any of the launched token
  if (b.burner_wallet) {
    try {
      const taccts = await conn.getParsedTokenAccountsByOwner(new PublicKey(b.burner_wallet), { mint: new PublicKey(MINT) });
      const amt = taccts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
      console.log(`     token balance: ${amt} $${meme.symbol}`);
    } catch (e) {
      console.log(`     token balance: (none / error)`);
    }
  }
}
