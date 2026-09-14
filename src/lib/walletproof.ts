// WalletProof RHC — "who is really buying" verdicts for Pons tokens. Read-only client for the private WalletProof
// engine; the API returns counts, shares and tiers only (never wallet lists), so everything here is safe to render.
export const WALLETPROOF_RHC_URL = (process.env.NEXT_PUBLIC_WALLETPROOF_RHC_URL || 'http://localhost:8100').replace(/\/$/, '');

export type WpTier = 'REAL' | 'THIN' | 'ELEVATED' | 'MANUFACTURED';
export interface WpVerdict {
  token: `0x${string}`; curve: `0x${string}`; name: string; symbol: string; deployer: `0x${string}`;
  tier: WpTier; emoji: string; label: string; blurb: string; reasons: string[];
  buyers: { total: number; real: number; crew: number; bots: number; one_shot: number; top_buyer_share: number };
  volume_eth: { buy: number; sell: number; dev_buy: number; crew_share: number; bot_share: number; one_shot_share: number; real_share: number };
  curve_state: { reserve_eth: number; peak_eth: number; graduated: boolean; dumps: number; sellers: number; age_s: number };
  deployer_history: { launches: number; graduations: number; farm_tokens: number; crew_dumped_tokens: number };
  receipt?: { launch_block: number; last_block: number; indexed_to_block: number; trades: number; method: string };
}
export interface WpStats {
  hours: number; indexed_to_block: number; launches: number; deployers: number; buy_volume_eth: number; crew_buy_share: number;
  graduations: number; graduations_by_tier: Record<WpTier, number>; manufactured_graduation_deployers: number;
  known_crew_wallets: number; known_farm_or_crew_deployers: number;
}

export const WP_TIER_COLOR: Record<WpTier, string> = {
  REAL: 'var(--success)', THIN: 'var(--muted)', ELEVATED: 'var(--accent-gold)', MANUFACTURED: 'var(--error)',
};

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${WALLETPROOF_RHC_URL}${path}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}
export const fetchVerdict = (tokenOrCurve: string) => get<WpVerdict>(`/v1/rhc/token/${tokenOrCurve}`);
export const fetchWpStats = (hours = 24) => get<WpStats>(`/v1/rhc/stats?hours=${hours}`);
export const fetchWpRecent = (limit = 30) => get<WpVerdict[]>(`/v1/rhc/recent?limit=${limit}`);
