// Robinhood Chain (PoolLaunch) client config — chain, deployed addresses,
// ABIs. The EVM twin of the Solana stack, except there is no backend: the
// UI reads contract state directly and users sign their own transactions.
// The platform holds nothing and can break nothing.
import { defineChain, createPublicClient, fallback, http, parseAbi } from 'viem';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
  contracts: {
    // Canonical multicall3 — verified deployed on RHC (eth_getCode,
    // 2026-09-14). Without this, viem multicall throws "chain does not
    // support contract multicall3" and every /rhc page dies on read.
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
});

// Deployed 2026-09-13 — see contracts/rhc/DEPLOYMENTS.md. pons rotates
// factories; OUR factory is stable, the pons target is baked into each
// campaign at creation.
// v4 — ACTIVE. Targets pons V2 (the live pons generation): adjustable
// creator tax up to the pons cap (10%), pons-native buyback flywheel,
// native-ETH fee flow via the pons FeeEscrow, curve → locked Uniswap v4.
// v6 — ACTIVE. v5 + the creation buy-in: 0.001 ETH fee paid with
// createCampaign, forwarded straight to the platform recipient (never
// held by the factory); holder-waiver hooks dormant until the platform
// token exists on RHC.
export const POOLLAUNCH_FACTORY_V6 = '0xB86b783ccaCC20746ae9dd33CffE4a205B35E334' as const;
// v5 — pons V2 + trustless v4 bot legs, no creation fee. Read-only.
export const POOLLAUNCH_FACTORY_V5 = '0xa5aC43cd8ff09e294240E97c2a63466B2c2a80E8' as const;
export const POOLLAUNCH_FACTORY_V4 = '0x552db842cdB40ea73Dcac6cfAe15AF1E03405a9D' as const; // pons V2, tax, no bot legs
export const POOLLAUNCH_FACTORY = '0xE2989dA79b04d64D9d68f476b6Ee8f971467b470' as const; // v3 — pons V1: burn + LP + vault legs
export const POOLLAUNCH_FACTORY_V2 = '0x129f7e8FaEab93C4c7E65033Be24ed383eBa6ad5' as const; // legacy, read-only
export const POOLLAUNCH_FACTORY_V1 = '0x74Fa741f5E4F0089227cb1ce45B1d00c9698388d' as const; // legacy, read-only
export const PONS_FACTORY = '0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75' as const;

// ── v7 (CampaignFactoryV5) — LIVE since 2026-09-20 ────────────────────
// Team rounds, token gating, ERC20/stock-quoted raises, creator-set
// payout asset, 0x…5EED signature addresses. Constructor args verified
// on-chain (tools/_verify-v7-deploy.mjs). V7_LIVE is a build-time env
// switch (NEXT_PUBLIC_V7_LIVE=1), ON in production since 2026-09-20 —
// every prod deploy must carry it (project env or --build-env).
export const POOLLAUNCH_FACTORY_V7 = '0x6928C1Ace232124641e9cfFEfD16D82E1B9c531B' as const; // ACTIVE since 2026-09-20
export const LEG_DEPLOYER_V3 = '0x518B6b80736af35D25F98Cc403A7f2dD8a0763AB' as const;
export const CAMPAIGN_DEPLOYER_V3 = '0xdDCf167F6DA48e8f6C1fC716fDFef4CCEEBd4fe3' as const;
// Build-time env switch, default OFF (see rhcEquity.ts for the rationale).
export const V7_LIVE = process.env.NEXT_PUBLIC_V7_LIVE === '1';

