'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

import { MemeHero } from '@/components/meme/MemeHero';
import { MemeActionPanel } from '@/components/meme/MemeActionPanel';
import { MemeTabs } from '@/components/meme/MemeTabs';
import { MobileStickyCTA } from '@/components/meme/MobileStickyCTA';
import { CreatorPastLaunches } from '@/components/CreatorPastLaunches';
import { ClaimRewards } from '@/components/ClaimRewards';
import { LaunchVisibilityPanel } from '@/components/meme/LaunchVisibilityPanel';
import { FeeDistributionBadge } from '@/components/meme/FeeDistributionBadge';
import { BuybackBotPanel } from '@/components/meme/BuybackBotPanel';
import { BackerLoungePanel } from '@/components/meme/BackerLoungePanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useRealtimeMeme, useRealtimeBackings } from '@/hooks/useRealtimeMemes';

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

  // ── Backing ──────────────────────────────────────────────────────
  const submitBacking = async () => {
    if (!connected || !publicKey || !signTransaction || !amount || !meme) return;

    const amountSol = parseFloat(amount);
    if (isNaN(amountSol) || amountSol <= 0) {
      setBackingStatus('Error: Invalid amount');
      return;
    }

    const minBacking = Number(meme.min_backing_sol) || 0.1;
    if (amountSol < minBacking) {
      setBackingStatus(`Error: Minimum backing is ${minBacking} SOL.`);
      return;
    }

    const myExisting = backings.find(
      (b) => b.backer_wallet === publicKey.toBase58() && b.status !== 'withdrawn',
    );
    if (myExisting) {
      setBackingStatus(
        `Error: You already have an active backing of ${Number(myExisting.amount_sol).toFixed(2)} SOL. Withdraw first to change your amount.`,
      );
      return;
    }

    const totalSlots = Number(meme.total_slots) || 8;
    if (backings.length >= totalSlots) {
      setBackingStatus('Error: All backer slots are filled.');
      return;
    }

    // Balance pre-check — saves the user a failed signature prompt.
    const totalNeeded = amountSol + 0.005;
    try {
      const balance = await connection.getBalance(publicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;
      if (balanceSol < totalNeeded) {
        setBackingStatus(
          `Error: Insufficient balance. You have ${balanceSol.toFixed(4)} SOL but need ~${totalNeeded.toFixed(4)} SOL.`,
        );
        return;
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

      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(poolWallet),
          lamports,
        }),
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      setBackingStatus(`Approve ${amountSol} SOL to the pool...`);
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

  const requestBack = () => {
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
    const myExisting = backings.find(
      (b) => b.backer_wallet === publicKey?.toBase58() && b.status !== 'withdrawn',
    );
    if (myExisting) {
      setBackingStatus(
        `Error: You already have an active backing of ${Number(myExisting.amount_sol).toFixed(2)} SOL. Withdraw first to change your amount.`,
      );
      return;
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

      setWithdrawStatus(`Successfully withdrew ${data.amount_refunded} SOL!`);
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
      };
    }
    return { mode: 'connect' as const, label: 'Loading…' };
  })();

  return (
    <>
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-5 pb-24 sm:pb-6">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--accent)] transition-colors text-xs font-mono uppercase tracking-widest"
        >
          <ArrowLeft className="w-3 h-3" />
          [&lt;] Back to Proving Grounds
        </Link>

        {/* Hero */}
        <MemeHero meme={meme} />

        {/* Primary action — different shape for each status */}
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
            />
          )}
        </div>

        {/* Fee distribution split — visible to everyone viewing the
            token. Renders only when meme.fee_preset is set (Phase 2+
            memes). Legacy memes with NULL config render nothing here. */}
        <FeeDistributionBadge meme={meme} />

        {/* Buyback bot status — visible to everyone for transparency.
            Renders only when meme.buyback_bot_enabled. Shows action,
            bot wallet, totals, recent runs (all on-chain auditable). */}
        <BuybackBotPanel meme={meme} />

        {/* Phase 4 — Keycard backer lounge. Renders only after the
            keycard/sync cron has created a gate for this meme. */}
        <BackerLoungePanel meme={meme} />

        {/* Creator-only: launch visibility + allowlist controls.
            Shows during the backing phase (when visibility is mutable);
            disabled UI when meme is past backing. Hidden entirely for
            non-creators — they don't see this panel at all. */}
        {isCreator && (
          <LaunchVisibilityPanel
            memeId={meme.id}
            currentVisibility={(meme.visibility ?? 'open') as 'open' | 'stealth' | 'spectator'}
            creatorWallet={meme.creator_wallet}
            canEdit={meme.status === 'backing'}
            maxBackingSol={meme.max_backing_sol ?? null}
          />
        )}

        {/* Rewards (post-launch, only if user is creator or distributed-backer) */}
        {isLaunched && (isCreator || isBacker) && (
          <ClaimRewards memeId={meme.id} isCreator={isCreator} isBacker={isBacker} />
        )}

        {/* Manual distribution retry — only surfaces if cron stragglers exist
            AND the user is the creator. Auto-distribution is the default;
            this is a rare fallback path. */}
        {isLaunched && isCreator && !launching && !distributing && backings.some((b) => b.status === 'confirmed') && (
          <div className="border border-[var(--warning)] bg-[var(--card)] p-4 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
              {'// DISTRIBUTION_PENDING'}
            </div>
            <p className="text-[11px] font-mono text-[var(--muted)]">
              Some backers are still pending. Auto-distribution will retry; you can also nudge it manually.
            </p>
            <button onClick={handleDistribute} disabled={distributing} className="btn-primary w-full">
              {distributing ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Distributing…
                </span>
              ) : (
                '[▶] Retry Pending Distribution'
              )}
            </button>
            {distributeStatus && (
              <div className="p-2.5 text-[11px] font-mono text-center uppercase tracking-widest border border-[var(--accent)] text-[var(--accent)]">
                &gt; {distributeStatus}
              </div>
            )}
          </div>
        )}

        {/* Creator track record — inline collapsible, the trust signal */}
        {meme.creator_wallet && (
          <CreatorPastLaunches
            wallet={meme.creator_wallet}
            variant="meme-page"
            excludeMemeId={meme.id}
          />
        )}

        {/* Tabs: everything else collapses into focused panels */}
        <MemeTabs
          meme={meme}
          backings={backings}
          backerCount={backerCount}
          isLaunched={isLaunched}
          isProving={isProving}
          publicKeyB58={publicKey?.toBase58()}
          canWithdraw={isProving}
          onWithdraw={requestWithdraw}
          withdrawing={withdrawing}
          withdrawStatus={withdrawStatus}
        />
      </div>

      {/* Mobile sticky CTA — hides when the inline action panel is on screen */}
      <MobileStickyCTA mode={stickyMode} hideWhenVisibleId="meme-action-panel" />

      {/* Confirmation dialogs */}
      <ConfirmDialog
        isOpen={showBackConfirm}
        onClose={() => setShowBackConfirm(false)}
        onConfirm={confirmBack}
        title="Confirm Backing"
        message={`You are backing ${meme.name} with ${amount} SOL.\n\nYour SOL goes into this token's shared pool. When all slots fill, the pool makes ONE atomic launch buy on pump.fun — every backer gets in at the exact same price, with no dev allocation and no sniper gap.\n\nAfter launch, your proportional share of supply is sent straight to this wallet.\n\nChanged your mind? You can withdraw while slots are still filling (2% fee). Once the pool is full it's committed and waits for the creator to launch on their schedule.`}
        confirmText={`Back with ${amount} SOL`}
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
        message={`Withdraw ${pendingWithdrawAmount.toFixed(4)} SOL from this token?\n\nWithdrawal fee: ${(pendingWithdrawAmount * 0.02).toFixed(4)} SOL (2%)\n\nYou will receive: ${(pendingWithdrawAmount * 0.98).toFixed(4)} SOL`}
        confirmText={`Withdraw ${(pendingWithdrawAmount * 0.98).toFixed(4)} SOL`}
        variant="warning"
        isLoading={withdrawing}
      />

      <ConfirmDialog
        isOpen={showLaunchConfirm}
        onClose={() => setShowLaunchConfirm(false)}
        onConfirm={confirmLaunch}
        title="Launch Token"
        message={`You are about to deploy ${meme.name} ($${meme.symbol}) to pump.fun with ${totalBackingSol.toFixed(2)} SOL of community backing. This action cannot be undone. Tokens will be distributed to all backers proportionally.`}
        confirmText="Launch Now"
        variant="info"
        isLoading={launching}
      />
    </>
  );
}
