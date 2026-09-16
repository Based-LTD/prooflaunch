#!/usr/bin/env node
// Cross-language proof for the 0x…5EED signature scheme.
//
// The browser grinder (src/lib/rhcVanity.ts) and the contract
// (CampaignDeployerV3's CREATE2) must derive byte-identical addresses.
// The fixture below comes from contracts/rhc/test/Vanity.t.sol, which
// grinds in Solidity and then asserts the campaign actually deploys to
// the predicted address. If either side ever drifts, this fails.
//
//   node tools/verify-vanity.mjs
//
// Regenerate the fixture with:
//   forge test --match-contract VanityTest -vv

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const OUT = '.vanity-check';
const FIXTURE = {
  deployer: '0x5B0091f49210e7B2A57B03dfE1AB9D08289d9294',
  initCodeHash: '0x92a85c3cd8ea51f3999121d0ce7af169a780d5971966c85fa4219539f5ff35b7',
  saltN: 35934,
  address: '0xDfb75be50bc5DF72dabb40870E408f843D485EeD',
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/package.json`, '{"type":"module"}');
execSync(
  `npx tsc src/lib/rhcVanity.ts --outDir ${OUT} --module es2022 --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: 'inherit' },
);

const { predictCreate2, grindVanitySalt, hasSignature, predictLegAddresses } = await import(`../${OUT}/rhcVanity.js`);

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const salt = '0x' + FIXTURE.saltN.toString(16).padStart(64, '0');
ok(
  predictCreate2(FIXTURE.deployer, salt, FIXTURE.initCodeHash).toLowerCase() === FIXTURE.address.toLowerCase(),
  'predictCreate2 matches the deployed Solidity address',
);

const g = grindVanitySalt({ deployer: FIXTURE.deployer, initCodeHash: FIXTURE.initCodeHash, startAt: 0, maxAttempts: 200_000 });
ok(g.found, 'grind finds a signature salt');
ok(g.attempts === FIXTURE.saltN + 1, `same enumeration as Solidity (${g.attempts} attempts)`);
ok(g.address.toLowerCase() === FIXTURE.address.toLowerCase(), 'ground address matches Solidity');

let worst = 0, total = 0;
for (let i = 0; i < 5; i++) {
  const r = grindVanitySalt({ deployer: FIXTURE.deployer, initCodeHash: FIXTURE.initCodeHash });
  if (!r.found || !hasSignature(r.address)) { ok(false, 'random-start grind failed'); break; }
  worst = Math.max(worst, r.ms); total += r.ms;
}
ok(worst > 0 && worst < 6000, `5 random-start grinds land the signature (avg ${Math.round(total / 5)}ms, worst ${worst}ms)`);

const impossible = grindVanitySalt({ deployer: FIXTURE.deployer, initCodeHash: FIXTURE.initCodeHash, suffix: 'deadbeefcafe', timeBudgetMs: 400 });
ok(!impossible.found && impossible.ms < 1500, `unreachable suffix gives up gracefully in ${impossible.ms}ms`);
ok(/^0x[0-9a-f]{40}$/i.test(impossible.address), 'still returns a usable salt when no signature is found');

// leg prediction is plain CREATE nonce math
const legs = predictLegAddresses('0x42a2495D9426fd5d88A01e724E62275DCe02dfF4', 7n, true, true);
ok(
  legs.burnLeg !== legs.lpLeg && /^0x[0-9a-fA-F]{40}$/.test(legs.burnLeg),
  'bot-leg nonce prediction returns two distinct addresses',
);

rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} check(s) failed` : '\nvanity scheme verified end to end');
process.exit(fail ? 1 : 0);
