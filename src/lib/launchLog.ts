import { createServerClient } from './supabase';

// Durable launch-step logging.
//
// The $TEST incident was undiagnosable because the serverless launch
// invocation's console logs were gone by the time we looked. This logger
// persists each step to the launch_events table so a failure is
// explainable from data.
//
// CRITICAL: the launch hot path (create -> buys) is timing-sensitive — a
// blocking DB write between create and the buys is exactly the kind of
// delay that caused the $TEST race. So the logger is fire-and-forget:
// it never awaits, never throws, never blocks the caller.

export type LaunchPhase =
  | 'create_sent'
  | 'create_confirmed'
  | 'curve_ready'
  | 'curve_timeout'
  | 'buy_sent'
  | 'buy_confirmed'
  | 'buy_failed'
  | 'retry_attempt'
  | 'retry_result'
  | 'launch_complete'
  | 'launch_error'
  | 'reconcile_scan'
  | 'reconcile_recovered'
  | 'reconcile_refunded'
  | 'reconcile_needs_manual'
  | 'reconcile_error';

export interface LaunchLogOpts {
  backerWallet?: string;
  ok?: boolean;
  signature?: string;
  detail?: unknown;
}

export type LaunchLogger = (phase: LaunchPhase, opts?: LaunchLogOpts) => void;

// Build a logger bound to a meme. Safe to call from the launch hot path.
export function createLaunchLogger(memeId: string): LaunchLogger {
  let supabase: ReturnType<typeof createServerClient> | null = null;
  try {
    supabase = createServerClient();
  } catch {
    // Missing env (e.g. build time) — degrade to console-only.
    supabase = null;
  }

  return (phase, opts = {}) => {
    const line = `[launch ${memeId}] ${phase}${opts.ok === false ? ' FAIL' : ''}`;
    if (opts.ok === false) {
      console.error(line, opts.signature || '', opts.detail ? JSON.stringify(opts.detail) : '');
    } else {
      console.log(line, opts.signature || '', opts.detail ? JSON.stringify(opts.detail) : '');
    }

    if (!supabase) return;

    let detail: unknown = null;
    if (opts.detail !== undefined) {
      try {
        detail = JSON.parse(JSON.stringify(opts.detail));
      } catch {
        detail = { unserializable: String(opts.detail) };
      }
    }

    // Fire-and-forget. Do NOT await — keeps the launch hot path fast.
    void supabase
      .from('launch_events')
      .insert({
        meme_id: memeId,
        backer_wallet: opts.backerWallet ?? null,
        phase,
        ok: opts.ok ?? true,
        signature: opts.signature ?? null,
        detail,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.error(`[launchLog] failed to persist ${phase}: ${error.message}`);
        }
      });
  };
}

// No-op logger for callers that don't supply one (keeps signatures clean).
export const noopLaunchLogger: LaunchLogger = () => {};
