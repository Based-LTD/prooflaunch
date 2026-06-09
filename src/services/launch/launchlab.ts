// Raydium LaunchLab launch adapter — Phase 2 implementation.
//
// LaunchLab is Raydium's bonding-curve token launchpad (the same
// infrastructure Bonk.fun runs on). Third launchpad we support
// alongside Pump.fun and Meteora DBC.
//
// Structural mirror of services/launch/meteora.ts: pool wallet pays +
// buys, mint keypair (vanity-derived when available) carries the
// `...pooL` brand suffix, single atomic create + first-buy in one tx.
// The inner instruction changes — Raydium's createLaunchpad SDK call
// instead of Meteora DBC's createPoolWithFirstBuy.
//
// Mainnet defaults:
//   - Quote mint: native wrapped SOL (NATIVE_MINT). All Raydium
//     LaunchLab pools quote in SOL right now.
//   - Config: derived deterministically via getPdaLaunchpadConfigId
//     with curveType=0, index=0. This is the canonical mainnet
//     LaunchLab config Raydium ships with the SDK.
//   - migrateType: 'amm' — post-graduation pools route to Raydium's
//     AMM v4, matching Bonk.fun's behavior. CPMM is the alternative
//     but AMM has the deeper aggregator support today.
//
// What's deliberately excluded in Phase 2:
//   - Per-meme custom curve / fee scheduler configs (Phase 3)
//   - Vesting allocations to the creator (we want creator-as-backer
//     parity with the rest of the platform — no special creator cut)
//   - Platform fee receiver routing (LaunchLab supports shareFeeRate
//     for revenue-share to platforms; we leave it default for now)
//
// Risk profile: LaunchLab's atomic create+buy means if the tx fails
// the pool wallet's SOL is preserved (no partial state). The SDK
// returns `{ execute, extInfo }` and we wait for the tx to confirm
// before persisting the pool address.

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';
import { NATIVE_MINT } from '@solana/spl-token';
import {
  Raydium,
  LAUNCHPAD_PROGRAM,
  getPdaLaunchpadConfigId,
  TxVersion,
} from '@raydium-io/raydium-sdk-v2';
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';
import { getAdaptivePriorityFee } from '@/lib/rpcHelpers';
import type { LaunchOutcome, LaunchParams } from './types';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Pool wallet pays the createLaunchpad rent (mint + ATA + pool
// accounts) + tx fee BEFORE the buy runs, so reserve for it; the buy
// can only spend what's left. Empirically the Raydium create is a
// touch heavier than Meteora's DBC create (more accounts), so we
// reserve slightly more than meteora.ts's 0.05.
const CREATE_RESERVE_LAMPORTS = 60_000_000; // 0.06 SOL

// Token decimals on LaunchLab. 6 matches Bonk.fun / standard meme convention.
const TOKEN_DECIMALS = 6;

// wSOL has 9 decimals.
const QUOTE_MINT_DECIMALS = 9;

// Slippage in BPS for the first buy. 1% = 100 bps. The curve is fresh
// so the price is deterministic — this is just a safety floor.
const SLIPPAGE_BPS = new BN(100);

function decryptKeypair(encrypted: string): Keypair {
  const sk = decryptPrivateKey(encrypted);
  return Keypair.fromSecretKey(bs58.decode(sk));
}

// Build the metadata URI that gets embedded ON-CHAIN at create time.
// IMPORTANT: this URL is FIXED at launch — wallets, explorers, and
// indexers resolve it for the life of the token. It must be unique
// per token. We use the mint pubkey (unique forever) as the key.
function metadataUriForMint(mint: PublicKey): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://prooflaunch.fun';
  return `${base}/api/token-metadata/${mint.toBase58()}`;
}

