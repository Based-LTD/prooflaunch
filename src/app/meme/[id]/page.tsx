'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { ArrowLeft, Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import { MemeIdentityBar } from '@/components/meme/MemeIdentityBar';
import { MemeActionPanel } from '@/components/meme/MemeActionPanel';
import { DashboardCard } from '@/components/meme/DashboardCard';
import { MobileStickyCTA } from '@/components/meme/MobileStickyCTA';
import { CreatorPastLaunches } from '@/components/CreatorPastLaunches';
import { BackerLoungePanel } from '@/components/meme/BackerLoungePanel';
import { BuybackBotPanel } from '@/components/meme/BuybackBotPanel';
import { LaunchVisibilityPanel } from '@/components/meme/LaunchVisibilityPanel';
import { BackerVaultManager } from '@/components/meme/BackerVaultManager';
import { EditMetadataPanel } from '@/components/meme/EditMetadataPanel';
import { ClaimRewards } from '@/components/ClaimRewards';
import { BackersList } from '@/components/BackersList';
import { GenesisBackerRoster } from '@/components/GenesisBackerRoster';
import { MemeChat } from '@/components/MemeChat';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useRealtimeMeme, useRealtimeBackings } from '@/hooks/useRealtimeMemes';
import { computeBackingEligibility } from '@/lib/backingEligibility';

// Page is now a thin shell: it owns state + handlers (SOL transactions,
// wallet signing, status messages) and assembles the new components.
// Visual layout lives in src/components/meme/*; the page just decides
// which status branch and feeds props down.

