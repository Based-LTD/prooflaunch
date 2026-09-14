#!/usr/bin/env node
// RHC holder airdrop — the SOL snapshot-airdrop bot ported to Robinhood Chain.
//
// Model (same as SOL): the campaign creator points a vault leg at the platform
// airdrop operator wallet. This tool, run by the operator:
//   1. claims that leg's accrued fees from the campaign's FeeSplitter
//      (WETH + the launched token), unwraps WETH to ETH
//   2. snapshots the token's holders at the current block by replaying
//      Transfer logs from the token's creation block
//   3. distributes ETH + tokens pro-rata to holders (system addresses
//      excluded), skipping dust shares below MIN_SHARE_BPS
//
// This leg is PLATFORM-OPERATED, not trustless — the UI says so. The
// trustless holder reward remains the 🔥 burn leg (supply reduction is
// pro-rata by construction, no snapshot authority needed).
//
// Usage:
//   node tools/rhc-holder-airdrop.mjs --campaign 0x...            # dry run
//   node tools/rhc-holder-airdrop.mjs --campaign 0x... --execute  # send
//   node tools/rhc-holder-airdrop.mjs --token 0x...               # snapshot only
//
// Key: RHC_AIRDROP_PRIVATE_KEY env, else ~/.rhc-airdrop/key

import { createPublicClient, createWalletClient, http, formatEther, parseAbi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'node:fs';
import os from 'node:os';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN = { id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const V3_FACTORY = '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA';
const POOL_FEE = 10000;
const PONS_LOCKER = '0x10F2756e373bAb14999fdC9177587D51D30a1Cf5';
const PONS_FACTORY = '0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75'; // fee-crumb holder, never a real backer
const DEAD = '0x000000000000000000000000000000000000dEaD';
const MIN_SHARE_BPS = 1n;      // skip holders under 0.01% — dust costs more than it pays (the SOL ATA-rent lesson)
const GAS_RESERVE = 10n ** 15n; // 0.001 ETH kept for the operator's own gas

const campaignAbi = parseAbi([
  'function launched() view returns (bool)',
  'function token() view returns (address)',
  'function feeSplitter() view returns (address)',
]);
const splitterAbi = parseAbi([
  'function claimLeg(address asset)',
  'function distribute(address asset)',
  'function legOwed(address leg, address asset) view returns (uint256)',
  'function accounted(address asset) view returns (uint256)',
  'function legCount() view returns (uint256)',
  'function legRecipients(uint256 i) view returns (address)',
  'function legBps(uint256 i) view returns (uint16)',
]);
const erc20Abi = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function symbol() view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const wethAbi = parseAbi(['function withdraw(uint256 wad)']);
const v3FactoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)']);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const EXECUTE = process.argv.includes('--execute');

function loadAccount() {
  let pk = process.env.RHC_AIRDROP_PRIVATE_KEY;
  const keyPath = os.homedir() + '/.rhc-airdrop/key';
  if (!pk && fs.existsSync(keyPath)) pk = fs.readFileSync(keyPath, 'utf8').trim();
  if (!pk) { console.error('No key: set RHC_AIRDROP_PRIVATE_KEY or create ~/.rhc-airdrop/key'); process.exit(1); }
  return privateKeyToAccount(pk);
}

const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });

// Replay Transfer logs → balance map at head. The RHC RPC answers a single
// address-filtered getLogs over the WHOLE chain in one call; chunking is
// only a fallback. DANGER learned the hard way: this RPC also silently
// returns [] for some bad ranges and prunes historical state (getCode
// binary-search converges near head — don't use it), so the ONLY trusted
// signal is the reconciliation below: replayed balances must sum exactly
// to totalSupply or we refuse to distribute.
async function snapshotHolders(token, latest) {
  const apply = (balances, logs) => {
    for (const l of logs) {
      const { from: f, to: t, value } = l.args;
      if (value === 0n) continue;
      if (f !== '0x0000000000000000000000000000000000000000')
        balances.set(f, (balances.get(f) ?? 0n) - value);
      else balances.genesisTo ??= t; // pons mints the curve supply here
      balances.set(t, (balances.get(t) ?? 0n) + value);
    }
  };
  const balances = new Map();
  try {
    apply(balances, await pub.getLogs({ address: token, event: erc20Abi[4], fromBlock: 0n, toBlock: latest }));
  } catch {
    balances.clear();
    const chunk = 500_000n;
    for (let from = 0n; from <= latest; from += chunk) {
      const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;
      apply(balances, await pub.getLogs({ address: token, event: erc20Abi[4], fromBlock: from, toBlock: to }));
    }
  }
  let sum = 0n;
  for (const v of balances.values()) sum += v;
  const supply = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' });
  if (sum !== supply) {
    console.error(`SNAPSHOT INTEGRITY FAILURE: replayed balances sum ${sum} != totalSupply ${supply}. Refusing to distribute.`);
    process.exit(1);
  }
  for (const [a, v] of balances) if (v <= 0n) balances.delete(a);
  return balances;
}

