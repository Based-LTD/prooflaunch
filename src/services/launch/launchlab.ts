// Raydium LaunchLab launch adapter — Phase 1 scaffolding.
//
// LaunchLab is Raydium's bonding-curve token launchpad (the same
// infrastructure that Bonk.fun now runs on). It's the third launchpad
// we support alongside Pump.fun and Meteora DBC.
//
// Phase 1 (this file today):
//   - Stub `launch()` that returns success: false with a clear
//     "Phase 2 ships next" message. Mirrors how the other multi-pad
//     scaffolds were shipped (Meteora pre-ae7fbe1).
//   - The dispatcher in ./index.ts routes here when
//     meme.launch_platform === 'launchlab'.
//
// Phase 2 (next ship, after devnet validation):
//   - Install @raydium-io/raydium-sdk-v2 (src/raydium/launchpad)
//   - Implement createLaunchpad() call with the meme's mint keypair
//     as `mintA`, `config.name` / `config.symbol` / metadata URI
//     from /api/token-metadata/[mint], `buyAmount` set to the pool's
//     usable balance (minus the LaunchLab create reserve), and
//     `migrateType: 'cpmm'` so post-graduation goes to Raydium CPMM.
//   - Decrypt the pool's encrypted private key (poolEncryptedKey) and
//     sign with both the pool keypair and the mint keypair, mirroring
//     the meteora.ts signer set.
//   - Populate the new memes.launchlab_pool_address column from the
//     SDK response so the meme detail page + buyback fee collector
//     can read it without rederiving.
//   - Return mintAddress + createSignature so the launch route can
//     update memes.status → 'live' + persist the platform-specific
//     address columns.
//
// Why not ship the full integration today: the launch path is the
// most fund-sensitive code in the system. Shipping un-devnet-tested
// launchpad code = a creator clicks "Launch" and their pool's SOL
// gets stuck mid-transaction with no recovery. The scaffolding
// pattern (used for POOL_FEEDER, used originally for Meteora) lets
// the submit picker show a "SOON" tile + sets reader expectations,
// without exposing real funds to untested code.

import type { LaunchOutcome, LaunchParams } from './types';

export async function launch(params: LaunchParams): Promise<LaunchOutcome> {
  params.log('reconcile_error', {
    detail: {
      stage: 'launchlab_stub',
      message: 'LaunchLab launch path not yet implemented; meme should not have been routed here.',
      mint_intended: params.config.name,
    },
    ok: false,
  });
  return {
    success: false,
    error: 'Raydium LaunchLab launches land in Phase 2. Pick Pump.fun or Meteora for now.',
  };
}
