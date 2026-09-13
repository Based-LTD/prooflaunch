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

          <div className="border border-[var(--border)] bg-[var(--background)] p-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] leading-relaxed">
            Fixed at creation, forever: 90% of creator trading fees → backers pro-rata ·
            7% platform · 3% holder rewards. The pooled buy fires snipe-exempt on the
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
            disabled={!isConnected || isPending || !f.name || !f.symbol || Number(f.goal) <= 0 || Number(f.goal) > BETA_GOAL_CAP_ETH}
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
