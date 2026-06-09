// Shared types for the multi-platform launch dispatcher.
//
// Each platform module under src/services/launch/ exports a `launch()`
// function with the signature
//   (params: LaunchParams) => Promise<LaunchOutcome>
// The dispatcher in ./index.ts reads memes.launch_platform and routes.
//
// LaunchConfig is the meme metadata + economics. LaunchParams adds the
// runtime context (pool wallet keys, launch logger) every platform needs
// to execute. Platform modules pull the fields they need and ignore
// the rest.

import type { LaunchLogger } from '@/lib/launchLog';

export type LaunchPlatform = 'pumpfun' | 'meteora' | 'bags' | 'bonk' | 'launchlab';

// Re-export the existing pump.fun config type so the rest of the
// codebase gradually migrates to importing from launch/types instead
// of reaching directly into services/pumpfun. No behavior change.
export type {
  LaunchConfig,
  BackerWithTimestamp,
} from '@/services/pumpfun';

import type { LaunchConfig } from '@/services/pumpfun';

export interface LaunchParams {
  config: LaunchConfig;
  poolEncryptedKey: string;
  poolWalletAddress: string;
  log: LaunchLogger;
  // Sub-escrow's encrypted private key. Required by platforms whose
  // launch program treats the token's "creator" as a transaction
  // signer (e.g. Meteora DBC's poolCreator). Pump.fun's creator is
  // just an IDL data arg so this is unused on that path. Optional so
  // pre-P2 memes (no sub-escrow) keep working.
  creatorEncryptedKey?: string;
}

// Superset return shape. pump.fun's launchPooledAtomic already returns
// this exact shape; other platforms populate the subset that's
// meaningful for them (e.g. Meteora DBC adds dbcPoolAddress in a
// future extension).
export interface LaunchOutcome {
  success: boolean;
  mintAddress?: string;
  pumpFunUrl?: string;
  createSignature?: string;
  poolWallet?: string;
  tokensReceived?: number;
  error?: string;
  // Reserved for non-pumpfun platforms. Populated by their adapters as
  // we wire them up; the launch route already only reads the fields
  // above so adding new ones is non-breaking.
  dbcPoolAddress?: string;
  bagsFeeShareAuthority?: string;
}
