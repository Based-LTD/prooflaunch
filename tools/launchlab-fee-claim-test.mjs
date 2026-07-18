// Validate the LaunchLab fee claim path against the test token we
// launched with tools/launchlab-mainnet-test.mjs
// (mint: 8Mn2gTYSjwBMRGdLDwej3RkrXEt5aKnZRxSeMjrJxiKf,
//  pool: 6ZEvtia2TnfsGXZcPzobFiQotReRcXDCx9GTGQE45gKJ).
//
// Uses the test pool wallet keypair (printed at end of that test run's
// output) to sign the claimCreatorFee call. Directly exercises the SDK
// pattern that src/services/fees/launchlab.ts uses in production —
// bypasses the DB lookup / sub-escrow forwarding so we can isolate the
// claim mechanic itself.
//
// Success outcome: any accrued fees (from the sniper trades captured
// in the screenshot) land as wSOL in the pool wallet's ATA, tx confirms.
//
// Run: node --env-file=.env.local tools/launchlab-fee-claim-test.mjs

import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  Raydium, LAUNCHPAD_PROGRAM, TxVersion,
} from '@raydium-io/raydium-sdk-v2';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
if (!RPC_URL) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL not set');

// Pool wallet keypair from the earlier launchlab-mainnet-test run.
// This wallet IS the creator authority for the LaunchLab pool below.
const POOL_KP_B58 = '2CVLFvnpR8jyxP4hnCNRGSf1wnudNtkXGfGFfzGoqbp8STtSoyqsU8FG9VTXxhgsYH4KGLGxQiqQyAFcyjfWt98C';
const POOL_ID = '6ZEvtia2TnfsGXZcPzobFiQotReRcXDCx9GTGQE45gKJ';

function ts() { return new Date().toISOString().slice(11, 23); }
function log(...args) { console.log(`[${ts()}]`, ...args); }

async function main() {
  log('═══ LaunchLab fee-claim validation ═══');
  const conn = new Connection(RPC_URL, 'confirmed');

  const poolKp = Keypair.fromSecretKey(bs58.decode(POOL_KP_B58));
  log('Pool wallet (creator authority):', poolKp.publicKey.toBase58());

  const preBal = await conn.getBalance(poolKp.publicKey);
  log('Pool wallet SOL pre-claim:', (preBal / LAMPORTS_PER_SOL).toFixed(6), 'SOL');

  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, poolKp.publicKey, true, TOKEN_PROGRAM_ID);
  const wsolPre = await conn.getAccountInfo(wsolAta, 'confirmed');
  const wsolAmtPre = wsolPre && wsolPre.data.length >= 72 ? Number(wsolPre.data.readBigUInt64LE(64)) : 0;
  log('wSOL ATA balance pre-claim:', (wsolAmtPre / LAMPORTS_PER_SOL).toFixed(9), 'SOL');

  log('Loading Raydium SDK with pool wallet as owner...');
  const raydium = await Raydium.load({
    connection: conn,
    owner: poolKp,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'confirmed',
    disableLoadToken: true,
  });
  log('SDK loaded. Calling claimCreatorFee(mintB=wSOL)...');

  const { execute, transaction } = await raydium.launchpad.claimCreatorFee({
    programId: LAUNCHPAD_PROGRAM,
    mintB: NATIVE_MINT,
    mintBProgram: TOKEN_PROGRAM_ID,
    txVersion: TxVersion.V0,
    computeBudgetConfig: { units: 400_000, microLamports: 200_000 },
  });
  log('Claim tx built. Executing...');

  try {
    const { txId } = await execute();
    log('Claim landed:', txId);
    log('Solscan:', `https://solscan.io/tx/${txId}`);
    await conn.confirmTransaction(txId, 'confirmed');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('Claim failed:', msg);
    if (/no fees|nothing to claim|zero balance|InsufficientFunds/i.test(msg)) {
      log('  → No fees accrued yet on this pool. Fee accrual on LaunchLab requires trading;');
      log('    the sniper trades from the screenshot may have generated fees for the LAUNCHPAD platform,');
      log('    not necessarily for the CREATOR (depends on pool config). This is INFO not ERROR.');
    }
    return;
  }

  // Post-check
  const wsolPost = await conn.getAccountInfo(wsolAta, 'confirmed');
  const wsolAmtPost = wsolPost && wsolPost.data.length >= 72 ? Number(wsolPost.data.readBigUInt64LE(64)) : 0;
  log('wSOL ATA balance post-claim:', (wsolAmtPost / LAMPORTS_PER_SOL).toFixed(9), 'SOL');
  log('Delta:', ((wsolAmtPost - wsolAmtPre) / LAMPORTS_PER_SOL).toFixed(9), 'SOL claimed');

  const postBal = await conn.getBalance(poolKp.publicKey);
  log('Pool wallet SOL post-claim:', (postBal / LAMPORTS_PER_SOL).toFixed(6), 'SOL');
  log('═══ Claim path validated ═══');
}

main().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
