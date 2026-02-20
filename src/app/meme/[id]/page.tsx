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
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ClaimRewards } from '@/components/ClaimRewards';
import { useRealtimeMeme, useRealtimeBackings } from '@/hooks/useRealtimeMemes';
import { createBurnerWallet, getSignMessage } from '@/lib/burnerWallet';

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
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawStatus, setWithdrawStatus] = useState<string | null>(null);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [showLaunchConfirm, setShowLaunchConfirm] = useState(false);
  const [pendingWithdrawWallet, setPendingWithdrawWallet] = useState<string | null>(null);
  const [pendingWithdrawAmount, setPendingWithdrawAmount] = useState<number>(0);
  // Burner wallet state
  const [pendingBurnerKeypair, setPendingBurnerKeypair] = useState<Keypair | null>(null);
  const [showBurnerInfo, setShowBurnerInfo] = useState(false);
  // Sweep state
  const [sweeping, setSweeping] = useState(false);
  const [sweepStatus, setSweepStatus] = useState<string | null>(null);
  const [burnerInfo, setBurnerInfo] = useState<{
    burner_wallet: string;
    buy_executed: boolean;
    amount_sol: number | null;
    swept: boolean;
    sweep_action: string | null;
  } | null>(null);
  const [showExportKey, setShowExportKey] = useState(false);
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [exportKeyCopied, setExportKeyCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Platform config
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null);
  const PLATFORM_FEE_PERCENT = 0.02; // 2%

  // Use real-time hooks for meme and backings
  const { meme, loading, error, refetch: refetchMeme } = useRealtimeMeme(id as string);
  const { backings, refetch: refetchBackings } = useRealtimeBackings(id as string);

  // Fetch platform config (escrow address)
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.escrow_address) {
          setEscrowAddress(data.escrow_address);
        }
      })
      .catch(err => console.error('Failed to fetch config:', err));
  }, []);

  // Set trade type based on meme status
  useEffect(() => {
    if (meme?.status === 'live') {
      setTradeType('buy'); // Default to buy for live tokens
    } else {
      setTradeType('back'); // Default to back for proving tokens
    }
  }, [meme?.status]);

  // Fetch burner wallet info when viewing a launched token
  useEffect(() => {
    const fetchBurnerInfo = async () => {
      if (!meme || meme.status !== 'live' || !connected || !publicKey) return;

      try {
        const response = await fetch(
          `/api/sweep?meme_id=${meme.id}&backer_wallet=${publicKey.toBase58()}`
        );
        if (response.ok) {
          const data = await response.json();
          setBurnerInfo(data);
        }
        // 404 is expected if user is not a backer - no need to log
      } catch (err) {
        // Network errors only
        console.error('Failed to fetch burner info:', err);
      }
    };

    fetchBurnerInfo();
  }, [meme, connected, publicKey]);

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

    setBacking(true);
    setBackingStatus('Creating token wallet...');

    try {
      // 1. Sign message to verify wallet ownership
      setBackingStatus('Sign to verify your wallet...');
      const messageToSign = getSignMessage(meme.id);
      const encodedMessage = new TextEncoder().encode(messageToSign);
      await signMessage(encodedMessage);

      // 2. Generate token wallet (private key sent to server over HTTPS)
      setBackingStatus('Generating token wallet...');
      const burnerWallet = createBurnerWallet();

      // Store the keypair temporarily so user can export it after success
      setPendingBurnerKeypair(burnerWallet.keypair);

      // 3. Create SOL transfer transaction to burner wallet + platform fee
      // User sends backing amount to burner wallet, and 2% fee to escrow
      const burnerPubkey = new PublicKey(burnerWallet.publicKey);
      const backingLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      const platformFee = amountSol * PLATFORM_FEE_PERCENT;
      const feeLamports = Math.floor(platformFee * LAMPORTS_PER_SOL);

      const transaction = new Transaction();

      // Transfer backing amount to burner wallet
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: burnerPubkey,
          lamports: backingLamports,
        })
      );

      // Transfer 2% platform fee to escrow wallet
      if (escrowAddress && feeLamports > 0) {
        const escrowPubkey = new PublicKey(escrowAddress);
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: escrowPubkey,
            lamports: feeLamports,
          })
        );
      }

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // 4. Sign and send transaction — use signTransaction (not signAndSendTransaction)
      // to avoid Phantom's "may be harmful" warning on unfamiliar addresses
      const totalSol = (amountSol + platformFee).toFixed(4);
      setBackingStatus(`Approve transfer of ${totalSol} SOL...`);
      const signed = await signTransaction!(transaction);
      const txSignature = await connection.sendRawTransaction(signed.serialize());

      // 5. Confirm transaction landed
      setBackingStatus('Processing transaction...');
      await connection.confirmTransaction({
        signature: txSignature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      // 6. Register backing with API (private key sent securely over HTTPS)
      setBackingStatus('Registering backing...');
      const response = await fetch('/api/backings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: publicKey.toBase58(),
          amount_sol: amountSol,
          deposit_tx: txSignature,
          // Burner wallet data - private key encrypted server-side
          burner_wallet: burnerWallet.publicKey,
          burner_private_key: burnerWallet.privateKey,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to register backing');
      }

      setBackingStatus('Backing successful!');
      setAmount('');
      setShowBurnerInfo(true); // Show the burner wallet export info

      // Refresh meme data and backings to show updates
      await Promise.all([refetchMeme(), refetchBackings()]);

    } catch (err) {
      console.error('Backing failed:', err);
      setBackingStatus(`Error: ${err instanceof Error ? err.message : 'Transaction failed'}`);
      setPendingBurnerKeypair(null);
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
      const authMessage = `launch:${meme.id}:${publicKey!.toBase58()}`;
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

      setLaunchStatus('Token launched successfully!');

      // Refresh meme data to show updated status
      await refetchMeme();

      // Clear status after a moment
      setTimeout(() => setLaunchStatus(null), 5000);
    } catch (err) {
      console.error('Launch failed:', err);
      setLaunchStatus(`Error: ${err instanceof Error ? err.message : 'Launch failed'}`);
    } finally {
      setLaunching(false);
    }
  };

  const handleWithdraw = async (backerWallet: string) => {
    if (!meme || withdrawing) return;

    setWithdrawing(true);
    setWithdrawStatus('Sign to authorize withdrawal...');

    try {
      // Sign a message to prove wallet ownership
      const authMessage = `withdraw:${meme.id}:${backerWallet}`;
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

  const handleSweep = async (action: 'sell' | 'transfer') => {
    if (!meme || !publicKey || sweeping) return;

    setSweeping(true);
    setSweepStatus(action === 'sell' ? 'Selling tokens...' : 'Transferring tokens...');

    try {
      const response = await fetch('/api/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: publicKey.toBase58(),
          action,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Sweep failed');
      }

      setSweepStatus(data.message);

      // Update burner info to show swept status
      setBurnerInfo(prev => prev ? { ...prev, swept: true, sweep_action: action } : null);

      // Clear status after a moment
      setTimeout(() => setSweepStatus(null), 5000);
    } catch (err) {
      console.error('Sweep failed:', err);
      setSweepStatus(`Error: ${err instanceof Error ? err.message : 'Sweep failed'}`);
    } finally {
      setSweeping(false);
    }
  };

  const handleExportPrivateKey = async () => {
    if (!meme || !publicKey) return;

    setShowExportKey(true);
    setExportedKey(null); // Reset

    try {
      // Sign a message to prove wallet ownership
      const authMessage = `export-key:${meme.id}:${publicKey.toBase58()}`;
      const msgBytes = new TextEncoder().encode(authMessage);
      const sigBytes = await signMessage!(msgBytes);
      const sigB58 = bs58.encode(sigBytes);

      const response = await fetch('/api/backings/export-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: publicKey.toBase58(),
          signature: sigB58,
          message: authMessage,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to export key');
      }

      setExportedKey(data.private_key);
    } catch (err) {
      console.error('Export key error:', err);
      // Keep modal open but show error state
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
      {/* Back Button */}
      <Link href="/" className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors uppercase text-sm font-bold tracking-wide">
        <ArrowLeft className="w-4 h-4" />
        Return to Revolution
      </Link>

      {/* Header - Propaganda Poster Style */}
      <div className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6">
        {/* Decorative corner accent */}
        <div className="absolute top-0 left-0 w-16 h-16 border-b-2 border-r-2 border-[var(--accent-gold)] opacity-50" />
        <div className="absolute bottom-0 right-0 w-16 h-16 border-t-2 border-l-2 border-[var(--accent-gold)] opacity-50" />

        <div className="flex items-start gap-6">
          {image_url ? (
            <div className="relative">
              <img
                src={image_url}
                alt={name}
                className="w-24 h-24 object-cover border-2 border-[var(--accent)]"
              />
              <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-[var(--accent)] flex items-center justify-center">
                <span className="text-white text-xs font-bold">★</span>
              </div>
            </div>
          ) : (
            <div className="w-24 h-24 bg-gradient-to-br from-[var(--gradient-start)] to-[var(--gradient-end)] flex items-center justify-center text-4xl font-bold border-2 border-[var(--accent)]">
              {symbol.charAt(0)}
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-black uppercase tracking-tight">{name}</h1>
              <span className={`px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
            <div className="text-xl text-[var(--accent-gold)] font-bold mb-3">${symbol}</div>
            <p className="text-[var(--muted)] leading-relaxed">{description}</p>

            {/* Social Links */}
            {(twitter || telegram || discord || website) && (
              <div className="flex flex-wrap gap-2 mt-3">
                {twitter && (
                  <a
                    href={twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--background)] hover:bg-[var(--border)] rounded-lg text-sm transition-colors"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--background)] hover:bg-[var(--border)] rounded-lg text-sm transition-colors"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--background)] hover:bg-[var(--border)] rounded-lg text-sm transition-colors"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--background)] hover:bg-[var(--border)] rounded-lg text-sm transition-colors"
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

        {/* Creator Info - Comrade Section */}
        <div className="mt-6 pt-4 border-t-2 border-[var(--border)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--accent)] font-bold uppercase text-xs tracking-wider">Comrade Creator:</span>
              <code className="bg-[var(--background)] border border-[var(--border)] px-3 py-1 text-xs font-mono">
                {creator_wallet.slice(0, 8)}...{creator_wallet.slice(-8)}
              </code>
              <button
                onClick={() => handleCopy(creator_wallet)}
                className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-[var(--success)]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {creator_twitter && (
            <a
              href={creator_twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-[var(--background)] hover:bg-[var(--accent)]/10 border-2 border-[var(--border)] hover:border-[var(--accent)] text-sm font-bold uppercase tracking-wide transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              <span>@{creator_twitter.split('/').pop()}</span>
            </a>
          )}
        </div>

        {/* Contract Address - shown for live tokens */}
        {isLaunched && meme.mint_address && (
          <div className="mt-4 pt-4 border-t-2 border-[var(--border)]">
            <div className="flex items-center gap-2 text-sm mb-3">
              <Coins className="w-5 h-5 text-[var(--accent-gold)]" />
              <span className="text-[var(--accent-gold)] font-bold uppercase tracking-wider">Victory Contract:</span>
            </div>
            <button
              onClick={() => handleCopy(meme.mint_address!)}
              className="w-full flex items-center gap-3 px-4 py-4 bg-[var(--background)] hover:bg-[var(--accent)]/10 border-2 border-[var(--border)] hover:border-[var(--accent)] transition-all group"
            >
              <code className="flex-1 text-sm font-mono text-left break-all text-[var(--foreground)]">
                {meme.mint_address}
              </code>
              {copied ? (
                <Check className="w-5 h-5 text-[var(--success)] flex-shrink-0" />
              ) : (
                <Copy className="w-5 h-5 text-[var(--muted)] group-hover:text-[var(--accent)] flex-shrink-0" />
              )}
            </button>
            <p className="text-xs text-[var(--muted)] mt-2 uppercase tracking-wide">
              Seize the means of trading on your favorite DEX
            </p>
          </div>
        )}
      </div>

      {/* Launch Section - shown when funded */}
      {(isFunded || isLaunching) && (
        <div className="relative border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
          <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--success)] text-white text-xs font-bold uppercase tracking-wider">
            ★ Victory Achieved ★
          </div>
          <h2 className="text-xl font-black uppercase tracking-tight pt-2">
            {isLaunching ? 'Launching Revolution...' : 'The People Have Spoken!'}
          </h2>
          <div className="bg-[var(--success)]/10 border-2 border-[var(--success)]/30 p-4">
            <p className="text-[var(--success)] font-bold mb-2 uppercase tracking-wide">
              All {totalSlots} Slots Filled - {Number(current_backing_sol).toFixed(2)} SOL Raised
            </p>
            <p className="text-sm text-[var(--muted)]">
              This meme has all backer slots filled and is ready to launch on pump.fun
            </p>
          </div>
          {isCreator ? (
            <button
              onClick={requestLaunch}
              disabled={launching || isLaunching}
              className="w-full py-4 font-black text-lg uppercase tracking-wide bg-gradient-to-r from-[var(--gradient-start)] to-[var(--gradient-end)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed border-2 border-[var(--accent)]"
            >
              {launching || isLaunching ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Deploying Revolution...
                </span>
              ) : (
                '★ Launch the Revolution ★'
              )}
            </button>
          ) : (
            <div className="text-center py-3 text-sm text-[var(--muted)] bg-[var(--background)] border-2 border-[var(--border)] uppercase tracking-wide">
              {connected ? 'Awaiting comrade creator...' : 'Connect wallet to witness history'}
            </div>
          )}
          {launchStatus && (
            <div className={`p-3 text-sm text-center font-bold uppercase tracking-wide ${
              launchStatus.includes('Error')
                ? 'bg-[var(--error)]/20 text-[var(--error)] border-2 border-[var(--error)]/30'
                : launchStatus.includes('successfully')
                ? 'bg-[var(--success)]/20 text-[var(--success)] border-2 border-[var(--success)]/30'
                : 'bg-[var(--accent)]/20 text-[var(--accent)] border-2 border-[var(--accent)]/30'
            }`}>
              {launchStatus}
            </div>
          )}
        </div>
      )}

      {/* Backing / Trade Panel - full width, right below header */}
      <div className="relative bg-[var(--card)] border-2 border-[var(--accent)]" style={isProving ? { borderWidth: '3px' } : {}}>
        {isProving && (
          <div className="bg-gradient-to-r from-[var(--gradient-start)] to-[var(--gradient-end)] w-full py-2.5 text-center text-white text-sm font-black uppercase tracking-widest">
            ★ Back This Token ★
          </div>
        )}

        <div className="p-6">
          {isProving && (
            <>
              {/* Compact info bar */}
              <div className="flex items-center gap-4 mb-5 flex-wrap">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[var(--accent)]" />
                  <span className="font-black">{slotsRemaining}</span>
                  <span className="text-xs text-[var(--muted)] uppercase">slots open</span>
                </div>
                <div className="w-px h-5 bg-[var(--border)]" />
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-[var(--accent-gold)]" />
                  <span className="font-black">{Number(current_backing_sol).toFixed(2)} SOL</span>
                  <span className="text-xs text-[var(--muted)] uppercase">raised</span>
                </div>
                <div className="w-px h-5 bg-[var(--border)]" />
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--warning)]" />
                  <span className="font-black text-[var(--warning)]">{timeRemaining}</span>
                  <span className="text-xs text-[var(--muted)] uppercase">left</span>
                </div>
                {filledSlots < 4 ? (
                  <span className="ml-auto text-xs bg-[var(--accent-gold)]/20 text-[var(--accent-gold)] px-2 py-1 font-bold uppercase border border-[var(--accent-gold)]/30">
                    Next: Bourgeoisie
                  </span>
                ) : (
                  <span className="ml-auto text-xs bg-[var(--accent)]/20 text-[var(--accent)] px-2 py-1 font-bold uppercase border border-[var(--accent)]/30">
                    Next: Proletariat
                  </span>
                )}
              </div>

              {/* Visual Slot Grid - compact */}
              <div className="flex gap-1.5 mb-5">
                {Array.from({ length: totalSlots }).map((_, i) => {
                  const isFilled = i < filledSlots;
                  const isBourgeoisie = i < 4;
                  return (
                    <div
                      key={i}
                      className={`flex-1 h-2 transition-all ${
                        isFilled
                          ? isBourgeoisie
                            ? 'bg-[var(--accent-gold)]'
                            : 'bg-[var(--accent)]'
                          : 'bg-[var(--border)]'
                      }`}
                    />
                  );
                })}
              </div>
            </>
          )}

          {!connected ? (
            <div className="text-center py-8 text-[var(--muted)] border-2 border-dashed border-[var(--accent)]/40 uppercase text-sm font-bold tracking-wide bg-[var(--accent)]/5">
              <div className="text-3xl mb-3">★</div>
              Connect wallet to {isProving ? 'join the cause' : 'trade'}
            </div>
          ) : isLaunched ? (
            /* Trading options for launched tokens */
            <div className="space-y-4">
              {burnerInfo && burnerInfo.burner_wallet && !burnerInfo.swept ? (
                <>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleSweep('transfer')}
                      disabled={sweeping}
                      className="flex-1 flex items-center justify-center gap-2 py-4 bg-[var(--success)] hover:bg-[var(--success)]/90 text-white font-black uppercase tracking-wide transition-colors disabled:opacity-50 border-2 border-[var(--success)]"
                    >
                      {sweeping ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUpRight className="w-5 h-5" />}
                      Claim Tokens
                    </button>
                    <a
                      href={meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 px-6 py-4 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white font-bold uppercase tracking-wide transition-colors border-2 border-[var(--accent)]"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Trade
                    </a>
                  </div>
                  <button
                    onClick={handleExportPrivateKey}
                    className="w-full flex items-center justify-center gap-2 p-2.5 bg-[var(--background)] hover:bg-[var(--border)] border border-[var(--border)] transition-colors text-xs uppercase tracking-wide text-[var(--muted)]"
                  >
                    <Key className="w-3 h-3" />
                    Export Private Key
                  </button>
                  {sweepStatus && (
                    <div className={`p-3 text-sm text-center ${
                      sweepStatus.includes('Error')
                        ? 'bg-[var(--error)]/20 text-[var(--error)]'
                        : 'bg-[var(--success)]/20 text-[var(--success)]'
                    }`}>
                      {sweeping && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
                      {sweepStatus}
                    </div>
                  )}
                </>
              ) : burnerInfo?.swept ? (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-[var(--success)]">
                    <Check className="w-5 h-5" />
                    <span className="font-bold uppercase text-sm">Tokens claimed</span>
                  </div>
                  <a
                    href={meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-2 px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white font-bold uppercase tracking-wide transition-colors border-2 border-[var(--accent)]"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Trade on pump.fun
                  </a>
                </div>
              ) : (
                <a
                  href={meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-4 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white font-black uppercase tracking-wide transition-colors border-2 border-[var(--accent)]"
                >
                  <ExternalLink className="w-5 h-5" />
                  Trade on pump.fun
                </a>
              )}
            </div>
          ) : (
            /* Backing panel */
            <div className="space-y-4">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-[var(--foreground)] mb-2 uppercase tracking-wide">
                    Your Pledge (SOL)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={minBacking.toString()}
                      min={minBacking}
                      step="0.1"
                      className="w-full px-5 py-4 bg-[var(--background)] border-2 border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-2xl font-bold"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
                      <button
                        onClick={() => setAmount(String(minBacking))}
                        className="text-xs bg-[var(--card)] border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--border)] font-bold uppercase"
                      >
                        Min
                      </button>
                      <button
                        onClick={() => setAmount(String(minBacking * 2))}
                        className="text-xs bg-[var(--card)] border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--border)] font-bold uppercase"
                      >
                        2x
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleTrade}
                  disabled={!amount || Number(amount) <= 0 || backing || backingPaused || slotsRemaining <= 0}
                  className="px-8 py-4 text-lg font-black uppercase tracking-wide transition-all border-2 bg-gradient-to-r from-[var(--gradient-start)] to-[var(--gradient-end)] text-white border-[var(--accent)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {backing ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    '★ Pledge ★'
                  )}
                </button>
              </div>

              {/* Fee + share summary - inline */}
              {amount && Number(amount) > 0 && (
                <div className="flex items-center gap-4 text-sm text-[var(--muted)] flex-wrap">
                  <span>Total: <span className="text-[var(--foreground)] font-bold">{(Number(amount) * 1.02).toFixed(4)} SOL</span> (inc. 2% fee)</span>
                  <span>Share: <span className="text-[var(--success)] font-bold">~{getProjectedPercent(Number(amount)).toFixed(1)}%</span></span>
                  <span className="ml-auto text-xs">Min: {minBacking} SOL</span>
                </div>
              )}

              {backingStatus && (
                <div className={`p-3 text-sm text-center font-bold uppercase tracking-wide ${
                  backingStatus.includes('Error')
                    ? 'bg-[var(--error)]/20 text-[var(--error)] border-2 border-[var(--error)]/30'
                    : backingStatus.includes('successful')
                    ? 'bg-[var(--success)]/20 text-[var(--success)] border-2 border-[var(--success)]/30'
                    : 'bg-[var(--accent)]/20 text-[var(--accent)] border-2 border-[var(--accent)]/30'
                }`}>
                  {backingStatus}
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
                  const isBourgeoisie = i < 4;
                  const slotBacking = backings[i];
                  return (
                    <div
                      key={i}
                      className={`flex-1 h-12 flex flex-col items-center justify-center text-xs font-bold border-2 transition-all ${
                        isFilled
                          ? isBourgeoisie
                            ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/20 text-[var(--accent-gold)]'
                            : 'border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)]'
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
              <div className="flex gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-[var(--accent-gold)]/20 border border-[var(--accent-gold)]" />
                  <span className="text-[var(--muted)]">Bourgeoisie (first to buy)</span>
                </div>
                {totalSlots > 4 && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-[var(--accent)]/20 border border-[var(--accent)]" />
                    <span className="text-[var(--muted)]">Proletariat (fast follow)</span>
                  </div>
                )}
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
                <span>Your wallet buys automatically — Bourgeoisie first, Proletariat follow</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[var(--accent-gold)] font-bold">4.</span>
                <span>Claim tokens to your main wallet after launch</span>
              </li>
            </ul>
            <div className="mt-3 pt-3 border-t border-[var(--border)] flex gap-4 text-xs text-[var(--muted)]">
              <span>Backers earn <span className="text-[var(--success)] font-bold">90%</span> of trading fees</span>
              <span>Withdrawal fee: <span className="text-[var(--warning)] font-bold">2%</span></span>
            </div>
          </div>
        </div>
      )}

      {/* Comrades & Communications Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Backers List - The Collective */}
        <BackersList
          backings={backings}
          totalBacking={Number(current_backing_sol)}
          currentWallet={publicKey?.toBase58()}
          canWithdraw={isProving}
          onWithdraw={requestWithdraw}
          withdrawing={withdrawing}
          withdrawStatus={withdrawStatus}
        />

        {/* Comrade Communications */}
        <MemeChat memeId={meme.id} />
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={showBackConfirm}
        onClose={() => setShowBackConfirm(false)}
        onConfirm={confirmBack}
        title="Confirm Your Allegiance"
        message={`You are pledging ${amount} SOL to the ${name} revolution.\n\nA secure token wallet will be created for you. When the revolution launches, this wallet will automatically acquire tokens on your behalf - keeping your position organic and hidden.\n\nAfter launch, you'll be able to:\n• Liquidate tokens instantly for SOL\n• Transfer tokens to your main wallet\n• Export the private key for full control`}
        confirmText={`Pledge ${amount} SOL`}
        variant="info"
        isLoading={backing}
      />

      {/* Token Wallet Info Modal - shows after backing, hides private key until launch */}
      {showBurnerInfo && pendingBurnerKeypair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--card)] border-2 border-[var(--success)] p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-[var(--success)]/20 flex items-center justify-center border-2 border-[var(--success)]">
                <span className="text-xl">★</span>
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight">Welcome, Comrade!</h3>
                <p className="text-sm text-[var(--muted)]">Your position is secured</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-[var(--accent)]/10 border-2 border-[var(--accent)]/30 p-4">
                <p className="text-sm text-[var(--accent)] font-bold uppercase tracking-wide mb-2">The Revolution Awaits:</p>
                <ul className="text-xs text-[var(--muted)] space-y-1">
                  <li>★ Your SOL is now in a secure token wallet</li>
                  <li>★ When the revolution launches, it will automatically acquire tokens</li>
                  <li>★ After launch, claim, transfer, or export your spoils</li>
                  <li>★ Your private key is encrypted and secured</li>
                </ul>
              </div>

              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4">
                <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                  <Key className="w-4 h-4" />
                  <span className="font-bold uppercase tracking-wide">Details classified until launch</span>
                </div>
                <p className="text-xs text-[var(--muted)] mt-2">
                  For operational security, your token wallet address and private key remain hidden until launch. This prevents front-running and protects your position in the collective.
                </p>
              </div>

              <div className="bg-[var(--warning)]/10 border-2 border-[var(--warning)]/30 p-4">
                <p className="text-sm text-[var(--warning)] font-bold uppercase tracking-wide mb-1">Second Thoughts?</p>
                <p className="text-xs text-[var(--muted)]">
                  You may retreat anytime before launch for a 2% desertion fee. Visit your Portfolio or use the withdraw button.
                </p>
              </div>

              <button
                onClick={() => {
                  setShowBurnerInfo(false);
                  setPendingBurnerKeypair(null);
                  setBackingStatus(null);
                }}
                className="w-full py-3 bg-[var(--accent)] text-white font-black uppercase tracking-wide hover:opacity-90 border-2 border-[var(--accent)]"
              >
                For the Revolution!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Private Key Modal (for launched tokens) */}
      {showExportKey && burnerInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--card)] border-2 border-[var(--warning)] p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-[var(--warning)]/20 flex items-center justify-center border-2 border-[var(--warning)]">
                <Key className="w-6 h-6 text-[var(--warning)]" />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight">Classified Information</h3>
                <p className="text-sm text-[var(--muted)]">Handle with extreme care</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-[var(--warning)]/10 border-2 border-[var(--warning)]/30 p-4">
                <p className="text-sm text-[var(--warning)] font-bold uppercase tracking-wide mb-2">Security Protocol:</p>
                <ul className="text-xs text-[var(--muted)] space-y-1">
                  <li>★ Never share your private key with anyone</li>
                  <li>★ Only import to trusted wallet apps (Phantom, Solflare)</li>
                  <li>★ This gives full control of the token wallet</li>
                </ul>
              </div>

              {exportedKey ? (
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4">
                  <p className="text-sm text-[var(--muted)] mb-2 uppercase tracking-wide font-bold">Private Key:</p>
                  <div className="flex gap-2">
                    <code className="flex-1 text-xs break-all bg-[var(--card)] p-2 border-2 border-[var(--border)]">
                      {exportKeyCopied ? '••••••••••••••••' : exportedKey}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(exportedKey);
                        setExportKeyCopied(true);
                        setTimeout(() => setExportKeyCopied(false), 3000);
                      }}
                      className="px-3 py-2 bg-[var(--accent)] text-white text-sm hover:opacity-90 border-2 border-[var(--accent)]"
                    >
                      {exportKeyCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-[var(--accent)]" />
                  <p className="text-sm text-[var(--muted)]">
                    Decrypting classified data...
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-2">
                    Wallet: <code className="text-xs">{burnerInfo.burner_wallet.slice(0, 8)}...{burnerInfo.burner_wallet.slice(-8)}</code>
                  </p>
                </div>
              )}

              <button
                onClick={() => {
                  setShowExportKey(false);
                  setExportedKey(null);
                  setExportKeyCopied(false);
                }}
                className="w-full py-3 bg-[var(--background)] hover:bg-[var(--border)] font-bold uppercase tracking-wide transition-colors border-2 border-[var(--border)]"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showWithdrawConfirm}
        onClose={() => {
          setShowWithdrawConfirm(false);
          setPendingWithdrawWallet(null);
          setPendingWithdrawAmount(0);
        }}
        onConfirm={confirmWithdraw}
        title="Confirm Retreat"
        message={`Withdraw ${pendingWithdrawAmount.toFixed(4)} SOL from the cause?\n\nDesertion fee: ${(pendingWithdrawAmount * 0.02).toFixed(4)} SOL (2%)\n\nYou will receive: ${(pendingWithdrawAmount * 0.98).toFixed(4)} SOL`}
        confirmText={`Retreat with ${(pendingWithdrawAmount * 0.98).toFixed(4)} SOL`}
        variant="warning"
        isLoading={withdrawing}
      />

      <ConfirmDialog
        isOpen={showLaunchConfirm}
        onClose={() => setShowLaunchConfirm(false)}
        onConfirm={confirmLaunch}
        title="Launch the Revolution"
        message={`You are about to deploy ${name} ($${symbol}) to pump.fun with ${Number(current_backing_sol).toFixed(2)} SOL of collective backing. This historic moment cannot be undone. Tokens will be distributed to all comrades proportionally.`}
        confirmText="★ Launch Now ★"
        variant="info"
        isLoading={launching}
      />
    </div>
  );
}