async function main() {
  const account = loadAccount();
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });
  console.log(`operator: ${account.address}  (${EXECUTE ? 'EXECUTE' : 'dry run'})`);

  const campaignAddr = arg('campaign');
  let token = arg('token');
  let splitter;
  const excluded = new Set([DEAD.toLowerCase(), account.address.toLowerCase(), PONS_LOCKER.toLowerCase(), PONS_FACTORY.toLowerCase()]);

  if (campaignAddr) {
    const c = { address: getAddress(campaignAddr), abi: campaignAbi };
    const [launched, t, s] = await Promise.all([
      pub.readContract({ ...c, functionName: 'launched' }),
      pub.readContract({ ...c, functionName: 'token' }),
      pub.readContract({ ...c, functionName: 'feeSplitter' }),
    ]);
    if (!launched) { console.error('campaign has not launched'); process.exit(1); }
    token = t; splitter = s;
    excluded.add(campaignAddr.toLowerCase());
    excluded.add(splitter.toLowerCase());

    // exclude every splitter leg (burn/LP legs, platform, rewards, vaults)
    const legCount = await pub.readContract({ address: splitter, abi: splitterAbi, functionName: 'legCount' });
    let operatorIsLeg = false;
    for (let i = 0n; i < legCount; i++) {
      const leg = await pub.readContract({ address: splitter, abi: splitterAbi, functionName: 'legRecipients', args: [i] });
      excluded.add(leg.toLowerCase());
      if (leg.toLowerCase() === account.address.toLowerCase()) operatorIsLeg = true;
    }
    if (!operatorIsLeg) console.log('⚠ operator is NOT a leg on this splitter — nothing to claim, snapshot/distribute existing balance only');

    // 1. claim our leg (both assets); NothingToClaim reverts are fine
    for (const asset of [WETH, token]) {
      try {
        const { request } = await pub.simulateContract({ account, address: splitter, abi: splitterAbi, functionName: 'claimLeg', args: [asset] });
        if (EXECUTE) {
          const h = await wallet.writeContract(request);
          await pub.waitForTransactionReceipt({ hash: h });
          console.log(`claimed leg ${asset === WETH ? 'WETH' : 'TOKEN'}: ${h}`);
        } else {
          const owed = await pub.readContract({ address: splitter, abi: splitterAbi, functionName: 'legOwed', args: [account.address, asset] });
          console.log(`claimable ${asset === WETH ? 'WETH' : 'TOKEN'} (pre-distribute floor): ${formatEther(owed)}`);
        }
      } catch { console.log(`nothing to claim: ${asset === WETH ? 'WETH' : 'TOKEN'}`); }
    }
  }
  if (!token) { console.error('need --campaign or --token'); process.exit(1); }
  token = getAddress(token);
  excluded.add(token.toLowerCase());

  const pool = await pub.readContract({ address: V3_FACTORY, abi: v3FactoryAbi, functionName: 'getPool', args: [token, WETH, POOL_FEE] });
  if (pool !== '0x0000000000000000000000000000000000000000') excluded.add(pool.toLowerCase());

  // 2. unwrap any WETH we hold
  const wethBal = await pub.readContract({ address: WETH, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  if (wethBal > 0n && EXECUTE) {
    const h = await wallet.writeContract({ address: WETH, abi: wethAbi, functionName: 'withdraw', args: [wethBal] });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`unwrapped ${formatEther(wethBal)} WETH: ${h}`);
  } else if (wethBal > 0n) console.log(`would unwrap ${formatEther(wethBal)} WETH`);

  // 3. snapshot holders (replay reconciles to totalSupply or aborts)
  const latest = await pub.getBlockNumber();
  console.log(`snapshotting ${token} @ block ${latest}…`);
  const balances = await snapshotHolders(token, latest);
  if (balances.genesisTo) excluded.add(balances.genesisTo.toLowerCase()); // pons curve vault
  let supply = 0n;
  const holders = [];
  for (const [a] of balances) {
    if (excluded.has(a.toLowerCase())) continue;
    // amounts from live balanceOf, enumeration from logs — guards against
    // any nonstandard transfer mechanics in pons tokens
    const v = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
    if (v === 0n) continue;
    holders.push([a, v]); supply += v;
  }
  holders.sort((x, y) => (y[1] > x[1] ? 1 : -1));
  console.log(`${holders.length} eligible holders, circulating (ex-system) supply ${formatEther(supply)}`);
  if (holders.length === 0 || supply === 0n) { console.log('no eligible holders — done'); return; }

  // 4. pro-rata distribution
  const ethBal = await pub.getBalance({ address: account.address });
  const ethPot = ethBal > GAS_RESERVE ? ethBal - GAS_RESERVE : 0n;
  const tokPot = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  console.log(`pots — ETH: ${formatEther(ethPot)}  TOKEN: ${formatEther(tokPot)}`);

  let sentEth = 0n, sentTok = 0n, paid = 0, skipped = 0;
  for (const [holder, bal] of holders) {
    const shareBps = (bal * 10_000n) / supply;
    if (shareBps < MIN_SHARE_BPS) { skipped++; continue; }
    const ethAmt = (ethPot * bal) / supply;
    const tokAmt = (tokPot * bal) / supply;
    if (ethAmt === 0n && tokAmt === 0n) { skipped++; continue; }
    if (EXECUTE) {
      if (ethAmt > 0n) {
        const h = await wallet.sendTransaction({ to: holder, value: ethAmt });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      if (tokAmt > 0n) {
        const h = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [holder, tokAmt] });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      console.log(`paid ${holder}  ${formatEther(ethAmt)} ETH + ${formatEther(tokAmt)} TOKEN (${Number(shareBps) / 100}%)`);
    } else {
      console.log(`would pay ${holder}  ${formatEther(ethAmt)} ETH + ${formatEther(tokAmt)} TOKEN (${Number(shareBps) / 100}%)`);
    }
    sentEth += ethAmt; sentTok += tokAmt; paid++;
  }
  console.log(`\n${EXECUTE ? 'DONE' : 'DRY RUN'}: ${paid} payouts (${skipped} dust-skipped) — ${formatEther(sentEth)} ETH, ${formatEther(sentTok)} TOKEN. Remainder carries to next round.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
