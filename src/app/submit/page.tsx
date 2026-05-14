'use client';

import { useState, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import { Upload, Info, Rocket, AlertCircle, Image, Link2, X, CheckCircle, Coins } from 'lucide-react';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Creation fee in SOL (goes to escrow to cover launch costs like metadata rent)
const CREATION_FEE_SOL = 0.02;

// Validation helpers
const FORBIDDEN_WORDS = ['scam', 'rug', 'rugpull', 'hack', 'steal'];
const URL_PATTERN = /^https?:\/\/[^\s]+$/;
const TWITTER_PATTERN = /^https?:\/\/(x\.com|twitter\.com)\/[^\s]+$/i;
const TELEGRAM_PATTERN = /^https?:\/\/t\.me\/[^\s]+$/i;
const DISCORD_PATTERN = /^https?:\/\/discord\.(gg|com)\/[^\s]+$/i;

interface ValidationErrors {
  name?: string;
  symbol?: string;
  description?: string;
  creatorTwitter?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  discord?: string;
}

function validateName(name: string): string | undefined {
  if (!name.trim()) return 'Name is required';
  if (name.trim().length < 2) return 'Name must be at least 2 characters';
  if (name.trim().length > 32) return 'Name must be 32 characters or less';
  if (FORBIDDEN_WORDS.some(word => name.toLowerCase().includes(word))) {
    return 'Name contains prohibited words';
  }
  if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return 'Name can only contain letters, numbers, spaces, hyphens, and underscores';
  }
  return undefined;
}

function validateSymbol(symbol: string): string | undefined {
  if (!symbol.trim()) return 'Symbol is required';
  if (symbol.trim().length < 2) return 'Symbol must be at least 2 characters';
  if (symbol.trim().length > 10) return 'Symbol must be 10 characters or less';
  if (!/^[A-Za-z0-9]+$/.test(symbol)) {
    return 'Symbol can only contain letters and numbers';
  }
  return undefined;
}

function validateDescription(description: string): string | undefined {
  if (description.length > 500) return 'Description must be 500 characters or less';
  if (FORBIDDEN_WORDS.some(word => description.toLowerCase().includes(word))) {
    return 'Description contains prohibited words';
  }
  return undefined;
}

function validateUrl(url: string, pattern?: RegExp, name?: string): string | undefined {
  if (!url) return undefined; // Optional field
  if (!URL_PATTERN.test(url)) return `Please enter a valid URL starting with http:// or https://`;
  if (pattern && !pattern.test(url)) return `Please enter a valid ${name} URL`;
  return undefined;
}

