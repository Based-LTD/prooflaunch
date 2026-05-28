'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

/**
 * Creator-only panel: manage launch visibility + backing allowlist.
 *
 * Shown only on a meme detail page when the connected wallet matches
 * the meme's creator AND the meme is still in the `backing` phase
 * (visibility is locked once the token is funded/launched).
 *
 * Renders three sections:
 *   1. Current visibility + buttons to switch modes
 *   2. Allowlist viewer + add/remove (hidden when visibility = open)
 *   3. Audit trail link (just a brief note — full history on token page)
 *
 * Auth: all mutations sign a timestamped message
 *   "visibility-set:{meme_id}:{wallet}:{ts}"
 *   "allowlist-modify:{meme_id}:{wallet}:{ts}"
 */

type Visibility = 'open' | 'stealth' | 'spectator';

interface AllowlistEntry {
  wallet: string;
  note: string | null;
  added_at: string;
}

interface Props {
  memeId: string;
  currentVisibility: Visibility;
  creatorWallet: string;
  /** Whether the meme is still in backing phase — visibility is locked otherwise */
  canEdit: boolean;
}

const VISIBILITY_LABELS: Record<Visibility, { name: string; desc: string; color: string }> = {
  open: {
    name: 'OPEN',
    desc: 'Public listing, anyone can back. Standard launch.',
    color: 'var(--success)',
  },
  spectator: {
    name: 'SPECTATOR',
    desc: 'Public listing, allowlist-only backing.',
    color: 'var(--accent)',
  },
  stealth: {
    name: 'INTERNAL',
    desc: 'Hidden from public board, allowlist-only.',
    color: 'var(--accent-gold)',
  },
};

export function LaunchVisibilityPanel({ memeId, currentVisibility, creatorWallet, canEdit }: Props) {
  const { publicKey, signMessage } = useWallet();
  const [visibility, setVisibility] = useState<Visibility>(currentVisibility);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [allowlistInput, setAllowlistInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'ok' | 'err' | null>(null);

  // Load current allowlist
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/memes/${memeId}/allowlist`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.allowlist) setAllowlist(d.allowlist);
      })
      .catch(() => {/* silent */});
    return () => { cancelled = true; };
  }, [memeId, visibility]); // re-fetch after visibility change in case we just added/removed

  function flashStatus(msg: string, kind: 'ok' | 'err') {
    setStatus(msg);
    setStatusKind(kind);
    setTimeout(() => { setStatus(null); setStatusKind(null); }, 4000);
  }

  async function signActionMessage(action: 'visibility-set' | 'allowlist-modify'): Promise<{ message: string; signature: string } | null> {
    if (!publicKey || !signMessage) {
      flashStatus('Connect wallet first', 'err');
      return null;
    }
    const ts = Date.now();
    const message = `${action}:${memeId}:${publicKey.toBase58()}:${ts}`;
    try {
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      return { message, signature: bs58.encode(sigBytes) };
    } catch {
      flashStatus('Signature cancelled', 'err');
      return null;
    }
  }

  async function changeVisibility(next: Visibility) {
    if (next === visibility) return;
    if (!publicKey) return;
    setLoading(true);
    const auth = await signActionMessage('visibility-set');
    if (!auth) { setLoading(false); return; }

    try {
      const res = await fetch(`/api/memes/${memeId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caller_wallet: publicKey.toBase58(),
          message: auth.message,
          signature: auth.signature,
          visibility: next,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      setVisibility(next);
      flashStatus(`Visibility → ${next}`, 'ok');
    } catch (e) {
      flashStatus(e instanceof Error ? e.message : 'Failed', 'err');
    } finally {
      setLoading(false);
    }
  }

  async function addWallets() {
    if (!publicKey) return;
    const wallets = allowlistInput.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
    if (wallets.length === 0) return;
    setLoading(true);
    const auth = await signActionMessage('allowlist-modify');
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
      // Refetch to show updated list
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
    const auth = await signActionMessage('allowlist-modify');
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

  return (
    <div className="border border-[var(--border)] bg-[var(--card)] p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            CREATOR CONTROLS · LAUNCH VISIBILITY
          </div>
          <div className="text-sm text-[var(--muted)] mt-0.5">
            Auto-flips to OPEN at launch — that&apos;s the PROOF guarantee.
          </div>
        </div>
        {status && (
          <span
            className="text-xs font-mono"
            style={{ color: statusKind === 'ok' ? 'var(--success)' : 'var(--error)' }}
          >
            {status}
          </span>
        )}
      </div>

      {/* Visibility selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {(['open', 'spectator', 'stealth'] as Visibility[]).map((v) => {
          const meta = VISIBILITY_LABELS[v];
          const selected = visibility === v;
          return (
            <button
              key={v}
              type="button"
              disabled={!canEdit || loading || selected}
              onClick={() => changeVisibility(v)}
              className={`border p-3 text-left transition-colors ${
                selected
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] hover:border-[var(--muted)]'
              } ${(!canEdit || loading) && !selected ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <div className="text-xs font-mono font-semibold" style={{ color: selected ? meta.color : 'var(--foreground)' }}>
                {meta.name} {selected && '· active'}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-1 leading-snug">
                {meta.desc}
              </div>
            </button>
          );
        })}
      </div>

      {!canEdit && (
        <div className="text-xs text-[var(--muted)] italic">
          Visibility is locked — this launch is past the backing phase.
        </div>
      )}

      {/* Allowlist editor — hidden in OPEN mode */}
      {visibility !== 'open' && (
        <div className="border-t border-[var(--border)] pt-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            BACKING ALLOWLIST · {allowlist.length} wallet{allowlist.length === 1 ? '' : 's'}
          </div>

          {/* Add input */}
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

          {/* Current list */}
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
              No wallets yet — add some so backing can begin.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
