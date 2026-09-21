'use client';

// The banner — the SOL page's X-style 3:1 hero, for Robinhood Chain.
// Off-chain by necessity (pons meta has no banner field): the image goes
// to Storage through the same upload route as the logo, the URL is bound
// to the campaign by one creator signature, and the server checks the
// signer against campaign.creator() on write and on read.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { Upload, X } from 'lucide-react';

export const BANNER_MAX_BYTES = 2 * 1024 * 1024;

export function useCampaignBanner(campaign: `0x${string}`, refreshKey = '') {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/rhc/media?campaign=${campaign}`, { cache: 'no-store' })
      .then((r) => r.json()).then((j) => { if (live) setUrl(j.banner_url ?? null); })
      .catch(() => { /* no banner is a fine answer */ });
    return () => { live = false; };
  }, [campaign, refreshKey]);
  return url;
}

/// Upload a banner file to storage. Returns its public URL.
export async function uploadBanner(file: File): Promise<string> {
  if (file.size > BANNER_MAX_BYTES) throw new Error(`Banner must be under 2 MB (you have ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'banner');
  const r = await fetch('/api/upload/image', { method: 'POST', body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Banner upload failed');
  return (await r.json()).url as string;
}

/// Bind (or clear, with null) a banner URL to a campaign: one signature.
export async function attachBanner(
  campaign: `0x${string}`, wallet: `0x${string}`, bannerUrl: string | null,
  signMessageAsync: (a: { message: string }) => Promise<`0x${string}`>,
): Promise<void> {
  const message = `rhc-banner:${campaign.toLowerCase()}:${wallet.toLowerCase()}:${Date.now()}`;
  const signature = await signMessageAsync({ message });
  const r = await fetch('/api/rhc/media', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaign, wallet, banner_url: bannerUrl, auth_message: message, auth_signature: signature }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `save failed (${r.status})`);
}

/// Creator-only card: pick a file, it uploads, one signature binds it.
export function BannerManager({ campaign, current, onChanged }: { campaign: `0x${string}`; current: string | null; onChanged: () => void }) {
  const { address: me } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'signing'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = useCallback(async (file: File) => {
    if (!me) return;
    setErr(null);
    setPreview(URL.createObjectURL(file));
    try {
      setBusy('uploading');
      const url = await uploadBanner(file);
      setBusy('signing');
      await attachBanner(campaign, me, url, signMessageAsync);
      onChanged();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/reject|denied/i.test(m) ? 'Signature declined — banner not attached' : m.split('\n')[0].slice(0, 140));
      setPreview(null);
    } finally {
      setBusy('idle');
      if (input.current) input.current.value = '';
    }
  }, [me, campaign, signMessageAsync, onChanged]);

  const remove = async () => {
    if (!me) return;
    setErr(null);
    try { setBusy('signing'); await attachBanner(campaign, me, null, signMessageAsync); setPreview(null); onChanged(); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(/reject|denied/i.test(m) ? 'Signature declined' : m.slice(0, 140)); }
    finally { setBusy('idle'); }
  };

  const shown = preview ?? current;
  return (
    <div className="space-y-2">
      <p className="text-xs font-mono text-[var(--muted)]">
        Banner — the wide image above the page, like the SOL side. 1500×500 (3:1), PNG/JPG/WebP, under 2 MB. One signature attaches it; only this campaign&apos;s creator can.
      </p>
      {shown ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt="" className="w-full block border border-[var(--border)]" style={{ aspectRatio: '3 / 1', objectFit: 'cover' }} />
          <button type="button" onClick={() => void remove()} disabled={busy !== 'idle'} aria-label="Remove banner"
            className="absolute top-2 right-2 w-6 h-6 bg-[var(--error)] flex items-center justify-center hover:opacity-90 disabled:opacity-40">
            <X className="w-3.5 h-3.5 text-[#0a0a0a]" />
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={busy !== 'idle' || !me}
          className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[var(--muted)] transition-colors disabled:opacity-40 inline-flex items-center gap-2">
          <Upload className="w-3.5 h-3.5" />
          {busy === 'uploading' ? 'Uploading…' : busy === 'signing' ? 'Sign in your wallet…' : shown ? 'Replace banner' : 'Upload banner'}
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
      </div>
      {err && <p className="text-xs font-mono text-[var(--error)]">{err}</p>}
    </div>
  );
}
