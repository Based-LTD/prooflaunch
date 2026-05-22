'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { Trophy, ExternalLink } from 'lucide-react';

const LAMPORTS_PER_SOL = 1_000_000_000;
const BACKER_SHARE = 0.90;

interface Backing {
  id: string;
  slot_number: number;
  backer_wallet: string;
  amount_sol: number;
  status: string;
  tokens_received: string | number | null;
  current_tokens?: string;
  locked_tokens?: string; // Streamflow-locked balance (counts toward hold)
  claimable_fees_sol: number | null;
  total_claimed_sol: number | null;
  claim_tx?: string | null;
}

interface EnrichedMeme {
  current_backing_sol: number;
  vault_lamports: number;
  creator_subescrow_pubkey: string | null;
  backings: Backing[];
}

interface Props {
  memeId: string;
}

/**
 * Public roster of every Genesis Backer (the 2-24 wallets that filled
 * a meme's backing slots pre-launch). Shows their stake, slot order,
 * current hold %, realized fees, and live Pending fees.
 *
 * Self-contained: fetches /api/memes/[id] for the enriched data
 * (current on-chain token balance + vault lamports) every 30s.
 * Doesn't rely on the page's realtime backings subscription, which
 * doesn't carry the on-chain enrichment.
 */
export const GenesisBackerRoster: FC<Props> = ({ memeId }) => {
  const [data, setData] = useState<EnrichedMeme | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/memes/${memeId}`);
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setData(j.meme);
      } catch {}
    };
    load();
    const interval = setInterval(load, 30000); // refresh every 30s for live Pending
    return () => { cancelled = true; clearInterval(interval); };
  }, [memeId]);

  // Only show distributed backings (post-launch holdings). If a meme
  // hasn't launched, this component should not be rendered.
  const distributed = useMemo(
    () => (data?.backings || []).filter((b) => b.status === 'distributed').sort((a, b) => a.slot_number - b.slot_number),
    [data],
  );

  if (!data || distributed.length === 0) return null;

  const totalBackingSol = Number(data.current_backing_sol);
  const vaultLamports = Number(data.vault_lamports || 0);
  const hasSubEscrow = !!data.creator_subescrow_pubkey;

  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-[var(--accent-gold)]" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // GENESIS_BACKERS
          </span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          {distributed.length} wallet{distributed.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="p-4 sm:p-6 space-y-3">
        <div>
          <h3 className="text-lg font-mono font-semibold uppercase tracking-tight">
            &gt; The Wallets That Showed Up Early
          </h3>
          <p className="text-xs font-mono text-[var(--muted)] mt-1 leading-relaxed">
            Every backer who committed SOL pre-launch and got their pro-rata token allocation
            at the same atomic transaction that created the token. Verifiable on-chain.
          </p>
        </div>

        {/* Table — desktop */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left py-2 px-2 text-[10px] uppercase tracking-widest text-[var(--muted)]">Slot</th>
                <th className="text-left py-2 px-2 text-[10px] uppercase tracking-widest text-[var(--muted)]">Wallet</th>
                <th className="text-right py-2 px-2 text-[10px] uppercase tracking-widest text-[var(--muted)]">Stake</th>
                <th className="text-right py-2 px-2 text-[10px] uppercase tracking-widest text-[var(--muted)]">% of Pool</th>
                <th className="text-right py-2 px-2 text-[10px] uppercase tracking-widest text-[var(--muted)]">Hold %</th>
                <th className="text-right py-2 px-2 text-[10px] uppercase tracking-widest text-[var(--muted)]">Fees Earned</th>
                {hasSubEscrow && (
                  <th className="text-right py-2 px-2 text-[10px] uppercase tracking-widest text-[var(--success)]">
                    Pending
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {distributed.map((b) => {
                const stakeSol = Number(b.amount_sol);
                const poolShare = totalBackingSol > 0 ? stakeSol / totalBackingSol : 0;
                const received = BigInt(b.tokens_received || 0);
                const inWallet = BigInt(b.current_tokens || 0);
                const locked = BigInt(b.locked_tokens || 0);
                const effective = inWallet + locked;
                const holdPct = received > BigInt(0) ? Number((effective * BigInt(10000)) / received) / 100 : 0;
                const isLocked = locked > BigInt(0);
                const claimable = Number(b.claimable_fees_sol || 0);
                const claimed = Number(b.total_claimed_sol || 0);
                const realizedFees = claimable + claimed;
                const pendingShare = hasSubEscrow && vaultLamports > 0
                  ? (vaultLamports / LAMPORTS_PER_SOL) * BACKER_SHARE * poolShare
                  : 0;

                return (
                  <tr key={b.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--background)]/40 transition-colors">
                    <td className="py-2 px-2 font-semibold text-[var(--accent)]">{b.slot_number}</td>
                    <td className="py-2 px-2">
                      <a
                        href={`https://solscan.io/account/${b.backer_wallet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--foreground)] hover:text-[var(--accent)] inline-flex items-center gap-1"
                      >
                        {b.backer_wallet.slice(0, 6)}…{b.backer_wallet.slice(-4)}
                        <ExternalLink className="w-3 h-3 opacity-50" />
                      </a>
                    </td>
                    <td className="py-2 px-2 text-right">{stakeSol.toFixed(2)} SOL</td>
                    <td className="py-2 px-2 text-right text-[var(--muted)]">{(poolShare * 100).toFixed(2)}%</td>
                    <td className="py-2 px-2 text-right">
                      <span className={holdPct >= 80 ? 'text-[var(--success)]' : holdPct >= 50 ? 'text-[var(--accent-gold)]' : 'text-[var(--muted)]'}>
                        {holdPct.toFixed(1)}%
                      </span>
                      {holdPct >= 80 && <span className="ml-1" title="Diamond hands — holds ≥80% of original">💎</span>}
                      {isLocked && (
                        <span
                          className="ml-1"
                          title={`Locked via Streamflow: ${(Number(locked) / Number(received) * 100).toFixed(1)}% of allocation`}
                        >
                          🔒
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {realizedFees > 0 ? `${realizedFees.toFixed(6)} SOL` : <span className="text-[var(--muted)]">—</span>}
                    </td>
                    {hasSubEscrow && (
                      <td className="py-2 px-2 text-right text-[var(--accent)]">
                        {pendingShare > 0 ? pendingShare.toFixed(6) : <span className="text-[var(--muted)]">—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Stacked card list — mobile */}
        <div className="sm:hidden space-y-2">
          {distributed.map((b) => {
            const stakeSol = Number(b.amount_sol);
            const poolShare = totalBackingSol > 0 ? stakeSol / totalBackingSol : 0;
            const received = BigInt(b.tokens_received || 0);
            const inWallet = BigInt(b.current_tokens || 0);
            const locked = BigInt(b.locked_tokens || 0);
            const effective = inWallet + locked;
            const holdPct = received > BigInt(0) ? Number((effective * BigInt(10000)) / received) / 100 : 0;
            const isLocked = locked > BigInt(0);
            const claimable = Number(b.claimable_fees_sol || 0);
            const claimed = Number(b.total_claimed_sol || 0);
            const realizedFees = claimable + claimed;
            const pendingShare = hasSubEscrow && vaultLamports > 0
              ? (vaultLamports / LAMPORTS_PER_SOL) * BACKER_SHARE * poolShare
              : 0;

            return (
              <div key={b.id} className="border border-[var(--border)] bg-[var(--background)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-semibold text-[var(--accent)]">SLOT {b.slot_number}</span>
                  <a
                    href={`https://solscan.io/account/${b.backer_wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-[var(--muted)] hover:text-[var(--accent)] inline-flex items-center gap-1"
                  >
                    {b.backer_wallet.slice(0, 6)}…{b.backer_wallet.slice(-4)}
                    <ExternalLink className="w-3 h-3 opacity-50" />
                  </a>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                  <div className="text-[var(--muted)]">Stake: <span className="text-[var(--foreground)]">{stakeSol.toFixed(2)} SOL ({(poolShare*100).toFixed(1)}%)</span></div>
                  <div className="text-[var(--muted)]">
                    Hold: <span className={holdPct >= 80 ? 'text-[var(--success)]' : holdPct >= 50 ? 'text-[var(--accent-gold)]' : 'text-[var(--foreground)]'}>
                      {holdPct.toFixed(1)}%{holdPct >= 80 ? ' 💎' : ''}{isLocked ? ' 🔒' : ''}
                    </span>
                  </div>
                  <div className="text-[var(--muted)]">Fees: <span className="text-[var(--foreground)]">{realizedFees > 0 ? `${realizedFees.toFixed(4)} SOL` : '—'}</span></div>
                  {hasSubEscrow && (
                    <div className="text-[var(--muted)]">
                      Pending:{' '}
                      <span className="text-[var(--accent)]">
                        {pendingShare > 0 ? pendingShare.toFixed(6) : '—'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]/60 pt-1">
          &gt; hold % = (wallet balance + streamflow-locked balance) / tokens received at launch ·{' '}
          🔒 = portion locked via streamflow · fees = claimed + claimable
          {hasSubEscrow ? ' · pending = live on-chain share' : ''}
        </p>
      </div>
    </div>
  );
};
