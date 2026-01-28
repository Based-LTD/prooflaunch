import { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import type { Meme, Backing, MemeWithBackings } from '@/types/database';

interface PlatformConfig {
  escrow_address: string;
  escrow_balance_sol: number;
  platform_fee_bps: number;
  min_backing_sol: number;
  submission_fee_sol: number;
}

export function useProofOfMeme() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch platform config
  const getConfig = useCallback(async (): Promise<PlatformConfig> => {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Failed to fetch config');
    return response.json();
  }, []);

  // Fetch all memes
  const getMemes = useCallback(async (filters?: {
    status?: string;
    creator?: string;
    limit?: number;
    offset?: number;
  }): Promise<Meme[]> => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.creator) params.set('creator', filters.creator);
    if (filters?.limit) params.set('limit', filters.limit.toString());
    if (filters?.offset) params.set('offset', filters.offset.toString());

    const response = await fetch(`/api/memes?${params}`);
    if (!response.ok) throw new Error('Failed to fetch memes');
    const data = await response.json();
    return data.memes;
  }, []);

  // Fetch single meme with backings
  const getMeme = useCallback(async (id: string): Promise<MemeWithBackings> => {
    const response = await fetch(`/api/memes/${id}`);
    if (!response.ok) throw new Error('Failed to fetch meme');
    const data = await response.json();
    return data.meme;
  }, []);

  // Submit a new meme
  const submitMeme = useCallback(async (params: {
    name: string;
    symbol: string;
    description: string;
    image_url: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
    website?: string;
    backing_goal_sol: number;
    backing_days?: number;
  }): Promise<Meme> => {
    if (!publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/memes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          creator_wallet: publicKey.toBase58(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit meme');
      }

      const data = await response.json();
      return data.meme;
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  // Back a meme (send SOL to escrow)
  const backMeme = useCallback(async (
    memeId: string,
    amountSol: number
  ): Promise<Backing> => {
    if (!publicKey || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    setLoading(true);
    setError(null);

    try {
      // Get escrow address
      const config = await getConfig();
      const escrowPubkey = new PublicKey(config.escrow_address);

      // Create transfer transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: escrowPubkey,
          lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
        })
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const signature = await connection.sendRawTransaction(signedTx.serialize());

      // Confirm transaction
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      // Register backing with API
      const response = await fetch('/api/backings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: memeId,
          backer_wallet: publicKey.toBase58(),
          amount_sol: amountSol,
          deposit_tx: signature,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to register backing');
      }

      const data = await response.json();
      return data.backing;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to back meme';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [publicKey, signTransaction, connection, getConfig]);

  // Get user's backings
  const getMyBackings = useCallback(async (): Promise<Backing[]> => {
    if (!publicKey) return [];

    const response = await fetch(`/api/backings?backer=${publicKey.toBase58()}`);
    if (!response.ok) throw new Error('Failed to fetch backings');
    const data = await response.json();
    return data.backings;
  }, [publicKey]);

  // Launch a funded meme (admin only in production)
  const launchMeme = useCallback(async (memeId: string): Promise<{
    mint_address: string;
    pump_fun_url: string;
    signature: string;
  }> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meme_id: memeId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to launch meme');
      }

      return response.json();
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    // State
    loading,
    error,
    connected: !!publicKey,
    wallet: publicKey?.toBase58(),

    // Methods
    getConfig,
    getMemes,
    getMeme,
    submitMeme,
    backMeme,
    getMyBackings,
    launchMeme,
  };
}
