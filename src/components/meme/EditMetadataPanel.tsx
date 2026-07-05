'use client';

// Creator-only inline editor for meme metadata. Reuses the same URL-
// shape rules as the /submit form and the /api/memes/[id]/metadata
// PATCH endpoint so surface-level validation matches what the server
// enforces.
//
// Two field groups:
//   1. Token identity (name / symbol / logo) — editable ONLY while
//      status IN ('backing', 'funded'). Rebranding pre-launch is a
//      real workflow (creators refine as they hit KOL feedback);
//      once launched these are baked into on-chain metadata and the
//      server rejects with 409.
//   2. Soft display (description / socials / banner) — editable for
//      the token's lifetime, matches Dex Screener / pump.fun pattern.
//
// Auth: same wallet-signed message pattern as the visibility panel,
// scoped to "metadata-edit:{meme_id}:{wallet}".

import { useState, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Loader2, Upload, X, CheckCircle, AlertCircle } from 'lucide-react';
import bs58 from 'bs58';
import type { Meme } from '@/types/database';

interface Props {
  meme: Meme;
  onSaved?: () => void;
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/;
const TWITTER_PATTERN = /^https?:\/\/(x\.com|twitter\.com)\/[^\s]+$/i;
const TELEGRAM_PATTERN = /^https?:\/\/t\.me\/[^\s]+$/i;
const DISCORD_PATTERN = /^https?:\/\/discord\.(gg|com)\/[^\s]+$/i;
const GITHUB_PATTERN = /^https?:\/\/(www\.)?github\.com\/[^\s]+$/i;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} \-_'.&!?]{1,31}$/u;
const SYMBOL_PATTERN = /^[A-Z0-9]{1,15}$/;

