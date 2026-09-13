'use client';

// RHC audit page — mirrors the SOL /proof role: every address, every
// split, verify-it-yourself. Ownerless contracts mean this page is a
// map, not a promise.
import { POOLLAUNCH_FACTORY, PONS_FACTORY, explorerUrl } from '@/lib/rhc';
import { RhcHeader } from '../components';

const PLATFORM_LEG = '0xD994AE0945c787A487c6dbd5188512E358986E29';
const REWARDS_LEG = '0x6ca08565CAf4f5CaAfB4BfeeCEcE6E0Ea3c65dcB';

const rows: [string, string, string][] = [
  ['PoolLaunch Factory', POOLLAUNCH_FACTORY, 'Deploys Campaign + FeeSplitter pairs. Stateless policy; no owner, no admin, no upgrade path.'],
  ['pons Factory (target)', PONS_FACTORY, 'The launchpad our campaigns launch through. pons rotates factories — campaigns pin theirs at creation.'],
  ['Platform Fee Leg (7%)', PLATFORM_LEG, 'Receives the platform share of creator fees, per campaign, immutably.'],
  ['Holder Rewards Leg (3%)', REWARDS_LEG, 'Accumulates the holder-rewards share — the future platform-token buyback feed.'],
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
