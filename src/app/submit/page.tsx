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
    creatorTwitter: '', // Creator's personal X account (Commie Launch only)
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
        <div className="relative border-2 border-[var(--success)] bg-[var(--card)] p-8 text-center">
          {/* Victory Banner */}
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-6 py-1 bg-[var(--success)] text-white text-xs font-bold uppercase tracking-wider">
            ★ Victory ★
          </div>
          <div className="w-20 h-20 mx-auto bg-[var(--success)]/20 flex items-center justify-center border-2 border-[var(--success)] mb-4">
            <span className="text-4xl">★</span>
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tight mb-2">Revolution Initiated!</h2>
          <p className="text-[var(--muted)] mb-4 uppercase tracking-wide">
            The people await. Redirecting to your movement...
          </p>
          <div className="w-8 h-8 border-2 border-[var(--accent)]/30 border-t-[var(--accent)] animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // Set to true to pause submissions for maintenance
  const SUBMISSIONS_PAUSED = false;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Propaganda-style Header */}
      <div className="relative text-center mb-8 py-6">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
        <h1 className="text-4xl font-black uppercase tracking-tight mb-2">
          <span className="gradient-text">Start a Revolution</span>
        </h1>
        <p className="text-[var(--muted)] uppercase tracking-wide text-sm">
          Submit your meme • Rally the comrades • Seize the market
        </p>
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
      </div>

      {SUBMISSIONS_PAUSED ? (
        <div className="relative border-2 border-[var(--warning)] bg-[var(--card)] p-8 text-center">
          <div className="w-16 h-16 mx-auto bg-[var(--warning)]/20 flex items-center justify-center border-2 border-[var(--warning)] mb-4">
            <AlertCircle className="w-8 h-8 text-[var(--warning)]" />
          </div>
          <h2 className="text-xl font-black uppercase tracking-tight mb-2">Revolution Temporarily Paused</h2>
          <p className="text-[var(--muted)] uppercase tracking-wide text-sm">
            Submissions are temporarily disabled while we upgrade the launch system. Check back soon, comrade.
          </p>
        </div>
      ) : !connected ? (
        <div className="relative border-2 border-[var(--warning)] bg-[var(--card)] p-8 text-center">
          <div className="w-16 h-16 mx-auto bg-[var(--warning)]/20 flex items-center justify-center border-2 border-[var(--warning)] mb-4">
            <AlertCircle className="w-8 h-8 text-[var(--warning)]" />
          </div>
          <h2 className="text-xl font-black uppercase tracking-tight mb-2">Comrade Identification Required</h2>
          <p className="text-[var(--muted)] uppercase tracking-wide text-sm">
            Connect your wallet to join the revolution
          </p>
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
          <div className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
              ★ Identity
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2 pt-2">
              <Rocket className="w-5 h-5 text-[var(--accent)]" />
              Meme Identity
            </h2>

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

          {/* Image Upload */}
          <div className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
              ★ Propaganda
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2 pt-2">
              <Image className="w-5 h-5 text-[var(--accent)]" />
              Revolutionary Image
            </h2>

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
                  <li>★ Square images work best (1:1 ratio)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Creator Info */}
          <div className="relative border-2 border-[var(--accent-gold)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent-gold)] text-black text-xs font-bold uppercase tracking-wider">
              ★ Comrade ID
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2 pt-2">
              <Link2 className="w-5 h-5 text-[var(--accent-gold)]" />
              Creator Identity
            </h2>

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
                Displayed on Commie Launch so users can identify you. Not included in token metadata.
              </span>
            </div>
          </div>

          {/* Social Links */}
          <div className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
              ★ Channels
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2 pt-2">
              <Link2 className="w-5 h-5 text-[var(--accent)]" />
              Communication Channels
              <span className="text-xs font-normal text-[var(--muted)]">(optional)</span>
            </h2>

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

          {/* Backer Slots */}
          <div className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
              ★ The Collective
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2 pt-2">
              <Upload className="w-5 h-5 text-[var(--accent)]" />
              Backer Slots
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold uppercase tracking-wide mb-2">Number of Slots *</label>
                <select
                  name="totalSlots"
                  value={formData.totalSlots}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-[var(--background)] border-2 border-[var(--border)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value={2}>2 slots (2 Bourgeoisie)</option>
                  <option value={3}>3 slots (3 Bourgeoisie)</option>
                  <option value={4}>4 slots (4 Bourgeoisie)</option>
                  <option value={5}>5 slots (4 Bourgeoisie + 1 Proletariat)</option>
                  <option value={6}>6 slots (4 Bourgeoisie + 2 Proletariat)</option>
                  <option value={7}>7 slots (4 Bourgeoisie + 3 Proletariat)</option>
                  <option value={8}>8 slots (4 Bourgeoisie + 4 Proletariat)</option>
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
                  const isBourgeoisie = i < 4;
                  return (
                    <div
                      key={i}
                      className={`w-10 h-10 flex items-center justify-center text-xs font-bold border-2 ${
                        isBourgeoisie
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
                  <span className="text-[var(--muted)]">Bourgeoisie (first to buy)</span>
                </div>
                {formData.totalSlots > 4 && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-[var(--accent)]/20 border border-[var(--accent)]" />
                    <span className="text-[var(--muted)]">Proletariat (fast follow-up)</span>
                  </div>
                )}
              </div>
              <div className="mt-3 text-sm text-[var(--muted)]">
                Minimum raise: <span className="font-bold text-[var(--foreground)]">{(formData.totalSlots * formData.minBackingSol).toFixed(2)} SOL</span>
                <span className="text-xs ml-2">(if everyone backs minimum)</span>
              </div>
            </div>
          </div>

          {/* Creation Fee Info */}
          <div className="border-2 border-[var(--warning)]/30 p-4">
            <div className="flex gap-3">
              <Coins className="w-6 h-6 text-[var(--warning)] flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-[var(--warning)] mb-1 uppercase tracking-wide">Revolutionary Tax: {CREATION_FEE_SOL} SOL</p>
                <p className="text-[var(--foreground)]/80">
                  A small fee covers token creation on Pump.fun.
                  To receive tokens at launch, you must also back your own meme separately.
                </p>
                <p className="text-[var(--muted)] mt-2 text-xs">
                  Phantom may show a &quot;This transaction may be harmful&quot; warning — this is a false positive.
                  Our escrow address is new and hasn&apos;t been allowlisted with Phantom&apos;s security provider yet.
                  It is safe to proceed.
                </p>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="border-2 border-[var(--accent)]/30 p-4">
            <div className="flex gap-3">
              <Info className="w-6 h-6 text-[var(--accent)] flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-[var(--accent)] mb-1 uppercase tracking-wide">The Path to Victory</p>
                <p className="text-[var(--foreground)]/80">
                  Once all backer slots are filled, the token launches on Pump.fun.
                  <strong> Bourgeoisie</strong> backers (slots 1-4) buy first at the best prices on the bonding curve.
                  <strong> Proletariat</strong> backers (slots 5-8) buy immediately after.
                  3-day deadline. If slots don&apos;t fill, backers get refunds.
                </p>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !formData.name || !formData.symbol || Object.keys(fieldErrors).some(k => fieldErrors[k as keyof ValidationErrors])}
            className="w-full py-4 font-black uppercase tracking-wide text-lg bg-gradient-to-r from-[var(--gradient-start)] to-[var(--gradient-end)] text-white border-2 border-[var(--accent)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white animate-spin" />
                Processing Contribution...
              </>
            ) : (
              <>
                <span className="text-xl">★</span>
                Pay {CREATION_FEE_SOL} SOL & Start Revolution
                <span className="text-xl">★</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
