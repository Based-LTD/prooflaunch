// Simple in-memory rate limiter for API endpoints
// For production, consider using Redis for distributed rate limiting

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean every minute

export interface RateLimitConfig {
  // Maximum requests allowed in the window
  limit: number;
  // Time window in milliseconds
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

export function rateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const key = identifier;

  let entry = rateLimitStore.get(key);

  // If no entry or entry expired, create new one
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
    return {
      success: true,
      limit: config.limit,
      remaining: config.limit - 1,
      resetTime: entry.resetTime,
    };
  }

  // Increment count
  entry.count++;

  // Check if over limit
  if (entry.count > config.limit) {
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  return {
    success: true,
    limit: config.limit,
    remaining: config.limit - entry.count,
    resetTime: entry.resetTime,
  };
}

// Pre-configured rate limiters for different endpoints
export const rateLimiters = {
  // Backing: 5 requests per minute per wallet
  backing: (wallet: string) =>
    rateLimit(`backing:${wallet}`, { limit: 5, windowMs: 60000 }),

  // Chat: 10 messages per minute per wallet
  chat: (wallet: string) =>
    rateLimit(`chat:${wallet}`, { limit: 10, windowMs: 60000 }),

  // Withdraw: 3 requests per minute per wallet
  withdraw: (wallet: string) =>
    rateLimit(`withdraw:${wallet}`, { limit: 3, windowMs: 60000 }),

  // Launch: 2 requests per minute per meme
  launch: (memeId: string) =>
    rateLimit(`launch:${memeId}`, { limit: 2, windowMs: 60000 }),

  // Submit: 3 memes per hour per wallet
  submit: (wallet: string) =>
    rateLimit(`submit:${wallet}`, { limit: 3, windowMs: 3600000 }),

  // General API: 100 requests per minute per IP
  general: (ip: string) =>
    rateLimit(`general:${ip}`, { limit: 100, windowMs: 60000 }),
};
