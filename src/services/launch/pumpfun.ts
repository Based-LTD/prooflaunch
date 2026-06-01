// Pump.fun launch adapter.
//
// Thin wrapper around launchPooledAtomic from src/services/pumpfun.ts.
// The full implementation stays in that monolith for now — moving it
// would touch 9 unrelated importers (verifyDeposit, refundFromPool,
// getEscrowAddress, etc. that share the file but aren't launch-specific).
//
// This adapter exists so the dispatcher (./index.ts) can call `launch()`
// on a platform-uniform interface without each platform module knowing
// about every other platform's implementation file.

import { launchPooledAtomic } from '@/services/pumpfun';
import type { LaunchOutcome, LaunchParams } from './types';

export async function launch(params: LaunchParams): Promise<LaunchOutcome> {
  // pump.fun's `creator` is an IDL data arg, not a tx signer — so we
  // ignore params.creatorEncryptedKey on this path. Only the meteora
  // adapter consumes it (Meteora's poolCreator IS a signer).
  const { config, poolEncryptedKey, poolWalletAddress, log } = params;
  return launchPooledAtomic(config, poolEncryptedKey, poolWalletAddress, log);
}
