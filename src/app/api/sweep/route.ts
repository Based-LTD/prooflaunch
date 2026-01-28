import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { sweepBurnerWallet } from '@/services/pumpfun';

// POST /api/sweep - Sweep tokens from burner wallet to main wallet
// Actions: "sell" (sell tokens, send SOL to main) or "transfer" (transfer tokens to main)
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { meme_id, backer_wallet, action } = body;

    // Validation
    if (!meme_id || !backer_wallet) {
      return NextResponse.json(
        { error: 'Missing required fields: meme_id, backer_wallet' },
        { status: 400 }
      );
    }

    if (!action || !['sell', 'transfer'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "sell" or "transfer"' },
        { status: 400 }
      );
    }

    // Get the meme to verify it's launched
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('*')
      .eq('id', meme_id)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    if (meme.status !== 'live') {
      return NextResponse.json(
        { error: 'Token must be launched before sweeping' },
        { status: 400 }
      );
    }

    if (!meme.mint_address) {
      return NextResponse.json(
        { error: 'Token mint address not found' },
        { status: 400 }
      );
    }

    // Get the backing record with burner wallet info
    const { data: backing, error: backingError } = await supabase
      .from('backings')
      .select('*')
      .eq('meme_id', meme_id)
      .eq('backer_wallet', backer_wallet)
      .single();

    if (backingError || !backing) {
      return NextResponse.json(
        { error: 'Backing not found for this wallet' },
        { status: 404 }
      );
    }

    if (!backing.burner_wallet || !backing.encrypted_private_key) {
      return NextResponse.json(
        { error: 'No burner wallet found for this backing' },
        { status: 400 }
      );
    }

    if (!backing.burner_buy_executed) {
      return NextResponse.json(
        { error: 'Burner wallet buy not yet executed' },
        { status: 400 }
      );
    }

    // Execute the sweep
    const result = await sweepBurnerWallet(
      meme.mint_address,
      backing.encrypted_private_key,
      backing.burner_wallet,
      backer_wallet,
      action as 'sell' | 'transfer'
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Sweep failed' },
        { status: 500 }
      );
    }

    // Update backing record to mark as swept
    await supabase
      .from('backings')
      .update({
        swept: true,
        sweep_action: action,
        sweep_signature: result.signature,
        swept_at: new Date().toISOString(),
      })
      .eq('id', backing.id);

    return NextResponse.json({
      success: true,
      action,
      signature: result.signature,
      amount: result.amount,
      message: action === 'sell'
        ? `Sold tokens for ${result.amount} SOL`
        : `Transferred ${result.amount} tokens to your wallet`,
    });
  } catch (error) {
    console.error('Sweep error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/sweep - Get burner wallet info for a backer (only after launch)
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const memeId = searchParams.get('meme_id');
    const backerWallet = searchParams.get('backer_wallet');

    if (!memeId || !backerWallet) {
      return NextResponse.json(
        { error: 'Missing meme_id or backer_wallet' },
        { status: 400 }
      );
    }

    // SECURITY: Check if meme is launched before revealing burner wallet info
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('status')
      .eq('id', memeId)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    if (meme.status !== 'live') {
      return NextResponse.json(
        { error: 'Burner wallet info only available after launch' },
        { status: 403 }
      );
    }

    // Get backing with burner info
    const { data: backing, error: backingError } = await supabase
      .from('backings')
      .select('burner_wallet, burner_buy_executed, swept, sweep_action, amount_sol')
      .eq('meme_id', memeId)
      .eq('backer_wallet', backerWallet)
      .single();

    if (backingError || !backing) {
      return NextResponse.json(
        { error: 'Backing not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      burner_wallet: backing.burner_wallet,
      buy_executed: backing.burner_buy_executed,
      swept: backing.swept || false,
      sweep_action: backing.sweep_action,
      amount_sol: backing.amount_sol,
    });
  } catch (error) {
    console.error('Get sweep info error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
