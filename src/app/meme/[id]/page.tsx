'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  ArrowLeft,
  Users,
  Target,
  Clock,
  ArrowUpRight,
  Copy,
  Check,
  Loader2,
  Info,
  Coins,
  Key,
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import Link from 'next/link';
import { MemeChat } from '@/components/MemeChat';
import { BackersList } from '@/components/BackersList';
import { GenesisBackerRoster } from '@/components/GenesisBackerRoster';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ClaimRewards } from '@/components/ClaimRewards';
import { useRealtimeMeme, useRealtimeBackings } from '@/hooks/useRealtimeMemes';

// Calculate time remaining from deadline
function getTimeRemaining(deadline: string): string {
  const now = new Date();
  const end = new Date(deadline);
  const diff = end.getTime() - now.getTime();

  if (diff <= 0) return 'Ended';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Pump.fun tokens are Token-2022 with 6 decimals (verified on-chain).
// On-chain / DB amounts are raw base units; humans want whole tokens
// (e.g. 3,671,647,218,713 raw -> "3,671,647 tokens").
const PUMP_TOKEN_DECIMALS = 6;
function formatTokenAmount(raw: string | number | null | undefined): string {
  const n = Number(raw || 0) / 10 ** PUMP_TOKEN_DECIMALS;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Map status to display style
function getStatusConfig(status: string) {
  const configs: Record<string, { label: string; class: string }> = {
    pending: { label: 'Pending', class: 'badge-pending' },
    backing: { label: 'Proving', class: 'badge-proving' },
    funded: { label: 'Funded', class: 'badge-funded' },
    launching: { label: 'Launching...', class: 'badge-launching' },
    live: { label: 'Live', class: 'badge-launched' },
    failed: { label: 'Failed', class: 'badge-failed' },
  };
  return configs[status] || { label: status, class: 'badge-pending' };
}

export default function MemeDetailPage() {
  const { id } = useParams();
  const { connected, publicKey, signTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const [amount, setAmount] = useState('');
  const [tradeType, setTradeType] = useState<'back' | 'buy' | 'sell'>('back');
  const [copied, setCopied] = useState(false);
  const [backing, setBacking] = useState(false);
  const [backingStatus, setBackingStatus] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [distributeStatus, setDistributeStatus] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawStatus, setWithdrawStatus] = useState<string | null>(null);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [showLaunchConfirm, setShowLaunchConfirm] = useState(false);
  const [pendingWithdrawWallet, setPendingWithdrawWallet] = useState<string | null>(null);
  const [pendingWithdrawAmount, setPendingWithdrawAmount] = useState<number>(0);
  const [showDetails, setShowDetails] = useState(false);

  // Use real-time hooks for meme and backings
  const { meme, loading, error, refetch: refetchMeme } = useRealtimeMeme(id as string);
  const { backings, refetch: refetchBackings } = useRealtimeBackings(id as string);

  // Set trade type based on meme status
  useEffect(() => {
    if (meme?.status === 'live') {
      setTradeType('buy'); // Default to buy for live tokens
    } else {
      setTradeType('back'); // Default to back for proving tokens
    }
  }, [meme?.status]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBack = async () => {
    if (!connected || !publicKey || !signMessage || !amount || !meme) return;

    const amountSol = parseFloat(amount);
    if (isNaN(amountSol) || amountSol <= 0) {
      setBackingStatus('Error: Invalid amount');
      return;
    }

    // Check if user already has an active backing
    const myExistingBacking = backings.find(
      (b) => b.backer_wallet === publicKey.toBase58() && b.status !== 'withdrawn'
    );
    if (myExistingBacking) {
      setBackingStatus(
        `Error: You already have an active backing of ${Number(myExistingBacking.amount_sol).toFixed(2)} SOL. Withdraw first to change your amount.`
      );
      return;
    }

    // Validate minimum backing amount
    if (amountSol < minBacking) {
      setBackingStatus(
        `Error: Minimum backing is ${minBacking} SOL.`
      );
      return;
    }

    // Check if slots available
    if (slotsRemaining <= 0) {
      setBackingStatus('Error: All backer slots are filled.');
      return;
    }

    // Check wallet balance before attempting transaction
    const totalNeeded = amountSol + 0.005; // backing to pool + tx fee buffer
    try {
      const balance = await connection.getBalance(publicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;
      if (balanceSol < totalNeeded) {
        setBackingStatus(
          `Error: Insufficient balance. You have ${balanceSol.toFixed(4)} SOL but need ~${totalNeeded.toFixed(4)} SOL (${amountSol} backing + tx costs).`
        );
        return;
      }
    } catch {
      // If balance check fails, proceed and let the transaction handle it
    }

    setBacking(true);
    setBackingStatus('Preparing backing...');

    try {
      // Pooled model: the backer simply sends their backing SOL to this
      // meme's pool wallet. No burner, no client keypair. At launch the
      // pool does ONE atomic createV2+buy; tokens are then distributed
      // proportionally to backers (claimed to their main wallet).
      const poolWallet: string | undefined = (meme as { pool_wallet?: string }).pool_wallet;
      if (!poolWallet) {
        throw new Error('This meme has no pool wallet yet — please refresh and try again.');
      }

      const backingLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      const transaction = new Transaction();
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(poolWallet),
          lamports: backingLamports,
        })
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      setBackingStatus(`Approve ${amountSol} SOL to the pool...`);
      const signed = await signTransaction!(transaction);
      const txSignature = await connection.sendRawTransaction(signed.serialize());

      setBackingStatus('Processing transaction...');
      await connection.confirmTransaction({
        signature: txSignature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      setBackingStatus('Registering backing...');
      const response = await fetch('/api/backings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: publicKey.toBase58(),
          amount_sol: amountSol,
          deposit_tx: txSignature,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to register backing');
      }

      setBackingStatus('Backing successful!');
      setAmount('');

      // Refresh meme data and backings to show updates
      await Promise.all([refetchMeme(), refetchBackings()]);

    } catch (err) {
      console.error('Backing failed:', err);
      setBackingStatus(`Error: ${err instanceof Error ? err.message : 'Transaction failed'}`);
    } finally {
      setBacking(false);
    }
  };

  const handleTrade = () => {
    // Only allow backing for tokens in 'backing' status
    if (tradeType === 'back' && meme?.status === 'backing') {
      // Validate amount before showing confirmation
      const amountSol = parseFloat(amount);
      if (isNaN(amountSol) || amountSol <= 0) {
        setBackingStatus('Error: Please enter a valid amount');
        return;
      }

      // Pre-check before showing dialog
      if (meme) {
        // Check if user already has an active backing
        const myExistingBacking = backings.find(
          (b) => b.backer_wallet === publicKey?.toBase58() && b.status !== 'withdrawn'
        );
        if (myExistingBacking) {
          setBackingStatus(
            `Error: You already have an active backing of ${Number(myExistingBacking.amount_sol).toFixed(2)} SOL. Withdraw first to change your amount.`
          );
          return;
        }

        // Validate minimum backing
        const minBackingAmount = Number(meme.min_backing_sol) || 0.1;
        if (amountSol < minBackingAmount) {
          setBackingStatus(
            `Error: Minimum backing is ${minBackingAmount} SOL.`
          );
          return;
        }
      }

      // Show confirmation dialog before backing
      setBackingStatus(null); // Clear any previous errors
      setShowBackConfirm(true);
    } else if (meme?.status === 'live') {
      // Buy/sell for launched tokens - direct users to trade on pump.fun
      const pumpUrl = meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`;
      window.open(pumpUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const confirmBack = () => {
    setShowBackConfirm(false);
    handleBack();
  };

  const requestWithdraw = (backerWallet: string) => {
    // Find the backing amount for this wallet
    const backing = backings.find(b => b.backer_wallet === backerWallet);
    const amount = backing ? Number(backing.amount_sol) : 0;
    setPendingWithdrawAmount(amount);
    setPendingWithdrawWallet(backerWallet);
    setShowWithdrawConfirm(true);
  };

  const confirmWithdraw = () => {
    setShowWithdrawConfirm(false);
    if (pendingWithdrawWallet) {
      handleWithdraw(pendingWithdrawWallet);
      setPendingWithdrawWallet(null);
      setPendingWithdrawAmount(0);
    }
  };

  const requestLaunch = () => {
    setShowLaunchConfirm(true);
  };

  const confirmLaunch = async () => {
    setShowLaunchConfirm(false);
    if (!meme || launching) return;

    setLaunching(true);
    setLaunchStatus('Sign to authorize launch...');

    try {
      // Sign a message to prove wallet ownership
      const authMessage = `launch:${meme.id}:${publicKey!.toBase58()}:${Date.now()}`;
      const msgBytes = new TextEncoder().encode(authMessage);
      const sigBytes = await signMessage!(msgBytes);
      const sigB58 = bs58.encode(sigBytes);

      setLaunchStatus('Initiating launch...');
      const response = await fetch('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          caller_wallet: publicKey?.toBase58(),
          signature: sigB58,
          message: authMessage,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Launch failed');
      }

      // Auto-distribute ran inside /api/launch — reflect its real result
      // and refetch BOTH meme and backings so the post-launch UI is
      // accurate (backings flip confirmed -> distributed). Without the
      // backings refetch the stale 'confirmed' rows make the pending-
      // distribution warning flash even though tokens already went out.
      const dist = data.distribution as { distributed: number; remaining: number } | undefined;
      if (dist && dist.remaining === 0) {
        setLaunchStatus(`Launched! Tokens distributed to all ${dist.distributed} backers.`);
      } else if (dist && dist.remaining > 0) {
        setLaunchStatus(`Launched! ${dist.distributed} distributed, ${dist.remaining} auto-retrying…`);
      } else {
        setLaunchStatus('Token launched successfully!');
      }

      await Promise.all([refetchMeme(), refetchBackings()]);

      // Clear status after a moment
      setTimeout(() => setLaunchStatus(null), 5000);
    } catch (err) {
      console.error('Launch failed:', err);
      setLaunchStatus(`Error: ${err instanceof Error ? err.message : 'Launch failed'}`);
    } finally {
      setLaunching(false);
    }
  };

  const handleDistribute = async () => {
    if (!meme || !publicKey || !signMessage || distributing) return;
    setDistributing(true);
    setDistributeStatus('Sign to authorize distribution...');
    try {
      const authMessage = `claim:${meme.id}:${publicKey.toBase58()}:${Date.now()}`;
      const sigBytes = await signMessage(new TextEncoder().encode(authMessage));
      const sigB58 = bs58.encode(sigBytes);

      setDistributeStatus('Distributing tokens to backers...');
      const response = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          caller_wallet: publicKey.toBase58(),
          signature: sigB58,
          message: authMessage,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Distribution failed');

      setDistributeStatus(
        data.remaining > 0
          ? `Distributed ${data.distributed}, ${data.remaining} failed — retry to finish`
          : `All ${data.distributed} backers received their tokens!`
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

  const handleWithdraw = async (backerWallet: string) => {
    if (!meme || withdrawing) return;

    setWithdrawing(true);
    setWithdrawStatus('Sign to authorize withdrawal...');

    try {
      // Sign a message to prove wallet ownership
      const authMessage = `withdraw:${meme.id}:${backerWallet}:${Date.now()}`;
      const msgBytes = new TextEncoder().encode(authMessage);
      const sigBytes = await signMessage!(msgBytes);
      const sigB58 = bs58.encode(sigBytes);

      setWithdrawStatus('Processing withdrawal...');
      const response = await fetch('/api/backings/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: backerWallet,
          signature: sigB58,
          message: authMessage,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Withdrawal failed');
      }

      setWithdrawStatus(`Successfully withdrew ${data.amount_refunded} SOL!`);

      // Refresh data to show updates
      await Promise.all([refetchMeme(), refetchBackings()]);

      // Clear status after a moment
      setTimeout(() => setWithdrawStatus(null), 5000);
    } catch (err) {
      console.error('Withdrawal failed:', err);
      setWithdrawStatus(`Error: ${err instanceof Error ? err.message : 'Withdrawal failed'}`);
    } finally {
      setWithdrawing(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  // Error state
  if (error || !meme) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Proving Grounds
        </Link>
        <div className="card p-8 text-center">
          <h2 className="text-xl font-semibold mb-2">Meme Not Found</h2>
          <p className="text-[var(--muted)]">{error || 'This meme does not exist.'}</p>
        </div>
      </div>
    );
  }

  const {
    name,
    symbol,
    description,
    status,
    backing_goal_sol,
    current_backing_sol,
    backing_deadline,
    creator_wallet,
    image_url,
    backer_count = 0,
    // Slot-based backing system
    total_slots = 8,
    min_backing_sol = 0.1,
    // Trust score params (with defaults for backwards compatibility)
    creator_fee_pct = 2,
    backer_share_pct = 70,
    dev_initial_buy_sol = 0,
    // Socials
    creator_twitter,
    twitter,
    telegram,
    discord,
    website,
  } = meme;

  const totalSlots = Number(total_slots) || 8;
  const minBacking = Number(min_backing_sol) || 0.1;
  const filledSlots = backer_count;
  const slotsRemaining = totalSlots - filledSlots;
  const progress = (filledSlots / totalSlots) * 100;
  const timeRemaining = getTimeRemaining(backing_deadline);
  const { label: statusLabel, class: statusClass } = getStatusConfig(status);

  const isProving = status === 'backing';
  const isFunded = status === 'funded';
  const isLaunching = status === 'launching';
  const isLaunched = status === 'live';
  const isCreator = connected && publicKey?.toBase58() === creator_wallet;
  const isBacker = connected && backings.some(
    (b) => b.backer_wallet === publicKey?.toBase58() && b.status === 'distributed'
  );

  // Calculate projected token percentage for current backer
  const totalBackingSol = Number(current_backing_sol) || 0;
  const getProjectedPercent = (amountSol: number) => {
    if (totalBackingSol + amountSol <= 0) return 0;
    return (amountSol / (totalBackingSol + amountSol)) * 100;
  };

  // Backing is currently paused for maintenance
  const backingPaused = false;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link href="/" className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--accent)] transition-colors text-xs font-mono uppercase tracking-widest">
        <ArrowLeft className="w-3 h-3" />
        [&lt;] Back to Proving Grounds
      </Link>

      {/* Header — terminal block */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // MEME.DETAIL // {symbol}
          </span>
          <span className={statusClass}>{statusLabel}</span>
        </div>

        <div className="p-4 sm:p-6 flex flex-col sm:flex-row items-start gap-4 sm:gap-6">
          {image_url ? (
            <img
              src={image_url}
              alt={name}
              className="w-20 h-20 sm:w-24 sm:h-24 object-cover border border-[var(--border)] flex-shrink-0"
            />
          ) : (
            <div className="w-20 h-20 sm:w-24 sm:h-24 border border-[var(--accent)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
              <span className="font-mono font-semibold text-[var(--accent)] text-2xl sm:text-3xl">
                {symbol.charAt(0)}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0 w-full">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
              &gt; TOKEN
            </div>
            <h1 className="text-2xl sm:text-3xl font-mono font-semibold uppercase tracking-tight break-words">
              {name}
            </h1>
            <div className="text-base font-mono text-[var(--accent)] mt-1">${symbol}</div>
            <p className="text-xs sm:text-sm font-mono text-[var(--muted)] leading-relaxed mt-3">{description}</p>

            {/* Social Links */}
            {(twitter || telegram || discord || website) && (
              <div className="flex flex-wrap gap-2 mt-3">
                {twitter && (
                  <a
                    href={twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--background)] hover:border-[var(--accent)] hover:text-[var(--accent)] border border-[var(--border)] text-[10px] font-mono uppercase tracking-widest transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                    Twitter
                  </a>
                )}
                {telegram && (
                  <a
                    href={telegram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--background)] hover:border-[var(--accent)] hover:text-[var(--accent)] border border-[var(--border)] text-[10px] font-mono uppercase tracking-widest transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                    </svg>
                    Telegram
                  </a>
                )}
                {discord && (
                  <a
                    href={discord}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--background)] hover:border-[var(--accent)] hover:text-[var(--accent)] border border-[var(--border)] text-[10px] font-mono uppercase tracking-widest transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
                    </svg>
                    Discord
                  </a>
                )}
                {website && (
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--background)] hover:border-[var(--accent)] hover:text-[var(--accent)] border border-[var(--border)] text-[10px] font-mono uppercase tracking-widest transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="2" y1="12" x2="22" y2="12"/>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                    Website
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Creator + meta strip */}
        <div className="border-t border-[var(--border)] px-6 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Creator:</span>
          <code className="bg-[var(--background)] border border-[var(--border)] px-2 py-1 text-[10px] font-mono">
            {creator_wallet.slice(0, 8)}…{creator_wallet.slice(-8)}
          </code>
          <button
            onClick={() => handleCopy(creator_wallet)}
            className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
            aria-label="Copy creator address"
          >
            {copied ? <Check className="w-3 h-3 text-[var(--success)]" /> : <Copy className="w-3 h-3" />}
          </button>
          {creator_twitter && (
            <a
              href={creator_twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[10px] font-mono uppercase tracking-widest transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              @{creator_twitter.split('/').pop()}
            </a>
          )}
        </div>

        {/* Contract Address — shown for live tokens */}
        {isLaunched && meme.mint_address && (
          <div className="border-t border-[var(--border)]">
            <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                // CONTRACT_ADDRESS
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                Trade on any DEX
              </span>
            </div>
            <button
              onClick={() => handleCopy(meme.mint_address!)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors group"
            >
              <code className="flex-1 text-xs font-mono text-left break-all">{meme.mint_address}</code>
              {copied ? (
                <Check className="w-4 h-4 text-[var(--success)] flex-shrink-0" />
              ) : (
                <Copy className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--accent)] flex-shrink-0" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Verify on-chain — the pool wallet is the whole trust story:
          backers fund it, it makes ONE launch buy, it distributes out.
          Shown during backing too, so funds can be verified BEFORE
          committing. Don't trust — verify. */}
      {(() => {
        const poolWallet = (meme as { pool_wallet?: string }).pool_wallet;
        if (!poolWallet) return null;
        return (
          <div className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                // VERIFY_ON_CHAIN
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                Don&apos;t trust — verify
              </span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              <div className="px-4 py-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5">
                  Pool wallet · backers fund here → one launch buy → distributed out
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono break-all">{poolWallet}</code>
                  <button
                    onClick={() => handleCopy(poolWallet)}
                    className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors flex-shrink-0"
                    aria-label="Copy pool wallet"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={`https://solscan.io/account/${poolWallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[10px] font-mono uppercase tracking-widest transition-colors flex-shrink-0"
                  >
                    Solscan <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
              {isLaunched && meme.mint_address && (
                <div className="px-4 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1.5">
                    Contract · open Holders — spread across backers, no dev bag
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono break-all">{meme.mint_address}</code>
                    <a
                      href={`https://solscan.io/account/${meme.mint_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[10px] font-mono uppercase tracking-widest transition-colors flex-shrink-0"
                    >
                      Solscan <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Distribution is automatic at launch (and a reconcile cron is the
          backstop). This manual control only appears as a fallback when
          some backers are still pending — never the primary path. */}
      {isLaunched && isCreator && !launching && !distributing && backings.some((b) => b.status === 'confirmed') && (
        <div className="border border-[var(--warning)] bg-[var(--card)]">
          <div className="border-b border-[var(--warning)] px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
              // DISTRIBUTION_PENDING
            </span>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
              Tokens distribute automatically at launch and a background job
              retries any stragglers — you normally don&apos;t touch this. Some
              backers are still pending; you can nudge it manually here.
            </p>
            <button
              onClick={handleDistribute}
              disabled={distributing}
              className="btn-primary w-full"
            >
              {distributing ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Distributing…
                </span>
              ) : (
                '[▶] Retry Pending Distribution'
              )}
            </button>
            {distributeStatus && (
              <div className={`p-3 text-xs font-mono uppercase tracking-widest text-center border ${
                distributeStatus.includes('Error') || distributeStatus.includes('failed')
                  ? 'text-[var(--error)] border-[var(--error)]'
                  : distributeStatus.includes('received')
                  ? 'text-[var(--success)] border-[var(--success)]'
                  : 'text-[var(--accent)] border-[var(--accent)]'
              }`}>
                &gt; {distributeStatus}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Launch Section — terminal alert */}
      {(isFunded || isLaunching) && (
        <div className="border border-[var(--success)] bg-[var(--card)]">
          <div className="border-b border-[var(--success)] px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
              // STATE: GOAL_REACHED
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)] pulse-glow">
              [!] READY
            </span>
          </div>

          <div className="p-6 space-y-4">
            <h2 className="text-xl font-mono font-semibold uppercase tracking-tight">
              {isLaunching ? '> Launching…' : '> Ready to Launch'}
            </h2>
            <div className="border border-[var(--success)] bg-[var(--background)] p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)] mb-2">
                ALL {totalSlots} SLOTS FILLED · {Number(current_backing_sol).toFixed(2)} SOL RAISED
              </div>
              <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
                All backer slots are filled. The token is ready to launch on pump.fun.
              </p>
            </div>
            {isCreator ? (
              <button
                onClick={requestLaunch}
                disabled={launching || isLaunching}
                className="btn-primary w-full"
              >
                {launching || isLaunching ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deploying…
                  </span>
                ) : (
                  '[▶] Launch Token'
                )}
              </button>
            ) : (
              <div className="text-center py-3 text-[10px] font-mono text-[var(--muted)] border border-[var(--border)] uppercase tracking-widest">
                {connected ? '> Waiting for creator to launch…' : '> Connect wallet to view'}
            </div>
          )}
            {launchStatus && (
              <div className={`p-3 text-xs font-mono uppercase tracking-widest text-center border ${
                launchStatus.includes('Error')
                  ? 'text-[var(--error)] border-[var(--error)]'
                  : launchStatus.includes('successfully')
                  ? 'text-[var(--success)] border-[var(--success)]'
                  : 'text-[var(--accent)] border-[var(--accent)]'
              }`}>
                &gt; {launchStatus}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backing / Trade Panel — terminal block */}
      <div className="border border-[var(--accent)] bg-[var(--card)]">
        {isProving && (
          <div className="bg-[var(--accent)] w-full py-2 text-center text-[#0a0a0a] text-[11px] font-mono font-semibold uppercase tracking-widest">
            [▶] Back This Token
          </div>
        )}

        <div className="p-6">
          {isProving && (
            <>
              {/* Metric strip — mobile-friendly */}
              <div className="border border-[var(--border)] bg-[var(--background)] grid grid-cols-3 divide-x divide-[var(--border)] mb-4 sm:mb-5">
                <div className="px-2 sm:px-3 py-2.5 sm:py-3">
                  <div className="text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Slots Open</div>
                  <div className="text-lg sm:text-xl font-mono font-semibold text-[var(--accent)] mt-0.5 sm:mt-1">{slotsRemaining}</div>
                </div>
                <div className="px-2 sm:px-3 py-2.5 sm:py-3">
                  <div className="text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Raised</div>
                  <div className="text-lg sm:text-xl font-mono font-semibold text-[var(--accent)] mt-0.5 sm:mt-1">
                    {Number(current_backing_sol).toFixed(2)}<span className="text-xs sm:text-sm text-[var(--muted)] ml-1">SOL</span>
                  </div>
                </div>
                <div className="px-2 sm:px-3 py-2.5 sm:py-3">
                  <div className="text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">Time Left</div>
                  <div className="text-lg sm:text-xl font-mono font-semibold text-[var(--warning)] mt-0.5 sm:mt-1">{timeRemaining}</div>
                </div>
              </div>

              {/* Tier indicator + slot grid */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    SLOTS [{filledSlots}/{totalSlots}]
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                    {slotsRemaining > 0 ? `${slotsRemaining} OPEN` : 'FULL'}
                  </span>
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: totalSlots }).map((_, i) => {
                    const isFilled = i < filledSlots;
                    return (
                      <div
                        key={i}
                        className={`flex-1 h-4 transition-colors ${
                          isFilled ? 'bg-[var(--accent)]' : 'border border-[var(--accent)]'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {!connected ? (
            <div className="border border-[var(--border)] bg-[var(--background)] p-6 text-center">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] mb-2">
                [!] NO_WALLET
              </div>
              <div className="text-xs font-mono uppercase tracking-widest text-[var(--muted)]">
                &gt; Connect wallet to {isProving ? 'back this meme' : 'trade'}
              </div>
            </div>
          ) : isLaunched ? (
            /* Launched: pooled allocation view */
            (() => {
              const myBacking = backings.find(
                (b) => b.backer_wallet === publicKey?.toBase58() && b.status !== 'withdrawn'
              ) as (typeof backings[number] & { claim_tokens?: string | number; claim_tx?: string }) | undefined;
              const distributed = myBacking?.status === 'distributed' && !!myBacking?.claim_tx;
              return (
                <div className="space-y-3">
                  {myBacking && (
                    <div className="border border-[var(--border)] bg-[var(--background)] p-4 space-y-2">
                      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                        <span className="text-[var(--accent)]">// YOUR_ALLOCATION</span>
                        <span className="text-[var(--muted)]">backed {Number(myBacking.amount_sol).toFixed(3)} SOL</span>
                      </div>
                      {distributed ? (
                        <>
                          <div className="flex items-center gap-2 text-[var(--success)]">
                            <Check className="w-4 h-4" />
                            <span className="font-bold uppercase text-sm">
                              Received {formatTokenAmount(myBacking.claim_tokens)} tokens
                            </span>
                          </div>
                          <a
                            href={`https://solscan.io/tx/${myBacking.claim_tx}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--accent)] underline"
                          >
                            &gt; view distribution tx
                          </a>
                        </>
                      ) : (
                        <div className="text-xs font-mono uppercase tracking-widest text-[var(--muted)]">
                          &gt; Awaiting distribution — the creator releases your
                          proportional share of the pool to this wallet.
                        </div>
                      )}
                    </div>
                  )}
                  <a
                    href={meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 py-4 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white font-black uppercase tracking-wide transition-colors border-2 border-[var(--accent)]"
                  >
                    <ExternalLink className="w-5 h-5" />
                    Trade on pump.fun
                  </a>
                </div>
              );
            })()
          ) : (
            /* Backing panel — mobile-first */
            <div className="space-y-3">
              {/* Label + min hint */}
              <div className="flex items-baseline justify-between">
                <label className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  &gt; Your Pledge (SOL)
                </label>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  Min: <span className="text-[var(--foreground)]">{minBacking}</span>
                </span>
              </div>

              {/* Amount input — full width on its own row */}
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={minBacking.toString()}
                min={minBacking}
                step="0.1"
                className="w-full px-4 py-4 bg-[var(--background)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-2xl font-mono font-semibold"
              />

              {/* Preset buttons — full-width row, easy tap targets */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setAmount(String(minBacking))}
                  className="py-2.5 text-[11px] font-mono uppercase tracking-widest border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                >
                  [&gt;] Min
                </button>
                <button
                  onClick={() => setAmount(String(minBacking * 2))}
                  className="py-2.5 text-[11px] font-mono uppercase tracking-widest border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                >
                  [&gt;] 2x
                </button>
                <button
                  onClick={() => setAmount(String(minBacking * 5))}
                  className="py-2.5 text-[11px] font-mono uppercase tracking-widest border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                >
                  [&gt;] 5x
                </button>
              </div>

              {/* Pledge button — full-width, terminal style */}
              <button
                onClick={handleTrade}
                disabled={!amount || Number(amount) <= 0 || backing || backingPaused || slotsRemaining <= 0}
                className="btn-primary w-full py-4 text-base"
              >
                {backing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Pledging…
                  </span>
                ) : (
                  <>[▶] Pledge {amount || ''} SOL</>
                )}
              </button>

              {/* Fee + share summary — stacks on mobile, inline on sm+ */}
              {amount && Number(amount) > 0 && (
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-[10px] font-mono uppercase tracking-widest border border-[var(--border)] bg-[var(--background)] p-3">
                  <span className="text-[var(--muted)]">
                    To pool: <span className="text-[var(--foreground)]">{Number(amount).toFixed(4)} SOL</span>
                    <span className="text-[var(--muted)]/70 ml-1">(no fee)</span>
                  </span>
                  <span className="text-[var(--muted)] sm:ml-auto">
                    Share: <span className="text-[var(--success)]">~{getProjectedPercent(Number(amount)).toFixed(1)}%</span>
                  </span>
                </div>
              )}

              {backingStatus && (
                <div className={`p-3 text-[11px] font-mono text-center uppercase tracking-widest border ${
                  backingStatus.includes('Error')
                    ? 'text-[var(--error)] border-[var(--error)]'
                    : backingStatus.includes('successful')
                    ? 'text-[var(--success)] border-[var(--success)]'
                    : 'text-[var(--accent)] border-[var(--accent)]'
                }`}>
                  &gt; {backingStatus}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Token Wallet Actions - shown to backers after launch */}
      {isLaunched && (isCreator || isBacker) && (
        <ClaimRewards
          memeId={meme.id}
          isCreator={isCreator}
          isBacker={isBacker}
        />
      )}

      {/* Details toggle */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full flex items-center justify-center gap-2 py-3 bg-[var(--card)] border-2 border-[var(--border)] hover:border-[var(--accent)] text-sm font-bold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--foreground)] transition-all"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        {showDetails ? 'Hide Details' : 'Show Details'}
      </button>

      {showDetails && (
        <div className="space-y-4">
          {/* Slot Grid + Stats (for proving) */}
          {isProving && (
            <div className="border-2 border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-[var(--muted)] uppercase text-xs tracking-wide font-bold">Backer Slots</span>
                <span className="font-black">{filledSlots} / {totalSlots} filled</span>
              </div>
              <div className="flex gap-2">
                {Array.from({ length: totalSlots }).map((_, i) => {
                  const isFilled = i < filledSlots;
                  const slotBacking = backings[i];
                  return (
                    <div
                      key={i}
                      className={`flex-1 h-12 flex flex-col items-center justify-center text-xs font-bold border-2 transition-all ${
                        isFilled
                          ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)]'
                          : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted)]'
                      }`}
                      title={isFilled && slotBacking ? `${Number(slotBacking.amount_sol).toFixed(2)} SOL` : `Slot ${i + 1}`}
                    >
                      <span>{i + 1}</span>
                      {isFilled && slotBacking && (
                        <span className="text-[10px] opacity-75">{Number(slotBacking.amount_sol).toFixed(1)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 bg-[var(--accent)]/20 border border-[var(--accent)]" />
                <span className="text-[var(--muted)]">Every slot is equal — all backers buy at the same price</span>
              </div>
            </div>
          )}

          {/* How it works */}
          <div className="border-2 border-[var(--border)] bg-[var(--card)] p-5">
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">How It Works</h3>
            <ul className="space-y-2 text-sm text-[var(--muted)]">
              <li className="flex items-start gap-2">
                <span className="text-[var(--accent-gold)] font-bold">1.</span>
                <span>Backers pledge SOL to fill {totalSlots} slots</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[var(--accent-gold)] font-bold">2.</span>
                <span>When full, creator launches on pump.fun</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[var(--accent-gold)] font-bold">3.</span>
                <span>The pool does ONE atomic buy — same price for everyone, no sniper gap</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[var(--accent-gold)] font-bold">4.</span>
                <span>Your proportional token share is sent to your wallet</span>
              </li>
            </ul>
            <div className="mt-3 pt-3 border-t border-[var(--border)] flex gap-4 text-xs text-[var(--muted)]">
              <span>Backers earn <span className="text-[var(--success)] font-bold">90%</span> of trading fees</span>
              <span>Withdrawal fee: <span className="text-[var(--warning)] font-bold">2%</span></span>
            </div>
          </div>
        </div>
      )}

      {/* Genesis Backer Roster — full-width above Backers/Chat for launched memes.
          Shows post-launch holdings, hold %, realized fees, and live pending fees. */}
      {isLaunched && (
        <div className="mt-6">
          <GenesisBackerRoster
            backings={backings as any}
            totalBackingSol={Number(current_backing_sol)}
            vaultLamports={Number((meme as any).vault_lamports || 0)}
            hasSubEscrow={!!(meme as any).creator_subescrow_pubkey}
          />
        </div>
      )}

      {/* Backers & Chat Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Pre-launch BackersList (slot-filling UX) — hidden post-launch
            since GenesisBackerRoster above shows the richer launched view. */}
        {!isLaunched && (
          <BackersList
            backings={backings}
            totalBacking={Number(current_backing_sol)}
            currentWallet={publicKey?.toBase58()}
            canWithdraw={isProving}
            onWithdraw={requestWithdraw}
            withdrawing={withdrawing}
            withdrawStatus={withdrawStatus}
          />
        )}

        {/* Chat — spans full width post-launch since roster moved up */}
        <div className={isLaunched ? 'lg:col-span-2' : ''}>
          <MemeChat memeId={meme.id} />
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={showBackConfirm}
        onClose={() => setShowBackConfirm(false)}
        onConfirm={confirmBack}
        title="Confirm Backing"
        message={`You are backing ${name} with ${amount} SOL.\n\nYour SOL goes into this meme's shared pool. When all slots fill, the pool makes ONE atomic launch buy on pump.fun — every backer gets in at the exact same price, with no dev allocation and no sniper gap.\n\nAfter launch, your proportional share of tokens is sent straight to this wallet.\n\nChanged your mind? You can withdraw while slots are still filling (2% fee). Once the pool is full it's committed and waits for the creator to launch on their schedule.`}
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
        message={`Withdraw ${pendingWithdrawAmount.toFixed(4)} SOL from this meme?\n\nWithdrawal fee: ${(pendingWithdrawAmount * 0.02).toFixed(4)} SOL (2%)\n\nYou will receive: ${(pendingWithdrawAmount * 0.98).toFixed(4)} SOL`}
        confirmText={`Withdraw ${(pendingWithdrawAmount * 0.98).toFixed(4)} SOL`}
        variant="warning"
        isLoading={withdrawing}
      />

      <ConfirmDialog
        isOpen={showLaunchConfirm}
        onClose={() => setShowLaunchConfirm(false)}
        onConfirm={confirmLaunch}
        title="Launch Token"
        message={`You are about to deploy ${name} ($${symbol}) to pump.fun with ${Number(current_backing_sol).toFixed(2)} SOL of community backing. This action cannot be undone. Tokens will be distributed to all backers proportionally.`}
        confirmText="Launch Now"
        variant="info"
        isLoading={launching}
      />
    </div>
  );
}
