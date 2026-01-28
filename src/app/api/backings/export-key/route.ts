import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// POST /api/backings/export-key - Export burner wallet private key (only after launch)
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { meme_id, backer_wallet } = body;

    // Validation
    if (!meme_id || !backer_wallet) {
      return NextResponse.json(
        { error: 'Missing required fields: meme_id, backer_wallet' },
        { status: 400 }
      );
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

    // Decrypt the private key
    // The key is stored as "enc:base64encodedkey"
    const encryptedKey = backing.encrypted_private_key;

    if (!encryptedKey.startsWith('enc:')) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 500 }
      );
    }

    // Decode the base64 private key
    const base64Key = encryptedKey.slice(4); // Remove "enc:" prefix
    const privateKey = Buffer.from(base64Key, 'base64').toString();

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
