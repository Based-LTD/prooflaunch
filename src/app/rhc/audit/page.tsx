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
  ...(PROOF_BURNER_LIVE ? [['ProofBurner (the flywheel)', PROOF_BURNER, 'Collects the $PLAUNCH-burn leg from every campaign and can only ever buy $PLAUNCH and send it to the dead address: pons curve before graduation, Uniswap v4 directly after, 0.2 ETH per crank, one crank per block. No owner, no withdraw, no retarget. Anyone can crank.'] as [string, string, string]] : []),
  [V8_LIVE ? 'Factory v7 (superseded 2026-09-20 → v8; campaigns run forever)' : 'Factory v7 (ACTIVE since 2026-09-20)', POOLLAUNCH_FACTORY_V7, 'Creates every new campaign. Team rounds, token gating, ERC20/stock-quoted raises, creator-set payout asset, one-crank-per-block bot legs; every campaign it creates carries the EquityRouter immutably. Self-reviewed with published findings; no independent audit yet.'],
  ['EquityRouter (deployed 2026-09-20)', EQUITY_ROUTER, 'ETH in, any ETH-paired Uniswap v4 asset out \u2014 how a claim arrives as tokenized stock. Ownerless, holds nothing, no asset allowlist by design.'],
  ['Leg Deployer V3', LEG_DEPLOYER_V3, 'Carries the v3 bot legs (one crank per block; tick range from pool spacing). Ownerless, stateless.'],
  ['pons Factory (target)', PONS_FACTORY, 'The launchpad our campaigns launch through. pons rotates factories — campaigns pin theirs at creation.'],
  [`Platform Fee Leg (${V8_LIVE ? '10' : '7'}%)`, PLATFORM_LEG, 'Receives the platform share of every campaign\u2019s creator tax, immutably, per campaign.'],
  ['Holder Rewards Leg (3%, pre-v8 campaigns)', REWARDS_LEG, 'A plain wallet, not a distributor: nothing here is paid to token holders, and nothing meaningful has ever accrued. It is the retired third leg on every campaign created before v8; from v8 on it is replaced by the 30% $PLAUNCH burn.'],
  ['Airdrop Operator (📸 legs)', AIRDROP_OPERATOR, 'Platform-run holder snapshot airdrops for campaigns that opted in. The one non-trustless bot — labeled so everywhere it appears.'],
];

// Superseded, but every campaign they created still runs, so an audit page
// cannot simply drop them. Address and one line each, folded away.
const superseded: [string, string, string][] = [
  ['Factory v6', POOLLAUNCH_FACTORY_V6, 'Created campaigns until 2026-09-20.'],
  ['Factory v5', POOLLAUNCH_FACTORY_V5, 'First factory with the Uniswap-v4 bot legs.'],
  ['Factory v4', POOLLAUNCH_FACTORY_V4, 'First pons V2 factory. No bot legs.'],
  ['Factory v3', POOLLAUNCH_FACTORY, 'pons V1 generation.'],
  ['Leg Deployer V2', LEG_DEPLOYER_V2, 'Bot-leg creation code for factories v5 and v6.'],
  ['Leg Deployer', LEG_DEPLOYER, 'Bot-leg creation code for factory v3.'],
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

          <details className="border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
            <summary className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] cursor-pointer hover:text-[var(--accent)]">
              Superseded factories ({superseded.length}) \u2014 their campaigns run forever
            </summary>
            <div className="mt-2 space-y-2">
              {superseded.map(([name, addr, role]) => (
                <div key={addr}>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{name}</span>
                    <a href={explorerUrl(addr)} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-[var(--accent)] hover:underline break-all">{addr}</a>
                  </div>
                  <div className="font-mono text-[10px] text-[var(--muted-soft)]">{role}</div>
                </div>
              ))}
            </div>
          </details>

          {/* The split is NOT one number: two legs are fixed by the factory,
              and the creator's own bot legs come out of the backer share. */}
          <div className="border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              Fee Split \u2014 {V8_LIVE ? 'factory v8' : 'factory v7'}, fixed per campaign at creation
            </span>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              {(V8_LIVE
                ? ([['30%', '$PLAUNCH burn', true], ['10%', 'platform', true], ['60%', 'backers, less bots', false]] as [string, string, boolean][])
                : ([['7%', 'platform', true], ['3%', 'retired leg', true], ['90%', 'backers, less bots', false]] as [string, string, boolean][])
              ).map(([v, k, fixed]) => (
                <div key={k} className={`border py-2 ${fixed ? 'border-[var(--accent-gold)]/50' : 'border-[var(--border)]'}`}>
                  <div className={`font-mono text-sm ${fixed ? 'text-[var(--accent-gold)]' : 'text-[var(--foreground)]'}`}>{v}</div>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mt-0.5">{k}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] font-mono text-[var(--muted)] leading-relaxed">
              Gold legs are set by the factory and nobody can change them. The last column is the
              creator&apos;s budget, not a guarantee: every bot leg they stack (coin burn, pool feeder,
              named vault) comes out of it, so the backer share is whatever is left.
              {!V8_LIVE && ' A campaign with a 30% coin burn pays backers 60%.'}
              {' '}Read the real numbers off that campaign&apos;s FeeSplitter, never off this page.
            </p>
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