export async function launch(params: LaunchParams): Promise<LaunchOutcome> {
  const { config, poolEncryptedKey, poolWalletAddress, log } = params;

  const conn = new Connection(RPC_URL, 'confirmed');

  // Mint keypair: consume a pre-ground `...pooL` vanity from the
  // shared pool so LaunchLab launches carry the same brand-recognizable
  // contract-address suffix that Pump.fun + Meteora launches do.
  // Degrades to a random mint if the pool is empty — never blocks launch.
  let mintKp = Keypair.generate();
  try {
    const { consumeVanityWallet } = await import('@/lib/vanity');
    const { decryptPrivateKey: dk } = await import('@/lib/crypto');
    const v = await consumeVanityWallet('pool', `launchlab-mint:${config.symbol}`);
    if (v) {
      mintKp = Keypair.fromSecretKey(bs58.decode(dk(v.encryptedPrivateKey)));
    }
  } catch { /* vanity unavailable — random mint is fine */ }
  const mint = mintKp.publicKey;

  try {
    const poolKp = decryptKeypair(poolEncryptedKey);
    if (poolKp.publicKey.toBase58() !== poolWalletAddress) {
      return { success: false, error: 'Pool wallet key mismatch' };
    }

    const poolBal = await conn.getBalance(poolKp.publicKey);
    if (poolBal <= 0) return { success: false, error: 'Pool wallet has no SOL' };

    const spend = poolBal - CREATE_RESERVE_LAMPORTS;
    if (spend <= 0) {
      return {
        success: false,
        error: `Pool balance ${poolBal} too low for createLaunchpad + first buy (need > ${CREATE_RESERVE_LAMPORTS})`,
      };
    }

    log('create_sent', {
      detail: {
        platform: 'launchlab',
        symbol: config.symbol,
        mint: mint.toBase58(),
        buyLamports: spend.toString(),
      },
    });

    const uri = metadataUriForMint(mint);

    // Initialize Raydium SDK with the pool keypair as the owner. The
    // SDK uses owner for signing all tx the createLaunchpad assembler
    // returns; we add mintKp via extraSigners since it signs as the
    // newly-created mint account.
    const raydium = await Raydium.load({
      connection: conn,
      owner: poolKp,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      blockhashCommitment: 'confirmed',
      disableLoadToken: true, // skip token-list prefetch — we just need launchpad
    });

    // Derive the canonical mainnet LaunchLab config:
    //   getPdaLaunchpadConfigId(programId, mintB, curveType, index)
    // The default (NATIVE_MINT, 0, 0) is the SOL-quoted, baseline-curve
    // config Raydium ships and Bonk.fun uses today.
    const { publicKey: configId } = getPdaLaunchpadConfigId(
      LAUNCHPAD_PROGRAM,
      NATIVE_MINT,
      0,
      0,
    );

    // SOL-030: adaptive priority fee read once at launch entry. Passed
    // into Raydium's computeBudgetConfig so the SDK's tx assembly uses
    // our adaptive value instead of a hardcoded literal.
    const microLamports = await getAdaptivePriorityFee(conn, { fallback: 200_000 });

    const { execute, extInfo } = await raydium.launchpad.createLaunchpad({
      programId: LAUNCHPAD_PROGRAM,
      mintA: mint,
      decimals: TOKEN_DECIMALS,
      name: config.name,
      symbol: config.symbol,
      uri,
      migrateType: 'amm',
      configId,
      mintBDecimals: QUOTE_MINT_DECIMALS,
      txVersion: TxVersion.V0,
      slippage: SLIPPAGE_BPS,
      buyAmount: new BN(spend.toString()),
      // createOnly: false → atomic create + first buy. We want the
      // pool's whole spend to land as a first buy in the same tx.
      createOnly: false,
      // mintKp must sign as the newly-created token mint.
      extraSigners: [mintKp],
      computeBudgetConfig: { units: 600_000, microLamports },
    });

    log('buy_sent', {
      detail: { platform: 'launchlab', mint: mint.toBase58() },
    });

    // execute() returns { txIds } when sequentially:true. The createLaunchpad
    // assembler may emit multiple txs (e.g. ATA setup) but the launchpad
    // pool init + buy lands in the final one. We capture txIds[0] as the
    // canonical "createSignature" — this is consistent with how Meteora
    // and Pump.fun return their single create+buy sig.
    const result = await execute({ sequentially: true });
    const sig = (result.txIds && result.txIds[0]) || '';
    if (!sig) {
      return { success: false, error: 'LaunchLab execute returned empty txIds' };
    }

    log('buy_confirmed', { signature: sig, ok: true });

    // Pool address from the SDK's extInfo. Persisted to
    // memes.launchlab_pool_address by the launch route so the buyback
    // fee collector can locate the pool to claim creator fees from
    // (raydium.launchpad.claimCreatorFee in a future ship).
    const launchlabPoolAddress = extInfo?.address?.poolId?.toBase58() ?? '';

    log('launch_complete', {
      signature: sig,
      detail: {
        platform: 'launchlab',
        mint: mint.toBase58(),
        pool: launchlabPoolAddress,
      },
    });

    return {
      success: true,
      mintAddress: mint.toBase58(),
      // jup.ag is the universal swap UI for Raydium pools. The
      // /launched + meme detail pages already route launchlab through
      // jup.ag — using the same URL here means the post-launch link
      // matches what users see in the BUY button.
      pumpFunUrl: `https://jup.ag/swap/SOL-${mint.toBase58()}`,
      createSignature: sig,
      poolWallet: poolKp.publicKey.toBase58(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('reconcile_error', {
      ok: false,
      detail: { platform: 'launchlab', error: msg },
    });
    return { success: false, error: `LaunchLab launch failed: ${msg}` };
  }
}
