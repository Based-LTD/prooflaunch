'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
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
  ExternalLink
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
  const { connected, publicKey, sendTransaction, signMessage } = useWallet();
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

  // Platform config
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null);
  const PLATFORM_FEE_PERCENT = 0.02; // 2%
  const PLATFORM_FEE_MINIMUM = 0.01; // 0.01 SOL minimum

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

    // TESTING: Raised from 10% to 50%
    const maxBackingPerWallet = Number(meme.backing_goal_sol) * 0.5;
    if (amountSol > maxBackingPerWallet) {
      setBackingStatus(
        `Error: Maximum backing is ${maxBackingPerWallet.toFixed(2)} SOL per wallet (50% of goal).`
      );
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
      // User sends backing amount to burner wallet, and fee (2% or 0.01 SOL minimum) to escrow
      const burnerPubkey = new PublicKey(burnerWallet.publicKey);
      const backingLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      const platformFee = Math.max(amountSol * PLATFORM_FEE_PERCENT, PLATFORM_FEE_MINIMUM);
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
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // 4. Send transaction via wallet
      const totalSol = (amountSol + platformFee).toFixed(4);
      setBackingStatus(`Approve transfer of ${totalSol} SOL...`);
      const txSignature = await sendTransaction(transaction, connection);

      // 5. Wait briefly for transaction to propagate
      setBackingStatus('Processing transaction...');
      await new Promise(resolve => setTimeout(resolve, 2000));

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

        // TESTING: Raised from 10% to 50%
        const maxBackingPerWallet = Number(meme.backing_goal_sol) * 0.5;
        if (amountSol > maxBackingPerWallet) {
          setBackingStatus(
            `Error: Maximum backing is ${maxBackingPerWallet.toFixed(2)} SOL per wallet (50% of goal).`
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
    setLaunchStatus('Initiating launch...');

    try {
      const response = await fetch('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          caller_wallet: publicKey?.toBase58(),
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
    setWithdrawStatus('Processing withdrawal...');

    try {
      const response = await fetch('/api/backings/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: backerWallet,
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
      const response = await fetch('/api/backings/export-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: meme.id,
          backer_wallet: publicKey.toBase58(),
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

  const progress = (Number(current_backing_sol) / Number(backing_goal_sol)) * 100;
  const timeRemaining = getTimeRemaining(backing_deadline);
  const { label: statusLabel, class: statusClass } = getStatusConfig(status);

  const isProving = status === 'backing';
  const isFunded = status === 'funded';
  const isLaunching = status === 'launching';
  const isLaunched = status === 'live';
  const maxBacking = Number(backing_goal_sol) * 0.5; // TESTING: 50% max per wallet (was 10%)
  const isCreator = connected && publicKey?.toBase58() === creator_wallet;
  const isBacker = connected && backings.some(
    (b) => b.backer_wallet === publicKey?.toBase58() && b.status === 'distributed'
  );

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Progress / Stats */}
        <div className="lg:col-span-2 space-y-4">
          {/* Launch Section - shown when funded */}
          {(isFunded || isLaunching) && (
            <div className="relative border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
              {/* Victory Banner */}
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--success)] text-white text-xs font-bold uppercase tracking-wider">
                ★ Victory Achieved ★
              </div>

              <h2 className="text-xl font-black uppercase tracking-tight pt-2">
                {isLaunching ? 'Launching Revolution...' : 'The People Have Spoken!'}
              </h2>

              <div className="bg-[var(--success)]/10 border-2 border-[var(--success)]/30 p-4">
                <p className="text-[var(--success)] font-bold mb-2 uppercase tracking-wide">
                  Goal Reached: {Number(current_backing_sol).toFixed(2)} / {Number(backing_goal_sol)} SOL
                </p>
                <p className="text-sm text-[var(--muted)]">
                  This meme has been fully funded and is ready to launch on pump.fun
                </p>
              </div>

              {/* Only creator can launch */}
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
                  {connected
                    ? 'Awaiting comrade creator...'
                    : 'Connect wallet to witness history'}
                </div>
              )}

              {/* Launch status message */}
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

          {isProving && (
            <div className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-6">
              {/* Section Header */}
              <div className="flex items-center gap-3">
                <div className="w-1 h-8 bg-gradient-to-b from-[var(--accent)] to-[var(--accent-gold)]" />
                <h2 className="text-xl font-black uppercase tracking-tight">Revolution Progress</h2>
              </div>

              {/* SOL Progress */}
              <div>
                <div className="flex justify-between text-sm mb-3">
                  <span className="flex items-center gap-2 text-[var(--muted)] uppercase text-xs tracking-wide font-bold">
                    <Target className="w-4 h-4 text-[var(--accent)]" /> Collective Goal
                  </span>
                  <span className="font-black text-lg">
                    {Number(current_backing_sol).toFixed(2)} / {Number(backing_goal_sol)} SOL
                  </span>
                </div>
                <div className="relative h-6 bg-[var(--background)] border-2 border-[var(--border)]">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--gradient-start)] to-[var(--accent-gold)] transition-all duration-500"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow-md">
                    {progress.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-3 text-center">
                  <Users className="w-5 h-5 mx-auto mb-1 text-[var(--accent)]" />
                  <span className="text-2xl font-black">{backer_count}</span>
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Comrades</p>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--warning)]/50 p-3 text-center">
                  <Clock className="w-5 h-5 mx-auto mb-1 text-[var(--warning)]" />
                  <span className="text-2xl font-black text-[var(--warning)]">{timeRemaining}</span>
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Remaining</p>
                </div>
              </div>

              {/* Fee Distribution Preview */}
              <div className="border-t-2 border-[var(--border)] pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Coins className="w-5 h-5 text-[var(--accent-gold)]" />
                  <span className="text-sm font-bold uppercase tracking-wide">Spoils of War Distribution</span>
                  <div className="group relative">
                    <Info className="w-4 h-4 text-[var(--muted)] cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-[var(--card)] border-2 border-[var(--border)] shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 text-xs">
                      <p className="text-[var(--muted)] mb-2">
                        When this token launches and trades on pump.fun, 0.5% of all trading volume flows as creator fees.
                      </p>
                      <p className="text-[var(--muted)]">
                        These fees are distributed 100% to backers and creator - no platform cut!
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center p-3 bg-[var(--background)] border-l-4 border-[var(--accent)]">
                    <span className="text-[var(--muted)] uppercase text-xs font-bold">Platform</span>
                    <span className="font-black text-lg text-[var(--accent)]">10%</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-[var(--background)] border-l-4 border-[var(--success)]">
                    <span className="text-[var(--muted)] uppercase text-xs font-bold">All Backers</span>
                    <span className="font-black text-lg text-[var(--success)]">90%</span>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3 uppercase tracking-wide">
                  All backers (including creator) share fees proportionally
                </p>
              </div>
            </div>
          )}

          {isLaunched && (
            <div className="relative border-2 border-[var(--success)] bg-[var(--card)] p-6">
              {/* Section Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-8 bg-gradient-to-b from-[var(--success)] to-[var(--accent-gold)]" />
                <h2 className="text-xl font-black uppercase tracking-tight">Victory Statistics</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-xs text-[var(--muted)] uppercase tracking-wide font-bold mb-2">Price</div>
                  <div className="text-2xl font-black">-- SOL</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-xs text-[var(--muted)] uppercase tracking-wide font-bold mb-2">Volume (24h)</div>
                  <div className="text-2xl font-black">-- SOL</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-xs text-[var(--muted)] uppercase tracking-wide font-bold mb-2">Market Cap</div>
                  <div className="text-2xl font-black">--</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-xs text-[var(--muted)] uppercase tracking-wide font-bold mb-2">Curve Progress</div>
                  <div className="text-2xl font-black">--%</div>
                </div>
              </div>
            </div>
          )}

          {/* Token Wallet Actions - shown to backers after launch */}
          {isLaunched && connected && burnerInfo && burnerInfo.burner_wallet && !burnerInfo.swept && (
            <div className="card p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[var(--accent)]/20 flex items-center justify-center">
                  <Key className="w-5 h-5 text-[var(--accent)]" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Your Tokens</h2>
                  <p className="text-sm text-[var(--muted)]">Claim tokens from your token wallet</p>
                </div>
              </div>

              <div className="bg-[var(--background)] rounded-lg p-4 mb-4">
                <p className="text-sm text-[var(--muted)] mb-1">Token Wallet:</p>
                <code className="text-xs break-all">{burnerInfo.burner_wallet}</code>
                {burnerInfo.amount_sol && (
                  <p className="text-sm mt-2">
                    <span className="text-[var(--muted)]">Backed:</span>{' '}
                    <span className="font-medium">{Number(burnerInfo.amount_sol).toFixed(2)} SOL</span>
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSweep('transfer')}
                    disabled={sweeping}
                    className="flex-1 flex items-center justify-center gap-3 p-4 bg-[var(--success)]/10 hover:bg-[var(--success)]/20 border border-[var(--success)]/30 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ArrowUpRight className="w-6 h-6 text-[var(--success)]" />
                    <div className="text-left">
                      <span className="font-medium block">Claim Tokens</span>
                      <span className="text-xs text-[var(--muted)]">Transfer to your main wallet</span>
                    </div>
                  </button>
                  <div className="group relative">
                    <div className="p-3 bg-[var(--background)] hover:bg-[var(--border)] border border-[var(--border)] rounded-lg cursor-help transition-colors">
                      <Info className="w-5 h-5 text-[var(--muted)]" />
                    </div>
                    <div className="absolute bottom-full right-0 mb-2 w-72 p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                      <p className="text-sm text-[var(--foreground)] mb-2 font-medium">After claiming tokens:</p>
                      <p className="text-xs text-[var(--muted)] mb-3">
                        Your tokens may not appear in Phantom or Solflare at first - this is normal for new tokens!
                      </p>
                      <p className="text-sm text-[var(--foreground)] mb-2 font-medium">To sell your tokens:</p>
                      <ol className="text-xs text-[var(--muted)] space-y-1 list-decimal list-inside">
                        <li>Go to pump.fun and connect your wallet</li>
                        <li>Search for this token or use the trade link below</li>
                        <li>Your tokens will appear there - sell from pump.fun</li>
                      </ol>
                    </div>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--border)]"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-[var(--card)] text-[var(--muted)]">or</span>
                  </div>
                </div>

                <button
                  onClick={handleExportPrivateKey}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-[var(--background)] hover:bg-[var(--border)] border border-[var(--border)] rounded-lg transition-colors text-sm"
                >
                  <Key className="w-4 h-4" />
                  <span>Export Private Key</span>
                </button>
              </div>

              {/* Sweep status message */}
              {sweepStatus && (
                <div className={`mt-4 p-3 rounded-lg text-sm text-center ${
                  sweepStatus.includes('Error')
                    ? 'bg-[var(--error)]/20 text-[var(--error)]'
                    : sweepStatus.includes('Sold') || sweepStatus.includes('Transferred')
                    ? 'bg-[var(--success)]/20 text-[var(--success)]'
                    : 'bg-[var(--accent)]/20 text-[var(--accent)]'
                }`}>
                  {sweeping && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
                  {sweepStatus}
                </div>
              )}
            </div>
          )}

          {/* Already swept message */}
          {isLaunched && connected && burnerInfo && burnerInfo.swept && (
            <div className="card p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[var(--success)]/20 flex items-center justify-center">
                  <Check className="w-5 h-5 text-[var(--success)]" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Tokens Claimed</h2>
                  <p className="text-sm text-[var(--muted)]">
                    {burnerInfo.sweep_action === 'sell'
                      ? 'You sold your tokens for SOL'
                      : 'Tokens transferred to your main wallet'}
                  </p>
                </div>
              </div>
              <a
                href={meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 p-3 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white rounded-lg transition-colors font-medium"
              >
                <ExternalLink className="w-4 h-4" />
                Trade on pump.fun
              </a>
            </div>
          )}

          {/* Claim Rewards - shown for live tokens to creators/backers */}
          {isLaunched && (isCreator || isBacker) && (
            <ClaimRewards
              memeId={meme.id}
              isCreator={isCreator}
              isBacker={isBacker}
            />
          )}


          {/* Rules - Revolutionary Doctrine */}
          <div className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6">
            {/* Section Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-8 bg-gradient-to-b from-[var(--accent)] to-[var(--accent-gold)]" />
              <h2 className="text-xl font-black uppercase tracking-tight">Revolutionary Doctrine</h2>
            </div>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3 p-2 bg-[var(--background)] border-l-4 border-[var(--accent)]">
                <span className="text-[var(--accent)] font-bold">★</span>
                <span className="text-[var(--muted)]">Maximum backing per comrade: <span className="text-[var(--foreground)] font-bold">{maxBacking.toFixed(1)} SOL</span> (10% of goal)</span>
              </li>
              <li className="flex items-start gap-3 p-2 bg-[var(--background)] border-l-4 border-[var(--accent)]">
                <span className="text-[var(--accent)] font-bold">★</span>
                <span className="text-[var(--muted)]">Spoils distributed proportional to contribution</span>
              </li>
              <li className="flex items-start gap-3 p-2 bg-[var(--background)] border-l-4 border-[var(--success)]">
                <span className="text-[var(--success)] font-bold">★</span>
                <span className="text-[var(--muted)]">Genesis backers earn <span className="text-[var(--success)] font-bold">90%</span> of all trading fees</span>
              </li>
              <li className="flex items-start gap-3 p-2 bg-[var(--background)] border-l-4 border-[var(--accent)]">
                <span className="text-[var(--accent)] font-bold">★</span>
                <span className="text-[var(--muted)]">Creator = backer: <span className="text-[var(--accent)] font-bold">Equal share</span> (no special cut)</span>
              </li>
              {dev_initial_buy_sol > 0 && (
                <li className="flex items-start gap-3 p-2 bg-[var(--warning)]/10 border-l-4 border-[var(--warning)]">
                  <span className="text-[var(--warning)] font-bold">⚠</span>
                  <span className="text-[var(--muted)]">Dev plans to acquire: <span className="text-[var(--warning)] font-bold">{dev_initial_buy_sol} SOL</span> at launch</span>
                </li>
              )}
              <li className="flex items-start gap-3 p-2 bg-[var(--success)]/10 border-l-4 border-[var(--success)]">
                <span className="text-[var(--success)] font-bold">✓</span>
                <span className="text-[var(--muted)]">Goal not reached? Claim refund from Portfolio</span>
              </li>
              <li className="flex items-start gap-3 p-2 bg-[var(--background)] border-l-4 border-[var(--warning)]">
                <span className="text-[var(--warning)] font-bold">⚠</span>
                <span className="text-[var(--muted)]">Early desertion fee: <span className="text-[var(--warning)] font-bold">2%</span></span>
              </li>
            </ul>
          </div>
        </div>

        {/* Trading Panel - Revolutionary Action */}
        <div className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 h-fit">
          {/* Decorative top banner */}
          <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
            {isProving ? '★ Join the Cause ★' : '★ Trade ★'}
          </div>

          <h2 className="text-xl font-black uppercase tracking-tight mb-4 pt-2">
            {isProving ? 'Back This Revolution' : 'Seize Tokens'}
          </h2>

          {!connected ? (
            <div className="text-center py-8 text-[var(--muted)] border-2 border-dashed border-[var(--border)] uppercase text-sm font-bold tracking-wide">
              Connect wallet to {isProving ? 'join' : 'trade'}
            </div>
          ) : isLaunched ? (
            /* Trading options for launched tokens */
            <div className="space-y-4">
              {burnerInfo && burnerInfo.burner_wallet && !burnerInfo.swept ? (
                /* Backer has tokens to claim */
                <>
                  <div className="bg-[var(--background)] rounded-lg p-4">
                    <p className="text-sm text-[var(--muted)] mb-1">Your token wallet:</p>
                    <code className="text-xs break-all">{burnerInfo.burner_wallet}</code>
                    {burnerInfo.amount_sol && (
                      <p className="text-sm mt-2 font-medium">
                        {Number(burnerInfo.amount_sol).toFixed(2)} SOL backed
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSweep('transfer')}
                      disabled={sweeping}
                      className="flex-1 flex items-center justify-center gap-2 p-3 bg-[var(--success)] hover:bg-[var(--success)]/90 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {sweeping ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                      <span className="font-medium">Claim Tokens</span>
                    </button>
                    <div className="group relative">
                      <div className="p-3 bg-[var(--background)] hover:bg-[var(--border)] border border-[var(--border)] rounded-lg cursor-help transition-colors">
                        <Info className="w-4 h-4 text-[var(--muted)]" />
                      </div>
                      <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                        <p className="text-xs text-[var(--muted)] mb-2">
                          Tokens may not show in Phantom/Solflare at first - this is normal!
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          Go to pump.fun to sell your tokens after claiming.
                        </p>
                      </div>
                    </div>
                  </div>

                  {sweepStatus && (
                    <div className={`p-3 rounded-lg text-sm text-center ${
                      sweepStatus.includes('Error')
                        ? 'bg-[var(--error)]/20 text-[var(--error)]'
                        : sweepStatus.includes('Sold') || sweepStatus.includes('Transferred')
                        ? 'bg-[var(--success)]/20 text-[var(--success)]'
                        : 'bg-[var(--accent)]/20 text-[var(--accent)]'
                    }`}>
                      {sweeping && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
                      {sweepStatus}
                    </div>
                  )}

                  <button
                    onClick={handleExportPrivateKey}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-[var(--background)] hover:bg-[var(--border)] border border-[var(--border)] rounded-lg transition-colors text-sm"
                  >
                    <Key className="w-4 h-4" />
                    Export Private Key
                  </button>
                </>
              ) : burnerInfo?.swept ? (
                /* Tokens already claimed */
                <div className="space-y-3">
                  <div className="text-center py-2">
                    <Check className="w-8 h-8 mx-auto mb-2 text-[var(--success)]" />
                    <p className="text-sm text-[var(--muted)]">
                      Tokens claimed!
                    </p>
                  </div>
                  <a
                    href={meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 p-3 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white rounded-lg transition-colors font-medium"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Trade on pump.fun
                  </a>
                </div>
              ) : (
                /* Not a backer - show trade on pump.fun */
                <div className="text-center py-4">
                  <p className="text-sm text-[var(--muted)] mb-4">
                    Trade this token on pump.fun
                  </p>
                  <a
                    href={meme.pump_fun_url || `https://pump.fun/coin/${meme.mint_address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Trade on pump.fun
                  </a>
                </div>
              )}
            </div>
          ) : (
            /* Backing panel for proving tokens */
            <>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[var(--muted)] mb-2">
                    Amount ({isProving || tradeType === 'buy' ? 'SOL' : symbol})
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.0"
                      min="0"
                      step="0.1"
                      className="w-full px-4 py-3 rounded-lg bg-[var(--background)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-lg"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
                      <button
                        onClick={() => setAmount(String(Number((maxBacking * 0.5).toFixed(4))))}
                        className="text-xs bg-[var(--card)] px-2 py-1 rounded hover:bg-[var(--border)]"
                      >
                        Half
                      </button>
                      <button
                        onClick={() => setAmount(String(maxBacking))}
                        className="text-xs bg-[var(--card)] px-2 py-1 rounded hover:bg-[var(--border)]"
                      >
                        Max
                      </button>
                    </div>
                  </div>
                </div>

                {/* Fee breakdown for backing */}
                {isProving && amount && Number(amount) > 0 && (
                  <div className="bg-[var(--background)] rounded-lg p-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--muted)]">Backing amount</span>
                      <span className="font-medium">{Number(amount).toFixed(4)} SOL</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <div className="flex items-center gap-1">
                        <span className="text-[var(--muted)]">Platform fee (2%)</span>
                        <div className="group relative">
                          <Info className="w-3 h-3 text-[var(--muted)] cursor-help" />
                          <div className="absolute bottom-full left-0 mb-2 w-48 p-2 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 text-xs">
                            This fee supports the platform and is sent to the escrow wallet.
                          </div>
                        </div>
                      </div>
                      <span>{(Number(amount) * 0.02).toFixed(4)} SOL</span>
                    </div>
                    <div className="border-t border-[var(--border)] pt-2 flex justify-between text-sm font-medium">
                      <span>Total</span>
                      <span className="text-[var(--accent)]">{(Number(amount) * 1.02).toFixed(4)} SOL</span>
                    </div>
                  </div>
                )}

                {isLaunched && amount && (
                  <div className="bg-[var(--background)] rounded-lg p-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--muted)]">You receive</span>
                      <span className="font-medium">-- {tradeType === 'buy' ? symbol : 'SOL'}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-2">
                      <span className="text-[var(--muted)]">Fee (1%)</span>
                      <span>{(Number(amount) * 0.01).toFixed(4)}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleTrade}
                  disabled={!amount || Number(amount) <= 0 || backing || (isProving && backingPaused)}
                  className={`w-full py-4 font-black uppercase tracking-wide transition-all border-2 ${
                    isProving
                      ? 'bg-gradient-to-r from-[var(--gradient-start)] to-[var(--gradient-end)] text-white border-[var(--accent)] hover:opacity-90'
                      : tradeType === 'buy'
                      ? 'bg-[var(--success)] hover:bg-[var(--success)]/90 text-white border-[var(--success)]'
                      : 'bg-[var(--error)] hover:bg-[var(--error)]/90 text-white border-[var(--error)]'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {backing ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </span>
                  ) : isProving && backingPaused ? (
                    'Revolution Paused'
                  ) : (
                    isProving ? '★ Join the Revolution ★' : tradeType === 'buy' ? 'Seize Tokens' : 'Liquidate Holdings'
                  )}
                </button>

                {/* Status message */}
                {backingStatus && (
                  <div className={`mt-3 p-3 text-sm text-center font-bold uppercase tracking-wide ${
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
            </>
          )}

          {/* Fee Info */}
          {isProving && (
            <div className="mt-4 p-3 bg-[var(--accent)]/10 border-2 border-[var(--accent)]/30">
              <p className="text-xs text-[var(--muted)] uppercase tracking-wide">
                All backers share <span className="text-[var(--accent)] font-bold">90%</span> of trading fees proportional to contribution
              </p>
            </div>
          )}
        </div>
      </div>

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
