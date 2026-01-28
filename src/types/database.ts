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

  // Backing config
  backing_goal_sol: number;      // How much SOL needed to launch (e.g., 10 SOL)
  current_backing_sol: number;   // Current amount backed
  backing_deadline: string;      // ISO date - when backing period ends

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
}

export interface Backing {
  id: string;
  created_at: string;

  meme_id: string;
  backer_wallet: string;
  amount_sol: number;

  // Transaction tracking
  deposit_tx?: string;           // SOL deposit to escrow
  refund_tx?: string;            // If meme fails to launch
  token_distribution_tx?: string; // When tokens are distributed

  // Status
  status: 'pending' | 'confirmed' | 'refunded' | 'distributed' | 'withdrawn';
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
  backing_goal_sol: number;
  backing_days: number;  // How many days for backing period
  // Trust score parameters
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