function getTimeRemaining(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function MemeDetailPage() {
  const { id } = useParams();
  const { connected, publicKey, signTransaction, signMessage } = useWallet();
  const { connection } = useConnection();

  // Backing state
  const [amount, setAmount] = useState('');
  const [backing, setBacking] = useState(false);
  const [backingStatus, setBackingStatus] = useState<string | null>(null);
  const [showBackConfirm, setShowBackConfirm] = useState(false);

  // Launch state (creator only)
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [showLaunchConfirm, setShowLaunchConfirm] = useState(false);

  // Reset-launch-window state (creator only — extends funded meme deadline 48h)
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  // Distribute state (creator manual retry — rare)
  const [distributing, setDistributing] = useState(false);
  const [distributeStatus, setDistributeStatus] = useState<string | null>(null);

  // Withdraw state
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawStatus, setWithdrawStatus] = useState<string | null>(null);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [pendingWithdrawWallet, setPendingWithdrawWallet] = useState<string | null>(null);
  const [pendingWithdrawAmount, setPendingWithdrawAmount] = useState(0);

  const { meme, loading, error, refetch: refetchMeme } = useRealtimeMeme(id as string);
  const { backings, refetch: refetchBackings } = useRealtimeBackings(id as string);

  // Page-level allowlist fetch. Only meaningful when the meme has
  // reserved slots — otherwise the breakdown UI doesn't render. We
  // hold the list in state so the action panel can show "team N/M
  // filled · open M/K filled" without re-fetching per render. Refresh
  // alongside backings so a freshly-added allowlist wallet appears.
  const [allowlistWallets, setAllowlistWallets] = useState<string[]>([]);
  useEffect(() => {
    if (!id || !meme || (meme.reserved_slots ?? 0) === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/memes/${id}/allowlist`);
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const list: { wallet: string }[] = Array.isArray(j?.allowlist) ? j.allowlist : [];
        setAllowlistWallets(list.map((row) => row.wallet));
      } catch { /* swallow — breakdown just doesn't render */ }
    })();
    return () => { cancelled = true; };
  }, [id, meme]);

  // ── Backing ──────────────────────────────────────────────────────
  // Helper — checks whether the connected wallet is on the meme's
  // backing_allowlist. Used to gate reserved-slot launches before the
  // user signs (preventing the "SOL stranded in pool wallet" footgun
  // when the backing API would have rejected post-deposit).
  const checkAllowlistMembership = async (memeId: string, wallet: string): Promise<boolean> => {
    try {
      const r = await fetch(`/api/memes/${memeId}/allowlist`);
      if (!r.ok) return false;
      const j = await r.json();
      const list: { wallet: string }[] = Array.isArray(j?.allowlist) ? j.allowlist : [];
      return list.some((row) => row.wallet === wallet);
    } catch {
      return false;
    }
  };

  const submitBacking = async () => {
    if (!connected || !publicKey || !signTransaction || !amount || !meme) return;

    const amountSol = parseFloat(amount);
    if (isNaN(amountSol) || amountSol <= 0) {
      setBackingStatus('Error: Invalid amount');
      return;
    }

    const minBacking = Number(meme.min_backing_sol) || 0.1;
    const minBackingUnit = (meme.quote_currency === 'usdc') ? 'USDC' : 'SOL';
    if (amountSol < minBacking) {
      setBackingStatus(`Error: Minimum backing is ${minBacking} ${minBackingUnit}.`);
      return;
    }

    // Quote-currency unit string for user-facing labels in this fn.
    // Hoisted to the top so every error message + balance check
    // downstream renders the correct denomination.
    const quoteCurrencyEarly: 'sol' | 'usdc' = (meme as { quote_currency?: 'sol' | 'usdc' }).quote_currency ?? 'sol';
    const unitLabel = quoteCurrencyEarly === 'usdc' ? 'USDC' : 'SOL';

    // Pre-check the team-fairness cap so the user doesn't sign a tx
    // the API will reject (which would leave their funds stranded in
    // the pool wallet because the on-chain deposit lands BEFORE the
    // API validates).
    const cap = meme.max_backing_sol != null ? Number(meme.max_backing_sol) : null;
    if (cap !== null && amountSol > cap + 1e-9) {
      setBackingStatus(`Error: This launch has a per-backer cap of ${cap} ${unitLabel}. Your amount exceeds it.`);
      return;
    }

    const myExisting = backings.find(
      (b) => b.backer_wallet === publicKey.toBase58() && b.status !== 'withdrawn',
    );
    if (myExisting) {
      setBackingStatus(
        `Error: You already have an active backing of ${Number(myExisting.amount_sol).toFixed(2)} ${unitLabel}. Withdraw first to change your amount.`,
      );
      return;
    }

    // Single-source gate. Checks "all slots filled", "team round",
    // and "public bucket filled" in one place — same helper as
    // confirmBack and the lock-card UI. See src/lib/backingEligibility.ts.
    const reservedSlotsCount = Number(meme.reserved_slots) || 0;
    const isAllowlisted = reservedSlotsCount > 0
      ? await checkAllowlistMembership(meme.id, publicKey.toBase58())
      : true;
    const eligibility = computeBackingEligibility({
      meme: { total_slots: Number(meme.total_slots) || 8, reserved_slots: reservedSlotsCount },
      backings,
      isAllowlisted,
    });
    if (!eligibility.canBack) {
      setBackingStatus(`Error: ${eligibility.message}`);
      return;
    }

    // Balance pre-check — saves the user a failed signature prompt.
    // USDC memes: need amountSol (USDC) in the backer's USDC ATA, and
    // ~0.01 SOL for gas + idempotent ATA-create rent. SOL memes:
    // amount + 0.005 SOL gas. SOL flow byte-identical to before.
    try {
      if (quoteCurrencyEarly === 'usdc') {
        const { getUsdcAta } = await import('@/lib/usdc');
        const { PublicKey: Pk } = await import('@solana/web3.js');
        const usdcAta = getUsdcAta(new Pk(publicKey.toBase58()));
        let usdcBal = 0;
        try {
          const bal = await connection.getTokenAccountBalance(usdcAta, 'confirmed');
          usdcBal = Number(bal.value.uiAmount);
        } catch { /* ATA may not exist yet → treated as 0 */ }
        if (usdcBal < amountSol) {
          setBackingStatus(
            `Error: Insufficient USDC. You have ${usdcBal.toFixed(2)} USDC but need ${amountSol.toFixed(2)} USDC.`,
          );
          return;
        }
        const solBal = await connection.getBalance(publicKey);
        if (solBal / LAMPORTS_PER_SOL < 0.01) {
          setBackingStatus(
            `Error: Insufficient SOL for gas. You need ~0.01 SOL to pay for the transaction (USDC backing).`,
          );
          return;
        }
      } else {
        const totalNeeded = amountSol + 0.005;
        const balance = await connection.getBalance(publicKey);
        const balanceSol = balance / LAMPORTS_PER_SOL;
        if (balanceSol < totalNeeded) {
          setBackingStatus(
            `Error: Insufficient balance. You have ${balanceSol.toFixed(4)} SOL but need ~${totalNeeded.toFixed(4)} SOL.`,
          );
          return;
        }
      }
    } catch {
      // If RPC balance check fails, let the transaction itself fail
      // with a wallet-side error — better than blocking the user.
    }

    setBacking(true);
    setBackingStatus('Preparing backing...');

    try {
      const poolWallet: string | undefined = (meme as { pool_wallet?: string }).pool_wallet;
      if (!poolWallet) {
        throw new Error('This meme has no pool wallet yet — please refresh and try again.');
      }

      // Quote-currency branch (migration 053). USDC memes sign an SPL
      // USDC transfer to the pool's USDC ATA (with idempotent ATA-create
      // for the pool's first USDC deposit). SOL memes use the existing
      // SystemProgram.transfer path — byte-identical to today.
      const quoteCurrency: 'sol' | 'usdc' = (meme as { quote_currency?: 'sol' | 'usdc' }).quote_currency ?? 'sol';
      let tx: Transaction;
      if (quoteCurrency === 'usdc') {
        const { buildUsdcBackingTx } = await import('@/lib/usdc');
        tx = buildUsdcBackingTx({
          backer: publicKey,
          pool: new PublicKey(poolWallet),
          amount: amountSol, // amountSol is the quote-units value (USDC here)
        });
      } else {
        const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
        tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(poolWallet),
            lamports,
          }),
        );
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const unit = quoteCurrency === 'usdc' ? 'USDC' : 'SOL';
      setBackingStatus(`Approve ${amountSol} ${unit} to the pool...`);
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());

      setBackingStatus('Processing transaction...');
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      setBackingStatus('Registering backing...');
      const res = await fetch('/api/backings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: publicKey.toBase58(),
          amount_sol: amountSol,
          deposit_tx: sig,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        // If the server rejected but auto-refunded, tell the user
        // explicitly so they see the SOL came back rather than guessing.
        if (d?.refunded === true && d?.refund_tx) {
          throw new Error(`${d.error || 'Backing rejected'} — your ${unitLabel} was refunded automatically (tx ${String(d.refund_tx).slice(0, 8)}…).`);
        }
        if (d?.refunded === false) {
          throw new Error(`${d.error || 'Backing rejected'} — auto-refund failed; contact support with deposit tx ${String(sig).slice(0, 8)}…`);
        }
        throw new Error(d.error || 'Failed to register backing');
      }

      setBackingStatus('Backing successful!');
      setAmount('');
      await Promise.all([refetchMeme(), refetchBackings()]);
    } catch (err) {
      console.error('Backing failed:', err);
      setBackingStatus(`Error: ${err instanceof Error ? err.message : 'Transaction failed'}`);
    } finally {
      setBacking(false);
    }
  };

  const requestBack = async () => {
    const amountSol = parseFloat(amount);
    if (isNaN(amountSol) || amountSol <= 0) {
      setBackingStatus('Error: Please enter a valid amount');
      return;
    }
    const minBacking = Number(meme?.min_backing_sol) || 0.1;
    if (amountSol < minBacking) {
      setBackingStatus(`Error: Minimum backing is ${minBacking} SOL.`);
      return;
    }
    // Pre-check cap so the confirm dialog doesn't tease an action the
    // submit step will block (and to avoid stranded-SOL post-deposit).
    const cap = meme?.max_backing_sol != null ? Number(meme.max_backing_sol) : null;
    if (cap !== null && amountSol > cap + 1e-9) {
      setBackingStatus(`Error: This launch has a per-backer cap of ${cap} SOL. Your amount exceeds it.`);
      return;
    }
    const myExisting = backings.find(
      (b) => b.backer_wallet === publicKey?.toBase58() && b.status !== 'withdrawn',
    );
    if (myExisting) {
      setBackingStatus(
        `Error: You already have an active backing of ${Number(myExisting.amount_sol).toFixed(2)} SOL. Withdraw first to change your amount.`,
      );
      return;
    }
    // Single-source gate — same helper used by submitBacking and the
    // lock-card UI. Fetches allowlist membership before opening the
    // confirm dialog so non-allowlisted backers learn early, not at
    // sign time.
    if (meme && publicKey) {
      const reservedSlotsCount = Number(meme.reserved_slots) || 0;
      const isAllowlisted = reservedSlotsCount > 0
        ? await checkAllowlistMembership(meme.id, publicKey.toBase58())
        : true;
      const eligibility = computeBackingEligibility({
        meme: { total_slots: Number(meme.total_slots) || 8, reserved_slots: reservedSlotsCount },
        backings,
        isAllowlisted,
      });
      if (!eligibility.canBack) {
        setBackingStatus(`Error: ${eligibility.message}`);
        return;
      }
    }
    setBackingStatus(null);
    setShowBackConfirm(true);
  };

  const confirmBack = () => {
    setShowBackConfirm(false);
    submitBacking();
  };

  // ── Reset launch window (creator extends funded deadline by 48h) ─
  const handleResetWindow = async () => {
    if (!meme || resetting || !publicKey || !signMessage) return;
    setResetting(true);
    setResetStatus('Sign to extend launch window…');
    try {
      const authMessage = `reset:${meme.id}:${publicKey.toBase58()}:${Date.now()}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);

      const res = await fetch(`/api/memes/${meme.id}/reset-launch-window`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caller_wallet: publicKey.toBase58(),
          signature: sigB58,
          message: authMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');

      setResetStatus(`Launch window extended +48h.`);
      await refetchMeme();
      setTimeout(() => setResetStatus(null), 4000);
    } catch (err) {
      console.error('Reset window failed:', err);
      setResetStatus(`Error: ${err instanceof Error ? err.message : 'Reset failed'}`);
    } finally {
      setResetting(false);
    }
  };

  // ── Launch ───────────────────────────────────────────────────────
  const requestLaunch = () => setShowLaunchConfirm(true);

  const confirmLaunch = async () => {
    setShowLaunchConfirm(false);
    if (!meme || launching || !publicKey || !signMessage) return;
    setLaunching(true);
    setLaunchStatus('Sign to authorize launch...');
    try {
      const authMessage = `launch:${meme.id}:${publicKey.toBase58()}:${Date.now()}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);

      setLaunchStatus('Initiating launch...');
      const res = await fetch('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          caller_wallet: publicKey.toBase58(),
          signature: sigB58,
          message: authMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Launch failed');

      const dist = data.distribution as { distributed: number; remaining: number } | undefined;
      if (dist && dist.remaining === 0) {
        setLaunchStatus(`Launched! Tokens distributed to all ${dist.distributed} backers.`);
      } else if (dist && dist.remaining > 0) {
        setLaunchStatus(`Launched! ${dist.distributed} distributed, ${dist.remaining} auto-retrying…`);
      } else {
        setLaunchStatus('Token launched successfully!');
      }
      await Promise.all([refetchMeme(), refetchBackings()]);
      setTimeout(() => setLaunchStatus(null), 5000);
    } catch (err) {
      console.error('Launch failed:', err);
      setLaunchStatus(`Error: ${err instanceof Error ? err.message : 'Launch failed'}`);
    } finally {
      setLaunching(false);
    }
  };

  // ── Distribute (manual retry — fallback when cron straggles) ─────
  const handleDistribute = async () => {
    if (!meme || !publicKey || !signMessage || distributing) return;
    setDistributing(true);
    setDistributeStatus('Sign to authorize distribution...');
    try {
      const authMessage = `claim:${meme.id}:${publicKey.toBase58()}:${Date.now()}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);

      setDistributeStatus('Distributing tokens to backers...');
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          caller_wallet: publicKey.toBase58(),
          signature: sigB58,
          message: authMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Distribution failed');

      setDistributeStatus(
        data.remaining > 0
          ? `Distributed ${data.distributed}, ${data.remaining} failed — retry to finish`
          : `All ${data.distributed} backers received their tokens!`,
      );
      await Promise.all([refetchMeme(), refetchBackings()]);
      setTimeout(() => setDistributeStatus(null), 6000);
    } catch (err) {
      console.error('Distribute failed:', err);
      setDistributeStatus(`Error: ${err instanceof Error ? err.message : 'Distribution failed'}`);
    } finally {
      setDistributing(false);
    }
  };

  // ── Withdraw ─────────────────────────────────────────────────────
  const requestWithdraw = (backerWallet: string) => {
    const b = backings.find((x) => x.backer_wallet === backerWallet);
    setPendingWithdrawAmount(b ? Number(b.amount_sol) : 0);
    setPendingWithdrawWallet(backerWallet);
    setShowWithdrawConfirm(true);
  };

  const confirmWithdraw = () => {
    setShowWithdrawConfirm(false);
    if (pendingWithdrawWallet) {
      runWithdraw(pendingWithdrawWallet);
      setPendingWithdrawWallet(null);
      setPendingWithdrawAmount(0);
    }
  };

  const runWithdraw = async (backerWallet: string) => {
    if (!meme || withdrawing || !signMessage) return;
    setWithdrawing(true);
    setWithdrawStatus('Sign to authorize withdrawal...');
    try {
      const authMessage = `withdraw:${meme.id}:${backerWallet}:${Date.now()}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);

      setWithdrawStatus('Processing withdrawal...');
      const res = await fetch('/api/backings/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: backerWallet,
          signature: sigB58,
          message: authMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed');

      setWithdrawStatus(`Successfully withdrew ${data.amount_refunded} ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'}!`);
      await Promise.all([refetchMeme(), refetchBackings()]);
      setTimeout(() => setWithdrawStatus(null), 5000);
    } catch (err) {
      console.error('Withdrawal failed:', err);
      setWithdrawStatus(`Error: ${err instanceof Error ? err.message : 'Withdrawal failed'}`);
    } finally {
      setWithdrawing(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (error || !meme) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Proving Grounds
        </Link>
        <div className="card p-8 text-center">
          <h2 className="text-xl font-semibold mb-2">Token Not Found</h2>
          <p className="text-[var(--muted)]">{error || 'This token does not exist.'}</p>
        </div>
      </div>
    );
  }

  const isProving = meme.status === 'backing';
  const isFunded = meme.status === 'funded';
  const isLaunching = meme.status === 'launching';
  const isLaunched = meme.status === 'live';
  const isCreator = connected && publicKey?.toBase58() === meme.creator_wallet;
  const isBacker = connected && backings.some(
    (b) => b.backer_wallet === publicKey?.toBase58() && b.status === 'distributed',
  );

  const totalSlots = Number(meme.total_slots) || 8;
  const minBacking = Number(meme.min_backing_sol) || 0.1;
  const backerCount = backings.length;
  const slotsRemaining = totalSlots - backerCount;
  const timeRemaining = getTimeRemaining(meme.backing_deadline);
  const totalBackingSol = Number(meme.current_backing_sol) || 0;

  const projectedSharePct = (() => {
    const a = Number(amount);
    if (!a || a <= 0) return 0;
    if (totalBackingSol + a <= 0) return 0;
    return (a / (totalBackingSol + a)) * 100;
  })();

  const myBacking = backings.find(
    (b) => b.backer_wallet === publicKey?.toBase58() && b.status !== 'withdrawn',
  ) as (typeof backings[number] & { claim_tokens?: string | number; claim_tx?: string }) | undefined;

  // Mobile sticky CTA mode — mirrors the visible action panel.
  const stickyMode = (() => {
    if (!connected) {
      return { mode: 'connect' as const, label: 'Connect wallet to interact' };
    }
    if (isLaunched && meme.mint_address) {
      return {
        mode: 'live' as const,
        symbol: meme.symbol,
        tradeUrl: meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`,
      };
    }
    if (isFunded || isLaunching) {
      return {
        mode: 'funded' as const,
        isCreator,
        onLaunch: requestLaunch,
        launching: launching || isLaunching,
      };
    }
    if (isProving) {
      return {
        mode: 'backing' as const,
        amount,
        minBacking,
        onPledge: requestBack,
        disabled: !amount || Number(amount) <= 0 || slotsRemaining <= 0,
        pledging: backing,
        unit: (meme.quote_currency === 'usdc' ? 'USDC' : 'SOL') as 'SOL' | 'USDC',
      };
    }
    return { mode: 'connect' as const, label: 'Loading…' };
  })();

  // Build the action panel once so we mount it in one spot.
  const actionPanel = (
    <div id="meme-action-panel">
      {isLaunched ? (
        <MemeActionPanel variant="live" meme={meme} myBacking={myBacking} />
      ) : isFunded || isLaunching ? (
        <MemeActionPanel
          variant="funded"
          meme={meme}
          totalSlots={totalSlots}
          totalBackingSol={totalBackingSol}
          isCreator={isCreator}
          isLaunching={isLaunching}
          launching={launching}
          launchStatus={launchStatus}
          onLaunch={requestLaunch}
          onResetWindow={handleResetWindow}
          resetting={resetting}
          resetStatus={resetStatus}
          connected={connected}
        />
      ) : (
        <MemeActionPanel
          variant="backing"
          meme={meme}
          backerCount={backerCount}
          totalBackingSol={totalBackingSol}
          slotsRemaining={slotsRemaining}
          totalSlots={totalSlots}
          timeRemaining={timeRemaining}
          minBacking={minBacking}
          amount={amount}
          setAmount={setAmount}
          onPledge={requestBack}
          backing={backing}
          backingStatus={backingStatus}
          backingPaused={false}
          connected={connected}
          projectedSharePct={projectedSharePct}
          backerWallets={backings.map((b) => b.backer_wallet)}
          allowlistWallets={allowlistWallets}
        />
      )}
    </div>
  );

  // Conditional flags for which dashboard cards to render. Each panel
  // already self-hides when irrelevant; these are page-level gates so
  // we don't render an empty DashboardCard chrome around nothing.
  const hasBots = ((meme.bots?.length ?? 0) > 0) || !!meme.buyback_bot_enabled;
  const hasPendingBackings = isLaunched && backings.some((b) => b.status === 'confirmed');
  const showRewards = isLaunched && (isCreator || isBacker);

  return (
    <>
      <div className="max-w-6xl mx-auto space-y-3 pb-24 sm:pb-6">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--accent)] transition-colors text-xs font-mono uppercase tracking-widest"
        >
          <ArrowLeft className="w-3 h-3" />
          [&lt;] Back to Proving Grounds
        </Link>

        {/* Optional X-style banner — renders full-width above the slim
            identity strip when the creator uploaded one. Skipped when
            absent so the page looks identical to legacy memes. */}
        {meme.banner_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meme.banner_url}
            alt=""
            className="w-full block border border-[var(--border)]"
            style={{ aspectRatio: '3 / 1', objectFit: 'cover' }}
          />
        )}

        {/* Slim identity bar — the token headliner. */}
        <MemeIdentityBar
          meme={meme}
          backerCount={backerCount}
          totalBackingSol={totalBackingSol}
          totalSlots={totalSlots}
          timeRemaining={timeRemaining}
        />

        {/* Description block — only renders when the creator set one.
            Sits right under the identity strip so it reads as the
            token's tagline / one-liner before the dashboard panels. */}
        {meme.description && (
          <div className="border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-2">
              {'// DESCRIPTION'}
            </div>
            <p className="text-sm font-mono text-[var(--foreground)]/85 leading-relaxed whitespace-pre-wrap">
              {meme.description}
            </p>
          </div>
        )}

        {/* Creator track record — collapsible, sits right under the
            identity bar so the creator's wallet history is part of the
            token's first impression (not buried at the bottom). */}
        {meme.creator_wallet && (
          <CreatorPastLaunches
            wallet={meme.creator_wallet}
            variant="meme-page"
            excludeMemeId={meme.id}
          />
        )}

        {/* Primary action — full-width ONLY when there's actual work to
            do (backing form, launch button). For LIVE status the buy
            action lives inside the grid as a TRADE card instead. */}
        {!isLaunched && actionPanel}

        {/* DASHBOARD GRID — 3 cols on lg, 1 col on mobile.
            Left column spans 2 cols and carries the bigger / dynamic
            panels (bots, backers). Right column is the narrower
            reference rail (links, fees, trust, creator, rewards, etc.). */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          {/* LEFT — wide column. Backers above bots: the holder roster
              is the more universally interesting/dynamic readout; bots
              are programmable details that sit below as a secondary
              expandable panel. */}
          <div className="lg:col-span-2 space-y-3">
            <DashboardCard
              label={isLaunched ? 'GENESIS BACKERS' : 'BACKERS'}
              meta={`${backerCount}/${totalSlots}`}
            >
              {isLaunched ? (
                <GenesisBackerRoster memeId={meme.id} />
              ) : (
                <BackersList
                  backings={backings}
                  totalBacking={Number(meme.current_backing_sol)}
                  currentWallet={publicKey?.toBase58()}
                  canWithdraw={isProving}
                  onWithdraw={requestWithdraw}
                  withdrawing={withdrawing}
                  withdrawStatus={withdrawStatus}
                  unit={meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'}
                />
              )}
            </DashboardCard>

            {hasBots && (
              <DashboardCard
                label="BUYBACK BOTS"
                meta={meme.bots?.length ? `${meme.bots.length} ACTIVE` : '1 ACTIVE'}
                noBodyPadding
              >
                <div className="p-3 sm:p-4">
                  <BuybackBotPanel meme={meme} />
                </div>
              </DashboardCard>
            )}
          </div>

          {/* RIGHT — narrow reference rail */}
          <div className="space-y-3">
            {/* TRADE card (live-only) — square-ish primary buy CTA + contract
                + external link chips, all in one panel at the top of the rail. */}
            {isLaunched && meme.mint_address && (
              <DashboardCard label="TRADE" meta="LIVE">
                <div className="space-y-3">
                  {(() => {
                    // Platform-aware buy button. Tokens on non-pump.fun
                    // launchpads (Meteora, LaunchLab) route through Jupiter
                    // (universal AMM aggregator on Solana); Pump.fun tokens
                    // keep their pump.fun deep-link. Falls back to pump.fun
                    // for legacy rows where launch_platform is unset.
                    const platform = meme.launch_platform;
                    const useJupiter = platform === 'meteora' || platform === 'launchlab';
                    const buyHref = useJupiter
                      ? `https://jup.ag/swap/SOL-${meme.mint_address}`
                      : (meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`);
                    const buyLabel = platform === 'meteora'
                      ? '▶ BUY ON METEORA'
                      : platform === 'launchlab'
                        ? '▶ BUY ON LAUNCHLAB'
                        : '▶ BUY ON PUMP.FUN';
                    return (
                      <a
                        href={buyHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full text-center py-3 bg-[var(--success)] hover:opacity-90 text-[#0a0a0a] font-mono font-bold uppercase tracking-widest text-xs transition-opacity"
                      >
                        {buyLabel}
                      </a>
                    );
                  })()}
                  <div>
                    <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
                      Contract
                    </div>
                    <div className="text-[10px] font-mono break-all text-[var(--foreground)]">
                      {meme.mint_address}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[var(--border)]">
                    <ExternalChip href={`https://dexscreener.com/solana/${meme.mint_address}`}>Dexscreener</ExternalChip>
                    <ExternalChip href={`https://solscan.io/account/${meme.mint_address}`}>Solscan</ExternalChip>
                    <ExternalChip href={`https://jup.ag/swap/SOL-${meme.mint_address}`}>Jupiter</ExternalChip>
                  </div>
                </div>
              </DashboardCard>
            )}

            {/* Lounge — small card in the grid, not full-width above. Auto-hides until a drop exists. */}
            <BackerLoungePanel meme={meme} isCreator={isCreator} />

            {showRewards && (
              <DashboardCard label="YOUR REWARDS">
                <ClaimRewards memeId={meme.id} isCreator={isCreator} isBacker={isBacker} />
              </DashboardCard>
            )}

            {isCreator && (
              <DashboardCard label="CREATOR CONTROLS">
                <div className="space-y-3">
                  {hasPendingBackings && (
                    <div className="border border-[var(--warning)]/60 bg-[var(--background)] p-3 space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
                        {'// DISTRIBUTION_PENDING'}
                      </div>
                      <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
                        Some backers are still pending. Auto-distribution retries every tick — nudge it manually here.
                      </p>
                      <button onClick={handleDistribute} disabled={distributing} className="btn-primary w-full text-xs py-2">
                        {distributing ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-3 h-3 animate-spin" /> Distributing…
                          </span>
                        ) : (
                          '[▶] Retry Pending Distribution'
                        )}
                      </button>
                      {distributeStatus && (
                        <div className="p-2 text-[10px] font-mono text-center uppercase tracking-widest border border-[var(--accent)] text-[var(--accent)]">
                          &gt; {distributeStatus}
                        </div>
                      )}
                    </div>
                  )}
                  <LaunchVisibilityPanel
                    memeId={meme.id}
                    creatorWallet={meme.creator_wallet}
                    canEdit={meme.status === 'backing'}
                    maxBackingSol={meme.max_backing_sol ?? null}
                    reservedSlots={meme.reserved_slots ?? 0}
                  />
                  {meme.status === 'backing' && (
                    <EditMetadataPanel meme={meme} onSaved={refetchMeme} />
                  )}
                  <BackerVaultManager meme={meme} isCreator={true} />
                </div>
              </DashboardCard>
            )}

            {/* Chat lives in the rail too — replaces the old ABOUT card
                so the dashboard fits more on screen. Long feeds scroll
                within the card. */}
            <DashboardCard label="CHAT">
              <MemeChat memeId={meme.id} />
            </DashboardCard>
          </div>
        </div>

      </div>

      {/* Mobile sticky CTA — hides when the inline action panel is on screen */}
      <MobileStickyCTA mode={stickyMode} hideWhenVisibleId="meme-action-panel" />

      {/* Confirmation dialogs */}
      <ConfirmDialog
        isOpen={showBackConfirm}
        onClose={() => setShowBackConfirm(false)}
        onConfirm={confirmBack}
        title="Confirm Backing"
        message={`You are backing ${meme.name} with ${amount} ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'}.\n\nYour ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'} goes into this token's shared pool. When all slots fill, the pool makes ONE atomic launch buy on ${meme.launch_platform === 'meteora' ? 'Meteora' : meme.launch_platform === 'launchlab' ? 'LaunchLab' : 'Pump.fun'} — every backer gets in at the exact same price, with no dev allocation and no sniper gap.\n\nAfter launch, your proportional share of supply is sent straight to this wallet.\n\nChanged your mind? You can withdraw while slots are still filling (2% fee). Once the pool is full it's committed and waits for the creator to launch on their schedule.`}
        confirmText={`Back with ${amount} ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'}`}
        variant="info"
        isLoading={backing}
      />

      <ConfirmDialog
        isOpen={showWithdrawConfirm}
        onClose={() => {
          setShowWithdrawConfirm(false);
          setPendingWithdrawWallet(null);
          setPendingWithdrawAmount(0);
        }}
        onConfirm={confirmWithdraw}
        title="Confirm Withdrawal"
        message={`Withdraw ${pendingWithdrawAmount.toFixed(4)} ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'} from this token?\n\nWithdrawal fee: ${(pendingWithdrawAmount * 0.02).toFixed(4)} ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'} (2%)\n\nYou will receive: ${(pendingWithdrawAmount * 0.98).toFixed(4)} ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'}`}
        confirmText={`Withdraw ${(pendingWithdrawAmount * 0.98).toFixed(4)} ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'}`}
        variant="warning"
        isLoading={withdrawing}
      />

      <ConfirmDialog
        isOpen={showLaunchConfirm}
        onClose={() => setShowLaunchConfirm(false)}
        onConfirm={confirmLaunch}
        title="Launch Token"
        message={`You are about to deploy ${meme.name} ($${meme.symbol}) to ${meme.launch_platform === 'meteora' ? 'Meteora' : meme.launch_platform === 'launchlab' ? 'LaunchLab' : 'Pump.fun'} with ${totalBackingSol.toFixed(2)} ${meme.quote_currency === 'usdc' ? 'USDC' : 'SOL'} of community backing. This action cannot be undone. Tokens will be distributed to all backers proportionally.`}
        confirmText="Launch Now"
        variant="info"
        isLoading={launching}
      />
    </>
  );
}

// Tiny external-link pill used in the LINKS dashboard card.
function ExternalChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[10px] font-mono uppercase tracking-widest transition-colors"
    >
      {children} <ExternalLink className="w-2.5 h-2.5" />
    </a>
  );
}

