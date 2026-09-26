'use client';

// Your RHC positions — mirrors the SOL /portfolio role: every campaign
// you've backed, with claim state at a glance.
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { Copy, Check } from 'lucide-react';
import { parseAbi } from 'viem';
import { fetchAllCampaigns, readBoardCache, writeBoardCache, rhcPublicClient, CampaignRow, fmtEth, explorerUrl, shortAddr } from '@/lib/rhc';
import { RhcHeader, CampaignCard, ConnectButton } from '../components';

const balAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);

interface Holding {
  token: `0x${string}`;
  symbol: string;
  name: string;
  logo: string;
  balance: bigint;
  campaign: `0x${string}`;
}

// YOUR BAG — the wallet view we control. Phantom won't display young
// tokens on this chain (verified: it refuses watchAsset here), so the
// user's holdings live HERE, read straight from the chain every load.
// Without this, a backer's honest experience is "my ETH left and
// nothing arrived" — the scam feel, on a product whose whole point is
// the opposite.
function YourBag({ rows, me }: { rows: CampaignRow[]; me: `0x${string}` }) {
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const launched = rows.filter((r) => r.launched && r.token !== '0x0000000000000000000000000000000000000000');
    if (launched.length === 0) { setHoldings([]); return; }
    rhcPublicClient.multicall({
      contracts: launched.map((r) => ({ address: r.token, abi: balAbi, functionName: 'balanceOf' as const, args: [me] as const })),
      allowFailure: true,
    }).then((res) => {
      setHoldings(launched
        .map((r, i) => ({
          token: r.token, symbol: r.symbol, name: r.name, logo: r.logo,
          balance: res[i].status === 'success' ? (res[i].result as bigint) : 0n,
          campaign: r.address,
        }))
        .filter((h) => h.balance > 0n));
    }).catch(() => setHoldings([]));
  }, [rows, me]);

  if (!holdings || holdings.length === 0) return null;
  return (
    <div className="border border-[var(--accent)]/40 bg-[var(--card)] mb-4">
      <div className="border-b border-[var(--border)] px-3 py-2 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          YOUR BAG: on-chain balances at {shortAddr(me)}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]">
          read live from Robinhood Chain
        </span>
      </div>
      <div className="p-3 space-y-2">
        {holdings.map((h) => (
          <div key={h.token} className="border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 flex flex-wrap items-center gap-3">
            {h.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={h.logo} alt={h.symbol} className="w-8 h-8 object-cover border border-[var(--border)]" />
            ) : (
              <div className="w-8 h-8 border border-[var(--accent)] flex items-center justify-center font-mono text-xs text-[var(--accent)]">
                {h.symbol.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-mono text-sm text-[var(--foreground)]">
                {(Number(h.balance) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
                <span className="text-[var(--accent)]">${h.symbol}</span>
              </div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">{h.name}</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(h.token).then(() => {
                    setCopied(h.token); setTimeout(() => setCopied(null), 1500);
                  }).catch(() => {});
                }}
                className="flex items-center gap-1.5 px-2 py-1.5 border border-[var(--border)] hover:border-[var(--accent)] transition-colors text-[9px] font-mono uppercase tracking-widest text-[var(--muted)]"
              >
                {copied === h.token ? <Check className="w-3 h-3 text-[var(--success)]" /> : <Copy className="w-3 h-3" />}
                CA
              </button>
              <a
                href={explorerUrl(h.token)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-1.5 border border-[var(--border)] hover:border-[var(--accent)] transition-colors text-[9px] font-mono uppercase tracking-widest text-[var(--accent)]"
              >
                Explorer ↗
              </a>
            </div>
          </div>
        ))}
        <p className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted-soft)] leading-relaxed">
          Phantom doesn&apos;t display new Robinhood Chain tokens yet, these balances are
          contract state, verifiable on the explorer, and tradable on pons regardless.
        </p>
      </div>
    </div>
  );
}

export default function RhcPortfolioPage() {
  const { address: me, isConnected } = useAccount();
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setRows(null);
    const cached = readBoardCache(me);
    if (cached) setRows(cached.filter((c) => c.myContribution > 0n));
    fetchAllCampaigns(me)
      .then((r) => { writeBoardCache(r, me); setRows(r.filter((c) => c.myContribution > 0n)); })
      .catch((e) => { if (!cached) setError(e instanceof Error ? e.message : String(e)); });
  }, [me]);

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <RhcHeader />
      {rows && me && <YourBag rows={rows} me={me} />}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-3 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            YOUR POSITIONS
          </span>
        </div>
        <div className="p-3">
          {!isConnected && (
            <div className="py-8 text-center space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                {'> '}Connect your wallet to see your positions
              </p>
              <ConnectButton />
            </div>
          )}
          {isConnected && error && (
            <p className="text-xs font-mono text-[var(--error)]">CHAIN READ FAILED: {error}</p>
          )}
          {isConnected && !rows && !error && (
            <p className="text-xs font-mono text-[var(--muted)] animate-pulse py-6 text-center">reading chain…</p>
          )}
          {rows && rows.length === 0 && (
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted-soft)] py-6 text-center">
              no positions yet: back a campaign from the board
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows?.map((r) => (
              <CampaignCard
                key={r.address}
                r={r}
                footer={
                  <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                    <span className="text-[var(--muted)]">
                      your stake: <span className="text-[var(--foreground)]">{fmtEth(r.myContribution, 3)} ETH</span>
                    </span>
                    {r.launched && (
                      <span className={r.myTokensClaimed ? 'text-[var(--success)]' : 'text-[var(--accent)]'}>
                        {r.myTokensClaimed ? '✓ claimed' : 'claim ready'}
                      </span>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
