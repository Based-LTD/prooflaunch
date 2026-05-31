'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

/**
 * Creator-only panel: team-fairness cap readout + backing allowlist for
 * reserved-slot launches.
 *
 * Visibility (stealth/spectator) was removed from the UI 2026-05-30 —
 * every new launch is OPEN. This panel used to handle visibility too;
 * now it carries just:
 *   1. Team-fairness cap readout (when meme.max_backing_sol is set)
 *   2. Allowlist viewer + add/remove (when meme.reserved_slots > 0)
 *
 * The file name stays as-is so we don't break imports; the component
 * does the right thing regardless.
 */

interface AllowlistEntry {
  wallet: string;
  note: string | null;
  added_at: string;
}

interface Props {
  memeId: string;
  creatorWallet: string;
  /** Backing phase = mutable; past that = read-only. */
  canEdit: boolean;
  /** Optional per-backer cap set at submission. NULL = uncapped. */
  maxBackingSol?: number | null;
  /** Reserved-slot count — when > 0, the allowlist gates the reserved positions. */
  reservedSlots?: number;
}

export function LaunchVisibilityPanel({ memeId, creatorWallet, canEdit, maxBackingSol, reservedSlots = 0 }: Props) {
  const { publicKey, signMessage } = useWallet();
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [allowlistInput, setAllowlistInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'ok' | 'err' | null>(null);

  const hasReservedSlots = reservedSlots > 0;
  const hasCap = maxBackingSol != null;

  // Load current allowlist (only when reserved slots make it relevant).
  useEffect(() => {
    if (!hasReservedSlots) return;
    let cancelled = false;
    fetch(`/api/memes/${memeId}/allowlist`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.allowlist) setAllowlist(d.allowlist);
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [memeId, hasReservedSlots]);

  function flashStatus(msg: string, kind: 'ok' | 'err') {
    setStatus(msg);
    setStatusKind(kind);
    setTimeout(() => { setStatus(null); setStatusKind(null); }, 4000);
  }

  async function signActionMessage(): Promise<{ message: string; signature: string } | null> {
    if (!publicKey || !signMessage) {
      flashStatus('Connect wallet first', 'err');
      return null;
    }
    const ts = Date.now();
    const message = `allowlist-modify:${memeId}:${publicKey.toBase58()}:${ts}`;
    try {
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      return { message, signature: bs58.encode(sigBytes) };
    } catch {
      flashStatus('Signature cancelled', 'err');
      return null;
    }
  }

  async function addWallets() {
    if (!publicKey) return;
    const wallets = allowlistInput.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
    if (wallets.length === 0) return;
    setLoading(true);
    const auth = await signActionMessage();
    if (!auth) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/memes/${memeId}/allowlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caller_wallet: publicKey.toBase58(),
          message: auth.message,
          signature: auth.signature,
          wallets,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      setAllowlistInput('');
      const refetch = await fetch(`/api/memes/${memeId}/allowlist`);
      if (refetch.ok) setAllowlist((await refetch.json()).allowlist || []);
      flashStatus(`Added ${j.added} wallet(s)`, 'ok');
    } catch (e) {
      flashStatus(e instanceof Error ? e.message : 'Failed', 'err');
    } finally {
      setLoading(false);
    }
  }

  async function removeWallet(wallet: string) {
    if (!publicKey) return;
    if (wallet === creatorWallet) {
      flashStatus("Can't remove your own wallet", 'err');
      return;
    }
    setLoading(true);
    const auth = await signActionMessage();
    if (!auth) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/memes/${memeId}/allowlist`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caller_wallet: publicKey.toBase58(),
          message: auth.message,
          signature: auth.signature,
          wallet,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      setAllowlist((prev) => prev.filter((e) => e.wallet !== wallet));
      flashStatus('Removed', 'ok');
    } catch (e) {
      flashStatus(e instanceof Error ? e.message : 'Failed', 'err');
    } finally {
      setLoading(false);
    }
  }

  // Nothing meaningful to show? Render null so the parent's CREATOR
  // CONTROLS card doesn't carry empty space.
  if (!hasCap && !hasReservedSlots) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--background)] p-3 space-y-3">
      {status && (
        <div
          className="text-[10px] font-mono uppercase tracking-widest"
          style={{ color: statusKind === 'ok' ? 'var(--success)' : 'var(--error)' }}
        >
          {status}
        </div>
      )}

      {hasCap && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            TEAM-FAIRNESS CAP
          </div>
          <div className="text-xs font-mono text-[var(--foreground)] mt-1">
            Every backing capped at {Number(maxBackingSol)} SOL. Team and public
            are bounded equally — no whale can out-back the team.
          </div>
        </div>
      )}

      {hasReservedSlots && (
        <div className={hasCap ? 'border-t border-[var(--border)] pt-3 space-y-2' : 'space-y-2'}>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            BACKING ALLOWLIST · {allowlist.length} wallet{allowlist.length === 1 ? '' : 's'} · {reservedSlots} reserved slot{reservedSlots === 1 ? '' : 's'}
          </div>

          <div className="space-y-2">
            <textarea
              value={allowlistInput}
              onChange={(e) => setAllowlistInput(e.target.value)}
              placeholder={'Add wallets (one per line)...'}
              rows={3}
              disabled={!canEdit || loading}
              className="w-full text-xs font-mono"
            />
            <button
              type="button"
              onClick={addWallets}
              disabled={!canEdit || loading || !allowlistInput.trim()}
              className="btn-secondary text-xs"
            >
              {loading ? 'Working…' : 'Sign + Add'}
            </button>
          </div>

          {allowlist.length > 0 ? (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {allowlist.map((e) => (
                <div key={e.wallet} className="flex items-center justify-between gap-2 text-xs font-mono py-1 border-b border-[var(--border)]/40 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{e.wallet}</div>
                    {e.note && <div className="text-[10px] text-[var(--muted)]">{e.note}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWallet(e.wallet)}
                    disabled={!canEdit || loading || e.wallet === creatorWallet}
                    className="text-[10px] text-[var(--error)] hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {e.wallet === creatorWallet ? 'YOU' : 'REMOVE'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[var(--muted)] italic">
              No wallets yet — add the team so they can claim reserved slots.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
