'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Meme } from '@/types/database';

// Creator-only panel for managing the Backer Vault content. Lets the
// creator replace the file inside their meme's Keycard gate at any time
// — drop alpha, post a whitelist code, share a Zoom link, swap in a PDF.
//
// Only renders when:
//   - The meme has a Keycard gate (keycard_gate_id set, post-launch)
//   - The connected wallet is the creator
//
// MVP: text/markdown only (most common use case + simplest UX). File
// uploads can come in Phase 4.2 if creators ask for it.

const PRESET_TEMPLATES: Array<{ label: string; content: string }> = [
  {
    label: 'Alpha drop',
    content: `# This week's alpha\n\n_Date: ${new Date().toISOString().slice(0, 10)}_\n\n**TL;DR:** [one-liner]\n\n## What's happening\n\n- Item 1\n- Item 2\n- Item 3\n\n## Action for holders\n\n[Anything they should do]\n\n## Links\n\n- [Link 1](https://)\n- [Link 2](https://)\n`,
  },
  {
    label: 'Whitelist drop',
    content: `# 🔓 Holder Whitelist\n\nYou unlocked this because you hold the token. Use this code or link below — limited time.\n\n**Code:** [paste code]\n**Link:** [paste link]\n**Expires:** [date/time]\n\nDo not share publicly.\n`,
  },
  {
    label: 'Holder call',
    content: `# Holder-only call\n\n**When:** [date + time + timezone]\n**Where:** [Zoom / Meet / X Space link]\n**Topic:** [what we're covering]\n\nDial in — it's a holder-only conversation.\n`,
  },
];

export function BackerVaultManager({ meme, isCreator }: { meme: Meme; isCreator: boolean }) {
  const { publicKey, signMessage } = useWallet();
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('vault.md');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'ok' | 'err' | null>(null);

  if (!isCreator) return null;
  if (!meme.keycard_gate_id) return null;

  function flash(msg: string, kind: 'ok' | 'err') {
    setStatus(msg);
    setStatusKind(kind);
    setTimeout(() => { setStatus(null); setStatusKind(null); }, 5000);
  }

  async function handleUpdate() {
    if (!publicKey || !signMessage) {
      flash('Connect wallet first', 'err');
      return;
    }
    if (!content.trim()) {
      flash('Vault content is empty', 'err');
      return;
    }
    setLoading(true);

    const ts = Date.now();
    const message = `vault-update:${meme.id}:${publicKey.toBase58()}:${ts}`;
    let signature: string;
    try {
      const bytes = new TextEncoder().encode(message);
      const sig = await signMessage(bytes);
      const bs58 = await import('bs58');
      signature = bs58.default.encode(sig);
    } catch {
      flash('Sign rejected', 'err');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/memes/${meme.id}/keycard-vault`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caller_wallet: publicKey.toBase58(),
          message,
          signature,
          content_text: content,
          content_filename: filename,
          content_mime: filename.endsWith('.md') ? 'text/markdown' : 'text/plain',
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Update failed');
      flash('Vault updated — holders will see the new content immediately', 'ok');
      setContent('');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Update failed', 'err');
    } finally {
      setLoading(false);
    }
  }

  const lastUpdated = meme.keycard_synced_at
    ? new Date(meme.keycard_synced_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="border border-[var(--accent)]/40 bg-[var(--card)] p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            CREATOR ONLY · ${meme.symbol} HOLDER DROP
          </div>
          <div className="text-sm font-mono text-[var(--foreground)] mt-1">
            Drop content only your token holders can unlock
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

      {/* What this is */}
      <div className="border-l-2 border-[var(--accent)]/40 pl-3 py-1 space-y-1">
        <div className="text-[11px] font-mono text-[var(--foreground)] leading-relaxed">
          You have a private slot on Keycard that only ${meme.symbol} holders can open. Drop anything in it:
        </div>
        <ul className="text-[11px] font-mono text-[var(--muted)] leading-relaxed list-disc pl-4 space-y-0.5">
          <li>Alpha calls / market intel</li>
          <li>Whitelist codes for upcoming drops</li>
          <li>Private Zoom/Telegram/Discord links</li>
          <li>Surprise giveaways or holder rewards</li>
        </ul>
        <div className="text-[11px] font-mono text-[var(--muted)] leading-relaxed pt-1">
          Update as often as you want. Each update <strong className="text-[var(--foreground)]">replaces</strong> the previous content.
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] border-t border-b border-[var(--border)] py-2">
        <span>
          {lastUpdated ? <>Last drop · <span className="text-[var(--foreground)]">{lastUpdated}</span></> : 'No drops yet'}
        </span>
        <a
          href={meme.keycard_gate_url || '#'}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] hover:underline normal-case"
        >
          Preview as a holder ↗
        </a>
      </div>

      {/* Quick templates */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          Start from:
        </span>
        {PRESET_TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setContent(t.content)}
            className="text-[11px] font-mono px-2 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write what you want holders to unlock. Markdown supported. Drop a link, paste a code, share a private invite — anything..."
        rows={10}
        className="w-full bg-[var(--background)] border border-[var(--border)] p-3 text-xs font-mono text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] resize-y"
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            File:
          </span>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
            placeholder="filename"
            className="bg-[var(--background)] border border-[var(--border)] px-2 py-1 text-xs font-mono w-40"
          />
        </div>
        <div className="text-[10px] font-mono text-[var(--muted)]">
          {Buffer.byteLength(content, 'utf8').toLocaleString()} / 4,194,304 bytes
        </div>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={loading || !content.trim() || !publicKey}
          className="px-4 py-2 bg-[var(--accent)] text-[var(--background)] text-xs font-mono uppercase tracking-wider hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {loading ? 'Dropping…' : 'Drop to holders'}
        </button>
      </div>
    </div>
  );
}