// Auto-prepend https:// if the user typed a bare domain like
// "github.com/handle". Mirrors the server-side forgiveness so the
// client validate() doesn't reject things the server would accept.
function autoScheme(v: string, hosts: string[]): string {
  if (/^https?:\/\//i.test(v)) return v;
  const lower = v.toLowerCase().replace(/^www\./, '');
  for (const h of hosts) {
    if (lower.startsWith(h + '/') || lower === h) return 'https://' + v;
  }
  return v;
}

export function EditMetadataPanel({ meme, onSaved }: Props) {
  const { publicKey, signMessage } = useWallet();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Token identity — only surfaced when pre-launch (see isPreLaunch).
  const [name, setName] = useState(meme.name ?? '');
  const [symbol, setSymbol] = useState(meme.symbol ?? '');
  const [imageUrl, setImageUrl] = useState(meme.image_url ?? '');
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [github, setGithub] = useState(meme.github ?? '');
  const [twitter, setTwitter] = useState(meme.twitter ?? '');
  const [telegram, setTelegram] = useState(meme.telegram ?? '');
  const [discord, setDiscord] = useState(meme.discord ?? '');
  const [website, setWebsite] = useState(meme.website ?? '');
  const [description, setDescription] = useState(meme.description ?? '');
  const [bannerUrl, setBannerUrl] = useState(meme.banner_url ?? '');
  const [bannerUploading, setBannerUploading] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const isPreLaunch = meme.status === 'backing' || meme.status === 'funded';

  // Logo upload — same shape as banner but writes to token-assets/logos/.
  // Kept as a separate handler because kind + preview treatment differ.
  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setStatus({ kind: 'err', msg: `Logo must be under 2 MB (you have ${(file.size / 1024 / 1024).toFixed(1)} MB).` });
      return;
    }
    setStatus(null);
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'logo');
      const r = await fetch('/api/upload/image', { method: 'POST', body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Logo upload failed');
      }
      const j = await r.json();
      setImageUrl(j.url);
    } catch (e) {
      setStatus({ kind: 'err', msg: e instanceof Error ? e.message : 'Upload failed' });
    } finally {
      setImageUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleBannerPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setStatus({ kind: 'err', msg: `Banner must be under 2 MB (you have ${(file.size / 1024 / 1024).toFixed(1)} MB).` });
      return;
    }
    setStatus(null);
    setBannerUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'banner');
      const r = await fetch('/api/upload/image', { method: 'POST', body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Banner upload failed');
      }
      const j = await r.json();
      setBannerUrl(j.url);
    } catch (e) {
      setStatus({ kind: 'err', msg: e instanceof Error ? e.message : 'Upload failed' });
    } finally {
      setBannerUploading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  };

  // Normalize each URL field BEFORE validating so "github.com/foo"
  // and "https://github.com/foo" both pass. The server also does this
  // — we mirror here so the client doesn't reject + the canonical
  // value stored downstream is always fully-qualified.
  const normalized = {
    github: github.trim() ? autoScheme(github.trim(), ['github.com']) : '',
    twitter: twitter.trim() ? autoScheme(twitter.trim(), ['x.com', 'twitter.com']) : '',
    telegram: telegram.trim() ? autoScheme(telegram.trim(), ['t.me']) : '',
    discord: discord.trim() ? autoScheme(discord.trim(), ['discord.gg', 'discord.com']) : '',
    website: website.trim()
      ? (/^https?:\/\//i.test(website.trim())
          ? website.trim()
          : (/\./.test(website.trim()) ? `https://${website.trim()}` : website.trim()))
      : '',
  };

  const validate = (): string | null => {
    // Token identity — only validate if actually shown (pre-launch).
    if (isPreLaunch) {
      const trimmedName = name.trim();
      if (!trimmedName) return 'Name is required';
      if (!NAME_PATTERN.test(trimmedName)) return 'Name must be 2-32 chars (letters/numbers/spaces/basic punctuation)';
      const trimmedSymbol = symbol.trim().toUpperCase();
      if (!trimmedSymbol) return 'Ticker is required';
      if (!SYMBOL_PATTERN.test(trimmedSymbol)) return 'Ticker must be 1-15 uppercase letters/numbers';
      if (!imageUrl) return 'Logo is required';
    }
    const { github: g, twitter: tw, telegram: tg, discord: dc, website: ws } = normalized;
    if (g && !GITHUB_PATTERN.test(g)) return 'GitHub must be a github.com/... URL';
    if (tw && !TWITTER_PATTERN.test(tw)) return 'Twitter/X must be a x.com/... or twitter.com/... URL';
    if (tg && !TELEGRAM_PATTERN.test(tg)) return 'Telegram must be a t.me/... URL';
    if (dc && !DISCORD_PATTERN.test(dc)) return 'Discord must be a discord.gg/... or discord.com/... URL';
    if (ws && !URL_PATTERN.test(ws)) return 'Website must be a valid URL';
    if (description.length > 500) return 'Description must be 500 chars or less';
    return null;
  };

  const handleSave = async () => {
    if (!publicKey || !signMessage) {
      setStatus({ kind: 'err', msg: 'Connect your wallet to save.' });
      return;
    }
    const err = validate();
    if (err) {
      setStatus({ kind: 'err', msg: err });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const wallet = publicKey.toBase58();
      const authMessage = `metadata-edit:${meme.id}:${wallet}:${Date.now()}`;
      const sig = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sig);

      // Send empty strings as null so the server clears the column;
      // omit fields that match the current row (no-op).
      const norm = (s: string): string | null => {
        const t = s.trim();
        return t.length === 0 ? null : t;
      };
      const payload: Record<string, unknown> = {
        caller_wallet: wallet,
        signature: sigB58,
        message: authMessage,
      };
      // Send the NORMALIZED URLs (so the server stores `https://...`
      // canonical form regardless of whether the user typed the scheme).
      // For the non-URL fields (description, banner_url) the raw trimmed
      // value is what we send.
      const fieldMap: Record<string, [string, string | null | undefined]> = {
        github: [normalized.github, meme.github ?? null],
        twitter: [normalized.twitter, meme.twitter ?? null],
        telegram: [normalized.telegram, meme.telegram ?? null],
        discord: [normalized.discord, meme.discord ?? null],
        website: [normalized.website, meme.website ?? null],
        banner_url: [norm(bannerUrl) ?? '', meme.banner_url ?? null],
        description: [norm(description) ?? '', meme.description ?? null],
      };
      for (const [key, [next, prev]] of Object.entries(fieldMap)) {
        const nextNorm = next === '' ? null : next;
        if (nextNorm !== prev) payload[key] = nextNorm;
      }

      // Token identity fields — only send if pre-launch AND the value
      // actually changed. These are required-if-present on the server
      // (no null-to-clear allowed), so we skip null coercion here.
      if (isPreLaunch) {
        const trimmedName = name.trim();
        const trimmedSymbol = symbol.trim().toUpperCase();
        if (trimmedName && trimmedName !== (meme.name ?? '')) payload.name = trimmedName;
        if (trimmedSymbol && trimmedSymbol !== (meme.symbol ?? '')) payload.symbol = trimmedSymbol;
        if (imageUrl && imageUrl !== (meme.image_url ?? '')) payload.image_url = imageUrl;
      }

      const r = await fetch(`/api/memes/${meme.id}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Save failed');
      }
      setStatus({ kind: 'ok', msg: 'Saved.' });
      onSaved?.();
    } catch (e) {
      setStatus({ kind: 'err', msg: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full border border-[var(--border)] hover:border-[var(--accent)] bg-[var(--background)] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
      >
        [✎] Edit token metadata
      </button>
    );
  }

  return (
    <div className="border border-[var(--accent)]/60 bg-[var(--background)] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          {'// EDIT_METADATA'}
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[10px] font-mono text-[var(--muted)] leading-snug">
        {isPreLaunch
          ? 'Rebrand freely while pre-launch. Name / symbol / logo lock the moment your token deploys on chain.'
          : 'Edit description, socials, and banner anytime. Name / symbol / logo are locked (already on chain).'}
      </p>

      <div className="space-y-2">
        {isPreLaunch && (
          <>
            <div className="border-t border-[var(--border)] pt-2 mt-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-2">
                {'// TOKEN_IDENTITY'}
              </div>
            </div>

            {/* Logo upload */}
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] block">
                Logo (square, 2 MB max)
              </label>
              {imageUrl ? (
                <div className="relative w-24 h-24">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="Logo preview"
                    className="w-24 h-24 border border-[var(--accent)]/60 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    aria-label="Replace logo"
                    className="absolute -bottom-2 -right-2 px-2 py-0.5 bg-[var(--accent)] text-[#0a0a0a] text-[9px] font-mono uppercase tracking-widest hover:opacity-90"
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={imageUploading}
                  className="w-24 h-24 border border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors flex flex-col items-center justify-center gap-1 text-[var(--muted)] hover:text-[var(--accent)]"
                >
                  {imageUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span className="text-[9px] font-mono uppercase tracking-widest">Upload</span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImagePick}
                className="hidden"
              />
            </div>

            <Field label="Name" value={name} onChange={setName} placeholder="e.g. Solana Music" />
            <Field label="Ticker (uppercase, ≤15)" value={symbol} onChange={(v) => setSymbol(v.toUpperCase())} placeholder="e.g. SOLMUSIC" />
          </>
        )}

        <div className="border-t border-[var(--border)] pt-2 mt-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-2">
            {'// DISPLAY'}
          </div>
        </div>
        <Field label="Description (≤500)" value={description} onChange={setDescription} placeholder="One-liner about your token" multiline />
        <Field label="X / Twitter" value={twitter} onChange={setTwitter} placeholder="https://x.com/..." />
        <Field label="Telegram" value={telegram} onChange={setTelegram} placeholder="https://t.me/..." />
        <Field label="Discord" value={discord} onChange={setDiscord} placeholder="https://discord.gg/..." />
        <Field label="Website" value={website} onChange={setWebsite} placeholder="https://..." />
        <Field label="GitHub" value={github} onChange={setGithub} placeholder="https://github.com/..." />

        {/* Banner upload */}
        <div className="space-y-1">
          <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] block">
            Banner (1500×500, 2 MB max)
          </label>
          {bannerUrl ? (
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bannerUrl}
                alt="Banner preview"
                className="w-full border border-[var(--accent)]/60"
                style={{ aspectRatio: '3 / 1', objectFit: 'cover' }}
              />
              <button
                type="button"
                onClick={() => setBannerUrl('')}
                aria-label="Clear banner"
                className="absolute -top-2 -right-2 w-5 h-5 bg-[var(--error)] flex items-center justify-center hover:opacity-90 transition-opacity"
              >
                <X className="w-3 h-3 text-[#0a0a0a]" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => bannerInputRef.current?.click()}
              disabled={bannerUploading}
              className="w-full border border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors flex flex-col items-center justify-center gap-1 text-[var(--muted)] hover:text-[var(--accent)]"
              style={{ aspectRatio: '3 / 1' }}
            >
              {bannerUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span className="text-[9px] font-mono uppercase tracking-widest">Upload banner</span>
                </>
              )}
            </button>
          )}
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleBannerPick}
            className="hidden"
          />
        </div>
      </div>

      {status && (
        <div
          className={`flex items-start gap-2 p-2 text-[10px] font-mono ${
            status.kind === 'ok'
              ? 'border border-[var(--success)] text-[var(--success)]'
              : 'border border-[var(--error)] text-[var(--error)]'
          }`}
        >
          {status.kind === 'ok' ? (
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          )}
          <span>{status.msg}</span>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !publicKey}
        className="btn-primary w-full text-xs py-2"
      >
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving…
          </span>
        ) : (
          '[▶] Save Changes'
        )}
      </button>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const Common = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    autoComplete: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    className: 'w-full text-xs font-mono bg-[var(--card)] border border-[var(--border)] px-2 py-1 focus:outline-none focus:border-[var(--accent)]',
  };
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] block">
        {label}
      </label>
      {multiline ? <textarea {...Common} rows={2} /> : <input type="text" {...Common} />}
    </div>
  );
}
