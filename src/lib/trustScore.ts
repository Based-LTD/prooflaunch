// Trust Score Calculator
// Calculates a 0-100 trust score based on creator parameters

export interface TrustScoreParams {
  creator_fee_pct: number;      // 0-10%
  backer_share_pct: number;     // 50-90%
  dev_initial_buy_sol: number;  // 0+ SOL
  backing_goal_sol: number;     // Used to calculate dev buy as % of goal
  duration: number;             // Backing duration in days
}

export interface TrustScoreBreakdown {
  total: number;
  components: {
    label: string;
    value: string;
    points: number;
    maxPoints: number;
    description: string;
  }[];
}

// Calculate individual component scores
function getCreatorFeeScore(pct: number): { points: number; description: string } {
  // 0% = +30, 2% = +24, 5% = +12, 10% = 0
  if (pct <= 0) return { points: 30, description: 'No creator fee' };
  if (pct <= 1) return { points: 27, description: 'Minimal fee (1%)' };
  if (pct <= 2) return { points: 24, description: 'Low fee (2%)' };
  if (pct <= 3) return { points: 18, description: 'Standard fee (3%)' };
  if (pct <= 5) return { points: 12, description: 'Above average fee' };
  if (pct <= 7) return { points: 6, description: 'High fee' };
  return { points: 0, description: 'Maximum fee (10%)' };
}

function getBackerShareScore(pct: number): { points: number; description: string } {
  // 90% = +30, 70% = +18, 50% = 0
  if (pct >= 90) return { points: 30, description: 'Max backer share (90%)' };
  if (pct >= 85) return { points: 27, description: 'Very high share (85%)' };
  if (pct >= 80) return { points: 24, description: 'High share (80%)' };
  if (pct >= 75) return { points: 21, description: 'Good share (75%)' };
  if (pct >= 70) return { points: 18, description: 'Standard share (70%)' };
  if (pct >= 60) return { points: 10, description: 'Below average share' };
  return { points: 0, description: 'Minimum share (50%)' };
}

function getDevBuyScore(devBuySol: number, goalSol: number): { points: number; description: string } {
  // Calculate as percentage of goal
  const pctOfGoal = (devBuySol / goalSol) * 100;

  // 0% = +30, 5% = +18, 10% = +12, 25% = +6, 50%+ = 0
  if (devBuySol === 0) return { points: 30, description: 'No dev snipe' };
  if (pctOfGoal <= 5) return { points: 24, description: 'Tiny dev buy (<5%)' };
  if (pctOfGoal <= 10) return { points: 18, description: 'Small dev buy (10%)' };
  if (pctOfGoal <= 25) return { points: 12, description: 'Moderate dev buy' };
  if (pctOfGoal <= 50) return { points: 6, description: 'Large dev buy' };
  return { points: 0, description: 'Dev buying most of supply' };
}

function getDurationScore(days: number): { points: number; description: string } {
  // Longer = more trust (gives community time to research)
  if (days >= 7) return { points: 10, description: 'Full week backing' };
  if (days >= 5) return { points: 8, description: '5 day backing' };
  if (days >= 3) return { points: 5, description: '3 day backing' };
  return { points: 2, description: 'Rush backing (1 day)' };
}

// Main calculator
export function calculateTrustScore(params: TrustScoreParams): TrustScoreBreakdown {
  const creatorFee = getCreatorFeeScore(params.creator_fee_pct);
  const backerShare = getBackerShareScore(params.backer_share_pct);
  const devBuy = getDevBuyScore(params.dev_initial_buy_sol, params.backing_goal_sol);
  const duration = getDurationScore(params.duration);

  const total = creatorFee.points + backerShare.points + devBuy.points + duration.points;

  return {
    total,
    components: [
      {
        label: 'Creator Fee',
        value: `${params.creator_fee_pct}%`,
        points: creatorFee.points,
        maxPoints: 30,
        description: creatorFee.description,
      },
      {
        label: 'Backer Share',
        value: `${params.backer_share_pct}%`,
        points: backerShare.points,
        maxPoints: 30,
        description: backerShare.description,
      },
      {
        label: 'Dev Initial Buy',
        value: params.dev_initial_buy_sol === 0 ? 'None' : `${params.dev_initial_buy_sol} SOL`,
        points: devBuy.points,
        maxPoints: 30,
        description: devBuy.description,
      },
      {
        label: 'Backing Duration',
        value: `${params.duration} day${params.duration > 1 ? 's' : ''}`,
        points: duration.points,
        maxPoints: 10,
        description: duration.description,
      },
    ],
  };
}

// Get trust score color based on score
export function getTrustScoreColor(score: number): string {
  if (score >= 90) return 'text-green-400';
  if (score >= 75) return 'text-green-500';
  if (score >= 60) return 'text-yellow-500';
  if (score >= 40) return 'text-orange-500';
  return 'text-red-500';
}

// Get trust score label
export function getTrustScoreLabel(score: number): string {
  if (score >= 90) return 'Highly Trusted';
  if (score >= 75) return 'Trusted';
  if (score >= 60) return 'Moderate';
  if (score >= 40) return 'Caution';
  return 'High Risk';
}

// Get background color class for trust score badge
export function getTrustScoreBgColor(score: number): string {
  if (score >= 90) return 'bg-green-500/20';
  if (score >= 75) return 'bg-green-500/15';
  if (score >= 60) return 'bg-yellow-500/15';
  if (score >= 40) return 'bg-orange-500/15';
  return 'bg-red-500/15';
}