// ── v8: the rev flywheel. Everything below is empty until deploy day; the
// flip is three build-time env values and a rebuild, no code change:
//   NEXT_PUBLIC_V8_LIVE=1
//   NEXT_PUBLIC_POOLLAUNCH_FACTORY_V8=0x…   (CampaignFactoryV6)
//   NEXT_PUBLIC_PROOF_BURNER=0x…            (ProofBurner)
// Order is forced by immutables: PROOF launches on v7 → burner → v8.
// See contracts/rhc/LAUNCH_RUNBOOK.md.
export const V8_LIVE = process.env.NEXT_PUBLIC_V8_LIVE === '1';
export const POOLLAUNCH_FACTORY_V8 = (process.env.NEXT_PUBLIC_POOLLAUNCH_FACTORY_V8 || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const PROOF_BURNER = (process.env.NEXT_PUBLIC_PROOF_BURNER || '0x0000000000000000000000000000000000000000') as `0x${string}`;
export const PROOF_BURNER_LIVE = PROOF_BURNER !== '0x0000000000000000000000000000000000000000';
/// The two fixed legs on every campaign's creator tax: PROOF burn 30 +
/// platform 10 (founder, 2026-09-22). This is THE model the site shows,
/// including in the days before v8 exists — the only campaign meant to be
/// created on v7 in that window is $PROOF's own, and the create page says
/// so out loud (FIXED_LEGS_NOTE). Backers get the remainder after the
/// creator's optional legs.
export const FIXED_LEGS_PCT = { burn: 30, platform: 10, total: 40 } as const;
export const FIXED_LEGS_NOTE = V8_LIVE ? '' : "Until $PROOF launches, today's factory still carries 7% platform + 3% (retired) instead — the flywheel legs replace them the moment it does.";
export const ACTIVE_FACTORY = V8_LIVE ? POOLLAUNCH_FACTORY_V8 : POOLLAUNCH_FACTORY_V7;

export const proofBurnerAbi = parseAbi([
  'function proofToken() view returns (address)',
  'function totalEthPulled() view returns (uint256)',
  'function totalEthSpent() view returns (uint256)',
  'function totalTokensBurned() view returns (uint256)',
  'function pendingEth() view returns (uint256)',
  'function lastCrankBlock() view returns (uint256)',
  'function pull(address splitter_)',
  'function pullMany(address[] splitters)',
  'function crank()',
]);

// Quote assets a raise can be denominated in. ETH is native; the rest
// must be pons-approved pair tokens (verified on-chain 2026-09-16) and
// carry their own decimals — never assume 18.
export interface QuoteAsset {
  address: `0x${string}`;
  symbol: string;
  label: string;
  decimals: number;
  blurb: string;
  /** Sensible raise sizes for this asset — 1 ETH and 1 USDG are not the
   *  same order of magnitude, so presets and the beta cap travel with
   *  the asset rather than being hardcoded in ETH. */
  goalPresets: string[];
  minPresets: string[];
  seatPresets: string[];
  betaCap: number;
}

export const QUOTE_ASSETS: QuoteAsset[] = [
  {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    label: 'ETH',
    decimals: 18,
    blurb: 'The native quote. Trustless bot legs available.',
    goalPresets: ['0.1', '0.25', '0.5', '1', '1.5', '2'],
    minPresets: ['0.01', '0.025', '0.05', '0.1', '0.25', '0.5'],
    seatPresets: ['0.01', '0.025', '0.05', '0.1', '0.25', '0.5'],
    betaCap: 2,
  },
  {
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    symbol: 'USDG',
    label: 'USDG',
    decimals: 6,
    blurb: 'Global Dollar. A stable-denominated raise: the goal means the same thing tomorrow.',
    goalPresets: ['250', '500', '1000', '2500', '5000'],
    minPresets: ['5', '10', '25', '50', '100'],
    seatPresets: ['10', '25', '50', '100', '250'],
    betaCap: 5000,
  },
  {
    address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa',
    symbol: 'SPCX',
    label: 'SPCX (SpaceX)',
    decimals: 18,
    blurb: 'Tokenized SpaceX stock. Pool equity, launch a token, earn the fee stream in it.',
    goalPresets: ['1', '2.5', '5', '10', '25'],
    minPresets: ['0.05', '0.1', '0.25', '0.5', '1'],
    seatPresets: ['0.1', '0.25', '0.5', '1', '2.5'],
    betaCap: 25,
  },
];

// RPC speed matters more than brand: the official gateway is Cloudflare-
// fronted and ~1.5s/request; publicnode and ordofi answer in 70–350ms
// (benchmarked 2026-09-15). Fallback order = fastest first, official as
// the last resort — reads fail over automatically.
export const RHC_RPC_URLS = [
  'https://robinhood-rpc.publicnode.com',
  'https://rpc.ordofi.network',
  'https://rpc.mainnet.chain.robinhood.com',
] as const;

export const rhcPublicClient = createPublicClient({
  chain: robinhoodChain,
  transport: fallback(RHC_RPC_URLS.map((u) => http(u, { timeout: 8_000 }))),
});

export const factoryAbi = parseAbi([
  'function campaignCount() view returns (uint256)',
  'function campaigns(uint256) view returns (address)',
  'function platformBps() view returns (uint16)',
  'function holderRewardsBps() view returns (uint16)',
  'function createCampaign(address ponsFactory, uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint256 dexId, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta, uint16 burnBps, uint16 lpBps, address[] vaultRecipients, uint16[] vaultBps) returns (address)',
  'event CampaignCreated(address indexed campaign, address indexed creator, address feeSplitter, uint256 goal, uint256 deadline, string symbol)',
]);

export const campaignAbi = parseAbi([
  'function creator() view returns (address)',
  'function goal() view returns (uint256)',
  'function minDeposit() view returns (uint256)',
  'function maxDeposit() view returns (uint256)',
  'function maxBackers() view returns (uint256)',
  'function deadline() view returns (uint256)',
  'function totalRaised() view returns (uint256)',
  'function backerCount() view returns (uint256)',
  'function launched() view returns (bool)',
  'function cancelled() view returns (bool)',
  'function refundable() view returns (bool)',
  'function token() view returns (address)',
  'function feeSplitter() view returns (address)',
  'function tokensAtLaunch() view returns (uint256)',
  'function totalRaisedAtLaunch() view returns (uint256)',
  'function contributionOf(address) view returns (uint256)',
  'function tokensClaimed(address) view returns (bool)',
  'function tokenMeta() view returns ((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet))',
  'function deposit() payable',
  'function withdraw()',
  'function launch()',
  'function claimTokens()',
  'function refund()',
  'function cancel()',
  'function pokeCollect()',
  // v4 (pons V2) campaigns only — curve() doubles as the generation probe
  'function curve() view returns (address)',
  'function creatorTaxBps() view returns (uint16)',
  'function excessAtLaunch() view returns (uint256)',
  'function pokeHarvest()',
]);

// v7 factory — the full option surface behind one CampaignParams struct.
export const factoryV5Abi = parseAbi([
  'function createCampaign((uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint16 creatorTaxBps, bool buybackEnabled, address quoteToken, address gateToken, uint256 gateMinBalance, uint16 reservedSeats, address[] allowlist, address payoutAsset, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta) p, uint16 burnBps, uint16 lpBps, address[] vaultRecipients, uint16[] vaultBps, bytes32 salt) payable returns (address)',
  'function previewInitCodeHash(address creator, (uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint16 creatorTaxBps, bool buybackEnabled, address quoteToken, address gateToken, uint256 gateMinBalance, uint16 reservedSeats, address[] allowlist, address payoutAsset, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta) p, uint16 burnBps, uint16 lpBps, address[] vaultRecipients, uint16[] vaultBps, address predictedBurnLeg, address predictedLpLeg) view returns (bytes32)',
  'function creationFee() view returns (uint256)',
  'function creationFeeFor(address creator) view returns (uint256)',
  'function campaignDeployer() view returns (address)',
  'function legDeployer() view returns (address)',
  'function campaignCount() view returns (uint256)',
  'function campaigns(uint256) view returns (address)',
  'event CampaignCreated(address indexed campaign, address indexed creator, address feeSplitter, uint256 goal, uint256 deadline, string symbol)',
]);

// v7 campaign — everything v6 had, plus the quote asset, the gate, the
// seat buckets and the ERC20 deposit path.
export const campaignV3Abi = parseAbi([
  'function quoteToken() view returns (address)',
  'function gateToken() view returns (address)',
  'function gateMinBalance() view returns (uint256)',
  'function reservedSeats() view returns (uint16)',
  'function reservedSeatsUsed() view returns (uint256)',
  'function publicSeatsUsed() view returns (uint256)',
  'function seatBucket(address) view returns (uint8)',
  'function allowlisted(address) view returns (bool)',
  'function launchFeeEscrowed() view returns (uint256)',
  'function launchFeeRefunded() view returns (bool)',
  'function payoutAsset() view returns (address)',
  'function depositToken(uint256 amount)',
  'function refundLaunchFee()',
]);

// v6 factory — v5 + payable creation fee with on-chain holder waiver.
export const factoryV4Abi = parseAbi([
  'function createCampaign(uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint16 creatorTaxBps, bool buybackEnabled, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta, uint16 burnBps, uint16 lpBps, address[] vaultRecipients, uint16[] vaultBps) payable returns (address)',
  'function creationFee() view returns (uint256)',
  'function creationFeeFor(address creator) view returns (uint256)',
  'function campaignCount() view returns (uint256)',
  'function campaigns(uint256) view returns (address)',
  'event CampaignCreated(address indexed campaign, address indexed creator, address feeSplitter, uint256 goal, uint256 deadline, string symbol)',
]);

// v5 factory — tax + trustless v4 bot legs + vault legs.
export const factoryV3Abi = parseAbi([
  'function createCampaign(uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint16 creatorTaxBps, bool buybackEnabled, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta, uint16 burnBps, uint16 lpBps, address[] vaultRecipients, uint16[] vaultBps) returns (address)',
  'function campaignCount() view returns (uint256)',
  'function campaigns(uint256) view returns (address)',
  'event CampaignCreated(address indexed campaign, address indexed creator, address feeSplitter, uint256 goal, uint256 deadline, string symbol)',
]);

// v4 factory — pons targets are baked in at deploy; creator supplies the
// raise terms, the tax, the buyback flag, and any vault legs.
export const factoryV2Abi = parseAbi([
  'function createCampaign(uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint16 creatorTaxBps, bool buybackEnabled, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta, address[] vaultRecipients, uint16[] vaultBps) returns (address)',
  'function campaignCount() view returns (uint256)',
  'function campaigns(uint256) view returns (address)',
  'event CampaignCreated(address indexed campaign, address indexed creator, address feeSplitter, uint256 goal, uint256 deadline, string symbol)',
]);

// pons V2 bonding curve — buy/sell are public; our campaign page trades
// directly so token ACCESS never depends on any external UI or wallet
// display. Post-graduation the curve refuses trades (pool takes over).
export const curveAbi = parseAbi([
  'function graduated() view returns (bool)',
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)',
  'function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256)',
]);

