-- Create chat_messages table for investor chat
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meme_id UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  message TEXT NOT NULL CHECK (char_length(message) <= 500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster message retrieval by meme
CREATE INDEX IF NOT EXISTS idx_chat_messages_meme_id ON chat_messages(meme_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- Enable Row Level Security
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read messages
CREATE POLICY "Anyone can read messages"
  ON chat_messages FOR SELECT
  USING (true);

-- Allow authenticated/anon users to insert messages (we verify wallet on API side)
CREATE POLICY "Anyone can insert messages"
  ON chat_messages FOR INSERT
  WITH CHECK (true);

-- Enable realtime for chat messages (optional - for future real-time updates)
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
