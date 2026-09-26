import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, http, parseAbi, parseAbiItem, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { rhcPublicClient, robinhoodChain, POOLLAUNCH_FACTORY_V7, POOLLAUNCH_FACTORY_V8, PROOF_BURNER, PROOF_BURNER_LIVE, V8_LIVE } from '@/lib/rhc';

// pons V2 FeeEscrow: where creator tax waits until a campaign harvests it.
const PONS_FEE_ESCROW = '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e' as const;

// The keeper. Every permissionless step in the fee flywheel — harvest a
// campaign's tax out of pons's escrow, crank a burn leg, pull the burner's
// leg, crank the burner — is a public button on an ownerless contract.
// Launch night (2026-09-25) 0.35 ETH sat waiting for hours because the
// only one pressing buttons was a person. This presses them on a timer.
//
// It owns nothing and can change nothing: it only calls functions anyone
// may call, from a gas-only wallet. Anyone else may still press first.
//
//   GET  /api/rhc/keeper            → read-only report of what it WOULD do
//   GET  + Vercel cron / Bearer CRON_SECRET → does it
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ZERO = '0x0000000000000000000000000000000000000000' as const;
const HARVEST_MIN = 3_000_000_000_000_000n;   // 0.003 ETH at pons before we harvest
const LEG_CRANK_MIN = 3_000_000_000_000_000n; // 0.003 ETH owed before we crank a burn leg
const PULL_MIN = 1_000_000_000_000_000n;      // 0.001 ETH owed to the burner before we pull
const BURNER_MIN = 5_000_000_000_000_000n;    // the burner's own MIN_CRANK_ETH

const created = parseAbiItem('event CampaignCreated(address indexed campaign, address indexed creator, address feeSplitter, uint256 goal, uint256 deadline, string symbol)');
const abi = parseAbi([
  'function launched() view returns (bool)',
  'function feeSplitter() view returns (address)',
  'function pokeHarvest()',
  'function balanceOf(address) view returns (uint256)',
  'function legCount() view returns (uint256)',
  'function legRecipients(uint256) view returns (address)',
  'function legOwed(address,address) view returns (uint256)',
  'function totalTokensBurned() view returns (uint256)',
  'function totalLiquidityAdds() view returns (uint256)',
  'function crank()',
  'function pull(address)',
  'function pendingEth() view returns (uint256)',
]);

type Action = { kind: 'harvest' | 'crankLeg' | 'pull' | 'crankBurner'; campaign?: string; target: string; eth: string; tx?: string; error?: string };

// Campaigns change rarely; enumerate once per ten minutes per instance.
let campaignCache: { at: number; list: { campaign: `0x${string}`; symbol: string }[] } | null = null;
async function campaigns() {
  if (campaignCache && Date.now() - campaignCache.at < 600_000) return campaignCache.list;
  const factories = [...(V8_LIVE ? [POOLLAUNCH_FACTORY_V8] : []), POOLLAUNCH_FACTORY_V7];
  const list: { campaign: `0x${string}`; symbol: string }[] = [];
  for (const f of factories) {
    const logs = await rhcPublicClient.getLogs({ address: f, event: created, fromBlock: 0n, toBlock: 'latest' }).catch(() => []);
    for (const l of logs) if (l.args.campaign) list.push({ campaign: l.args.campaign, symbol: l.args.symbol ?? '?' });
  }
  campaignCache = { at: Date.now(), list };
  return list;
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;
  if (req.headers.get('x-vercel-cron') && secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  const execute = authorized(req);
  const key = process.env.RHC_KEEPER_PRIVATE_KEY;
  const canSign = execute && !!key;
  const account = canSign ? privateKeyToAccount(key as `0x${string}`) : null;
  const wallet = account ? createWalletClient({ account, chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0]) }) : null;

  const actions: Action[] = [];
  const send = async (a: Action, fn: () => Promise<`0x${string}`>) => {
    actions.push(a);
    if (!wallet) return;
    try {
      const hash = await fn();
      const r = await rhcPublicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
      a.tx = hash; if (r.status !== 'success') a.error = 'reverted';
    } catch (e) { a.error = (e as Error).message.split('\n')[0].slice(0, 120); }
  };
  const write = (address: `0x${string}`, functionName: 'pokeHarvest' | 'crank' | 'pull', args?: readonly [`0x${string}`]) =>
    wallet!.writeContract({ address, abi, functionName, args: args as never, type: 'legacy', gas: 900_000n });

  try {
    const list = await campaigns();
    for (const { campaign, symbol } of list) {
      const launched = await rhcPublicClient.readContract({ address: campaign, abi, functionName: 'launched' }).catch(() => false);
      if (!launched) continue;
      const splitter = await rhcPublicClient.readContract({ address: campaign, abi, functionName: 'feeSplitter' }).catch(() => null);
      if (!splitter) continue;

      // 1. tax waiting at pons → the splitter
      const atPons = await rhcPublicClient.readContract({ address: PONS_FEE_ESCROW, abi, functionName: 'balanceOf', args: [splitter] }).catch(() => 0n);
      if (atPons >= HARVEST_MIN) await send({ kind: 'harvest', campaign: symbol, target: campaign, eth: formatEther(atPons) }, () => write(campaign, 'pokeHarvest'));

      // 2. every leg that is a contract with a crank, or the burner
      const n = Number(await rhcPublicClient.readContract({ address: splitter, abi, functionName: 'legCount' }).catch(() => 0n));
      for (let i = 0; i < n; i++) {
        const leg = await rhcPublicClient.readContract({ address: splitter, abi, functionName: 'legRecipients', args: [BigInt(i)] }).catch(() => null);
        if (!leg) continue;
        const owed = await rhcPublicClient.readContract({ address: splitter, abi, functionName: 'legOwed', args: [leg, ZERO] }).catch(() => 0n);
        if (PROOF_BURNER_LIVE && leg.toLowerCase() === PROOF_BURNER.toLowerCase()) {
          if (owed >= PULL_MIN) await send({ kind: 'pull', campaign: symbol, target: splitter, eth: formatEther(owed) }, () => write(PROOF_BURNER, 'pull', [splitter]));
          continue;
        }
        if (owed < LEG_CRANK_MIN) continue;
        const isBot = await rhcPublicClient.readContract({ address: leg, abi, functionName: 'totalTokensBurned' }).then(() => true).catch(() =>
          rhcPublicClient.readContract({ address: leg, abi, functionName: 'totalLiquidityAdds' }).then(() => true).catch(() => false));
        if (isBot) await send({ kind: 'crankLeg', campaign: symbol, target: leg, eth: formatEther(owed) }, () => write(leg, 'crank'));
      }
    }

    // 3. the burner itself
    if (PROOF_BURNER_LIVE) {
      const pending = await rhcPublicClient.readContract({ address: PROOF_BURNER, abi, functionName: 'pendingEth' }).catch(() => 0n);
      if (pending >= BURNER_MIN) await send({ kind: 'crankBurner', target: PROOF_BURNER, eth: formatEther(pending) }, () => write(PROOF_BURNER, 'crank'));
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 200), actions }, { status: 500 });
  }

  const mode = canSign ? 'executed' : execute ? 'no key: dry-run' : 'dry-run';
  if (actions.length) console.log(`[keeper] ${mode}:`, JSON.stringify(actions));
  return NextResponse.json({ ok: true, mode, keeper: account?.address ?? null, actions, at: new Date().toISOString() });
}
