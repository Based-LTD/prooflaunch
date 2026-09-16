#!/usr/bin/env node
// The frontend's hand-written ABIs must match the compiled contracts.
// A selector mismatch means every call reverts with no useful error, so
// this compares them directly against the forge artifacts.
//
//   node tools/verify-abi.mjs
import { readFileSync } from 'node:fs';
import { parseAbi, toFunctionSelector } from 'viem';

const artifact = (name, file) =>
  JSON.parse(readFileSync(`contracts/rhc/out/${file}.sol/${name}.json`, 'utf8')).abi;

// human-readable ABIs, copied from src/lib/rhc.ts
const factoryV5 = parseAbi([
  'function createCampaign((uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint16 creatorTaxBps, bool buybackEnabled, address quoteToken, address gateToken, uint256 gateMinBalance, uint16 reservedSeats, address[] allowlist, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta) p, uint16 burnBps, uint16 lpBps, address[] vaultRecipients, uint16[] vaultBps, bytes32 salt) payable returns (address)',
  'function previewInitCodeHash(address creator, (uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint16 creatorTaxBps, bool buybackEnabled, address quoteToken, address gateToken, uint256 gateMinBalance, uint16 reservedSeats, address[] allowlist, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta) p, uint16 burnBps, uint16 lpBps, address[] vaultRecipients, uint16[] vaultBps, address predictedBurnLeg, address predictedLpLeg) view returns (bytes32)',
  'function creationFeeFor(address creator) view returns (uint256)',
  'function campaignDeployer() view returns (address)',
  'function legDeployer() view returns (address)',
  'function campaignCount() view returns (uint256)',
]);
const campaignV3 = parseAbi([
  'function quoteToken() view returns (address)',
  'function gateToken() view returns (address)',
  'function reservedSeats() view returns (uint16)',
  'function seatBucket(address) view returns (uint8)',
  'function allowlisted(address) view returns (bool)',
  'function launchFeeEscrowed() view returns (uint256)',
  'function depositToken(uint256 amount)',
  'function refundLaunchFee()',
]);

let fail = 0;
function check(label, mine, compiled) {
  const real = new Set(
    compiled.filter((e) => e.type === 'function').map((e) => toFunctionSelector(e)),
  );
  for (const fn of mine.filter((e) => e.type === 'function')) {
    const sel = toFunctionSelector(fn);
    const ok = real.has(sel);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}.${fn.name} ${sel}`);
    if (!ok) fail++;
  }
}

check('CampaignFactoryV5', factoryV5, artifact('CampaignFactoryV5', 'CampaignFactoryV5'));
check('CampaignV3', campaignV3, artifact('CampaignV3', 'CampaignV3'));

console.log(fail ? `\n${fail} ABI mismatch(es) — the frontend would revert` : '\nfrontend ABIs match the compiled contracts');
process.exit(fail ? 1 : 0);