// v8 campaigns (CampaignV4) only — the pre-launch lock. MAX_LOCK() doubles
// as the generation probe; older campaigns have none of this.
export const campaignV4Abi = parseAbi([
  // lock is measured in DAYS FROM LAUNCH; lockUntil() is 0 until launch
  'function lockDays(address) view returns (uint32)',
  'function lockUntil(address) view returns (uint64)',
  'function lockMultiplierBps(uint32 days_) pure returns (uint16)',
  'function MAX_LOCK_DAYS() view returns (uint32)',
  'function launchedAt() view returns (uint64)',
  'function excessClaimed(address) view returns (bool)',
  'function depositLocked(uint32 days_) payable',
  'function depositTokenLocked(uint256 amount, uint32 days_)',
  'function extendLock(uint32 days_)',
  'function claimExcess()',
]);

/// The lock tiers, mirrored from CampaignV4.lockMultiplierBps so the UI can
/// say "×1.5" before the wallet opens. Contract is the source of truth.
export function lockMultiplier(days: number): number {
  return days >= 365 ? 1.5 : days >= 180 ? 1.25 : 1;
}

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export const splitterAbi = parseAbi([
  'function backerBps() view returns (uint16)',
  'function backerPool(address asset) view returns (uint256)',
  'function backerClaimed(address backer, address asset) view returns (uint256)',
  'function backerEntitlement(address backer, address asset) view returns (uint256)',
  'function distribute(address asset)',
  'function claimBacker(address asset)',
  // v7 splitters only (FeeSplitterV3): route the ETH entitlement to an
  // ETH-paired v4 asset in the same tx. Older splitters lack these and the
  // page must not offer them.
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'function equityRouter() view returns (address)',
  'function claimBackerAs(PoolKey key, uint256 minOut) returns (uint256 assetOut)',
  'function claimLegAs(PoolKey key, uint256 minOut) returns (uint256 assetOut)',
  'function claimLeg(address asset)',
  // v8 splitters only (FeeSplitterV4) — the fee stream follows the tokens.
  // forfeitTo() doubles as the generation probe. backerOwed is THE number
  // to show: entitlement − claimed overstates a seller.
  'function forfeitTo() view returns (address)',
  'function proofBurnBps() view returns (uint16)',
  'function backerOwed(address backer, address asset) view returns (uint256)',
  'function heldBps(address backer) view returns (uint16)',
  'function settle(address backer, address asset)',
]);

