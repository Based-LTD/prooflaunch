import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { launchWithBurnerWallets, LaunchConfig, BurnerBackerInfo } from '@/services/pumpfun';
import { rateLimiters } from '@/lib/rateLimit';

// POST /api/launch - Launch a funded meme token with burner wallet flow
// Creates token with 0 dev buy, then executes buys from each backer's burner wallet
// Earlier backers get better prices (lower on bonding curve) - rewards early conviction!
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { meme_id, caller_wallet } = body;

    if (!meme_id) {
      return NextResponse.json(
        { error: 'Missing meme_id' },
        { status: 400 }
      );
    }

    // Rate limiting - 2 launch attempts per minute per meme
    const rateLimitResult = rateLimiters.launch(meme_id);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Launch already in progress. Please wait.' },
        { status: 429 }
      );
    }

    // Get meme
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('*')
      .eq('id', meme_id)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // Verify caller is the creator (if caller_wallet provided)
    if (caller_wallet && caller_wallet !== meme.creator_wallet) {
      return NextResponse.json(
        { error: 'Only the creator can launch this token' },
        { status: 403 }
      );
    }

    // Check if meme is ready to launch
    if (meme.status !== 'funded') {
      return NextResponse.json(
        { error: `Meme is not ready to launch (status: ${meme.status}, need: funded)` },
        { status: 400 }
      );
    }

    // Get all backers for this meme with burner wallet info
    const { data: backings, error: backingsError } = await supabase
      .from('backings')
      .select('backer_wallet, amount_sol, created_at, burner_wallet, encrypted_private_key')
      .eq('meme_id', meme_id)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: true }); // Earliest backers first

    if (backingsError || !backings || backings.length === 0) {
      return NextResponse.json(
        { error: 'No confirmed backings found for this meme' },
        { status: 400 }
      );
    }

    // Check that all backings have burner wallets
    const backingsWithBurners = backings.filter(b => b.burner_wallet && b.encrypted_private_key);
    if (backingsWithBurners.length === 0) {
      return NextResponse.json(
        { error: 'No backings with burner wallets found. Backings may be from old system.' },
        { status: 400 }
      );
    }

    // Update status to launching
    await supabase
      .from('memes')
      .update({ status: 'launching' })
      .eq('id', meme_id);

    // Prepare launch config
    const config: LaunchConfig = {
      name: meme.name,
      symbol: meme.symbol,
      description: meme.description,
      imageUrl: meme.image_url,
      twitter: meme.twitter,
      telegram: meme.telegram,
      discord: meme.discord,
      website: meme.website,
      totalBackingSol: meme.current_backing_sol,
      creatorWallet: meme.creator_wallet,
    };

    // Map backings to BurnerBackerInfo format
    const burnerBackers: BurnerBackerInfo[] = backingsWithBurners.map((b) => ({
      mainWallet: b.backer_wallet,
      burnerWallet: b.burner_wallet,
      encryptedPrivateKey: b.encrypted_private_key,
      amountSol: Number(b.amount_sol),
      backedAt: new Date(b.created_at),
    }));

    console.log(`Launching ${config.name} with ${burnerBackers.length} burner wallets...`);
    console.log('Burner wallets will buy in order of backing time (earliest first = best price)');

    // Launch with the burner wallet flow
    const result = await launchWithBurnerWallets(config, burnerBackers);

    if (!result.success || !result.mintAddress) {
      // Revert status on failure
      await supabase
        .from('memes')
        .update({ status: 'funded' })
        .eq('id', meme_id);

      console.error('Launch failed:', result.error);
      console.error('Buy results:', JSON.stringify(result.buyResults, null, 2));

      return NextResponse.json(
        {
          error: result.error || 'Launch failed',
          buyResults: result.buyResults,
        },
        { status: 500 }
      );
    }

    // Update meme with launch info
    await supabase
      .from('memes')
      .update({
        status: 'live',
        mint_address: result.mintAddress,
        pump_fun_url: result.pumpFunUrl,
        launched_at: new Date().toISOString(),
      })
      .eq('id', meme_id);

    // Update creator's successful launches count
    await supabase.rpc('increment_successful_launches', {
      wallet: meme.creator_wallet,
    });

    // Update backing records with buy results
    for (const buyResult of result.buyResults) {
      // Update if buy was successful (has signature) OR if tokens were received
      // Also consider it successful if there was no error (some buys succeed without returning signature)
      const hasSignature = !!buyResult.buySignature;
      const hasTokens = (buyResult.tokensReceived || 0) > 0;
      const noError = !buyResult.error;
      const wasSuccessful = hasSignature || hasTokens || noError;

      console.log(`Updating backing for ${buyResult.mainWallet}:`, {
        hasSignature,
        hasTokens,
        noError,
        wasSuccessful,
        buySignature: buyResult.buySignature,
        tokensReceived: buyResult.tokensReceived,
        error: buyResult.error,
      });

      const updateResult = await supabase
        .from('backings')
        .update({
          status: wasSuccessful ? 'distributed' : 'confirmed',
          tokens_received: buyResult.tokensReceived || 0,
          burner_buy_executed: wasSuccessful,
          burner_buy_signature: buyResult.buySignature || null,
        })
        .eq('meme_id', meme_id)
        .eq('backer_wallet', buyResult.mainWallet)
        .select();

      if (updateResult.error) {
        console.error(`Failed to update backing for ${buyResult.mainWallet}:`, updateResult.error);
      } else {
        const rowsUpdated = updateResult.data?.length || 0;
        console.log(`Updated backing for ${buyResult.mainWallet}: ${rowsUpdated} rows affected`);
        if (rowsUpdated === 0) {
          console.error(`WARNING: No rows updated! meme_id=${meme_id}, backer_wallet=${buyResult.mainWallet}`);
          // Debug: check what backings exist for this meme
          const { data: existingBackings } = await supabase
            .from('backings')
            .select('backer_wallet, status')
            .eq('meme_id', meme_id);
          console.log('Existing backings for this meme:', existingBackings);
        }
      }
    }

    const successfulBuys = result.buyResults.filter(r => r.buySignature).length;
    console.log(`Launch complete! ${successfulBuys}/${burnerBackers.length} burner buys successful`);

    return NextResponse.json({
      success: true,
      mint_address: result.mintAddress,
      pump_fun_url: result.pumpFunUrl,
      create_signature: result.createSignature,
      buy_results: result.buyResults.map(r => ({
        main_wallet: r.mainWallet,
        burner_wallet: r.burnerWallet,
        amount_sol: r.amountSol,
        tokens_received: r.tokensReceived,
        success: !!r.buySignature,
        error: r.error,
      })),
      total_backers: burnerBackers.length,
      successful_buys: successfulBuys,
    });
  } catch (error) {
    console.error('Launch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
