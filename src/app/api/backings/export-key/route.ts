import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifySignedAuthMessage, decryptPrivateKey } from '@/lib/crypto';

// POST /api/backings/export-key - Export burner wallet private key (only after launch)
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { meme_id, backer_wallet, signature, message } = body;

    // Validation
    if (!meme_id || !backer_wallet) {
      return NextResponse.json(
        { error: 'Missing required fields: meme_id, backer_wallet' },
        { status: 400 }
      );
    }

    // Require timestamped wallet signature to prove ownership
    if (!signature || !message) {
      return NextResponse.json({ error: 'Wallet signature required' }, { status: 401 });
    }
    const auth = verifySignedAuthMessage(
      `export-key:${meme_id}:${backer_wallet}`,
      message, signature, backer_wallet
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Get the meme to verify it's launched
    const { data: meme, error: memeError } = await supabase
      .from('memes')
      .select('id, status, name')
      .eq('id', meme_id)
      .single();

    if (memeError || !meme) {
      return NextResponse.json({ error: 'Meme not found' }, { status: 404 });
    }

    // SECURITY: Only allow key export after token is launched
    if (meme.status !== 'live') {
      return NextResponse.json(
        {
          error: 'Private key export is only available after the token launches',
          status: meme.status
        },
        { status: 403 }
      );
    }

    // Get the backing record with encrypted private key
    const { data: backing, error: backingError } = await supabase
      .from('backings')
      .select('burner_wallet, encrypted_private_key, burner_buy_executed')
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

    // Decrypt the private key (handles both legacy enc: and new aes: formats)
    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(backing.encrypted_private_key);
    } catch {
      return NextResponse.json(
        { error: 'Failed to decrypt key' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      burner_wallet: backing.burner_wallet,
      private_key: privateKey,
      buy_executed: backing.burner_buy_executed,
    });
  } catch (error) {
    console.error('Export key error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
