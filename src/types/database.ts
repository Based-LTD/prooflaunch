// Database types for Proof Launch

export type MemeStatus = 'pending' | 'backing' | 'funded' | 'launching' | 'live' | 'failed';

export interface Meme {
  id: string;
  created_at: string;
  updated_at: string;

  // Creator info
  creator_wallet: string;

  // Token metadata
  name: string;
  symbol: string;
  description: string;
  image_url: string;

  // Creator's personal social (Proof Launch only, not in token metadata)
  creator_twitter?: string;

  // Social links (will be in token metadata)
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;

  // Backing config (slot-based system)
  total_slots: number;           // 2-24 backer slots (raised from 8 in migration 021)
  reserved_slots: number;        // 0..total_slots-1 (migration 037). When > 0, the last N
                                 // slot positions are gated to backing_allowlist wallets.
                                 // Open slots = total_slots - reserved_slots.
  min_backing_sol: number;       // Minimum SOL per backer (set by creator)
  current_backing_sol: number;   // Total amount backed (sum of all backings)
  backing_deadline: string;      // ISO date - when backing period ends (3 days default)
  funded_at?: string;            // ISO date - when status flipped to funded; null = pre-019 grandfathered (no 24h launch deadline)
  launch_deadline?: string;      // ISO date - funded meme must launch or auto-refund by this time; creator can reset via /api/memes/{id}/reset-launch-window (migration 027)

  // Legacy field (deprecated, kept for backward compatibility)
  backing_goal_sol?: number;     // Old goal-based system - no longer used

  // Status
  status: MemeStatus;

  // Launch info (populated after launch)
  mint_address?: string;
  pump_fun_url?: string;
  launched_at?: string;

  // Platform fees
  submission_fee_paid: boolean;
  platform_fee_bps: number;      // Basis points (e.g., 200 = 2%)

  // Trust score parameters (set by creator)
  creator_fee_pct: number;       // 0-10% - creator's cut of trading fees
  backer_share_pct: number;      // 50-90% - genesis backers' share of trading fees
  dev_initial_buy_sol: number;   // Dev's planned initial buy (0 = no snipe)
  auto_refund: boolean;          // Whether backers auto-refunded on failure
  trust_score: number;           // Calculated 0-100 trust score

  // Launch Configuration v2 — visibility mode (migration 029)
  // open      = standard public launch (default for legacy + opt-out)
  // stealth   = hidden from public listings, allowlist-only backing
  // spectator = public listing, allowlist-only backing
  visibility?: 'open' | 'stealth' | 'spectator';

  // Team-fairness cap (migration 032). Optional creator-set max per backer.
  // NULL = uncapped. When set, applies universally (allowlisted + public)
  // so no wallet can out-back any other. Must be ≥ min_backing_sol.
  max_backing_sol?: number | null;

  // Phase 4 — Keycard backer-lounge gate (migration 033). Populated by
  // /api/keycard/sync after the meme goes live and a gate is created
  // for ">0 balance of mint_address" holders. NULL = no gate yet.
  keycard_gate_id?: string | null;
  keycard_gate_url?: string | null;
  keycard_synced_at?: string | null;

  // Launch Configuration v2 — fee distribution config (migration 030).
  // NULL on legacy memes (use hardcoded distribution). When set, the
  // five _pct fields sum to 100 and override the legacy logic.
  fee_preset?: 'standard' | 'community_first' | 'deflationary' | 'charity_aligned' | 'custom' | null;
  fee_backer_pct?: number | null;
  fee_holder_rewards_pct?: number | null;
  fee_platform_pct?: number | null;
  fee_burn_pct?: number | null;
  fee_charity_pct?: number | null;
  fee_charity_wallet?: string | null;

  // Phase 3 — Per-meme buyback bot (migration 031).
  // When enabled, a system-controlled wallet takes one of the launch slots
  // and accrues claimable_fees_sol like any backer. A cron periodically
  // claims, swaps SOL → meme token via Jupiter, and executes the action.
  buyback_bot_enabled?: boolean;
  buyback_bot_action?:
    | 'burn'
    | 'hold'
    | 'distribute_tokens_holders'
    | 'distribute_tokens_backers'
    | 'distribute_sol_holders'
    | 'distribute_sol_backers'
    // Legacy/deprecated values kept so existing rows don't break the type:
    | 'distribute_holders'
    | 'distribute_backers'
    | null;
  buyback_bot_wallet?: string | null;
  buyback_bot_fee_pct?: number;
  buyback_bot_last_run_at?: string | null;
  buyback_bot_total_sol_spent?: number;
  buyback_bot_total_tokens_acted?: number;

  // Phase B — bot stack. Populated by /api/memes/[id]; empty array for
  // memes that haven't enabled any bots.
  bots?: MemeBot[];
}

// Phase B — one row per bot in a meme's stack. A meme can have up to
// 6 bots (one per distinct action). Each bot has its own dedicated
// wallet for self-contained on-chain auditing.
export interface MemeBot {
  id: string;
  meme_id: string;
  slot_order: number;
  action:
    | 'burn'
    | 'hold'
    | 'distribute_tokens_holders'
    | 'distribute_tokens_backers'
    | 'distribute_sol_holders'
    | 'distribute_sol_backers'
    | 'donate_sol'
    | 'donate_tokens';
  fee_pct: number;
  bot_wallet: string;
  // Required when action='hold' (vault label like "Marketing"). Optional
  // for action='donate_*' (display name like "Charity"). NULL for all
  // other actions. Enforced by migration 042 / 043 CHECK constraints.
  label: string | null;
  // Required when action='donate_*' — immutable destination pubkey set
  // at submit and never updated. NULL for all other actions.
  destination_wallet?: string | null;
  last_run_at?: string | null;
  total_sol_spent: number;
  total_tokens_acted: number;
  created_at: string;
}

export interface Backing {
  id: string;
  created_at: string;

  meme_id: string;
  backer_wallet: string;
  amount_sol: number;
  slot_number: number;           // 1-8, assigned in order of backing

  // Transaction tracking
  deposit_tx?: string;           // SOL deposit to escrow
  refund_tx?: string;            // If meme fails to launch
  token_distribution_tx?: string; // When tokens are distributed

  // Status
  status: 'pending' | 'confirmed' | 'refunded' | 'distributed' | 'withdrawn';
}

// Slot tier types
// Genesis (slots 1-4) buy first at the lowest prices on the curve.
// Wave 2 (slots 5-8) buy immediately after in a second batch.
export type SlotTier = 'genesis' | 'wave2';

export function getSlotTier(slotNumber: number): SlotTier {
  return slotNumber <= 4 ? 'genesis' : 'wave2';
}

export interface User {
  wallet_address: string;
  created_at: string;

  // Stats
  memes_created: number;
  memes_backed: number;
  total_backed_sol: number;

  // Reputation (for future features)
  successful_launches: number;
  reputation_score: number;
}

// API request/response types
export interface SubmitMemeRequest {
  name: string;
  symbol: string;
  description: string;
  image: File;
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  total_slots: number;       // 2-24 backer slots (raised from 8 in migration 021)
  min_backing_sol: number;   // Minimum SOL per backer
  // Trust score parameters (legacy, mostly unused now)
  creator_fee_pct: number;
  backer_share_pct: number;
  dev_initial_buy_sol: number;
  auto_refund: boolean;
}

export interface BackMemeRequest {
  meme_id: string;
  amount_sol: number;
}

export interface MemeWithBackings extends Meme {
  backings: Backing[];
  backer_count: number;
}
