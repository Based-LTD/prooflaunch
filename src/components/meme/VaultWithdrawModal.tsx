'use client';

import { useEffect, useState } from 'react';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { X, Loader2 } from 'lucide-react';
import type { MemeBot } from '@/types/database';

// Modal that lets the meme's creator drain a VAULT bot's SOL or token
// balance to a destination wallet. The modal:
//
//   1. Reads on-chain balances for the bot wallet (SOL + the meme's mint).
//   2. Builds the signed-message payload that POST /api/bots/[id]/withdraw
//      expects (see route.ts — same format here; if you change one, change
//      both).
//   3. Asks the user's wallet to sign the message via signMessage().
//   4. POSTs the signed payload; on success surfaces the tx and refreshes.
//
// Closes on successful submit OR user cancel. Errors stay inline.

interface Props {
  bot: MemeBot;
  mintAddress: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

// Match the server's MIN_VAULT_RESERVE_LAMPORTS (route.ts). Update both
// together so the UI's "available" matches what the API will accept.
const MIN_VAULT_RESERVE_LAMPORTS = 0.001 * LAMPORTS_PER_SOL;

function formatLamports(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

function formatTokenRaw(raw: bigint, decimals: number): string {
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (frac === BigInt(0)) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

export function VaultWithdrawModal({ bot, mintAddress, onClose, onSuccess }: Props) {
  const { publicKey, signMessage } = useWallet();
  const { connection } = useConnection();

  const [asset, setAsset] = useState<'sol' | 'token'>('token');
  const [destination, setDestination] = useState<string>('');
  const [amountMode, setAmountMode] = useState<'all' | 'custom'>('all');
  const [customAmount, setCustomAmount] = useState<string>(''); // user-facing units (SOL or token decimals)
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalanceRaw, setTokenBalanceRaw] = useState<bigint | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTx, setSuccessTx] = useState<string | null>(null);

  // Prefill destination with the connected wallet (creator) — the most
  // common case. Creator can override before submitting.
  useEffect(() => {
    if (publicKey && !destination) setDestination(publicKey.toBase58());
  }, [publicKey, destination]);

  // Load on-chain balances for both assets so the user can pick.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const botPk = new PublicKey(bot.bot_wallet);
        const sol = await connection.getBalance(botPk);
        if (cancelled) return;
        setSolBalance(sol);

        if (mintAddress) {
          const mintPk = new PublicKey(mintAddress);
          const mintInfo = await connection.getAccountInfo(mintPk);
          if (!cancelled && mintInfo) {
            const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
              ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
            const ata = getAssociatedTokenAddressSync(mintPk, botPk, false, tokenProgramId);
            const balRes = await connection.getTokenAccountBalance(ata).catch(() => null);
            if (!cancelled) {
              const raw = BigInt(balRes?.value?.amount || '0');
              setTokenBalanceRaw(raw);
              setTokenDecimals(balRes?.value?.decimals ?? 6);
              // Default the asset selector to whichever has a non-zero
              // balance, preferring tokens (the vault's intended asset).
              if (raw > BigInt(0)) setAsset('token');
              else if (sol > MIN_VAULT_RESERVE_LAMPORTS) setAsset('sol');
            }
          }
        }
      } finally {
        if (!cancelled) setLoadingBalances(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bot.bot_wallet, mintAddress, connection]);

  const solAvailable = solBalance !== null
    ? Math.max(0, solBalance - MIN_VAULT_RESERVE_LAMPORTS)
    : null;

