// Real-mainnet validation of the Raydium LaunchLab createLaunchpad call
// our production launchlab.ts uses. Bypasses the Proof API auth flow
// (no /api/memes, no wallet signature) — directly funds a fresh keypair
// from PROOF_BUYBACK and calls createLaunchpad with the EXACT same
// params shape services/launch/launchlab.ts ships.
//
// Cost: ~0.1 SOL total. CREATE_RESERVE is 0.06; the buy spends the
// remainder; tx fees + ATA rent eat a few thousand lamports.
//
// Outcome on success: prints mint address, pool ID, tx signature, and
// the jup.ag link so we can verify the token trades.
//
// Outcome on failure: prints the exact error from the SDK so we can
// fix launchlab.ts before the first creator picks LaunchLab in the UI.

// Env loaded via `node --env-file=.env.local` (Node 20.6+ built-in).
import {
  Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  Raydium, LAUNCHPAD_PROGRAM, getPdaLaunchpadConfigId, TxVersion,
} from '@raydium-io/raydium-sdk-v2';
import { NATIVE_MINT } from '@solana/spl-token';
import { BN } from 'bn.js';
import bs58 from 'bs58';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
// Local .env.local PROOF_BUYBACK is stale (points to rotated wallet, 0 SOL).
// Vercel has the current reverted key, but for this local-only test we
// source from ESCROW which the local env knows about. ~0.1 SOL of escrow's
// ~0.22 SOL — leaves ~0.12 SOL headroom for the wallet's normal ops.
const FUNDER_KEY = process.env.ESCROW_WALLET_PRIVATE_KEY;
const FUND_LAMPORTS = 100_000_000; // 0.1 SOL

if (!RPC_URL) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL not set');
if (!FUNDER_KEY) throw new Error('ESCROW_WALLET_PRIVATE_KEY not set');

function ts() { return new Date().toISOString().slice(11, 23); }
function log(...args) { console.log(`[${ts()}]`, ...args); }

async function main() {
  log('═══ LaunchLab mainnet validation ═══');
  const conn = new Connection(RPC_URL, 'confirmed');
  // Vercel env-newline gotcha: keys can carry literal `\n` or trailing
  // whitespace from paste. Strip both before decoding.
  const cleanKey = FUNDER_KEY.replace(/\\n/g, '').trim();
  const funder = Keypair.fromSecretKey(bs58.decode(cleanKey));
  log('Funder:', funder.publicKey.toBase58());

  const funderBal = await conn.getBalance(funder.publicKey);
  log('Funder balance:', (funderBal / 1e9).toFixed(4), 'SOL');
  if (funderBal < FUND_LAMPORTS + 10_000) {
    throw new Error(`Funder too low: have ${funderBal}, need ${FUND_LAMPORTS + 10_000}`);
  }

  const testKp = Keypair.generate();
  const mintKp = Keypair.generate();
  log('Test pool wallet:', testKp.publicKey.toBase58());
  log('Test mint:', mintKp.publicKey.toBase58());

  // 1. Fund the test pool wallet
  log('Funding test pool wallet with', FUND_LAMPORTS, 'lamports...');
  const fundTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: testKp.publicKey,
      lamports: FUND_LAMPORTS,
    }),
  );
  const fundSig = await sendAndConfirmTransaction(conn, fundTx, [funder], { commitment: 'confirmed' });
  log('Funded:', fundSig);

  // Wait for balance propagation across RPC nodes
  await new Promise((r) => setTimeout(r, 3000));
  const testBal = await conn.getBalance(testKp.publicKey);
  log('Test wallet balance:', (testBal / 1e9).toFixed(4), 'SOL');

  // 2. Init Raydium SDK with the test wallet as owner
  log('Loading Raydium SDK...');
  const raydium = await Raydium.load({
    connection: conn,
    owner: testKp,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'confirmed',
    disableLoadToken: true,
  });
  log('Raydium SDK loaded.');

  // 3. Derive the canonical mainnet LaunchLab config
  const { publicKey: configId } = getPdaLaunchpadConfigId(
    LAUNCHPAD_PROGRAM, NATIVE_MINT, 0, 0,
  );
  log('Config ID:', configId.toBase58());

  // Spend: balance minus the 0.06 SOL reserve our launchlab.ts uses
  const CREATE_RESERVE = 60_000_000;
  const spend = testBal - CREATE_RESERVE;
  log('Reserve:', CREATE_RESERVE, '· first-buy amount:', spend, 'lamports');
  if (spend <= 0) throw new Error('Insufficient balance after reserve');

  const uri = `https://prooflaunch.fun/api/token-metadata/${mintKp.publicKey.toBase58()}`;
  log('Metadata URI (placeholder, not on-chain yet):', uri);

  // 4. Build the createLaunchpad call — mirrors services/launch/launchlab.ts EXACTLY
  log('Building createLaunchpad tx...');
  const { execute, extInfo } = await raydium.launchpad.createLaunchpad({
    programId: LAUNCHPAD_PROGRAM,
    mintA: mintKp.publicKey,
    decimals: 6,
    name: 'LaunchLab Test',
    symbol: 'LLTEST',
    uri,
    migrateType: 'cpmm',   // matches src/services/launch/launchlab.ts (creator-fee-NFT post-grad)
    configId,
    mintBDecimals: 9,
    txVersion: TxVersion.V0,
    slippage: new BN(100),
    buyAmount: new BN(spend.toString()),
    createOnly: false,
    extraSigners: [mintKp],
    computeBudgetConfig: { units: 600_000, microLamports: 200_000 },
  });

  log('Executing tx(s)...');
  const result = await execute({ sequentially: true });
  const sig = (result.txIds && result.txIds[0]) || '';
  log('═══ SUCCESS ═══');
  log('Tx signature:', sig);
  log('Mint:', mintKp.publicKey.toBase58());
  log('LaunchLab pool:', extInfo?.address?.poolId?.toBase58() ?? '<not in extInfo>');
  log('Jupiter swap link:', `https://jup.ag/swap/SOL-${mintKp.publicKey.toBase58()}`);
  log('Solscan tx:', `https://solscan.io/tx/${sig}`);

  // Final balances
  const testEnd = await conn.getBalance(testKp.publicKey);
  log('Test wallet end balance:', (testEnd / 1e9).toFixed(6), 'SOL');
  log('Test pool wallet keypair (base58, save if you want to sweep leftover):');
  log(bs58.encode(testKp.secretKey));
}

main().catch((e) => {
  console.error('\n═══ FAILED ═══');
  console.error('Error:', e?.message ?? e);
  if (e?.logs) console.error('Tx logs:', e.logs);
  console.error('\nFull error object:');
  console.error(e);
  process.exit(1);
});
