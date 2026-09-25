// One-off: bind the banner + GitHub link for the live $PLAUNCH campaign.
// The create page uploads the banner BEFORE the create tx, so the file is
// already in storage; only the rhc_campaign_media row is missing (a stale
// cached bundle meant the pre-tx signature never ran). Writes the row with
// set_by = the on-chain creator, which is what the read path checks.
//
//   node tools/_bind-plaunch-media.mjs                 # list recent banners
//   node tools/_bind-plaunch-media.mjs <bannerUrl> [githubUrl]
import { createClient } from '@supabase/supabase-js';
import { createPublicClient, http, parseAbi } from 'viem';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const CAMPAIGN = '0xc2C9F89553DF78DCd830f6254717460247575eeD';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const chain = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com') });

const creator = await chain.readContract({
  address: CAMPAIGN,
  abi: parseAbi(['function creator() view returns (address)']),
  functionName: 'creator',
});

const [, , bannerUrl, github] = process.argv;

if (!bannerUrl) {
  const { data, error } = await db.storage.from('token-assets').list('banners', {
    limit: 12, sortBy: { column: 'created_at', order: 'desc' },
  });
  if (error) throw error;
  console.log('campaign', CAMPAIGN, '\ncreator ', creator, '\n\nmost recent banners:');
  for (const f of data ?? []) {
    console.log(' ', (f.created_at ?? '').slice(0, 19), String(f.metadata?.size ?? '?').padStart(8), 'bytes',
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/token-assets/banners/${f.name}`);
  }
  console.log('\nre-run with the right URL:  node tools/_bind-plaunch-media.mjs <url> [github]');
  process.exit(0);
}

const row = {
  campaign: CAMPAIGN.toLowerCase(),
  set_by: creator.toLowerCase(),
  banner_url: bannerUrl,
  updated_at: new Date().toISOString(),
  ...(github ? { github } : {}),
};
const { error } = await db.from('rhc_campaign_media').upsert(row, { onConflict: 'campaign' });
if (error) throw error;
console.log('bound:', JSON.stringify(row, null, 2));
