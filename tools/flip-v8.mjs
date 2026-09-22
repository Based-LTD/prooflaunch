#!/usr/bin/env node
// Launch day, site half. Reads contracts/rhc/v8.addresses.json, checks the
// addresses against the chain (so a typo can never reach prod), sets the
// three Vercel production env values, and runs the usual prod deploy with
// them as build-env. One command; the UI is already built for it.
//
//   node tools/flip-v8.mjs            # verify + set env + deploy
//   node tools/flip-v8.mjs --check    # verify only
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createPublicClient, http, parseAbi } from 'viem';

const a = JSON.parse(readFileSync('contracts/rhc/v8.addresses.json', 'utf8'));
const c = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com') });
const fAbi = parseAbi(['function proofBurner() view returns (address)', 'function proofBurnBps() view returns (uint16)', 'function platformBps() view returns (uint16)', 'function campaignDeployer() view returns (address)']);
const bAbi = parseAbi(['function proofToken() view returns (address)', 'function initializer() view returns (address)']);

const [burner, burnBps, platBps, cdep, token, init] = await Promise.all([
  c.readContract({ address: a.factoryV8, abi: fAbi, functionName: 'proofBurner' }),
  c.readContract({ address: a.factoryV8, abi: fAbi, functionName: 'proofBurnBps' }),
  c.readContract({ address: a.factoryV8, abi: fAbi, functionName: 'platformBps' }),
  c.readContract({ address: a.factoryV8, abi: fAbi, functionName: 'campaignDeployer' }),
  c.readContract({ address: a.proofBurner, abi: bAbi, functionName: 'proofToken' }),
  c.readContract({ address: a.proofBurner, abi: bAbi, functionName: 'initializer' }),
]);
const eq = (x, y) => x.toLowerCase() === y.toLowerCase();
const checks = [
  ['factory.proofBurner == burner', eq(burner, a.proofBurner)],
  [`factory.proofBurnBps == ${a.proofBurnBps}`, Number(burnBps) === Number(a.proofBurnBps)],
  [`factory.platformBps == ${a.platformBps}`, Number(platBps) === Number(a.platformBps)],
  ['factory.campaignDeployer == satellite', eq(cdep, a.campaignDeployerV4)],
  ['burner.proofToken == $PROOF', eq(token, a.proofToken)],
  ['burner.initializer == 0 (init unreachable)', eq(init, '0x0000000000000000000000000000000000000000')],
];
let ok = true;
for (const [name, pass] of checks) { console.log(pass ? '  ✓' : '  ✗', name); ok &&= pass; }
if (!ok) { console.error('\nRefusing to flip: on-chain state does not match v8.addresses.json'); process.exit(1); }
console.log(`\n$PROOF token: ${token}\nburner:       ${a.proofBurner}\nfactory v8:   ${a.factoryV8}`);
if (process.argv.includes('--check')) process.exit(0);

const env = { NEXT_PUBLIC_V8_LIVE: '1', NEXT_PUBLIC_POOLLAUNCH_FACTORY_V8: a.factoryV8, NEXT_PUBLIC_PROOF_BURNER: a.proofBurner };
for (const [k, v] of Object.entries(env)) {
  try { execSync(`vercel env rm ${k} production --yes`, { stdio: 'ignore' }); } catch { /* not set yet */ }
  execSync(`printf '%s' "${v}" | vercel env add ${k} production`, { stdio: 'inherit', shell: '/bin/bash' });
}
const be = Object.entries({ NEXT_PUBLIC_V7_LIVE: '1', NEXT_PUBLIC_EQUITY_ROUTER_LIVE: '1', ...env }).map(([k, v]) => `--build-env ${k}=${v}`).join(' ');
console.log('\nDeploying prod with v8 on…');
execSync(`npx vercel --prod --yes ${be}`, { stdio: 'inherit' });
console.log('\nDone. Open prooflaunch.fun/rhc — the FLYWHEEL panel should show live counters.');
