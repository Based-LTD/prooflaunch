// Multi-platform launch dispatcher.
//
// Reads memes.launch_platform and routes to the appropriate adapter.
// Each adapter exports the same launch(params) → LaunchOutcome shape
// (see ./types.ts) so the launch route doesn't need a switch statement
// per call site.
//
// Adding a new platform:
//   1. Add the value to LaunchPlatform in ./types.ts
//   2. Add the value to the CHECK constraint in migration 046 (or a
//      later migration)
//   3. Create src/services/launch/<name>.ts with `export async function
//      launch(params: LaunchParams): Promise<LaunchOutcome>`
//   4. Add it to the switch below

import type { LaunchOutcome, LaunchParams, LaunchPlatform } from './types';
import { launch as launchPumpfun } from './pumpfun';
import { launch as launchMeteora } from './meteora';
import { launch as launchLaunchlab } from './launchlab';
import { launch as launchBags } from './bags';

export async function launchOnPlatform(
  platform: LaunchPlatform,
  params: LaunchParams,
): Promise<LaunchOutcome> {
  switch (platform) {
    case 'pumpfun':
      return launchPumpfun(params);
    case 'meteora':
      return launchMeteora(params);
    case 'launchlab':
      return launchLaunchlab(params);
    case 'bags':
      return launchBags(params);
    case 'bonk':
      return {
        success: false,
        error: `${platform} launches are not yet implemented.`,
      };
    default: {
      // Exhaustiveness check — TS will error here if a new platform is
      // added to LaunchPlatform without a case above.
      const _exhaustive: never = platform;
      return {
        success: false,
        error: `Unknown launch platform: ${_exhaustive}`,
      };
    }
  }
}

export type { LaunchOutcome, LaunchParams, LaunchPlatform } from './types';