// WETH on Robinhood Chain (pons pair token, from TokenLaunched events)
export const RHC_WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as const;

// Platform airdrop operator — creators add it as a vault leg to opt into
// platform-run holder snapshot airdrops (tools/rhc-holder-airdrop.mjs), the
// same machinery as the SOL launches. Clearly labeled non-trustless in UI.
export const AIRDROP_OPERATOR = '0xFd88ee2413514374654eD267A80ebE3319cAB3B9' as const;

export function fmtEth(wei: bigint, digits = 4): string {
  return (Number(wei) / 1e18).toFixed(digits);
}

// One row per campaign, everything the UI needs, including the connected
// wallet's position when `me` is provided. Reads the chain directly —
// fine at beta scale, replace with an indexer when volume demands.
export interface CampaignRow {
  address: `0x${string}`;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
  creator: `0x${string}`;
  goal: bigint;
  totalRaised: bigint;
  backerCount: bigint;
  maxBackers: bigint; // 0 = open (unlimited backers)
  deadline: bigint;
  launched: boolean;
  cancelled: boolean;
  refundable: boolean;
  token: `0x${string}`;
  myContribution: bigint;
  myTokensClaimed: boolean;
}

export async function fetchAllCampaigns(me?: `0x${string}`): Promise<CampaignRow[]> {
  const zero = '0x0000000000000000000000000000000000000000' as `0x${string}`;
  const who = me ?? zero;
  // v7 joins the board only when the flag is on — a campaign created on
  // it while dark would otherwise launch fine and then be invisible here.
  const factories = [
    ...(V8_LIVE ? [POOLLAUNCH_FACTORY_V8] : []),
    ...(V7_LIVE ? [POOLLAUNCH_FACTORY_V7] : []),
    POOLLAUNCH_FACTORY_V6, POOLLAUNCH_FACTORY_V5, POOLLAUNCH_FACTORY_V4, POOLLAUNCH_FACTORY, POOLLAUNCH_FACTORY_V2, POOLLAUNCH_FACTORY_V1,
  ];

  // THREE round-trips total, regardless of campaign count. The old
  // shape awaited one RPC call per campaign per factory sequentially —
  // seconds of spinner for a handful of rows. (allowFailure everywhere:
  // one dead factory generation or one weird campaign never blanks the
  // board.)

  // #1 — every factory's campaignCount in one multicall
  const counts = await rhcPublicClient.multicall({
    contracts: factories.map((address) => ({ address, abi: factoryAbi, functionName: 'campaignCount' as const })),
    allowFailure: true,
  });

  // #2 — every campaigns(i) across every factory in one multicall
  const indexCalls: { address: `0x${string}`; abi: typeof factoryAbi; functionName: 'campaigns'; args: [bigint] }[] = [];
  factories.forEach((address, f) => {
    const n = counts[f].status === 'success' ? (counts[f].result as bigint) : 0n;
    for (let i = 0n; i < n; i++) indexCalls.push({ address, abi: factoryAbi, functionName: 'campaigns', args: [i] });
  });
  if (indexCalls.length === 0) return [];
  const addrRes = await rhcPublicClient.multicall({ contracts: indexCalls, allowFailure: true });
  const addrs = addrRes.filter((r) => r.status === 'success').map((r) => r.result as `0x${string}`);

  // #3 — all 13 fields for all campaigns, flattened into one multicall
  const FIELDS = 13;
  const fieldCalls = addrs.flatMap((address) => {
    const c = { address, abi: campaignAbi } as const;
    return [
      { ...c, functionName: 'tokenMeta' as const },
      { ...c, functionName: 'creator' as const },
      { ...c, functionName: 'goal' as const },
      { ...c, functionName: 'totalRaised' as const },
      { ...c, functionName: 'backerCount' as const },
      { ...c, functionName: 'maxBackers' as const },
      { ...c, functionName: 'deadline' as const },
      { ...c, functionName: 'launched' as const },
      { ...c, functionName: 'cancelled' as const },
      { ...c, functionName: 'refundable' as const },
      { ...c, functionName: 'token' as const },
      { ...c, functionName: 'contributionOf' as const, args: [who] as const },
      { ...c, functionName: 'tokensClaimed' as const, args: [who] as const },
    ];
  });
  const res = await rhcPublicClient.multicall({ contracts: fieldCalls, allowFailure: true });

  const rows: CampaignRow[] = [];
  addrs.forEach((address, i) => {
    const slice = res.slice(i * FIELDS, (i + 1) * FIELDS);
    if (slice.some((r) => r.status !== 'success')) return; // skip broken row, keep the board
    const v = slice.map((r) => r.result);
    const meta = v[0] as { name: string; symbol: string; logo: string; description: string;
      socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string } };
    rows.push({
      address, name: meta.name, symbol: meta.symbol, logo: meta.logo,
      description: meta.description, socials: meta.socials,
      creator: v[1] as `0x${string}`,
      goal: v[2] as bigint, totalRaised: v[3] as bigint, backerCount: v[4] as bigint,
      maxBackers: v[5] as bigint, deadline: v[6] as bigint,
      launched: v[7] as boolean, cancelled: v[8] as boolean, refundable: v[9] as boolean,
      token: v[10] as `0x${string}`,
      myContribution: v[11] as bigint, myTokensClaimed: v[12] as boolean,
    });
  });
  return rows.reverse(); // newest first
}

