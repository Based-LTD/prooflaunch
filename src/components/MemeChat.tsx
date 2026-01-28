'use client';

import { FC, useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Send, MessageCircle, Loader2 } from 'lucide-react';

interface ChatMessage {
  id: string;
  meme_id: string;
  wallet_address: string;
  message: string;
  created_at: string;
}

interface MemeChatProps {
  memeId: string;
}

export const MemeChat: FC<MemeChatProps> = ({ memeId }) => {
  const { connected, publicKey } = useWallet();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch(`/api/chat?meme_id=${memeId}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoading(false);
    }
  }, [memeId]);

  // Initial fetch and polling for new messages
  useEffect(() => {
    fetchMessages();

    // Poll for new messages every 5 seconds
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Scroll within chat container only when user sends a new message
  // Don't auto-scroll on load or when other users send messages
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, []);

  // Send message
  const handleSend = async () => {
    if (!connected || !publicKey || !newMessage.trim()) return;

    setSending(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meme_id: memeId,
          wallet_address: publicKey.toBase58(),
          message: newMessage.trim(),
        }),
      });

      if (response.ok) {
        setNewMessage('');
        // Immediately fetch to show the new message
        await fetchMessages();
        // Scroll to bottom after sending own message
        scrollToBottom();
      } else {
        const data = await response.json();
        console.error('Failed to send:', data.error);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Shorten wallet address
  const shortAddress = (address: string) =>
    `${address.slice(0, 4)}...${address.slice(-4)}`;

  return (
    <div className="card p-4 flex flex-col h-[400px]">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[var(--border)]">
        <MessageCircle className="w-5 h-5 text-[var(--accent)]" />
        <h3 className="font-semibold">Investor Chat</h3>
        <span className="text-xs text-[var(--muted)]">({messages.length} messages)</span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {loading ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]">
            <MessageCircle className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs">Be the first to chat!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = publicKey?.toBase58() === msg.wallet_address;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-[var(--muted)]">
                    {shortAddress(msg.wallet_address)}
                  </span>
                  <span className="text-xs text-[var(--muted)] opacity-50">
                    {formatTime(msg.created_at)}
                  </span>
                </div>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                    isMe
                      ? 'bg-[var(--accent)] text-white rounded-br-none'
                      : 'bg-[var(--card)] border border-[var(--border)] rounded-bl-none'
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      {connected ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            maxLength={500}
            disabled={sending}
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none text-sm disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || sending}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--accent)]/90 transition-colors"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      ) : (
        <div className="text-center py-3 text-sm text-[var(--muted)] bg-[var(--background)] rounded-lg">
          Connect wallet to chat
        </div>
      )}
    </div>
  );
};
