import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { createServerClient } from '@/lib/supabase';

// Full creator track record for a wallet. There is NO single Solana API
// that gives "all tokens this wallet created" because pump.fun strips
// Metaplex creator/authority info from its launches for trust/immutability.
// So we combine THREE on-chain/off-chain sources for maximum honest coverage:
//
//   1. Proof Launch launches (from our DB — has full status + launched_at)
//   2. PumpSwap pools where creator = wallet (graduated pump.fun tokens,
//      mint extracted directly from pool account data + Metaplex symbol)
//   3. Pump.fun BC accounts where creator = wallet (pre-graduation count
//      only — BC accounts don't store the mint, only as PDA seed)
//   4. Helius DAS getAssetsByCreator (catches non-pump.fun tokens with
//      proper Metaplex creator tags — Raydium direct, Bonk Stage, etc.)
//
// Cached server-side 60s so popular meme pages don't re-hit DAS+RPC on
// every view, but transient RPC flakes don't pin empty results for long.

export const revalidate = 60;

const PUMP_BC = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMPSWAP_AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const METAPLEX_METADATA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const LAUNCH_LAB = new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');

// PumpSwap Pool layout: 8 disc + 1 bump + 2 index + 32 creator + 32 base_mint
const PUMPSWAP_CREATOR_OFFSET = 11;
const PUMPSWAP_BASE_MINT_OFFSET = 43;
// pump.fun BC layout: 8 disc + 5*8 reserves + 1 complete + 32 creator
const PUMP_BC_CREATOR_OFFSET = 49;
// Launch Lab pool state layout: mint at offset 205, creator at offset 333.
// (Empirically verified on mainnet — see /api/creator/[wallet]/launches comment.)
const LAUNCH_LAB_MINT_OFFSET = 205;
const LAUNCH_LAB_CREATOR_OFFSET = 333;
const LAUNCH_LAB_ACCOUNT_SIZE = 429;

interface ProofLaunchEntry {
  id: string;
  symbol: string;
  name: string;
  status: string;
  mint_address: string | null;
  launched_at: string | null;
  created_at: string;
  source: 'proof_launch';
}

interface PumpfunGraduatedEntry {
  mint: string;
  symbol: string | null;
  name: string | null;
  source: 'pumpfun_graduated';
}

interface LaunchLabEntry {
  mint: string;
  symbol: string | null;
  name: string | null;
  source: 'launch_lab';
}

interface ExternalEntry {
  mint: string;
  symbol: string | null;
  name: string | null;
  burnt: boolean;
  source: 'external';
}

interface CreatorLaunchesResponse {
  wallet: string;
  proof_launch: ProofLaunchEntry[];
  pumpfun_graduated: PumpfunGraduatedEntry[];
  pumpfun_pregrad_count: number;
  launch_lab: LaunchLabEntry[];
  external: ExternalEntry[];
  totals: {
    proof_launch: number;
    pumpfun_graduated: number;
    pumpfun_pregrad_count: number;
    launch_lab: number;
    external: number;
    grand_total: number;
  };
  fetched_at: string;
}

function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METAPLEX_METADATA.toBuffer(), mint.toBuffer()],
    METAPLEX_METADATA,
  )[0];
}

function parseMetaplexMetadata(data: Buffer): { name: string | null; symbol: string | null } {
  try {
    let cursor = 1 + 32 + 32;
    const nameLen = data.readUInt32LE(cursor);
    cursor += 4;
    const name = data.slice(cursor, cursor + nameLen).toString('utf8').replace(/\0+$/, '').trim();
    cursor += nameLen;
    const symbolLen = data.readUInt32LE(cursor);
    cursor += 4;
    const symbol = data.slice(cursor, cursor + symbolLen).toString('utf8').replace(/\0+$/, '').trim();
    return { name: name || null, symbol: symbol || null };
  } catch {
    return { name: null, symbol: null };
  }
}

