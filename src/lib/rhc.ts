// Robinhood Chain (PoolLaunch) client config — chain, deployed addresses,
// ABIs. The EVM twin of the Solana stack, except there is no backend: the
// UI reads contract state directly and users sign their own transactions.
// The platform holds nothing and can break nothing.
import { defineChain, createPublicClient, http, parseAbi } from 'viem';

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
// v5 — ACTIVE. pons V2 + the trustless bot legs ported to Uniswap v4
// (dual-phase: curve buys pre-graduation, direct PoolManager after).
// Live-verified 2026-09-14: 21,447 bytes, 90/7/3, legDeployer wired.
export const POOLLAUNCH_FACTORY_V5 = '0xa5aC43cd8ff09e294240E97c2a63466B2c2a80E8' as const;
export const POOLLAUNCH_FACTORY_V4 = '0x552db842cdB40ea73Dcac6cfAe15AF1E03405a9D' as const; // pons V2, tax, no bot legs
export const POOLLAUNCH_FACTORY = '0xE2989dA79b04d64D9d68f476b6Ee8f971467b470' as const; // v3 — pons V1: burn + LP + vault legs
export const POOLLAUNCH_FACTORY_V2 = '0x129f7e8FaEab93C4c7E65033Be24ed383eBa6ad5' as const; // legacy, read-only
export const POOLLAUNCH_FACTORY_V1 = '0x74Fa741f5E4F0089227cb1ce45B1d00c9698388d' as const; // legacy, read-only
export const PONS_FACTORY = '0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75' as const;

export const rhcPublicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
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

export const splitterAbi = parseAbi([
  'function backerBps() view returns (uint16)',
  'function backerPool(address asset) view returns (uint256)',
  'function backerClaimed(address backer, address asset) view returns (uint256)',
  'function backerEntitlement(address backer, address asset) view returns (uint256)',
  'function distribute(address asset)',
  'function claimBacker(address asset)',
  'function claimLeg(address asset)',
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
  // v2 first (current), then v1 (legacy campaigns stay visible forever —
  // their contracts are immutable and keep working regardless of factory).
  const addrs: `0x${string}`[] = [];
  for (const factory of [POOLLAUNCH_FACTORY_V5, POOLLAUNCH_FACTORY_V4, POOLLAUNCH_FACTORY, POOLLAUNCH_FACTORY_V2, POOLLAUNCH_FACTORY_V1]) {
    try {
      const count = await rhcPublicClient.readContract({
        address: factory, abi: factoryAbi, functionName: 'campaignCount',
      });
      for (let i = 0n; i < count; i++) {
        addrs.push(await rhcPublicClient.readContract({
          address: factory, abi: factoryAbi, functionName: 'campaigns', args: [i],
        }));
      }
    } catch {
      // a single unreachable factory generation must never blank the board
      continue;
    }
  }
  const rows: CampaignRow[] = [];
  for (const address of addrs) {
    const c = { address, abi: campaignAbi } as const;
    const [meta, goal, totalRaised, backerCount, maxBackers, deadline, launched, cancelled, refundable, token, myContribution, myTokensClaimed] =
      await rhcPublicClient.multicall({
        contracts: [
          { ...c, functionName: 'tokenMeta' },
          { ...c, functionName: 'goal' },
          { ...c, functionName: 'totalRaised' },
          { ...c, functionName: 'backerCount' },
          { ...c, functionName: 'maxBackers' },
          { ...c, functionName: 'deadline' },
          { ...c, functionName: 'launched' },
          { ...c, functionName: 'cancelled' },
          { ...c, functionName: 'refundable' },
          { ...c, functionName: 'token' },
          { ...c, functionName: 'contributionOf', args: [who] },
          { ...c, functionName: 'tokensClaimed', args: [who] },
        ],
        allowFailure: false,
      }) as unknown as [
        { name: string; symbol: string }, bigint, bigint, bigint, bigint, bigint,
        boolean, boolean, boolean, `0x${string}`, bigint, boolean
      ];
    rows.push({
      address, name: meta.name, symbol: meta.symbol, goal, totalRaised,
      backerCount, maxBackers, deadline, launched, cancelled, refundable, token,
      myContribution, myTokensClaimed,
    });
  }
  return rows.reverse(); // newest first
}

export function explorerUrl(addr: string): string {
  return `https://robinhoodchain.blockscout.com/address/${addr}`;
}