export default function SubmitPage() {
  const { connected, publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: '',
    totalSlots: 4,        // 2-8 backer slots
    minBackingSol: 0.1,   // Minimum SOL per backer
    creatorTwitter: '', // Creator's personal X account (Proof Launch only)
    twitter: '',
    website: '',
    telegram: '',
    discord: '',
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Validate all fields
  const validateForm = (): boolean => {
    const errors: ValidationErrors = {
      name: validateName(formData.name),
      symbol: validateSymbol(formData.symbol),
      description: validateDescription(formData.description),
      creatorTwitter: validateUrl(formData.creatorTwitter, TWITTER_PATTERN, 'X/Twitter'),
      twitter: validateUrl(formData.twitter, TWITTER_PATTERN, 'X/Twitter'),
      website: validateUrl(formData.website),
      telegram: validateUrl(formData.telegram, TELEGRAM_PATTERN, 'Telegram'),
      discord: validateUrl(formData.discord, DISCORD_PATTERN, 'Discord'),
    };

    // Remove undefined values
    Object.keys(errors).forEach(key => {
      if (errors[key as keyof ValidationErrors] === undefined) {
        delete errors[key as keyof ValidationErrors];
      }
    });

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Validate single field on blur
  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));

    let error: string | undefined;
    switch (field) {
      case 'name':
        error = validateName(formData.name);
        break;
      case 'symbol':
        error = validateSymbol(formData.symbol);
        break;
      case 'description':
        error = validateDescription(formData.description);
        break;
      case 'creatorTwitter':
        error = validateUrl(formData.creatorTwitter, TWITTER_PATTERN, 'X/Twitter');
        break;
      case 'twitter':
        error = validateUrl(formData.twitter, TWITTER_PATTERN, 'X/Twitter');
        break;
      case 'website':
        error = validateUrl(formData.website);
        break;
      case 'telegram':
        error = validateUrl(formData.telegram, TELEGRAM_PATTERN, 'Telegram');
        break;
      case 'discord':
        error = validateUrl(formData.discord, DISCORD_PATTERN, 'Discord');
        break;
    }

    setFieldErrors(prev => ({
      ...prev,
      [field]: error,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !publicKey) return;

    // Mark all fields as touched to show errors
    setTouched({
      name: true,
      symbol: true,
      description: true,
      creatorTwitter: true,
      twitter: true,
      website: true,
      telegram: true,
      discord: true,
    });

    // Validate form
    if (!validateForm()) {
      setError('Please fix the errors above before submitting');
      return;
    }

    // Extra validation before spending SOL - check all required fields
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!formData.symbol.trim()) {
      setError('Symbol is required');
      return;
    }
    if (!formData.description.trim()) {
      setError('Description is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Step 1: Get escrow address for creation fee
      const configRes = await fetch('/api/config');
      if (!configRes.ok) {
        throw new Error('Failed to get platform config');
      }
      const config = await configRes.json();
      const escrowAddress = config.escrow_address;

      if (!escrowAddress) {
        throw new Error('Escrow address not configured');
      }

      // Step 2: Pay the creation fee to the escrow wallet (covers launch costs)
      const creationFeeLamports = CREATION_FEE_SOL * LAMPORTS_PER_SOL;

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(escrowAddress),
          lamports: creationFeeLamports,
        })
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Use signTransaction (not signAndSendTransaction) to avoid
      // Phantom's "may be harmful" warning on unfamiliar addresses
      const signed = await signTransaction!(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      // Confirm the transaction landed
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      // Step 2: Create the meme with the payment signature and burner wallet
      let imageUrl = 'https://placehold.co/400x400/1a1a2e/ffffff?text=' + formData.symbol;

      if (imageFile) {
        // For now, use data URL (not ideal for production)
        imageUrl = imagePreview || imageUrl;
      }

      const response = await fetch('/api/memes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_wallet: publicKey.toBase58(),
          name: formData.name.trim(),
          symbol: formData.symbol.toUpperCase().trim(),
          description: formData.description.trim(),
          image_url: imageUrl,
          creator_twitter: formData.creatorTwitter || undefined,
          twitter: formData.twitter || undefined,
          telegram: formData.telegram || undefined,
          discord: formData.discord || undefined,
          website: formData.website || undefined,
          total_slots: formData.totalSlots,
          min_backing_sol: formData.minBackingSol,
          backing_days: 3, // Fixed 3-day backing period
          // Creation fee payment (goes to escrow for platform costs)
          creation_fee_signature: signature,
          creation_fee_sol: CREATION_FEE_SOL,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit meme');
      }

      const data = await response.json();
      setSuccess(true);

      // Redirect to the meme page after a short delay
      setTimeout(() => {
        router.push(`/meme/${data.meme.id}`);
      }, 2000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Something went wrong';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox'
        ? checked
        : ['totalSlots', 'minBackingSol'].includes(name)
        ? Number(value)
        : value
    }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be under 5MB');
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="border border-[var(--success)] bg-[var(--card)]">
          <div className="border-b border-[var(--success)] px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)]">
              // STATE: SUBMITTED
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--success)] pulse-glow">
              [OK]
            </span>
          </div>
          <div className="p-8 text-center space-y-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
              &gt; OUTPUT
            </div>
            <h2 className="text-2xl font-mono font-semibold uppercase tracking-tight">
              Meme Submitted<span className="cursor-blink" />
            </h2>
            <p className="text-xs font-mono text-[var(--muted)] uppercase tracking-widest">
              Redirecting to meme page…
            </p>
            <div className="w-6 h-6 border-2 border-[var(--accent)]/30 border-t-[var(--accent)] animate-spin mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  // Set to true to pause submissions for maintenance
  const SUBMISSIONS_PAUSED = false;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header — terminal block */}
      <div className="border border-[var(--border)] bg-[var(--card)] mb-6">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // PROOF_LAUNCH.SYS // SUBMIT
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            [INPUT]
          </span>
        </div>
        <div className="p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
            &gt; NEW_MEME
          </div>
          <h1 className="text-2xl sm:text-3xl font-mono font-semibold uppercase tracking-tight">
            Submit a Meme<span className="cursor-blink" />
          </h1>
          <p className="text-xs font-mono text-[var(--muted)] mt-2">
            Configure token · Rally backers · Launch on Pump.fun
          </p>
        </div>
      </div>

      {SUBMISSIONS_PAUSED ? (
        <div className="border border-[var(--warning)] bg-[var(--card)]">
          <div className="border-b border-[var(--warning)] px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
              [!] SUBMISSIONS_PAUSED
            </span>
          </div>
          <div className="p-6">
            <h2 className="text-base font-mono font-semibold uppercase tracking-tight mb-2">Submissions paused</h2>
            <p className="text-xs font-mono text-[var(--muted)]">
              &gt; Temporarily disabled while we upgrade the launch system. Check back soon.
            </p>
          </div>
        </div>
      ) : !connected ? (
        <div className="border border-[var(--warning)] bg-[var(--card)]">
          <div className="border-b border-[var(--warning)] px-4 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
              [!] WALLET_REQUIRED
            </span>
          </div>
          <div className="p-6">
            <h2 className="text-base font-mono font-semibold uppercase tracking-tight mb-2">Wallet required</h2>
            <p className="text-xs font-mono text-[var(--muted)]">
              &gt; Connect your wallet to submit a meme
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Display */}
          {error && (
            <div className="bg-[var(--error)]/10 border-2 border-[var(--error)]/30 p-4">
              <div className="flex gap-3 items-center">
                <AlertCircle className="w-5 h-5 text-[var(--error)]" />
                <p className="text-[var(--error)] font-bold uppercase tracking-wide text-sm">{error}</p>
              </div>
            </div>
          )}

          {/* Basic Info */}
          <div className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                // IDENTITY
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                01
              </span>
            </div>
            <div className="p-6 space-y-4">

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Name *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  onBlur={() => handleBlur('name')}
                  placeholder="e.g., Bonk Dog"
                  maxLength={32}
                  required
                  className={`w-full px-4 py-3 rounded-lg bg-[var(--background)] border focus:outline-none ${
                    touched.name && fieldErrors.name
                      ? 'border-[var(--error)] focus:border-[var(--error)]'
                      : 'border-[var(--border)] focus:border-[var(--accent)]'
                  }`}
                />
                <div className="flex justify-between mt-1">
                  {touched.name && fieldErrors.name ? (
                    <span className="text-xs text-[var(--error)]">{fieldErrors.name}</span>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">Letters, numbers, spaces, hyphens</span>
                  )}
                  <span className="text-xs text-[var(--muted)]">{formData.name.length}/32</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Symbol *</label>
                <input
                  type="text"
                  name="symbol"
                  value={formData.symbol}
                  onChange={handleChange}
                  onBlur={() => handleBlur('symbol')}
                  placeholder="e.g., BONKD"
                  maxLength={10}
                  required
                  className={`w-full px-4 py-3 rounded-lg bg-[var(--background)] border focus:outline-none uppercase ${
                    touched.symbol && fieldErrors.symbol
                      ? 'border-[var(--error)] focus:border-[var(--error)]'
                      : 'border-[var(--border)] focus:border-[var(--accent)]'
                  }`}
                />
                <div className="flex justify-between mt-1">
                  {touched.symbol && fieldErrors.symbol ? (
                    <span className="text-xs text-[var(--error)]">{fieldErrors.symbol}</span>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">Letters and numbers only</span>
                  )}
                  <span className="text-xs text-[var(--muted)]">{formData.symbol.length}/10</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                onBlur={() => handleBlur('description')}
                placeholder="Tell the community about your meme..."
                maxLength={500}
                rows={3}
                className={`w-full px-4 py-3 rounded-lg bg-[var(--background)] border focus:outline-none resize-none ${
                  touched.description && fieldErrors.description
                    ? 'border-[var(--error)] focus:border-[var(--error)]'
                    : 'border-[var(--border)] focus:border-[var(--accent)]'
                }`}
              />
              <div className="flex justify-between mt-1">
                {touched.description && fieldErrors.description ? (
                  <span className="text-xs text-[var(--error)]">{fieldErrors.description}</span>
                ) : (
                  <span className="text-xs text-[var(--muted)]">Describe your meme</span>
                )}
                <span className="text-xs text-[var(--muted)]">{formData.description.length}/500</span>
              </div>
            </div>
            </div>
          </div>

          {/* Image Upload */}
          <div className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                // IMAGE
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                02
              </span>
            </div>
            <div className="p-6 space-y-4">

            <div className="flex gap-4">
              <div className="relative">
                {imagePreview ? (
                  <div className="relative w-32 h-32">
                    <img
                      src={imagePreview}
                      alt="Token preview"
                      className="w-32 h-32 object-cover border-2 border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-[var(--error)] flex items-center justify-center hover:bg-[var(--error)]/80 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-32 h-32 border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors flex flex-col items-center justify-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <Upload className="w-8 h-8" />
                    <span className="text-xs uppercase font-bold">Upload</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>

              <div className="flex-1 text-sm text-[var(--muted)]">
                <p className="mb-2 uppercase tracking-wide font-bold text-xs">Upload your token&apos;s image</p>
                <ul className="space-y-1 text-xs">
                  <li>★ PNG, JPG, GIF, or WebP</li>
                  <li>★ Max 5MB</li>
                  <li>· Square images work best (1:1 ratio)</li>
                </ul>
              </div>
            </div>
            </div>
          </div>

          {/* Creator Info */}
          <div className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
                // CREATOR
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                03
              </span>
            </div>
            <div className="p-6 space-y-4">

            <div>
              <label className="block text-sm font-bold uppercase tracking-wide mb-2">X Profile or Community</label>
              <input
                type="text"
                name="creatorTwitter"
                value={formData.creatorTwitter}
                onChange={handleChange}
                onBlur={() => handleBlur('creatorTwitter')}
                placeholder="https://x.com/profile or https://x.com/i/communities/..."
                className={`w-full px-4 py-3 bg-[var(--background)] border-2 focus:outline-none ${
                  touched.creatorTwitter && fieldErrors.creatorTwitter
                    ? 'border-[var(--error)] focus:border-[var(--error)]'
                    : 'border-[var(--border)] focus:border-[var(--accent)]'
                }`}
              />
              {touched.creatorTwitter && fieldErrors.creatorTwitter && (
                <span className="text-xs text-[var(--error)]">{fieldErrors.creatorTwitter}</span>
              )}
              <span className="text-xs text-[var(--muted)] mt-1 block">
                Displayed on Proof Launch so users can identify you. Not included in token metadata.
              </span>
            </div>
            </div>
          </div>

          {/* Social Links — written to on-chain token metadata */}
          <div className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                // TOKEN METADATA · OPTIONAL
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                04
              </span>
            </div>
            <div className="p-6 space-y-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] -mt-2">
              &gt; Written to the token&apos;s on-chain metadata on Pump.fun
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Token X (Twitter)</label>
                <input
                  type="text"
                  name="twitter"
                  value={formData.twitter}
                  onChange={handleChange}
                  onBlur={() => handleBlur('twitter')}
                  placeholder="https://x.com/..."
                  className={`w-full px-4 py-3 rounded-lg bg-[var(--background)] border focus:outline-none ${
                    touched.twitter && fieldErrors.twitter
                      ? 'border-[var(--error)] focus:border-[var(--error)]'
                      : 'border-[var(--border)] focus:border-[var(--accent)]'
                  }`}
                />
                {touched.twitter && fieldErrors.twitter && (
                  <span className="text-xs text-[var(--error)]">{fieldErrors.twitter}</span>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Website</label>
                <input
                  type="text"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  onBlur={() => handleBlur('website')}
                  placeholder="https://..."
                  className={`w-full px-4 py-3 rounded-lg bg-[var(--background)] border focus:outline-none ${
                    touched.website && fieldErrors.website
                      ? 'border-[var(--error)] focus:border-[var(--error)]'
                      : 'border-[var(--border)] focus:border-[var(--accent)]'
                  }`}
                />
                {touched.website && fieldErrors.website && (
                  <span className="text-xs text-[var(--error)]">{fieldErrors.website}</span>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Telegram</label>
                <input
                  type="text"
                  name="telegram"
                  value={formData.telegram}
                  onChange={handleChange}
                  onBlur={() => handleBlur('telegram')}
                  placeholder="https://t.me/..."
                  className={`w-full px-4 py-3 rounded-lg bg-[var(--background)] border focus:outline-none ${
                    touched.telegram && fieldErrors.telegram
                      ? 'border-[var(--error)] focus:border-[var(--error)]'
                      : 'border-[var(--border)] focus:border-[var(--accent)]'
                  }`}
                />
                {touched.telegram && fieldErrors.telegram && (
                  <span className="text-xs text-[var(--error)]">{fieldErrors.telegram}</span>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Discord</label>
                <input
                  type="text"
                  name="discord"
                  value={formData.discord}
                  onChange={handleChange}
                  onBlur={() => handleBlur('discord')}
                  placeholder="https://discord.gg/..."
                  className={`w-full px-4 py-3 rounded-lg bg-[var(--background)] border focus:outline-none ${
                    touched.discord && fieldErrors.discord
                      ? 'border-[var(--error)] focus:border-[var(--error)]'
                      : 'border-[var(--border)] focus:border-[var(--accent)]'
                  }`}
                />
                {touched.discord && fieldErrors.discord && (
                  <span className="text-xs text-[var(--error)]">{fieldErrors.discord}</span>
                )}
              </div>
            </div>
            </div>
          </div>

          {/* Backer Slots */}
          <div className="border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                // BACKING_CONFIG
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                05
              </span>
            </div>
            <div className="p-6 space-y-4">

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold uppercase tracking-wide mb-2">Number of Slots *</label>
                <select
                  name="totalSlots"
                  value={formData.totalSlots}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-[var(--background)] border-2 border-[var(--border)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value={2}>2 slots (2 Genesis)</option>
                  <option value={3}>3 slots (3 Genesis)</option>
                  <option value={4}>4 slots (4 Genesis)</option>
                  <option value={5}>5 slots (4 Genesis + 1 Wave 2)</option>
                  <option value={6}>6 slots (4 Genesis + 2 Wave 2)</option>
                  <option value={7}>7 slots (4 Genesis + 3 Wave 2)</option>
                  <option value={8}>8 slots (4 Genesis + 4 Wave 2)</option>
                </select>
                <span className="text-xs text-[var(--muted)]">Token launches when all slots are filled</span>
              </div>
              <div>
                <label className="block text-sm font-bold uppercase tracking-wide mb-2">Minimum Backing *</label>
                <select
                  name="minBackingSol"
                  value={formData.minBackingSol}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-[var(--background)] border-2 border-[var(--border)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value={0.1}>0.1 SOL minimum</option>
                  <option value={0.25}>0.25 SOL minimum</option>
                  <option value={0.5}>0.5 SOL minimum</option>
                  <option value={1}>1 SOL minimum</option>
                  <option value={2}>2 SOL minimum</option>
                  <option value={5}>5 SOL minimum</option>
                </select>
                <span className="text-xs text-[var(--muted)]">Each backer must contribute at least this amount</span>
              </div>
            </div>

            {/* Slot Preview */}
            <div className="mt-4 p-4 bg-[var(--background)] border border-[var(--border)]">
              <div className="text-sm font-bold uppercase tracking-wide mb-3">Launch Preview</div>
              <div className="flex gap-2 flex-wrap mb-3">
                {Array.from({ length: formData.totalSlots }).map((_, i) => {
                  const isGenesis = i < 4;
                  return (
                    <div
                      key={i}
                      className={`w-10 h-10 flex items-center justify-center text-xs font-bold border-2 ${
                        isGenesis
                          ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
                          : 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      }`}
                    >
                      {i + 1}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-[var(--accent-gold)]/20 border border-[var(--accent-gold)]" />
                  <span className="text-[var(--muted)]">Genesis (first to buy)</span>
                </div>
                {formData.totalSlots > 4 && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-[var(--accent)]/20 border border-[var(--accent)]" />
                    <span className="text-[var(--muted)]">Wave 2 (fast follow-up)</span>
                  </div>
                )}
              </div>
              <div className="mt-3 text-sm text-[var(--muted)]">
                Minimum raise: <span className="font-bold text-[var(--foreground)]">{(formData.totalSlots * formData.minBackingSol).toFixed(2)} SOL</span>
                <span className="text-xs ml-2">(if everyone backs minimum)</span>
              </div>
            </div>
            </div>
          </div>

          {/* Creation Fee Info */}
          <div className="border border-[var(--warning)] bg-[var(--card)]">
            <div className="border-b border-[var(--warning)] px-4 py-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--warning)]">
                // CREATION_FEE · {CREATION_FEE_SOL} SOL
              </span>
            </div>
            <div className="p-4 text-xs font-mono text-[var(--muted)] leading-relaxed">
              <p>&gt; A small fee covers token creation on Pump.fun. To receive tokens at launch, you must also back your own meme separately.</p>
            </div>
          </div>

          {/* Info Box */}
          <div className="border border-[var(--accent)] bg-[var(--card)]">
            <div className="border-b border-[var(--accent)] px-4 py-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                // HOW_LAUNCH_WORKS
              </span>
            </div>
            <div className="p-4">
              <div className="text-xs font-mono text-[var(--muted)] leading-relaxed space-y-2">
                <p>&gt; Once all backer slots are filled, the token launches on Pump.fun.</p>
                <p>&gt; <strong className="text-[var(--accent-gold)]">GENESIS</strong> backers (slots 1-4) buy first at the best prices on the bonding curve.</p>
                <p>&gt; <strong className="text-[var(--accent)]">WAVE 2</strong> backers (slots 5-8) buy immediately after.</p>
                <p>&gt; 3-day deadline. If slots don&apos;t fill, backers get refunds.</p>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !formData.name || !formData.symbol || Object.keys(fieldErrors).some(k => fieldErrors[k as keyof ValidationErrors])}
            className="btn-primary w-full text-base py-4"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-[#0a0a0a]/30 border-t-[#0a0a0a] animate-spin" />
                Submitting…
              </span>
            ) : (
              <>[▶] Pay {CREATION_FEE_SOL} SOL & Submit</>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
