// Find recently graduated pons pools (PoolManager Initialize events with the
// pons hook and native-ETH currency0), then ask Dexscreener about each token.
import { createPublicClient, http, parseAbiItem } from 'viem';

const c = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 20000, retryCount: 4, retryDelay: 1500 }) });
const PM = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const HOOK = '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044';
const ev = parseAbiItem('event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const head = await c.getBlockNumber();
const found = [];
let to = head;
const STEP = 150000n;
while (found.length < 6 && to > head - 1500000n) {
  const from = to - STEP;
  try {
    const logs = await c.getLogs({ address: PM, event: ev, fromBlock: from, toBlock: to });
    for (const l of logs.reverse()) {
      if (l.args.hooks.toLowerCase() === HOOK && l.args.currency0 === '0x0000000000000000000000000000000000000000') {
        found.push({ token: l.args.currency1, block: l.blockNumber });
        if (found.length >= 6) break;
      }
    }
  } catch (e) {
    console.log('  range', String(from), '-', String(to), 'err', (e.shortMessage || e.message).slice(0, 70));
  }
  to = from;
  await sleep(500);
}
console.log('graduated pons pools found (newest first):', found.length);
for (const f of found) {
  const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + f.token).then((x) => x.json()).catch(() => ({}));
  const pairs = (r.pairs || []).filter((p) => /robinhood/i.test(p.chainId));
  const tag = pairs.length ? `LISTED (${pairs[0].dexId}, ${pairs[0].baseToken.symbol}, vol24h $${Math.round(pairs[0].volume?.h24 || 0)})` : 'not listed';
  console.log('  ', f.token, 'block', String(f.block), '→ dexscreener:', tag);
  await sleep(300);
}
