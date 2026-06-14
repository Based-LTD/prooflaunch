'use client';

// Pool wallet claim page — multi-step flow for a creator to take
// self-custody of their meme's pool wallet.
//
// Steps:
//   1. Wallet connect (must match meme.creator_wallet)
//   2. Critical warnings — once you save this, we can't recover it for you
//   3. Sign derivation message → decrypt sealed blob client-side
//   4. Verify recovered key derives to the expected pool_wallet pubkey
//   5. Display key (base58, JSON download, QR code)
//   6. Confirm: type first 4 + last 4 chars of the key to prove you've seen it
//   7. POST to /api/wallet-claim/confirm → platform schedules 24h burn
//
// All decryption happens client-side. The server never sees the
// decrypted key. The libsodium-wrappers package works in the browser
// (it compiles to wasm). All the crypto helpers in src/lib/walletClaim.ts
// are isomorphic.

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { Keypair } from '@solana/web3.js';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import { AlertTriangle, CheckCircle, Loader2, Copy, Check, Download, ShieldAlert } from 'lucide-react';
import {
  DERIVATION_MESSAGE_V1,
  deriveX25519SecretFromSignature,
  x25519PublicFromSecret,
  openSealedBox,
} from '@/lib/walletClaim';

type Step =
  | 'connect'
  | 'verify_owner'
  | 'warnings'
  | 'decrypt'
  | 'display'
  | 'verify_chars'
  | 'confirm'
  | 'done'
  | 'error';

