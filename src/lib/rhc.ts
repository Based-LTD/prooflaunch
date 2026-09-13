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
});

// Deployed 2026-09-13 — see contracts/rhc/DEPLOYMENTS.md. pons rotates
// factories; OUR factory is stable, the pons target is baked into each
// campaign at creation.
export const POOLLAUNCH_FACTORY = '0x74Fa741f5E4F0089227cb1ce45B1d00c9698388d' as const;
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
  'function createCampaign(address ponsFactory, uint256 goal, uint256 minDeposit, uint256 maxDeposit, uint256 maxBackers, uint256 deadline, uint256 launchConfigId, uint256 dexId, (string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address feeWallet) meta) returns (address)',
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

export function fmtEth(wei: bigint, digits = 4): string {
  return (Number(wei) / 1e18).toFixed(digits);
}

export function explorerUrl(addr: string): string {
  return `https://robinhoodchain.blockscout.com/address/${addr}`;
}
