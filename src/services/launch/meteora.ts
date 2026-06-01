// Meteora DBC launch adapter — STUB.
//
// Planned Phase 1: call @meteora-ag/dynamic-bonding-curve-sdk's
// `createPoolWithFirstBuy` from the per-meme pool wallet. The pool
// wallet pattern transfers without rewriting; only the inner
// instruction changes from pump.fun's createV2+buy to DBC's
// createPoolWithFirstBuy.
//
// Phase 1 deliberately EXCLUDES:
//   - Alpha Vault (inverts our submit→back→launch order — UX rewrite)
//   - DAMM v2 post-graduation fee accrual (Phase 2)
//   - Custom DBC fee scheduler config in the submit form
//
// Until this stub is filled in, the dispatcher (./index.ts) is the
// only caller and it gates Meteora launches at the route layer with
// a clear error. The submit form's platform picker shows "Coming soon"
// next to the Meteora option so the path is never reached by a user.

import type { LaunchOutcome, LaunchParams } from './types';

export async function launch(_params: LaunchParams): Promise<LaunchOutcome> {
  return {
    success: false,
    error: 'Meteora launches are not yet implemented. Phase 1 wiring in progress.',
  };
}
