'use client';

// Create a pooled campaign. The creator sets terms once; everything becomes
// immutable at creation — including fee routing, which no one (us included)
// can ever change.
import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, decodeEventLog } from 'viem';
import { POOLLAUNCH_FACTORY, PONS_FACTORY, factoryAbi, rhcPublicClient } from '@/lib/rhc';
import { RhcHeader } from '../components';

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

  const input = (key: keyof typeof f, label: string, placeholder = '', width = '') => (
    <label className={`block font-mono text-xs text-neutral-400 ${width}`}>
      {label}
      <input
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        placeholder={placeholder}
        className="mt-1 w-full bg-black border border-neutral-600 px-3 py-2 font-mono text-sm text-neutral-200 focus:border-orange-500 outline-none"
      />
    </label>
  );

  if (created) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <RhcHeader />
        <div className="border border-green-600 p-6 font-mono">
          <p className="text-green-400 text-lg uppercase tracking-wider">campaign live</p>
          <p className="mt-2 text-sm text-neutral-300">
            share this link with your backers:
          </p>
          <a href={`/rhc/campaign/${created}`} className="mt-2 block text-orange-400 underline break-all">
            prooflaunch.fun/rhc/campaign/{created}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <RhcHeader />
      <h1 className="font-mono text-lg text-neutral-200 uppercase tracking-widest mb-6">create pooled launch</h1>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {input('name', 'token name', 'e.g. Proof Coin')}
          {input('symbol', 'symbol', 'e.g. PROOF')}
        </div>
        {input('logo', 'logo url (https)', 'https://…/logo.png')}
        <label className="block font-mono text-xs text-neutral-400">
          description
          <textarea
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            rows={3}
            className="mt-1 w-full bg-black border border-neutral-600 px-3 py-2 font-mono text-sm text-neutral-200 focus:border-orange-500 outline-none"
          />
        </label>
        <div className="grid grid-cols-3 gap-4">
          {input('twitter', 'x / twitter', 'https://x.com/…')}
          {input('telegram', 'telegram', '')}
          {input('website', 'website', '')}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 border-t border-neutral-800 pt-4">
          {input('goal', 'goal (eth)')}
          {input('min', 'min/backer')}
          {input('max', 'max/backer (0=∞)')}
          {input('slots', 'slots (0=∞)')}
          {input('days', 'deadline (days)')}
        </div>

        <div className="border border-neutral-800 p-3 font-mono text-xs text-neutral-500">
          fixed at creation, forever: 90% of creator trading fees → backers pro-rata ·
          7% platform · 3% holder rewards. launch fires the pooled buy snipe-exempt on
          the launch block. if the goal isn&apos;t met by deadline, refunds open automatically.
        </div>

        <button
          onClick={submit}
          disabled={!isConnected || isPending || !f.name || !f.symbol || Number(f.goal) <= 0}
          className="border border-orange-500 px-8 py-3 font-mono text-sm uppercase tracking-widest text-orange-400 hover:bg-orange-500 hover:text-black transition-colors disabled:opacity-40"
        >
          {isPending ? 'confirm in wallet…' : isConnected ? 'create campaign' : 'connect wallet first'}
        </button>
        {error && (
          <p className="font-mono text-xs text-red-400">{(error as Error).message.split('\n')[0].slice(0, 160)}</p>
        )}
      </div>
    </main>
  );
}
