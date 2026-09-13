'use client';

// Create a pooled campaign — mirrors the SOL submit form's styling:
// shared input/label classes, bordered card sections, btn-primary CTA.
// Terms become immutable at creation, fee routing included.
import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, decodeEventLog } from 'viem';
import { POOLLAUNCH_FACTORY, PONS_FACTORY, factoryAbi } from '@/lib/rhc';
import { RhcHeader } from '../components';

// Soft-launch guardrail: contracts allow any goal (oversized raises are
// proven safe — they graduate at birth), but until the external contract
// review completes we cap UI-created campaigns. Raise/remove after P3.
const BETA_GOAL_CAP_ETH = 2;

const inputClass =
  'w-full px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-sm font-mono';
const labelClass =
  'block text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5';

export default function CreateCampaignPage() {
  const { isConnected } = useAccount();
  const [f, setF] = useState({
    name: '', symbol: '', logo: '', description: '',
    twitter: '', telegram: '', website: '',
    goal: '1', min: '0.05', max: '0', slots: '0', days: '3',
  });
  // Bot stack — the RHC twin of the SOL launch bots. Burn runs as an
  // ownerless BurnLeg contract; vaults are named wallets that pull their
  // leg of fees anytime. All carved from the backer share.
  const [burnPct, setBurnPct] = useState('0');
  const [lpPct, setLpPct] = useState('0');
  const [vaults, setVaults] = useState<{ addr: string; pct: string }[]>([]);
  const botsPct = (Number(burnPct) || 0) + (Number(lpPct) || 0) + vaults.reduce((s, v) => s + (Number(v.pct) || 0), 0);
  const backerPct = 90 - botsPct;
  const vaultsValid = vaults.every(v => (Number(v.pct) || 0) >= 0 && (/^0x[0-9a-fA-F]{40}$/.test(v.addr) || v.pct === '' || v.pct === '0'));
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { data: receipt, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    if (isSuccess && receipt) {
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
          if (ev.eventName === 'CampaignCreated') {
            setCreated((ev.args as { campaign: string }).campaign);
          }
        } catch { /* not ours */ }
      }
    }
  }, [isSuccess, receipt]);

  const submit = () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(f.days) * 86400);
    writeContract({
      address: POOLLAUNCH_FACTORY,
      abi: factoryAbi,
      functionName: 'createCampaign',
      args: [
        PONS_FACTORY,
        parseEther(f.goal),
        parseEther(f.min),
        f.max === '0' ? 0n : parseEther(f.max),
        BigInt(f.slots || '0'),
        deadline,
        0n, 0n,
        {
          name: f.name, symbol: f.symbol.toUpperCase(), logo: f.logo, description: f.description,
          socials: { twitter: f.twitter, telegram: f.telegram, discord: '', website: f.website, farcaster: '' },
          feeWallet: '0x0000000000000000000000000000000000000000', // overwritten by the contract → FeeSplitter
        },
        Math.round((Number(burnPct) || 0) * 100),
        Math.round((Number(lpPct) || 0) * 100),
        vaults.filter(v => Number(v.pct) > 0).map(v => v.addr as `0x${string}`),
        vaults.filter(v => Number(v.pct) > 0).map(v => Math.round(Number(v.pct) * 100)),
      ],
    });
  };

  const input = (key: keyof typeof f, lbl: string, placeholder = '') => (
    <label className={labelClass}>
      {lbl}
      <input
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        placeholder={placeholder}
        className={`${inputClass} mt-1.5 normal-case tracking-normal`}
      />
    </label>
  );

  if (created) {
    return (
      <div className="max-w-2xl mx-auto pb-8">
        <RhcHeader />
        <div className="border border-[var(--success)]/50 bg-[var(--card)]">
          <div className="border-b border-[var(--border)] px-3 py-1.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
              {'// '}CAMPAIGN LIVE
            </span>
          </div>
          <div className="p-4">
            <p className="text-sm font-mono text-[var(--muted)]">Share this link with your backers:</p>
            <a
              href={`/rhc/campaign/${created}`}
              className="mt-2 block font-mono text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] break-all"
            >
              prooflaunch.fun/rhc/campaign/{created}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8">
      <RhcHeader />

      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-3 py-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// '}CREATE POOLED LAUNCH
          </span>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {input('name', 'Token Name', 'e.g. Proof Coin')}
            {input('symbol', 'Symbol', 'e.g. PROOF')}
          </div>
          {input('logo', 'Logo URL (https)', 'https://…/logo.png')}
          <label className={labelClass}>
            Description
            <textarea
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              rows={3}
              className={`${inputClass} mt-1.5 normal-case tracking-normal resize-none`}
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {input('twitter', 'X / Twitter', 'https://x.com/…')}
            {input('telegram', 'Telegram')}
            {input('website', 'Website')}
          </div>

          <div className="border-t border-[var(--border)] pt-4 grid grid-cols-2 sm:grid-cols-5 gap-4">
            {input('goal', 'Goal (ETH)')}
            {input('min', 'Min / Backer')}
            {input('max', 'Max (0 = ∞)')}
            {input('slots', 'Slots (0 = ∞)')}
            {input('days', 'Deadline (Days)')}
          </div>

          {/* ── Bot stack — same concept as the SOL launch bots ── */}
          <div className="border-t border-[var(--border)] pt-4">
            <span className={labelClass}>{'// '}Launch Bots (optional — carved from the backer share)</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              <label className={labelClass}>
                🔥 Burn Bot — % of fees that buy & burn the token
                <input
                  value={burnPct}
                  onChange={(e) => setBurnPct(e.target.value)}
                  placeholder="0"
                  className={`${inputClass} mt-1.5`}
                />
                <span className="block mt-1 normal-case tracking-normal text-[var(--muted-soft)]">
                  Runs as an ownerless contract. Anyone can crank it; nobody can stop it.
                </span>
              </label>
              <label className={labelClass}>
                🌊 Pool Feeder — % of fees that become locked liquidity
                <input
                  value={lpPct}
                  onChange={(e) => setLpPct(e.target.value)}
                  placeholder="0"
                  className={`${inputClass} mt-1.5`}
                />
                <span className="block mt-1 normal-case tracking-normal text-[var(--muted-soft)]">
                  Full-range LP the contract owns forever — no withdraw function exists.
                  World-first: liquidity locked by construction, compounds its own fees.
                </span>
              </label>
              <div>
                <span className={labelClass}>🏦 Vault Legs — named wallets that earn a fee %</span>
                {vaults.map((v, i) => (
                  <div key={i} className="flex gap-2 mt-1.5">
                    <input
                      value={v.addr}
                      onChange={(e) => setVaults(vaults.map((x, j) => j === i ? { ...x, addr: e.target.value } : x))}
                      placeholder="0x… (marketing / DAO / LP wallet)"
                      className={inputClass}
                    />
                    <input
                      value={v.pct}
                      onChange={(e) => setVaults(vaults.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))}
                      placeholder="%"
                      className={`${inputClass} w-20`}
                    />
                    <button
                      type="button"
                      onClick={() => setVaults(vaults.filter((_, j) => j !== i))}
                      className="px-2 text-[var(--muted)] hover:text-[var(--error)] font-mono"
                    >×</button>
                  </div>
                ))}
                {vaults.length < 3 && (
                  <button
                    type="button"
                    onClick={() => setVaults([...vaults, { addr: '', pct: '' }])}
                    className="mt-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:text-[var(--accent-hover)]"
                  >
                    + Add Vault
                  </button>
                )}
              </div>
            </div>
            <p className={`mt-2 text-[10px] font-mono uppercase tracking-widest ${backerPct < 10 ? 'text-[var(--warning)]' : 'text-[var(--muted)]'}`}>
              Backers receive {backerPct}% of creator fees{botsPct > 0 ? ` (90% − ${botsPct}% bots)` : ''} · 7% platform · 3% holder rewards
            </p>
          </div>

          <div className="border border-[var(--border)] bg-[var(--background)] p-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] leading-relaxed">
            Fixed at creation, forever: {backerPct}% of creator trading fees → backers pro-rata ·
            7% platform · 3% holder rewards{botsPct > 0 ? ` · ${botsPct}% bots` : ''}. The pooled buy fires snipe-exempt on the
            launch block. Goal unmet by deadline → refunds open automatically.
          </div>

          {Number(f.goal) > BETA_GOAL_CAP_ETH && (
            <p className="text-xs font-mono text-[var(--warning)]">
              BETA CAP: goals are limited to {BETA_GOAL_CAP_ETH} ETH until the external contract
              review completes. (A {f.goal} ETH raise would work — oversized raises graduate at
              launch — we&apos;re just walking before running.)
            </p>
          )}

          <button
            onClick={submit}
            disabled={!isConnected || isPending || !f.name || !f.symbol || Number(f.goal) <= 0 || Number(f.goal) > BETA_GOAL_CAP_ETH || backerPct < 0 || !vaultsValid}
            className="btn-primary"
          >
            {isPending ? 'Confirm in Wallet…' : isConnected ? 'Create Campaign' : 'Connect Wallet First'}
          </button>
          {error && (
            <p className="text-xs font-mono text-[var(--error)]">
              {(error as Error).message.split('\n')[0].slice(0, 160)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
