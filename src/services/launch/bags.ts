// Bags launch adapter.
//
// Bags is built on top of Meteora DBC + DAMM v2 under the hood — the same
// program family src/services/launch/meteora.ts already integrates with. So
// the on-chain primitives (DBC pool, fee accrual, graduation to DAMM v2)
// are familiar. What Bags adds is a hosted launch API: instead of
// hand-rolling the createPool + first-buy instructions like the Meteora
// adapter does, we call their HTTP endpoints and they hand back unsigned
// VersionedTransactions for our pool wallet to sign + send.
//
// 5-step recipe (from docs.bags.fm/how-to-guides/launch-token):
//   1. POST /token-launch/create-token-info  → mint + IPFS metadata URI
//   2. POST /fee-share/config                → fee-share authority + txs
//   3. Sign + send each fee-share tx (with pool wallet + sub-escrow)
//   4. POST /token-launch/create-launch-transaction → unsigned launch tx
//   5. Sign with pool wallet + send
//
// Critical architectural fit: Bags's fee-share config accepts an array of
// (wallet, bps) claimers summing to 10000. We register our per-meme
// sub-escrow as the dominant claimer (9999 bps = 99.99%) and the pool
// wallet (= the on-chain "creator" Bags requires to appear) at 1 bps to
// satisfy their rule. Net effect: ~all fees route to sub-escrow, the
// existing Meteora DBC drain path in distribution.ts picks them up,
// downstream bots/backers/platform/partner all work unchanged.
//
// The 1 bps to pool wallet is tiny (0.01% of fees) and ends up in the
// pool wallet, which the creator can later claim via the wallet-claim
// flow — so it's effectively a small tip to the creator on top of
// everything else. Acceptable cost for fitting Bags's rule cleanly.

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TokenAccountNotFoundError,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';
import type { LaunchOutcome, LaunchParams } from './types';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const BAGS_API_BASE = 'https://public-api-v2.bags.fm/api/v1';

// Reserve for: sub-escrow pre-fund (1.5M lamports, see SUB_ESCROW_PREFUND
// below) + token-info creation rent + fee-share config rent + launch
// rent + tx fees. Bags's flow ships multiple txs from the pool wallet
// before the actual first-buy lands, so this is a bit fatter than the
// Meteora adapter's 0.05 SOL. Tightenable empirically once we have
// production data; conservative for first launch safety.
const CREATE_RESERVE_LAMPORTS = 80_000_000; // 0.08 SOL

// Per Bags's fee-share rule, the launch wallet (creator) must appear in
// the claimers array. We give it the minimum (1 bps) so ~all fees route
// to the sub-escrow.
const POOL_WALLET_BPS = 1;
const SUB_ESCROW_BPS = 9999;

// Bags's POST /fee-share/config does an on-chain account lookup against
// every claimer pubkey. Our fresh sub-escrow keypairs have no on-chain
// footprint at launch time (they only become real when fees start
// accruing later), which makes Bags's API return 500. Workaround:
// pre-fund the sub-escrow with rent-exempt minimum from the pool wallet
// BEFORE calling fee-share/config. The dust gets swept during the first
// fee drain cycle, so net cost per launch is just rent + tx fee
// (~0.0016 SOL). Validated empirically against the live Bags API
// 2026-06-23.
const SUB_ESCROW_PREFUND_LAMPORTS = 1_500_000; // 0.0015 SOL

function decryptKeypair(encrypted: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(decryptPrivateKey(encrypted)));
}

