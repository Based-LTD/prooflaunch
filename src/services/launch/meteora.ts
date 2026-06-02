// Meteora DBC launch adapter — Phase 1 implementation.
//
// Mirrors src/services/pumpfun.ts launchPooledAtomic at the structural
// level: pool wallet pays + buys; sub-escrow is the pool creator (so
// trading fees route to it; cron drains hourly). The inner instruction
// changes from pump.fun's createV2AndBuy to Meteora DBC's
// createPoolWithFirstBuy — both are atomic create + first-buy in one tx.
//
// Phase 1 deliberately uses a SINGLE shared DBC config (METEORA_DBC_CONFIG
// env) that defines the curve, fee schedule, and migration target for
// every Proof Launch token. One-time admin setup runs separately at
// tools/meteora-create-config.mjs.
//
// Phase 1 deliberately EXCLUDES:
//   - Alpha Vault (would invert submit→back→launch order)
//   - DAMM v2 post-graduation fee accrual (separate Phase 2)
//   - Per-meme custom curve / fee scheduler configs (Phase 2)
//   - Jito bundling (the DBC create-and-first-buy is the *first* slot for
//     this curve, so there's no pre-existing pool to snipe — direct
//     send is safe for Phase 1; add Jito later if MEV becomes an issue)
//
// All other infra (slot-based backing, pool wallet pattern, refund
// safety nets, bot stacks, fee distribution to backers) is reused
// unchanged from the pump.fun path.

