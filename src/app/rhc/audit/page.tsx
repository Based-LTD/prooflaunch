'use client';

// RHC audit page — mirrors the SOL /proof role: every address, every
// split, verify-it-yourself. Ownerless contracts mean this page is a
// map, not a promise.
import { POOLLAUNCH_FACTORY, POOLLAUNCH_FACTORY_V4, POOLLAUNCH_FACTORY_V5, POOLLAUNCH_FACTORY_V6, POOLLAUNCH_FACTORY_V7, POOLLAUNCH_FACTORY_V8, PROOF_BURNER, V8_LIVE, PROOF_BURNER_LIVE, LEG_DEPLOYER_V3, PONS_FACTORY, AIRDROP_OPERATOR, explorerUrl } from '@/lib/rhc';
import { EQUITY_ROUTER } from '@/lib/rhcEquity';
import { RhcHeader } from '../components';

const PLATFORM_LEG = '0xD994AE0945c787A487c6dbd5188512E358986E29';
const REWARDS_LEG = '0x6ca08565CAf4f5CaAfB4BfeeCEcE6E0Ea3c65dcB';
const LEG_DEPLOYER = '0xA530b670762A5e82062A8f2256B0d877Afc8eBe4';
const LEG_DEPLOYER_V2 = '0x42a2495D9426fd5d88A01e724E62275DCe02dfF4';

const rows: [string, string, string][] = [
  ...(V8_LIVE ? [['Factory v8 (ACTIVE — the flywheel)', POOLLAUNCH_FACTORY_V8, 'Every campaign it creates carries two fixed legs on the creator tax: 30% to the ProofBurner and 10% to the platform. Backers get the rest after the creator\'s optional legs. Sellers\' forfeited shares and every creation fee go to the burner. Pre-launch locks with fee weighting.'] as [string, string, string]] : []),
  ...(PROOF_BURNER_LIVE ? [['ProofBurner (the flywheel)', PROOF_BURNER, 'Collects the PROOF-burn leg from every campaign and can only ever buy $PROOF and send it to the dead address: pons curve before graduation, Uniswap v4 directly after, 0.2 ETH per crank, one crank per block. No owner, no withdraw, no retarget. Anyone can crank.'] as [string, string, string]] : []),
  [V8_LIVE ? 'Factory v7 (superseded 2026-09-20 → v8; campaigns run forever)' : 'Factory v7 (ACTIVE since 2026-09-20)', POOLLAUNCH_FACTORY_V7, 'Creates every new campaign. Team rounds, token gating, ERC20/stock-quoted raises, creator-set payout asset, one-crank-per-block bot legs; every campaign it creates carries the EquityRouter immutably. Self-reviewed with published findings; no independent audit yet.'],
  ['EquityRouter (deployed 2026-09-20)', EQUITY_ROUTER, 'ETH in, any ETH-paired Uniswap v4 asset out \u2014 how a claim arrives as tokenized stock. Ownerless, holds nothing, no asset allowlist by design.'],
  ['Leg Deployer V3', LEG_DEPLOYER_V3, 'Carries the v3 bot legs (one crank per block; tick range from pool spacing). Ownerless, stateless.'],
  ['Factory v6', POOLLAUNCH_FACTORY_V6, 'Created every campaign until 2026-09-20; superseded by v7, its campaigns run forever. v5 plus a 0.001 ETH creation buy-in forwarded instantly to the platform leg (the factory never holds a balance). Stateless policy; no owner, no admin, no upgrade path.'],
  ['Factory v5', POOLLAUNCH_FACTORY_V5, 'pons V2 plus the trustless Uniswap-v4 bot legs (Burn, Pool Feeder). Dual-phase: curve buys before graduation, direct PoolManager swaps after. Read-only in the UI; its campaigns run forever.'],
  ['Factory v4', POOLLAUNCH_FACTORY_V4, 'Targets pons V2: adjustable creator tax (0\u201310%, earned by backers), native-ETH fee flow. No bot legs. Read-only; its campaigns run forever.'],
  ['Factory v3', POOLLAUNCH_FACTORY, 'pons V1 generation \u2014 the original trustless Burn + Pool Feeder bot legs. Read-only in the UI; its campaigns run forever.'],
  ['Leg Deployer V2', LEG_DEPLOYER_V2, 'Carries the v4 bot-leg creation code for factories v5+ (Robinhood Chain enforces the 24KB contract size limit). Ownerless, stateless.'],
  ['Leg Deployer', LEG_DEPLOYER, 'Carries the v3 Burn + Pool Feeder creation code. Ownerless, stateless.'],
  ['pons Factory (target)', PONS_FACTORY, 'The launchpad our campaigns launch through. pons rotates factories — campaigns pin theirs at creation.'],
  ['Platform Fee Leg (7%)', PLATFORM_LEG, 'Receives the platform share of creator fees, per campaign, immutably.'],
  ['Holder Rewards Leg (3%, v1–v7 campaigns only)', REWARDS_LEG, 'The 3% leg on campaigns created before v8 — test launches only; nothing meaningful ever accrued here. From v8 on that leg is the 30% PROOF burn instead.'],
  ['Airdrop Operator (📸 legs)', AIRDROP_OPERATOR, 'Platform-run holder snapshot airdrops for campaigns that opted in. The one non-trustless bot — labeled so everywhere it appears.'],
];

export default function RhcAuditPage() {
  return (
    <div className="max-w-3xl mx-auto pb-8">
      <RhcHeader />
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-3 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// '}AUDIT — CONTRACTS & WALLETS
          </span>
        </div>
        <div className="p-3 space-y-3">
          {rows.map(([name, addr, role]) => (
            <div key={addr} className="border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{name}</span>
                <a
                  href={explorerUrl(addr)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:text-[var(--accent-hover)]"
                >
                  Explorer ↗
                </a>
              </div>
              <p className="mt-1 font-mono text-xs text-[var(--foreground)] break-all">{addr}</p>
              <p className="mt-1 font-mono text-xs text-[var(--muted)]">{role}</p>
            </div>
          ))}

          <div className="border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Fee Split — every campaign, fixed at creation</span>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              {[['90%', 'backers'], ['7%', 'platform'], ['3%', 'holder rewards']].map(([v, k]) => (
                <div key={k} className="border border-[var(--border)] py-2">
                  <div className="font-mono text-sm text-[var(--foreground)]">{v}</div>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mt-0.5">{k}</div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] leading-relaxed">
            Contracts are ownerless: no pause, no upgrade, no admin key exists. Deposits sit in each
            campaign until launch or refund; the platform never custodies funds. Source in the public
            repo (contracts/rhc). Verify everything yourself — that&apos;s the point.
          </p>
        </div>
      </div>
    </div>
  );
}