// ── session cache: paint instantly, revalidate in background ────────
// The SOL board feels instant because it renders from a cached fetch
// while fresh data streams in; same pattern here, chain-flavored.
// BigInts survive via string tagging.
const BOARD_CACHE_KEY = 'rhc-board-cache-v1';

export function serializeRows(rows: CampaignRow[]): string {
  return JSON.stringify(rows, (_k, val) => (typeof val === 'bigint' ? '#bigint:' + val.toString() : val));
}

export function parseRows(json: string): CampaignRow[] {
  return JSON.parse(json, (_k, val) =>
    typeof val === 'string' && val.startsWith('#bigint:') ? BigInt(val.slice(8)) : val
  ) as CampaignRow[];
}

export function readBoardCache(me?: `0x${string}`): CampaignRow[] | null {
  try {
    const raw = sessionStorage.getItem(BOARD_CACHE_KEY + (me ?? ''));
    if (!raw) return null;
    return parseRows(raw);
  } catch { return null; }
}

/// Call after anything that changes the board (a create, a launch). Drops
/// every session-cache variant and flags the next board load to bypass
/// the CDN too — otherwise a brand-new campaign can be invisible for up
/// to 30 s (punch list #2, found on the first prod test).
const BOARD_DIRTY_KEY = 'rhc-board-dirty';
export function clearBoardCache(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(BOARD_CACHE_KEY)) sessionStorage.removeItem(k);
    }
    sessionStorage.setItem(BOARD_DIRTY_KEY, '1');
  } catch { /* storage blocked */ }
}
/// True once after clearBoardCache(); consuming it clears the flag.
export function takeBoardDirty(): boolean {
  try {
    const d = sessionStorage.getItem(BOARD_DIRTY_KEY) === '1';
    if (d) sessionStorage.removeItem(BOARD_DIRTY_KEY);
    return d;
  } catch { return false; }
}

export function writeBoardCache(rows: CampaignRow[], me?: `0x${string}`): void {
  try {
    sessionStorage.setItem(BOARD_CACHE_KEY + (me ?? ''), serializeRows(rows));
  } catch { /* private mode etc — cache is a bonus, never a requirement */ }
}

export function explorerUrl(addr: string): string {
  return `https://robinhoodchain.blockscout.com/address/${addr}`;
}
