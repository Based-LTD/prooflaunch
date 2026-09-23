'use client';

// v8 campaigns, before launch: the creator can change what pons will mint
// — name, symbol, logo, description, links — with one transaction. After
// launch this form disappears; the on-chain meta is pons' and immutable.
// Backers can withdraw in full at any time before launch, so an edit can
// never trap anyone; the roster sees the new name on the next load.
import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import { campaignV4Abi, robinhoodChain } from '@/lib/rhc';

interface Meta { name: string; symbol: string; logo: string; description: string; socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string } }

export function OnChainMetaEditor({ campaign, current, onSent }: { campaign: `0x${string}`; current: Meta; onSent: (hash: `0x${string}`) => void }) {
  const [f, setF] = useState({ ...current, socials: { ...current.socials } });
  const [logoBusy, setLogoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { writeContractAsync, isPending } = useWriteContract();
  const input = 'w-full bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-xs font-mono focus:border-[var(--accent)] focus:outline-none';
  const submit = async () => {
    setErr(null);
    try {
      const hash = await writeContractAsync({
        address: campaign, abi: campaignV4Abi, functionName: 'updateMeta', chainId: robinhoodChain.id,
        args: [{ name: f.name.trim(), symbol: f.symbol.trim().toUpperCase(), logo: f.logo.trim(), description: f.description.trim(), socials: f.socials, feeWallet: '0x0000000000000000000000000000000000000000' }],
      });
      onSent(hash);
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(/reject|denied/i.test(m) ? 'Rejected in wallet — nothing changed' : m.split('\n')[0].slice(0, 140)); }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs font-mono text-[var(--muted)]">
        Before launch you can still change what pons will mint: name, symbol, logo, description, links. One transaction. The moment the token launches this is frozen forever. Backers see the change and can withdraw if they disagree.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" className={input} />
        <input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} placeholder="SYMBOL" maxLength={12} className={input} />
        <label className={`${input} cursor-pointer text-[var(--muted)] truncate`}>
          {logoBusy ? 'Uploading…' : f.logo ? `logo: ${f.logo.slice(-18)}` : 'Upload new logo'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0]; if (!file) return;
            try { setLogoBusy(true); const fd = new FormData(); fd.append('file', file); const r = await fetch('/api/upload/image', { method: 'POST', body: fd }); if (!r.ok) throw new Error('logo upload failed'); setF({ ...f, logo: (await r.json()).url }); }
            catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setLogoBusy(false); }
          }} />
        </label>
      </div>
      <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} placeholder="Description" className={input} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(['twitter', 'telegram', 'discord', 'website', 'farcaster'] as const).map((k) => (
          <input key={k} value={f.socials[k]} onChange={(e) => setF({ ...f, socials: { ...f.socials, [k]: e.target.value } })} placeholder={`${k} https://…`} className={input} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void submit()} disabled={isPending || logoBusy || !f.name.trim() || !f.symbol.trim()} className="btn-primary !px-3 !py-1.5 !text-[10px]">
          {isPending ? 'Confirm in wallet…' : 'Update on-chain · 1 transaction'}
        </button>
        {err && <span className="text-xs font-mono text-[var(--error)]">{err}</span>}
      </div>
    </div>
  );
}