export default function ClaimWalletPage() {
  const { meme_id } = useParams<{ meme_id: string }>();
  const { publicKey, signMessage, connected } = useWallet();

  const [step, setStep] = useState<Step>('connect');
  const [error, setError] = useState<string | null>(null);
  const [meme, setMeme] = useState<{ creator_wallet: string; pool_wallet: string; symbol?: string } | null>(null);
  const [sealedBlob, setSealedBlob] = useState<string | null>(null);
  const [recoveredSecretKey, setRecoveredSecretKey] = useState<Uint8Array | null>(null);
  const [recoveredKeypair, setRecoveredKeypair] = useState<Keypair | null>(null);
  const [verifyChars, setVerifyChars] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  // Wallet connect → fetch meme + sealed blob.
  useEffect(() => {
    if (!connected || !publicKey || !meme_id) return;
    if (step !== 'connect') return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        // First, look up the meme without auth (public read of pool/creator wallet).
        const memeRes = await fetch(`/api/memes/${meme_id}`);
        if (!memeRes.ok) throw new Error('Token not found');
        const memeData = await memeRes.json();
        const m = memeData.meme;
        if (!m) throw new Error('Token not found');
        setMeme({ creator_wallet: m.creator_wallet, pool_wallet: m.pool_wallet, symbol: m.symbol });

        if (publicKey.toBase58() !== m.creator_wallet) {
          setError(`Connected wallet ${publicKey.toBase58().slice(0, 6)}… is not the creator of this token. Connect ${m.creator_wallet.slice(0, 6)}… instead.`);
          setStep('error');
          return;
        }
        setStep('verify_owner');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load meme');
        setStep('error');
      } finally {
        setLoading(false);
      }
    })();
  }, [connected, publicKey, meme_id, step]);

  // Step: verify_owner → fetch sealed blob from /initiate.
  const handleVerifyOwner = async () => {
    if (!publicKey || !signMessage || !meme) return;
    setLoading(true);
    setError(null);
    try {
      // Auth signature for /initiate.
      const ts = Date.now();
      const authMessage = `claim-pool:${meme_id}:${publicKey.toBase58()}:${ts}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);

      const res = await fetch('/api/wallet-claim/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id,
          caller_wallet: publicKey.toBase58(),
          signature: sigB58,
          message: authMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate claim');
      setSealedBlob(data.sealed_pool_key);
      setStep('warnings');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Initiate failed');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  // Step: decrypt → sign derivation message, decrypt blob locally.
  const handleDecrypt = async () => {
    if (!publicKey || !signMessage || !sealedBlob || !meme) return;
    setLoading(true);
    setError(null);
    try {
      // Sign the deterministic derivation message. Same signature the
      // server used at launch time to seal the key.
      const sigBytes = await signMessage(new TextEncoder().encode(DERIVATION_MESSAGE_V1));
      const x25519Secret = await deriveX25519SecretFromSignature(sigBytes);
      const x25519Pubkey = await x25519PublicFromSecret(x25519Secret);
      const opened = await openSealedBox(sealedBlob, x25519Pubkey, x25519Secret);
      x25519Secret.fill(0);

      // Sanity: recovered secret key should derive to meme.pool_wallet.
      let kp: Keypair;
      try {
        kp = Keypair.fromSecretKey(opened);
      } catch (e) {
        throw new Error(`recovered bytes are not a valid keypair: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (kp.publicKey.toBase58() !== meme.pool_wallet) {
        throw new Error(
          `recovered keypair pubkey (${kp.publicKey.toBase58()}) does not match the on-chain pool wallet (${meme.pool_wallet}). Do not use this key.`,
        );
      }

      setRecoveredSecretKey(opened);
      setRecoveredKeypair(kp);
      setStep('display');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decryption failed');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  // Step: verify_chars → user types first 4 + last 4 chars of the key.
  const handleVerifyChars = () => {
    if (!recoveredSecretKey) return;
    const secretB58 = bs58.encode(recoveredSecretKey);
    const expected = `${secretB58.slice(0, 4)}${secretB58.slice(-4)}`;
    if (verifyChars.trim().toLowerCase() !== expected.toLowerCase()) {
      setError(`Verification failed. Expected first-4 + last-4 to be '${expected}'. Please try again.`);
      return;
    }
    setError(null);
    setStep('confirm');
  };

  // Step: confirm → POST to /confirm endpoint.
  const handleConfirm = async () => {
    if (!publicKey || !signMessage) return;
    setLoading(true);
    setError(null);
    try {
      const ts = Date.now();
      const authMessage = `claim-confirm:${meme_id}:${publicKey.toBase58()}:${ts}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);
      const res = await fetch('/api/wallet-claim/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id,
          caller_wallet: publicKey.toBase58(),
          signature: sigB58,
          message: authMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Confirm failed');
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  const secretB58 = recoveredSecretKey ? bs58.encode(recoveredSecretKey) : '';
  const downloadJson = () => {
    if (!recoveredSecretKey || !recoveredKeypair) return;
    const blob = new Blob([
      JSON.stringify(Array.from(recoveredSecretKey), null, 2),
    ], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pool-wallet-${recoveredKeypair.publicKey.toBase58()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copySecret = async () => {
    if (!secretB58) return;
    await navigator.clipboard.writeText(secretB58);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-mono font-bold uppercase tracking-tight">
        Claim Pool Wallet
      </h1>
      {meme && (
        <div className="text-xs font-mono text-[var(--muted)]">
          Token: ${meme.symbol ?? '?'} · Pool: <code className="bg-[var(--background)] px-1">{meme.pool_wallet.slice(0, 8)}…{meme.pool_wallet.slice(-4)}</code>
        </div>
      )}

      {/* CONNECT */}
      {step === 'connect' && (
        <div className="border border-[var(--border)] p-6 space-y-4">
          <p>Connect the wallet that created this meme.</p>
          <WalletMultiButton />
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        </div>
      )}

      {/* VERIFY OWNER */}
      {step === 'verify_owner' && (
        <div className="border border-[var(--border)] p-6 space-y-4">
          <p>Sign a message to prove ownership of this token.</p>
          <button
            onClick={handleVerifyOwner}
            disabled={loading}
            className="w-full py-3 bg-[var(--accent)] text-[#0a0a0a] font-mono font-bold uppercase tracking-widest disabled:opacity-40"
          >
            {loading ? 'Signing…' : 'Sign Ownership Message'}
          </button>
        </div>
      )}

      {/* WARNINGS */}
      {step === 'warnings' && (
        <div className="border-2 border-[var(--error)] bg-[var(--error)]/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-[var(--error)] font-bold uppercase tracking-wide">
            <ShieldAlert className="w-5 h-5" /> Read carefully before continuing
          </div>
          <ul className="text-sm space-y-2 list-disc list-inside">
            <li>You are about to take <strong>full custody</strong> of this token&apos;s pool wallet.</li>
            <li>Once you claim, the platform <strong>cannot recover</strong> this key for you. Ever.</li>
            <li>You must save the key in your password manager or hardware wallet immediately after seeing it.</li>
            <li>If you lose access to <em>this wallet</em>, you also lose the pool wallet permanently.</li>
            <li>The 24-hour grace period is for support to manually reverse the claim if something went wrong. After 24h the platform-encrypted backup is destroyed.</li>
            <li>If you only want to view the key (re-claim), that&apos;s fine — the encrypted blob stays in our DB forever and you can re-decrypt it anytime by signing the same message.</li>
          </ul>
          <button
            onClick={() => setStep('decrypt')}
            className="w-full py-3 bg-[var(--error)] text-white font-mono font-bold uppercase tracking-widest"
          >
            I understand → Decrypt my key
          </button>
        </div>
      )}

      {/* DECRYPT */}
      {step === 'decrypt' && (
        <div className="border border-[var(--border)] p-6 space-y-4">
          <p>Sign the derivation message to decrypt your sealed pool key locally.</p>
          <p className="text-xs font-mono text-[var(--muted)]">
            Message: <code>{DERIVATION_MESSAGE_V1}</code>
          </p>
          <p className="text-xs text-[var(--muted)]">
            This signature is deterministic and never leaves your browser. The decryption happens client-side.
          </p>
          <button
            onClick={handleDecrypt}
            disabled={loading}
            className="w-full py-3 bg-[var(--accent)] text-[#0a0a0a] font-mono font-bold uppercase tracking-widest disabled:opacity-40"
          >
            {loading ? 'Decrypting…' : 'Sign + Decrypt'}
          </button>
        </div>
      )}

      {/* DISPLAY */}
      {step === 'display' && recoveredKeypair && (
        <div className="border-2 border-[var(--success)] bg-[var(--success)]/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-[var(--success)] font-bold uppercase tracking-wide">
            <CheckCircle className="w-5 h-5" /> Pool wallet recovered
          </div>
          <p className="text-sm">
            The recovered keypair's public key matches <code>{recoveredKeypair.publicKey.toBase58()}</code> ✓
          </p>
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-[var(--muted)] mb-2">
              Secret key (base58 — Solana standard)
            </div>
            <div className="font-mono text-xs bg-[var(--background)] p-3 break-all border border-[var(--border)]">
              {secretB58}
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={copySecret} className="px-3 py-1.5 border border-[var(--border)] text-xs font-mono uppercase tracking-widest flex items-center gap-1">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy
              </button>
              <button onClick={downloadJson} className="px-3 py-1.5 border border-[var(--border)] text-xs font-mono uppercase tracking-widest flex items-center gap-1">
                <Download className="w-3 h-3" /> Download JSON
              </button>
            </div>
          </div>
          <div className="border-t border-[var(--border)] pt-4">
            <p className="text-sm mb-2">Save this key now in your password manager. Then continue.</p>
            <button
              onClick={() => setStep('verify_chars')}
              className="w-full py-3 bg-[var(--accent)] text-[#0a0a0a] font-mono font-bold uppercase tracking-widest"
            >
              I've saved my key → continue
            </button>
          </div>
        </div>
      )}

      {/* VERIFY CHARS */}
      {step === 'verify_chars' && (
        <div className="border border-[var(--border)] p-6 space-y-4">
          <p>To confirm you've actually saved the key, type the <strong>first 4 + last 4 characters</strong> of the secret key (no spaces).</p>
          <input
            type="text"
            value={verifyChars}
            onChange={(e) => setVerifyChars(e.target.value)}
            className="w-full font-mono p-3 bg-[var(--background)] border border-[var(--border)]"
            placeholder="e.g. abc1xyz9"
          />
          {error && (
            <div className="text-xs text-[var(--error)] font-mono">{error}</div>
          )}
          <button
            onClick={handleVerifyChars}
            className="w-full py-3 bg-[var(--accent)] text-[#0a0a0a] font-mono font-bold uppercase tracking-widest"
          >
            Verify
          </button>
        </div>
      )}

      {/* CONFIRM */}
      {step === 'confirm' && (
        <div className="border-2 border-[var(--warning)] bg-[var(--warning)]/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-[var(--warning)] font-bold uppercase tracking-wide">
            <AlertTriangle className="w-5 h-5" /> Final confirmation
          </div>
          <p>Click below to confirm your claim. The 24-hour grace period begins now.</p>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="w-full py-3 bg-[var(--warning)] text-[#0a0a0a] font-mono font-bold uppercase tracking-widest disabled:opacity-40"
          >
            {loading ? 'Confirming…' : 'Confirm Claim'}
          </button>
        </div>
      )}

      {/* DONE */}
      {step === 'done' && (
        <div className="border-2 border-[var(--success)] bg-[var(--success)]/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-[var(--success)] font-bold uppercase tracking-wide">
            <CheckCircle className="w-5 h-5" /> Claim complete
          </div>
          <p>Your pool wallet is now under your custody. The platform-encrypted backup will be permanently destroyed in 24 hours.</p>
          <p className="text-sm text-[var(--muted)]">
            If you ever lose the cleartext key, you can come back to this page and re-decrypt the sealed blob — your wallet's signature on the derivation message is deterministic, so you'll get the same key.
          </p>
        </div>
      )}

      {/* ERROR */}
      {step === 'error' && error && (
        <div className="border-2 border-[var(--error)] bg-[var(--error)]/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-[var(--error)] font-bold uppercase tracking-wide">
            <ShieldAlert className="w-5 h-5" /> Error
          </div>
          <p className="text-sm font-mono">{error}</p>
          <button onClick={() => { setError(null); setStep('connect'); }} className="px-4 py-2 border border-[var(--border)] text-xs font-mono uppercase tracking-widest">
            Start Over
          </button>
        </div>
      )}
    </div>
  );
}