import {
  Connection,
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { BN } from 'bn.js';
import { DynamicBondingCurveClient, deriveDbcPoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk';

// Quote mint = native SOL (wrapped). Same constant we used in the
// config template. Required to derive the DBC pool address.
const QUOTE_MINT_SOL = new PublicKey('So11111111111111111111111111111111111111112');
import bs58 from 'bs58';
import { decryptPrivateKey } from '@/lib/crypto';
import type { LaunchOutcome, LaunchParams } from './types';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Pool wallet pays the createPool rent + ATA + tx fee in the SAME tx
// before the buy runs, so reserve for it; the buy can only spend what's
// left. Number tuned to match the pump.fun analog (35M lamports there);
// DBC's create instruction is a bit heavier but still fits well under
// 0.05 SOL. Empirically tightened on devnet before mainnet promotion.
const CREATE_RESERVE_LAMPORTS = 50_000_000; // 0.05 SOL

function decryptKeypair(encrypted: string): Keypair {
  const sk = decryptPrivateKey(encrypted);
  return Keypair.fromSecretKey(bs58.decode(sk));
}

function getConfigPubkey(): PublicKey | null {
  const cfg = process.env.METEORA_DBC_CONFIG;
  if (!cfg) return null;
  try {
    return new PublicKey(cfg);
  } catch {
    return null;
  }
}

// Build the metadata URI that gets embedded ON-CHAIN at create time.
// IMPORTANT: this URL is FIXED at launch — wallets, explorers, and
// indexers resolve it for the life of the token. It must be unique
// per token. We use the mint pubkey (unique forever) as the key, not
// the symbol (collides across memes — e.g. multiple BONKD submissions
// would overwrite each other's metadata).
function metadataUriForMint(mint: PublicKey): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://prooflaunch.fun';
  return `${base}/api/token-metadata/${mint.toBase58()}`;
}

export async function launch(params: LaunchParams): Promise<LaunchOutcome> {
  const { config, poolEncryptedKey, poolWalletAddress, log, creatorEncryptedKey } = params;

  const dbcConfig = getConfigPubkey();
  if (!dbcConfig) {
    return {
      success: false,
      error: 'METEORA_DBC_CONFIG env not set — run tools/meteora-create-config.mjs first',
    };
  }

  const conn = new Connection(RPC_URL, 'confirmed');

  // Mint keypair: in Phase 1 we use a random keypair. The pump.fun path
  // also tries a pre-ground `...pooL` vanity from the vanity pool; we'll
  // wire that in once Meteora launches are stable on mainnet.
  const mintKp = Keypair.generate();
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
      return { success: false, error: 'Pool balance too low for createPool + first buy' };
    }

    log('create_sent', { detail: { platform: 'meteora', symbol: config.symbol } });
    const uri = metadataUriForMint(mint);

    // poolCreator → sub-escrow when provided (so DBC creator-fees route
    // to per-meme sub-escrow, matching the pump.fun pattern). Falls back
    // to the pool wallet when no sub-escrow is set (legacy / pre-P2 memes).
    //
    // CRITICAL: Meteora's poolCreator is a TRANSACTION SIGNER (different
    // from pump.fun's IDL-arg creator). When we route fees to the
    // sub-escrow, the sub-escrow keypair must also sign the launch tx.
    // The launch route loads memes.encrypted_creator_subescrow_key and
    // passes it through as creatorEncryptedKey.
    const useSubEscrowAsCreator = !!config.creatorPubkey && !!creatorEncryptedKey;
    let creatorSignerKp: Keypair | null = null;
    let poolCreator: PublicKey;
    if (useSubEscrowAsCreator) {
      creatorSignerKp = decryptKeypair(creatorEncryptedKey!);
      if (creatorSignerKp.publicKey.toBase58() !== config.creatorPubkey) {
        return { success: false, error: 'Sub-escrow key/pubkey mismatch' };
      }
      poolCreator = creatorSignerKp.publicKey;
    } else {
      poolCreator = poolKp.publicKey;
    }

    const client = new DynamicBondingCurveClient(conn, 'confirmed');

    log('create_sent', {
      detail: {
        platform: 'meteora',
        mint: mint.toBase58(),
        poolCreator: poolCreator.toBase58(),
        dbcConfig: dbcConfig.toBase58(),
        buyLamports: spend.toString(),
      },
    });

    // Single-tx atomic create + first buy. The DBC SDK assembles the
    // create-pool + ATA + swap instructions; we add a priority-fee
    // ComputeBudget at the front so the tx lands quickly on mainnet
    // without depending on Jito.
    const tx = await client.pool.createPoolWithFirstBuy({
      createPoolParam: {
        name: config.name,
        symbol: config.symbol,
        uri,
        payer: poolKp.publicKey,
        poolCreator,
        config: dbcConfig,
        baseMint: mint,
      },
      firstBuyParam: {
        buyer: poolKp.publicKey,
        buyAmount: new BN(spend.toString()),
        // Slippage tolerance — empty pool means first-buy quote is
        // deterministic from the curve config, so 0 minimum is safe.
        // Set to a non-zero floor in Phase 1.1 once we wire the curve
        // quote pre-computation.
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      },
    });

    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    );

    log('buy_sent', { detail: { platform: 'meteora' } });
    // Signer set: pool wallet (pays + buys), mint keypair (account being
    // created), and the sub-escrow when it's the poolCreator. The SDK
    // builds a legacy Transaction so signer order doesn't matter — the
    // serializer collects required pubkeys from the instructions.
    const signers: Keypair[] = [poolKp, mintKp];
    if (creatorSignerKp) signers.push(creatorSignerKp);
    const sig = await sendAndConfirmTransaction(
      conn,
      tx,
      signers,
      { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 },
    );

    log('buy_confirmed', { signature: sig, ok: true });

    // Derive the DBC pool address from (quoteMint, baseMint, config).
    // Deterministic — same triple always yields the same pool address.
    // The launch route persists this to memes.dbc_pool_address so the
    // hourly fee cron can locate the pool to claim from.
    const dbcPoolAddress = deriveDbcPoolAddress(QUOTE_MINT_SOL, mint, dbcConfig).toBase58();

    log('launch_complete', {
      signature: sig,
      detail: { platform: 'meteora', mint: mint.toBase58(), dbcPool: dbcPoolAddress },
    });

    // Meteora's pool URL — Edge.gg / Dexscreener style. Final URL shape
    // depends on which downstream UI we link to. Using the meteora.ag
    // pool URL keeps it on-platform.
    const pumpFunUrl = `https://launch.meteora.ag/${mint.toBase58()}`;

    return {
      success: true,
      mintAddress: mint.toBase58(),
      pumpFunUrl,
      createSignature: sig,
      poolWallet: poolKp.publicKey.toBase58(),
      // Token amount received by the pool — DBC's first-buy returns
      // the curve-derived token amount; we'd parse it from the tx logs
      // (program-emitted "swap" event). For Phase 1 we leave it
      // undefined; the cron's reconcile path will fill it from on-chain
      // pool state. Settlement to backers still works because backer
      // tokens are computed from pool_token_balance after launch.
      tokensReceived: undefined,
      dbcPoolAddress,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('launch_error', { ok: false, detail: { platform: 'meteora', error: msg } });
    return { success: false, error: `Meteora launch failed: ${msg}` };
  }
}
