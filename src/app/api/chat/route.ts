import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { rateLimiters } from '@/lib/rateLimit';

// Sanitize message to prevent XSS attacks
function sanitizeMessage(message: string): string {
  return message
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Encode special HTML characters
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    // Remove potential script injection patterns
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    // Trim whitespace
    .trim();
}

// GET /api/chat - Get chat messages for a meme
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const memeId = searchParams.get('meme_id');

    if (!memeId) {
      return NextResponse.json({ error: 'meme_id is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('meme_id', memeId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      console.error('Failed to fetch messages:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: data || [] });
  } catch (error) {
    console.error('Chat GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/chat - Send a chat message
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const { meme_id, wallet_address, message } = body;

    // Validation
    if (!meme_id || !wallet_address || !message) {
      return NextResponse.json(
        { error: 'meme_id, wallet_address, and message are required' },
        { status: 400 }
      );
    }

    // Rate limiting - 10 messages per minute per wallet
    const rateLimitResult = rateLimiters.chat(wallet_address);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many messages. Please wait before sending another.' },
        { status: 429 }
      );
    }

    if (message.length > 500) {
      return NextResponse.json(
        { error: 'Message too long (max 500 characters)' },
        { status: 400 }
      );
    }

    // Sanitize message to prevent XSS
    const sanitizedMessage = sanitizeMessage(message);

    if (!sanitizedMessage || sanitizedMessage.length === 0) {
      return NextResponse.json(
        { error: 'Message cannot be empty after sanitization' },
        { status: 400 }
      );
    }

    // Check if user has backed this meme (optional - for now allow all connected wallets)
    // TODO: Restrict to backers only if desired

    // Insert message
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        meme_id,
        wallet_address,
        message: sanitizedMessage,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to insert message:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: data }, { status: 201 });
  } catch (error) {
    console.error('Chat POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
