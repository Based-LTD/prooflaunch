'use client';

// Campaign chat — the SOL page's MemeChat for Robinhood Chain, in the
// house style. Posting needs one wallet signature (EIP-191), cached for
// four minutes so a conversation isn't a wallet prompt per line. The
// server verifies every post; reading is open.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { explorerUrl } from '@/lib/rhc';

interface Msg { id: string; wallet: string; message: string; created_at: string }

const AUTH_TTL_MS = 4 * 60 * 1000;
// No 0x prefix, four chars each end: what a backer asked for after reading a
// column of 0x04f2…4140 lines — the prefix is noise when every row has it.
const short = (a: string) => `${a.slice(2, 6)}…${a.slice(-4)}`;

export function CampaignChat({ campaign, roster }: { campaign: `0x${string}`; roster?: Set<string> }) {
  const { address: me, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const auth = useRef<{ wallet: string; message: string; signature: string; ts: number } | null>(null);

  const fetchMsgs = useCallback(async () => {
    try {
      const r = await fetch(`/api/rhc/chat?campaign=${campaign}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j.disabled) setDisabled(true);
      setMsgs(j.messages ?? []);
    } catch { /* keep what we have */ } finally { setLoading(false); }
  }, [campaign]);

  useEffect(() => {
    void fetchMsgs();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void fetchMsgs(); }, 5_000);
    return () => clearInterval(t);
  }, [fetchMsgs]);

  const send = async () => {
    if (!me || !text.trim() || sending) return;
    setSending(true); setErr(null);
    try {
      const wallet = me.toLowerCase();
      const c = auth.current;
      let message: string, signature: string;
      if (c && c.wallet === wallet && Date.now() - c.ts < AUTH_TTL_MS) {
        ({ message, signature } = c);
      } else {
        message = `rhc-chat:${campaign.toLowerCase()}:${wallet}:${Date.now()}`;
        signature = await signMessageAsync({ message });
        auth.current = { wallet, message, signature, ts: Date.now() };
      }
      const r = await fetch('/api/rhc/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campaign, wallet, message: text.trim(), auth_message: message, auth_signature: signature }),
      });
      if (r.status === 401) auth.current = null;
      if (r.ok) {
        setText('');
        await fetchMsgs();
        endRef.current?.parentElement?.scrollTo({ top: 1e9 });
      } else {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `send failed (${r.status})`);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/reject|denied/i.test(m) ? 'Signature declined — nothing was posted' : m.split('\n')[0].slice(0, 120));
    } finally { setSending(false); }
  };

  return (
    <div className="border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{'// '}CHAT</span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{msgs.length} message{msgs.length === 1 ? '' : 's'}</span>
      </div>
      <div className="p-4">
        <div className="h-64 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] animate-pulse">loading…</p>
          ) : disabled ? (
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">chat opens soon</p>
          ) : msgs.length === 0 ? (
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">no messages yet — backers, say hello</p>
          ) : msgs.map((m) => {
            const isMe = !!me && me.toLowerCase() === m.wallet.toLowerCase();
            const isBacker = roster?.has(m.wallet.toLowerCase());
            return (
              <div key={m.id} className={`text-xs font-mono ${isMe ? 'text-right' : ''}`}>
                <span className="text-[10px] text-[var(--muted)]">
                  <a href={explorerUrl(m.wallet)} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)]">{short(m.wallet)}</a>
                  {isBacker && <span className="ml-1 text-[9px] uppercase tracking-widest text-[var(--accent)]">backer</span>}
                  <span className="ml-2 opacity-60">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </span>
                <div className={`mt-0.5 inline-block max-w-[85%] px-2.5 py-1.5 text-left break-words ${isMe ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/40' : 'bg-[var(--background)] border border-[var(--border)]'}`}>
                  {m.message}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {isConnected && !disabled ? (
          <div className="mt-3 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              maxLength={500}
              disabled={sending}
              placeholder={auth.current ? 'Message…' : 'Message… (first post asks for one signature)'}
              className="flex-1 min-w-0 bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-xs font-mono focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
            />
            <button onClick={() => void send()} disabled={sending || !text.trim()} className="btn-primary px-4">
              {sending ? '…' : 'Send'}
            </button>
          </div>
        ) : !disabled ? (
          <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">{'> '}Connect your wallet to post</p>
        ) : null}
        {err && <p className="mt-2 text-xs font-mono text-[var(--error)]">{err}</p>}
      </div>
    </div>
  );
}
