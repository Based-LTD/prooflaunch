'use client';

// Shared RHC UI — the SOL design system verbatim: same variables, card
// shells, chip and label conventions. Same site, different chain.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { WpBadge } from './walletproof';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { robinhoodChain, CampaignRow, fmtEth } from '@/lib/rhc';

// Card-scale social icon — the card root is a <Link>, so open via
// window.open + stopPropagation (nested anchors are invalid HTML).
function CardSocial({ href, label }: { href: string; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
      }}
      title={href}
      className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
    >
      {label}
    </button>
  );
}

// Time left, MemeCard-tight: 2D 4H / 5H 12M / 34M / ENDED.
function timeLeft(deadline: bigint): string {
  const s = Number(deadline) - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'ENDED';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}D ${h}H`;
  if (h > 0) return `${h}H ${m}M`;
  return `${m}M`;
}

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors, isPending, error, reset } = useConnect();
  const [pick, setPick] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const { disconnect, disconnectAsync } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    // EIP-6963: every installed wallet announces itself as its own
    // connector with its own provider. The generic injected() connector
    // only talks to window.ethereum — whichever extension won that global
    // — so with two wallets in one browser, "connect" silently went to the
    // wrong one and looked like a dead button (founder, 2026-09-20, mid
    // test). Offer the discovered wallets by name; fall back to injected
    // only when nothing announced itself. And always SHOW the error.
    const named = connectors.filter((c) => c.id !== 'injected');
    const choices = named.length > 0 ? named : connectors;
    // Never auto-connect, even to a lone wallet: with one extension
    // installed the button used to fire straight into it, which reads as
    // the site choosing a wallet for you.
    const mustPick = choices.length > 0;
    const stale = (e: unknown) => {
      const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      return /AlreadyConnected|already connected/i.test(m);
    };
    const go = async (c: (typeof connectors)[number]) => {
      reset();
      setLocalErr(null);
      setPick(false);
      try {
        // Connecting requests Robinhood Chain in the same step — users
        // should never meet a separate "switch network" ceremony.
        await connectAsync({ connector: c, chainId: robinhoodChain.id });
      } catch (e) {
        // "Connector already connected": the extension still holds a
        // session while our account state says otherwise (wallet switched,
        // or the site was disconnected from the extension side). Treat it
        // as stale — drop it and connect fresh — instead of showing the
        // user a contradiction (founder, 2026-09-20).
        if (stale(e)) {
          try { await disconnectAsync({ connector: c }); } catch { /* nothing to drop */ }
          try { await disconnectAsync(); } catch { /* no other connections */ }
          try { await connectAsync({ connector: c, chainId: robinhoodChain.id }); return; } catch (e2) { setLocalErr(e2 instanceof Error ? e2.message : String(e2)); return; }
        }
        // any other failure is already rendered via `error` below
      }
    };
    const resetConnection = () => {
      try { localStorage.removeItem('wagmi.store'); } catch { /* storage blocked */ }
      window.location.reload();
    };
    const label = isPending ? 'Connecting…' : choices.length === 0 ? 'No wallet found' : null;
    return (
      <div className="relative">
        <button
          onClick={() => (mustPick ? setPick((v) => !v) : undefined)}
          disabled={isPending || choices.length === 0}
          aria-haspopup={mustPick ? 'menu' : undefined}
          aria-expanded={mustPick ? pick : undefined}
          title={choices.length === 0 ? 'No wallet extension detected in this browser' : undefined}
          // Compact on phones: at 390px the full-width button pushed the
          // hamburger off-screen and stretched the document sideways.
          className="btn-primary !px-2.5 !text-[10px] sm:!px-4 sm:!text-xs whitespace-nowrap"
        >
          {label ?? (
            <>
              <span className="sm:hidden">Connect</span>
              <span className="hidden sm:inline">Connect Wallet{mustPick ? ' \u25be' : ''}</span>
            </>
          )}
        </button>

        {pick && mustPick && (
          <div role="menu" className="absolute right-0 top-full mt-1 min-w-[15rem] border border-[var(--border)] bg-[var(--background)] shadow-lg z-50">
            {choices.map((c) => (
              <button
                key={c.uid}
                role="menuitem"
                onClick={() => go(c)}
                className="flex items-start gap-2 w-full px-3 py-2 text-left text-xs font-mono text-[var(--foreground)] hover:bg-[var(--card)] transition-colors"
              >
                {c.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <span className="min-w-0">{c.name}</span>
              </button>
            ))}
            <div className="border-t border-[var(--border)] px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-[var(--muted-soft)] leading-relaxed">
              Your wallet must be on Robinhood Chain. We ask it to switch when
              you connect; approve that prompt.
            </div>
          </div>
        )}

        {(localErr || error) && !pick && (
          <p
            role="alert"
            className="absolute right-0 top-full mt-1 max-w-[18rem] px-2 py-1 text-[10px] font-mono leading-snug text-[var(--error)] border border-[var(--error)]/40 bg-[var(--background)] z-50"
          >
            {localErr
              ? localErr.split('\n')[0].slice(0, 140)
              : error && /Provider not found|not found/i.test(error.name + error.message)
                ? 'No wallet extension answered in this browser. Install or unlock one, then try again.'
                : error && stale(error)
                  ? 'The wallet thinks it is still connected. Resetting the connection…'
                  : (error?.message ?? '').split('\n')[0].slice(0, 140)}
            {' '}
            <button type="button" onClick={resetConnection} className="underline underline-offset-2 text-[var(--foreground)]">
              reset connection
            </button>
          </p>
        )}
      </div>
    );
  }
  if (chainId !== robinhoodChain.id) {
    // Rare fallback (user hopped networks mid-session): fix it silently
    // in one tap, styled like the normal wallet chip — no scary banner.
    return (
      <button
        onClick={() => switchChain({ chainId: robinhoodChain.id })}
        className="px-4 py-2.5 text-xs font-mono border border-[var(--warning)]/60 text-[var(--warning)] hover:bg-[var(--warning)] hover:text-black transition-colors"
        title="Your wallet is on another network — click to hop back"
      >
        {address?.slice(0, 6)}…{address?.slice(-4)} ⚠
      </button>
    );
  }
  return (
    <button
      onClick={() => disconnect()}
      className="px-4 py-2.5 text-xs font-mono border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
      title="Click to disconnect"
    >
      {address?.slice(0, 6)}…{address?.slice(-4)}
    </button>
  );
}

// Subpage header row — chip + tagline only. The wallet button lives in
// the navbar (same slot as the SOL WalletMultiButton), not here.
export function RhcHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between mb-6 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent-gold)]/60 text-[var(--accent-gold)] bg-[var(--accent-gold)]/5 shrink-0">
          Robinhood Chain
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
          {'// '}Pool the raise · own the float · earn the fees
        </span>
      </div>
    </div>
  );
}

export function StatusPill({ launched, cancelled, refundable, deadline, totalRaised, goal }: {
  launched: boolean; cancelled: boolean; refundable: boolean;
  deadline: bigint; totalRaised: bigint; goal: bigint;
}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  let label = 'Backing';
  let color = 'var(--accent)';
  if (launched) { label = 'Live'; color = 'var(--success)'; }
  else if (cancelled) { label = 'Cancelled'; color = 'var(--muted)'; }
  else if (refundable) { label = 'Refunds Open'; color = 'var(--error)'; }
  else if (totalRaised >= goal) { label = 'Funded'; color = 'var(--success)'; }
  else if (now >= deadline) { label = 'Expired'; color = 'var(--muted)'; }
  return (
    <span
      className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border shrink-0"
      style={{ borderColor: `color-mix(in srgb, ${color} 60%, transparent)`, color, background: `color-mix(in srgb, ${color} 5%, transparent)` }}
    >
      {label}
    </span>
  );
}

// One campaign card — the SOL MemeCard anatomy: top bar with $SYM +
// status, avatar + name + socials, description, slot grid or raise bar,
// copyable CA once live, "by creator" footer.
export function CampaignCard({ r, footer }: { r: CampaignRow; footer?: React.ReactNode }) {
  const [caCopied, setCaCopied] = useState(false);
  const pct = r.goal > 0n ? Number((r.totalRaised * 100n) / r.goal) : 0;
  const socials = [
    { label: 'X', href: r.socials?.twitter },
    { label: 'TG', href: r.socials?.telegram },
    { label: 'DC', href: r.socials?.discord },
    { label: 'WEB', href: r.socials?.website },
    { label: 'FC', href: r.socials?.farcaster },
  ].filter((x) => !!x.href?.trim());
  const live = r.launched;
  const seatRound = !live && r.maxBackers > 0n && r.maxBackers <= 24n;

  const copyCA = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(r.token).then(() => {
      setCaCopied(true);
      setTimeout(() => setCaCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <Link href={`/rhc/campaign/${r.address}`} className="block">
      <div className="border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] transition-colors">
        {/* Top bar — system path + status */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
            {'// '}{r.symbol.slice(0, 12)}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {live && <WpBadge token={r.token} />}
            <StatusPill {...r} />
          </div>
        </div>

        {/* Main */}
        <div className="p-4 space-y-3">
          {/* Avatar + name + socials */}
          <div className="flex items-start gap-3">
            {r.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.logo}
                alt={r.name}
                className="w-12 h-12 object-cover border border-[var(--border)] flex-shrink-0"
              />
            ) : (
              <div className="w-12 h-12 border border-[var(--accent)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
                <span className="font-mono font-semibold text-[var(--accent)] text-sm">
                  {(r.symbol || '?').charAt(0)}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-mono font-semibold uppercase tracking-tight text-base truncate">
                {r.name}
              </h3>
              <div className="text-xs font-mono text-[var(--accent)]">${r.symbol}</div>
              {socials.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                  {socials.map((x) => (
                    <CardSocial key={x.label} href={x.href!} label={x.label} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {r.description && (
            <p className="text-xs font-mono text-[var(--muted)] line-clamp-2 leading-relaxed">
              {r.description}
            </p>
          )}

          {/* Backing-phase block */}
          {!live && (
            <div className="space-y-2 pt-1">
              {seatRound ? (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Seats</span>
                    <span className="text-xs font-mono text-[var(--accent)]">
                      {r.backerCount.toString()} / {r.maxBackers.toString()}
                    </span>
                  </div>
                  <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${Number(r.maxBackers)}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: Number(r.maxBackers) }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-3 ${i < Number(r.backerCount) ? 'bg-[var(--accent)]' : 'border border-[var(--accent)]'}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-1 bg-[var(--border)]">
                  <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              )}
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                <span className="text-[var(--muted)]">
                  Pledged: <span className="text-[var(--foreground)]">{fmtEth(r.totalRaised, 3)}</span>
                  {' / '}{fmtEth(r.goal, 3)} ETH
                </span>
                <span className="text-[var(--muted)]">{timeLeft(r.deadline)} left</span>
              </div>
            </div>
          )}

          {/* Live block — copyable CA */}
          {live && (
            <div className="space-y-2 pt-1">
              <button
                onClick={copyCA}
                className="w-full flex items-center gap-2 px-2 py-1.5 bg-[var(--background)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
              >
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">CA:</span>
                <code className="flex-1 text-[10px] font-mono truncate text-left">{r.token}</code>
                {caCopied ? (
                  <Check className="w-3 h-3 text-[var(--success)] flex-shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-[var(--muted)] flex-shrink-0" />
                )}
              </button>
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                <span>{r.backerCount.toString()} backer{r.backerCount === 1n ? '' : 's'}</span>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(`https://robinhoodchain.blockscout.com/token/${r.token}`, '_blank', 'noopener,noreferrer');
                  }}
                  className="text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
                >
                  [↗] Explorer
                </span>
              </div>
            </div>
          )}
          {footer}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          <span>by {r.creator.slice(0, 6)}…{r.creator.slice(-4)}</span>
          <span>&gt; OPEN</span>
        </div>
      </div>
    </Link>
  );
}

/// House-style modal: dark backdrop, bordered card, "// LABEL" header, X
/// and Escape to close. Used for creator tools and the pre-submit review,
/// so forms are a click away instead of always open on the page.
export function Modal({ open, onClose, label, children, wide = false }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'} max-h-[92vh] overflow-y-auto border border-[var(--border)] bg-[var(--card)]`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-3 py-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">{'// '}{label}</span>
          <button onClick={onClose} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--foreground)] text-sm leading-none px-1">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