  async function handleSubmit() {
    setError(null);
    if (!publicKey || !signMessage) {
      setError('Wallet not connected or does not support signMessage');
      return;
    }

    // Validate destination upfront (saves the user a signature prompt).
    let destPk: PublicKey;
    try {
      destPk = new PublicKey(destination);
    } catch {
      setError('Invalid destination address');
      return;
    }

    // Resolve amount in raw units (lamports for SOL, base units for token).
    let amountStr: string;
    if (amountMode === 'all') {
      amountStr = 'all';
    } else {
      const trimmed = customAmount.trim();
      if (!trimmed || isNaN(Number(trimmed)) || Number(trimmed) <= 0) {
        setError('Enter a positive amount');
        return;
      }
      if (asset === 'sol') {
        amountStr = Math.floor(Number(trimmed) * LAMPORTS_PER_SOL).toString();
      } else {
        // Token amount entered in display units → convert to raw using
        // the mint's decimals. If we couldn't load decimals (no mint?),
        // require "all".
        if (tokenDecimals === null) {
          setError('Token decimals unknown — use Max');
          return;
        }
        // Robust decimal → raw conversion (handles trailing zeros).
        const [whole, frac = ''] = trimmed.split('.');
        const fracPadded = (frac + '0'.repeat(tokenDecimals)).slice(0, tokenDecimals);
        const wholeBig = BigInt(whole || '0');
        const fracBig = BigInt(fracPadded || '0');
        const raw = wholeBig * (BigInt(10) ** BigInt(tokenDecimals)) + fracBig;
        if (raw <= BigInt(0)) {
          setError('Amount must be positive');
          return;
        }
        amountStr = raw.toString();
      }
    }

    // Nonce — single-use UUID. crypto.randomUUID is on all modern browsers.
    const nonce = crypto.randomUUID();
    const tsMs = Date.now();
    const signer = publicKey.toBase58();

    // Message format MUST match what /api/bots/[id]/withdraw expects.
    const prefix =
      `bot-withdraw:${bot.id}:${signer}:${destPk.toBase58()}:${asset}:${amountStr}:${nonce}`;
    const message = `${prefix}:${tsMs}`;

    setSubmitting(true);
    try {
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      const signatureB58 = bs58.encode(sigBytes);

      const res = await fetch(`/api/bots/${bot.id}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer,
          signature: signatureB58,
          message,
          destination: destPk.toBase58(),
          asset,
          amount: amountStr,
          nonce,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `withdraw failed (${res.status})`);
        return;
      }
      setSuccessTx(body.tx);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-[var(--border)] bg-[var(--card)] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              WITHDRAW FROM VAULT
            </div>
            <div className="text-sm font-mono font-semibold mt-0.5 text-[var(--foreground)]">
              {bot.label ?? 'Vault'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balances */}
        <div className="border border-[var(--border)] bg-[var(--background)] p-3 text-[11px] font-mono space-y-1">
          {loadingBalances ? (
            <div className="flex items-center gap-2 text-[var(--muted)]">
              <Loader2 className="w-3 h-3 animate-spin" /> Reading on-chain balances…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[var(--muted)]">Vault SOL</span>
                <span className="text-[var(--foreground)]">
                  {solBalance !== null ? `${formatLamports(solBalance)} SOL` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--muted)]">Vault tokens</span>
                <span className="text-[var(--foreground)]">
                  {tokenBalanceRaw !== null && tokenDecimals !== null
                    ? formatTokenRaw(tokenBalanceRaw, tokenDecimals)
                    : '—'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Asset toggle */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            Asset
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAsset('token')}
              className={`p-2 text-xs font-mono border transition-colors ${
                asset === 'token'
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50'
              }`}
            >
              TOKEN
            </button>
            <button
              type="button"
              onClick={() => setAsset('sol')}
              className={`p-2 text-xs font-mono border transition-colors ${
                asset === 'sol'
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50'
              }`}
            >
              SOL
            </button>
          </div>
        </div>

        {/* Destination */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            Destination wallet
          </label>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Solana wallet address"
            className="w-full bg-[var(--background)] border border-[var(--border)] px-2 py-2 text-[11px] font-mono text-[var(--foreground)] outline-none focus:border-[var(--accent)] break-all"
          />
        </div>

        {/* Amount */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            Amount
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAmountMode('all')}
              className={`p-2 text-xs font-mono border transition-colors ${
                amountMode === 'all'
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50'
              }`}
            >
              MAX (available)
            </button>
            <button
              type="button"
              onClick={() => setAmountMode('custom')}
              className={`p-2 text-xs font-mono border transition-colors ${
                amountMode === 'custom'
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50'
              }`}
            >
              CUSTOM
            </button>
          </div>
          {amountMode === 'custom' && (
            <input
              type="text"
              inputMode="decimal"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder={asset === 'sol' ? 'e.g. 0.5 (SOL)' : 'e.g. 1000.5 (tokens)'}
              className="w-full bg-[var(--background)] border border-[var(--border)] px-2 py-2 text-xs font-mono text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
            />
          )}
          {amountMode === 'all' && asset === 'sol' && solAvailable !== null && (
            <div className="text-[10px] font-mono text-[var(--muted)]">
              {formatLamports(solAvailable)} SOL withdrawable (reserve {formatLamports(MIN_VAULT_RESERVE_LAMPORTS)} kept for rent)
            </div>
          )}
        </div>

        {/* Error or success */}
        {error && (
          <div className="border border-red-400/40 bg-red-400/5 p-2.5 text-[10px] font-mono text-red-400 leading-snug">
            ★ {error}
          </div>
        )}
        {successTx && (
          <div className="border border-[var(--success)]/40 bg-[var(--success)]/5 p-2.5 text-[10px] font-mono text-[var(--success)] leading-snug break-all">
            ✓ Withdrawal sent.{' '}
            <a
              href={`https://solscan.io/tx/${successTx}`}
              target="_blank" rel="noreferrer"
              className="underline"
            >
              View tx
            </a>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-3 py-2 text-xs font-mono uppercase tracking-wider border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/60"
          >
            Close
          </button>
          {!successTx && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !publicKey || !destination}
              className="flex-1 btn-primary text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Signing…
                </>
              ) : (
                <>Sign &amp; Withdraw</>
              )}
            </button>
          )}
        </div>

        <div className="text-[10px] font-mono text-[var(--muted)] italic leading-snug">
          The platform never moves vault funds without your signature. Every withdrawal
          is recorded in meme_bot_withdrawals — publicly auditable forever.
        </div>
      </div>
    </div>
  );
}