function bagsHeaders(json = true): Record<string, string> {
  const key = process.env.BAGS_API_KEY;
  if (!key) {
    throw new Error('BAGS_API_KEY not set — Bags launches require an API key from dev.bags.fm');
  }
  const h: Record<string, string> = { 'x-api-key': key };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

interface BagsTokenInfoResponse {
  tokenMint: string;
  tokenMetadata: string;
}

interface BagsFeeShareTxBundle {
  blockhash: { blockhash: string; lastValidBlockHeight: number };
  transaction: string; // base58
}

interface BagsFeeShareResponse {
  needsCreation: boolean;
  feeShareAuthority: string;
  meteoraConfigKey: string;
  transactions: BagsFeeShareTxBundle[];
  bundles: string[][] | null;
}

interface BagsLaunchTxResponse {
  // Per docs: response IS the base58 string directly, not wrapped
  // (the outer { success, response } envelope strips at our parse step).
  transaction: string;
}

interface BagsApiEnvelope<T> {
  success: boolean;
  response?: T;
  error?: string;
}

// 1. Create token info + metadata. Bags handles IPFS upload server-side.
async function createTokenInfo(config: LaunchParams['config']): Promise<BagsTokenInfoResponse> {
  // multipart/form-data per docs. We pass imageUrl (not a file blob)
  // because our memes already have an accessible image_url.
  const form = new FormData();
  form.set('name', config.name.slice(0, 32));
  form.set('symbol', config.symbol.toUpperCase().replace(/\$/g, '').slice(0, 10));
  form.set('description', config.description.slice(0, 1000));
  if (config.imageUrl) form.set('imageUrl', config.imageUrl);
  if (config.twitter) form.set('twitter', config.twitter);
  if (config.telegram) form.set('telegram', config.telegram);
  if (config.website) form.set('website', config.website);

  const res = await fetch(`${BAGS_API_BASE}/token-launch/create-token-info`, {
    method: 'POST',
    headers: bagsHeaders(false), // multipart, no JSON header
    body: form,
  });
  if (!res.ok) {
    throw new Error(`bags create-token-info ${res.status}: ${await res.text()}`);
  }
  const env = (await res.json()) as BagsApiEnvelope<{ tokenMint: string; tokenMetadata: string }>;
  if (!env.success || !env.response) {
    throw new Error(`bags create-token-info: ${env.error || 'unknown error'}`);
  }
  return { tokenMint: env.response.tokenMint, tokenMetadata: env.response.tokenMetadata };
}

// 2. Create fee-share config — registers the per-token fee router with
// our sub-escrow as the dominant claimer.
async function createFeeShareConfig(args: {
  payer: PublicKey;
  baseMint: PublicKey;
  poolWallet: PublicKey;
  subEscrow: PublicKey;
}): Promise<BagsFeeShareResponse> {
  const body = {
    payer: args.payer.toBase58(),
    baseMint: args.baseMint.toBase58(),
    claimersArray: [args.poolWallet.toBase58(), args.subEscrow.toBase58()],
    basisPointsArray: [POOL_WALLET_BPS, SUB_ESCROW_BPS],
  };
  const res = await fetch(`${BAGS_API_BASE}/fee-share/config`, {
    method: 'POST',
    headers: bagsHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`bags fee-share/config ${res.status}: ${await res.text()}`);
  }
  const env = (await res.json()) as BagsApiEnvelope<BagsFeeShareResponse>;
  if (!env.success || !env.response) {
    throw new Error(`bags fee-share/config: ${env.error || 'unknown error'}`);
  }
  return env.response;
}

// 3. Sign + send each fee-share tx in sequence. They're returned as
// base58-encoded VersionedTransactions; only the pool wallet (the
// payer/signer in the tx's static accounts) signs. Sub-escrow is just
// a recipient pubkey in the claimers array and is NOT a tx signer —
// trying to add it as a signer triggers 'Cannot sign with non signer
// key' (validated 2026-06-23 against the live API).
async function sendFeeShareTransactions(args: {
  conn: Connection;
  transactions: BagsFeeShareTxBundle[];
  poolKp: Keypair;
}): Promise<string[]> {
  const sigs: string[] = [];
  for (const bundle of args.transactions) {
    const raw = bs58.decode(bundle.transaction);
    const vtx = VersionedTransaction.deserialize(raw);
    vtx.sign([args.poolKp]);
    const sig = await args.conn.sendTransaction(vtx, { skipPreflight: false });
    await args.conn.confirmTransaction({ signature: sig, ...bundle.blockhash }, 'confirmed');
    sigs.push(sig);
  }
  return sigs;
}

// 4. Build the actual launch tx (mint + first buy + DBC pool creation).
async function createLaunchTransaction(args: {
  tokenMetadata: string;
  tokenMint: string;
  wallet: PublicKey;
  initialBuyLamports: number;
  configKey: string;
}): Promise<VersionedTransaction> {
  const body = {
    ipfs: args.tokenMetadata,
    tokenMint: args.tokenMint,
    wallet: args.wallet.toBase58(),
    initialBuyLamports: args.initialBuyLamports,
    configKey: args.configKey,
  };
  const res = await fetch(`${BAGS_API_BASE}/token-launch/create-launch-transaction`, {
    method: 'POST',
    headers: bagsHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`bags create-launch-transaction ${res.status}: ${await res.text()}`);
  }
  const env = (await res.json()) as BagsApiEnvelope<string>;
  if (!env.success || !env.response) {
    throw new Error(`bags create-launch-transaction: ${env.error || 'unknown error'}`);
  }
  const raw = bs58.decode(env.response);
  return VersionedTransaction.deserialize(raw);
}

// 5. Fetch the resulting DBC pool address so the cron knows where to
// drain fees from. Best-effort — failure here doesn't undo the launch.
async function fetchPoolKey(tokenMint: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${BAGS_API_BASE}/solana/bags/pools/token-mint?tokenMint=${tokenMint}`,
      { headers: bagsHeaders() },
    );
    if (!res.ok) return null;
    const env = (await res.json()) as BagsApiEnvelope<{ dbcPoolKey: string }>;
    return env.response?.dbcPoolKey ?? null;
  } catch {
    return null;
  }
}

export async function launch(params: LaunchParams): Promise<LaunchOutcome> {
  const { config, poolEncryptedKey, poolWalletAddress, log, creatorEncryptedKey } = params;

  if (!creatorEncryptedKey) {
    return {
      success: false,
      error: 'Bags launches require a sub-escrow keypair (creatorEncryptedKey). Pre-Phase-2 memes are not supported.',
    };
  }

  let poolKp: Keypair;
  let subEscrowKp: Keypair;
  try {
    poolKp = decryptKeypair(poolEncryptedKey);
    subEscrowKp = decryptKeypair(creatorEncryptedKey);
  } catch (e) {
    return {
      success: false,
      error: `decrypt failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (poolKp.publicKey.toBase58() !== poolWalletAddress) {
    return { success: false, error: 'pool wallet pubkey mismatch — refusing to launch' };
  }

  const conn = new Connection(RPC_URL, 'confirmed');

  // Compute the initial buy amount: everything the pool wallet has,
  // minus the reserve for rent + tx fees.
  const poolBalance = await conn.getBalance(poolKp.publicKey);
  if (poolBalance <= CREATE_RESERVE_LAMPORTS) {
    return {
      success: false,
      error: `pool wallet balance ${(poolBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL below reserve ${(CREATE_RESERVE_LAMPORTS / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
    };
  }
  const initialBuyLamports = poolBalance - CREATE_RESERVE_LAMPORTS;

  try {
    // Step 0: pre-fund the sub-escrow so Bags's account lookup in
    // fee-share/config succeeds. See SUB_ESCROW_PREFUND_LAMPORTS comment.
    const subBalPre = await conn.getBalance(subEscrowKp.publicKey);
    if (subBalPre < SUB_ESCROW_PREFUND_LAMPORTS) {
      log('create_sent', { detail: { stage: 'bags_sub_prefund', amount: SUB_ESCROW_PREFUND_LAMPORTS } });
      const fundTx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: poolKp.publicKey,
        toPubkey: subEscrowKp.publicKey,
        lamports: SUB_ESCROW_PREFUND_LAMPORTS - subBalPre,
      }));
      fundTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      fundTx.feePayer = poolKp.publicKey;
      const fundSig = await conn.sendTransaction(fundTx, [poolKp]);
      await conn.confirmTransaction(fundSig, 'confirmed');
      log('create_confirmed', { detail: { stage: 'bags_sub_prefund', sig: fundSig } });
    }

    // Step 1: token info + metadata
    log('create_sent', { detail: { stage: 'bags_token_info', initialBuyLamports } });
    const info = await createTokenInfo(config);
    const baseMint = new PublicKey(info.tokenMint);
    log('create_confirmed', { detail: { stage: 'bags_token_info', tokenMint: info.tokenMint } });

    // Step 2: fee-share config — sub-escrow is the dominant claimer
    log('create_sent', { detail: { stage: 'bags_fee_share_config' } });
    const feeShare = await createFeeShareConfig({
      payer: poolKp.publicKey,
      baseMint,
      poolWallet: poolKp.publicKey,
      subEscrow: subEscrowKp.publicKey,
    });
    log('create_confirmed', {
      detail: {
        stage: 'bags_fee_share_config',
        meteoraConfigKey: feeShare.meteoraConfigKey,
        feeShareAuthority: feeShare.feeShareAuthority,
        txCount: feeShare.transactions.length,
      },
    });

    // Step 3: sign + send the config txs
    if (feeShare.transactions.length > 0) {
      log('create_sent', { detail: { stage: 'bags_fee_share_txs', count: feeShare.transactions.length } });
      const cfgSigs = await sendFeeShareTransactions({
        conn,
        transactions: feeShare.transactions,
        poolKp,
      });
      log('create_confirmed', { detail: { stage: 'bags_fee_share_txs', sigs: cfgSigs } });
    }

    // Step 4: build the launch tx
    log('create_sent', { detail: { stage: 'bags_launch_tx' } });
    const launchVtx = await createLaunchTransaction({
      tokenMetadata: info.tokenMetadata,
      tokenMint: info.tokenMint,
      wallet: poolKp.publicKey,
      initialBuyLamports,
      configKey: feeShare.meteoraConfigKey,
    });

    // Step 5: sign + send. Pool wallet is the signer (= launch wallet).
    launchVtx.sign([poolKp]);
    const launchSig = await conn.sendTransaction(launchVtx, { skipPreflight: false });
    const confirmation = await conn.confirmTransaction(launchSig, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`launch tx reverted: ${JSON.stringify(confirmation.value.err)}`);
    }
    log('create_confirmed', { signature: launchSig, detail: { stage: 'bags_launch_tx' } });

    // Step 5b: poll the pool wallet's ATA of the new mint until the
    // initial-buy tokens become visible. The launch route checks
    // result.tokensReceived to decide whether to mark the meme live, so
    // this can't be skipped. Detect the token program from the mint
    // account because Bags tokens may use Token-2022 or legacy SPL
    // depending on the DBC config.
    const mintAcct = await conn.getAccountInfo(new PublicKey(info.tokenMint));
    const tokenProgramId = mintAcct?.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const poolAta = getAssociatedTokenAddressSync(
      new PublicKey(info.tokenMint), poolKp.publicKey, false, tokenProgramId,
    );
    let tokensReceived: number | undefined;
    const POLL_DEADLINE = Date.now() + 15_000;
    while (Date.now() < POLL_DEADLINE) {
      try {
        const acct = await getAccount(conn, poolAta, 'confirmed', tokenProgramId);
        if (acct.amount > BigInt(0)) {
          tokensReceived = Number(acct.amount);
          break;
        }
      } catch (e) {
        if (!(e instanceof TokenAccountNotFoundError)) throw e;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (tokensReceived === undefined) {
      log('reconcile_error', {
        ok: false,
        detail: { stage: 'bags_pool_balance_read_timeout', poolAta: poolAta.toBase58() },
      });
    }

    // Step 5c (best-effort): fetch the DBC pool key for downstream fee
    // collection. Failure here doesn't undo the launch — the cron can
    // re-derive or fetch it later.
    const dbcPoolKey = await fetchPoolKey(info.tokenMint);

    return {
      success: true,
      mintAddress: info.tokenMint,
      createSignature: launchSig,
      poolWallet: poolKp.publicKey.toBase58(),
      tokensReceived,
      // Bags tokens trade on Meteora DBC, so we surface the pool key in
      // the same field the existing meteora.ts adapter uses. The
      // existing fee cron (services/fees/meteora-dbc.ts) handles them
      // identically.
      dbcPoolAddress: dbcPoolKey ?? undefined,
      bagsFeeShareAuthority: feeShare.feeShareAuthority,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('launch_error', { detail: { stage: 'bags_launch', err: msg } });
    return { success: false, error: `bags launch failed: ${msg}` };
  }
}
