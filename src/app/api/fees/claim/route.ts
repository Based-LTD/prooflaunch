import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const ESCROW_PRIVATE_KEY = process.env.ESCROW_WALLET_PRIVATE_KEY!;

function getEscrowWallet(): Keypair {
  const secretKey = bs58.decode(ESCROW_PRIVATE_KEY);
  return Keypair.fromSecretKey(secretKey);
}

// POST to claim rewards
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_address, meme_id } = body;

    if (!wallet_address) {
      return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Get all claimable fees for this wallet
    let totalClaimable = 0;
    const claimSources: Array<{ type: 'backer' | 'creator'; id: string; amount: number }> = [];

    // Check backer rewards
    const backingsQuery = supabase
      .from('backings')
      .select('id, meme_id, claimable_fees_sol')
      .eq('backer_wallet', wallet_address)
      .gt('claimable_fees_sol', 0);

    if (meme_id) {
      backingsQuery.eq('meme_id', meme_id);
    }

    const { data: backings } = await backingsQuery;

    if (backings) {
      for (const backing of backings) {
        const amount = Number(backing.claimable_fees_sol);
        if (amount > 0) {
          totalClaimable += amount;
          claimSources.push({ type: 'backer', id: backing.id, amount });
        }
      }
    }

    // Check creator rewards (if this wallet is a creator)
    const creatorQuery = supabase
      .from('memes')
      .select('id, creator_claimable_fees_sol')
      .eq('creator_wallet', wallet_address)
      .gt('creator_claimable_fees_sol', 0);

    if (meme_id) {
      creatorQuery.eq('id', meme_id);
    }

    const { data: creatorMemes } = await creatorQuery;

    if (creatorMemes) {
      for (const meme of creatorMemes) {
        const amount = Number(meme.creator_claimable_fees_sol);
        if (amount > 0) {
          totalClaimable += amount;
          claimSources.push({ type: 'creator', id: meme.id, amount });
        }
      }
    }

    if (totalClaimable <= 0) {
      return NextResponse.json({ error: 'No rewards to claim' }, { status: 400 });
    }

    // Minimum claim amount (to cover tx fees)
    const MIN_CLAIM = 0.001; // 0.001 SOL
    if (totalClaimable < MIN_CLAIM) {
      return NextResponse.json(
        { error: `Minimum claim amount is ${MIN_CLAIM} SOL. Current: ${totalClaimable.toFixed(6)} SOL` },
        { status: 400 }
      );
    }

    // Create claim record
    const { data: claim, error: claimError } = await supabase
      .from('fee_claims')
      .insert({
        meme_id: meme_id || null,
        wallet_address,
        amount_sol: totalClaimable,
        status: 'processing',
      })
      .select()
      .single();

    if (claimError) {
      throw new Error(`Failed to create claim: ${claimError.message}`);
    }

    // Send SOL from escrow to claimer
    const connection = new Connection(RPC_URL, 'confirmed');
    const escrowWallet = getEscrowWallet();
    const recipientPubkey = new PublicKey(wallet_address);

    // Deduct small fee for transaction cost
    const TX_FEE = 0.000005; // ~5000 lamports
    const amountToSend = totalClaimable - TX_FEE;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrowWallet.publicKey,
        toPubkey: recipientPubkey,
        lamports: Math.floor(amountToSend * LAMPORTS_PER_SOL),
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = escrowWallet.publicKey;

    const signature = await connection.sendTransaction(transaction, [escrowWallet]);

    // Update claim record with signature
    await supabase
      .from('fee_claims')
      .update({
        claim_tx: signature,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', claim.id);

    // Zero out the claimed amounts
    for (const source of claimSources) {
      if (source.type === 'backer') {
        const { data: currentBacking } = await supabase
          .from('backings')
          .select('total_claimed_sol')
          .eq('id', source.id)
          .single();

        await supabase
          .from('backings')
          .update({
            claimable_fees_sol: 0,
            total_claimed_sol: (Number(currentBacking?.total_claimed_sol) || 0) + source.amount,
          })
          .eq('id', source.id);
      } else {
        const { data: currentMeme } = await supabase
          .from('memes')
          .select('creator_total_claimed_sol')
          .eq('id', source.id)
          .single();

        await supabase
          .from('memes')
          .update({
            creator_claimable_fees_sol: 0,
            creator_total_claimed_sol: (Number(currentMeme?.creator_total_claimed_sol) || 0) + source.amount,
          })
          .eq('id', source.id);
      }
    }

    return NextResponse.json({
      success: true,
      amount_claimed: totalClaimable,
      amount_sent: amountToSend,
      tx_signature: signature,
      claim_id: claim.id,
    });
  } catch (error) {
    console.error('Claim error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Claim failed' },
      { status: 500 }
    );
  }
}

// GET to check claimable rewards for a wallet
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    const memeId = searchParams.get('meme_id');

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet parameter required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Get backer rewards
    const backingsQuery = supabase
      .from('backings')
      .select(`
        id,
        meme_id,
        amount_sol,
        claimable_fees_sol,
        total_claimed_sol,
        memes (
          name,
          symbol,
          mint_address,
          backer_share_pct
        )
      `)
      .eq('backer_wallet', wallet)
      .eq('status', 'distributed');

    if (memeId) {
      backingsQuery.eq('meme_id', memeId);
    }

    const { data: backings } = await backingsQuery;

    // Get creator rewards
    const creatorQuery = supabase
      .from('memes')
      .select('id, name, symbol, creator_claimable_fees_sol, creator_total_claimed_sol, creator_fee_pct')
      .eq('creator_wallet', wallet)
      .eq('status', 'live');

    if (memeId) {
      creatorQuery.eq('id', memeId);
    }

    const { data: creatorMemes } = await creatorQuery;

    // Calculate totals
    const backerClaimable = backings?.reduce((sum, b) => sum + Number(b.claimable_fees_sol || 0), 0) || 0;
    const backerClaimed = backings?.reduce((sum, b) => sum + Number(b.total_claimed_sol || 0), 0) || 0;
    const creatorClaimable = creatorMemes?.reduce((sum, m) => sum + Number(m.creator_claimable_fees_sol || 0), 0) || 0;
    const creatorClaimed = creatorMemes?.reduce((sum, m) => sum + Number(m.creator_total_claimed_sol || 0), 0) || 0;

    return NextResponse.json({
      wallet,
      backer_rewards: {
        claimable: backerClaimable,
        total_claimed: backerClaimed,
        tokens: backings?.map((b) => ({
          meme_id: b.meme_id,
          name: (b.memes as any)?.name,
          symbol: (b.memes as any)?.symbol,
          backing_amount: b.amount_sol,
          claimable: Number(b.claimable_fees_sol || 0),
          claimed: Number(b.total_claimed_sol || 0),
        })) || [],
      },
      creator_rewards: {
        claimable: creatorClaimable,
        total_claimed: creatorClaimed,
        tokens: creatorMemes?.map((m) => ({
          meme_id: m.id,
          name: m.name,
          symbol: m.symbol,
          claimable: Number(m.creator_claimable_fees_sol || 0),
          claimed: Number(m.creator_total_claimed_sol || 0),
        })) || [],
      },
      total_claimable: backerClaimable + creatorClaimable,
      total_claimed: backerClaimed + creatorClaimed,
    });
  } catch (error) {
    console.error('Get rewards error:', error);
    return NextResponse.json(
      { error: 'Failed to get rewards' },
      { status: 500 }
    );
  }
}