async function fetchDasAssetsByCreator(rpcUrl: string, wallet: string) {
  const items: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 5; page++) {
    try {
      const body = {
        jsonrpc: '2.0',
        id: `tr-${page}`,
        method: 'getAssetsByCreator',
        params: { creatorAddress: wallet, onlyVerified: false, page, limit: 1000 },
      };
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) break;
      const j = await r.json();
      const pageItems = (j?.result?.items as Array<Record<string, unknown>>) || [];
      items.push(...pageItems);
      if (pageItems.length < 1000) break;
    } catch { break; }
  }
  return items;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ wallet: string }> },
) {
  const { wallet } = await params;
  if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 });

  let walletPk: PublicKey;
  try { walletPk = new PublicKey(wallet); }
  catch { return NextResponse.json({ error: 'invalid wallet' }, { status: 400 }); }
  void walletPk; // validation only

  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: 'RPC not configured' }, { status: 500 });
  const conn = new Connection(rpcUrl, 'confirmed');
  const supabase = createServerClient();

  // ── PL DB ─────────────────────────────────────────────────────────
  const { data: plMemes } = await supabase
    .from('memes')
    .select('id, symbol, name, status, mint_address, launched_at, created_at')
    .eq('creator_wallet', wallet)
    .order('created_at', { ascending: false });
  const proofLaunch: ProofLaunchEntry[] = (plMemes || []).map(m => ({
    id: m.id, symbol: m.symbol, name: m.name, status: m.status,
    mint_address: m.mint_address, launched_at: m.launched_at,
    created_at: m.created_at, source: 'proof_launch',
  }));
  const plMints = new Set(proofLaunch.map(p => p.mint_address).filter(Boolean) as string[]);

  // ── PumpSwap pools (graduated pump.fun tokens) — parallel with DAS ─
  const pumpSwapPromise = conn.getProgramAccounts(PUMPSWAP_AMM, {
    commitment: 'confirmed',
    filters: [{ memcmp: { offset: PUMPSWAP_CREATOR_OFFSET, bytes: wallet } }],
  }).catch(() => []);

  // ── Pump.fun BC count (pre-grad, count-only since BC doesn't store mint) ─
  const pumpBcPromise = conn.getProgramAccounts(PUMP_BC, {
    commitment: 'confirmed',
    filters: [{ memcmp: { offset: PUMP_BC_CREATOR_OFFSET, bytes: wallet } }],
    dataSlice: { offset: 0, length: 0 },
  }).catch(() => []);

  // ── Launch Lab state accounts (Raydium's launchpad) ─────────────────
  // Use raw fetch instead of web3.js — web3.js's getProgramAccounts wraps
  // params in a way that produced wrong results when combined with memcmp;
  // raw JSON-RPC matches the request shape that works in curl testing.
  // The Helius gPA endpoint flakes occasionally — one retry on transient
  // failure (HTTP error or RPC error) significantly reduces the chance a
  // creator's Launch Lab section drops in/out between page loads.
  const launchLabPromise: Promise<Array<{ pubkey: string; data: Buffer }>> = (async () => {
    const attempt = async (): Promise<{ ok: true; accts: Array<{ pubkey: string; data: Buffer }> } | { ok: false; transient: boolean }> => {
      try {
        const r = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'll',
            method: 'getProgramAccounts',
            params: [
              LAUNCH_LAB.toBase58(),
              {
                encoding: 'base64',
                filters: [{ memcmp: { offset: LAUNCH_LAB_CREATOR_OFFSET, bytes: wallet } }],
              },
            ],
          }),
        });
        if (!r.ok) return { ok: false, transient: true };
        const j = await r.json();
        if (j?.error) {
          console.warn('Launch Lab RPC error:', j.error.message);
          return { ok: false, transient: true };
        }
        const accts = (j?.result as Array<{ pubkey: string; account: { data: [string, string] } }>) || [];
        return {
          ok: true,
          accts: accts.map(a => ({
            pubkey: a.pubkey,
            data: Buffer.from(a.account.data[0], 'base64'),
          })),
        };
      } catch (e) {
        console.warn('Launch Lab raw query failed:', e instanceof Error ? e.message : e);
        return { ok: false, transient: true };
      }
    };

    const first = await attempt();
    if (first.ok) return first.accts;
    if (first.transient) {
      await new Promise(r => setTimeout(r, 400));
      const second = await attempt();
      if (second.ok) return second.accts;
    }
    return [];
  })();

  // ── Helius DAS for everything else (Raydium-direct, Bonk, etc.) ────
  const dasPromise = fetchDasAssetsByCreator(rpcUrl, wallet);

  const [pools, bcs, launchLabAccts, dasItems] = await Promise.all([
    pumpSwapPromise, pumpBcPromise, launchLabPromise, dasPromise,
  ]);

  // PumpSwap pool extraction
  const poolMints: { mint: string }[] = [];
  for (const p of pools) {
    const data = p.account.data;
    if (data.length < PUMPSWAP_BASE_MINT_OFFSET + 32) continue;
    const mint = new PublicKey(data.subarray(PUMPSWAP_BASE_MINT_OFFSET, PUMPSWAP_BASE_MINT_OFFSET + 32));
    poolMints.push({ mint: mint.toBase58() });
  }
  // Fetch metadata in parallel for each pool mint (skip if already PL)
  const pumpfunGraduated: PumpfunGraduatedEntry[] = await Promise.all(
    poolMints
      .filter(p => !plMints.has(p.mint))
      .map(async ({ mint }) => {
        try {
          const info = await conn.getAccountInfo(metadataPda(new PublicKey(mint)));
          const md = info ? parseMetaplexMetadata(info.data) : { name: null, symbol: null };
          return { mint, symbol: md.symbol, name: md.name, source: 'pumpfun_graduated' as const };
        } catch {
          return { mint, symbol: null, name: null, source: 'pumpfun_graduated' as const };
        }
      }),
  );

  // Pre-grad count = total BCs minus graduated (those have both BC + pool)
  const pregradCount = Math.max(0, bcs.length - pools.length);

  // Launch Lab extraction (new shape: { pubkey, data: Buffer })
  const launchLab: LaunchLabEntry[] = await Promise.all(
    launchLabAccts
      .map(a => {
        const data = a.data;
        if (data.length < LAUNCH_LAB_MINT_OFFSET + 32) return null;
        const mint = new PublicKey(data.subarray(LAUNCH_LAB_MINT_OFFSET, LAUNCH_LAB_MINT_OFFSET + 32)).toBase58();
        return mint;
      })
      .filter((m): m is string => m !== null && !plMints.has(m))
      .map(async (mint) => {
        try {
          const info = await conn.getAccountInfo(metadataPda(new PublicKey(mint)));
          const md = info ? parseMetaplexMetadata(info.data) : { name: null, symbol: null };
          return { mint, symbol: md.symbol, name: md.name, source: 'launch_lab' as const };
        } catch {
          return { mint, symbol: null, name: null, source: 'launch_lab' as const };
        }
      }),
  );

  // DAS external — filter to fungibles, dedupe against everything we already found
  const allKnownMints = new Set<string>([
    ...plMints,
    ...pumpfunGraduated.map(p => p.mint),
    ...launchLab.map(p => p.mint),
  ]);
  const external: ExternalEntry[] = [];
  for (const a of dasItems) {
    const iface = a.interface as string;
    if (iface !== 'FungibleToken' && iface !== 'FungibleAsset') continue;
    const mint = a.id as string;
    if (!mint || allKnownMints.has(mint)) continue;
    const content = (a.content as Record<string, unknown> | undefined) || {};
    const metadata = (content.metadata as Record<string, unknown> | undefined) || {};
    external.push({
      mint,
      symbol: (metadata.symbol as string) || null,
      name: (metadata.name as string) || null,
      burnt: Boolean(a.burnt),
      source: 'external',
    });
  }

  const resp: CreatorLaunchesResponse = {
    wallet,
    proof_launch: proofLaunch,
    pumpfun_graduated: pumpfunGraduated,
    pumpfun_pregrad_count: pregradCount,
    launch_lab: launchLab,
    external,
    totals: {
      proof_launch: proofLaunch.length,
      pumpfun_graduated: pumpfunGraduated.length,
      pumpfun_pregrad_count: pregradCount,
      launch_lab: launchLab.length,
      external: external.length,
      grand_total: proofLaunch.length + pumpfunGraduated.length + launchLab.length + external.length + pregradCount,
    },
    fetched_at: new Date().toISOString(),
  };

  return NextResponse.json(resp, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
