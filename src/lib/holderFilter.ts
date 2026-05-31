// Curated denylist of Solana program IDs whose PDAs hold tokens on
// behalf of users but cannot be airdropped to (no human claim path).
// Used by BOTH the PROOF daily airdrop and per-meme buyback bot
// distributions. Refresh quarterly.
//
// Pattern follows what Jito MEV tip distributions, MNDE rewards, and
// the original BONK airdrop all do: maintain a small curated list of
// confirmed DeFi venues to exclude, and INCLUDE everything else
// (multisigs, governance treasuries, new wallet types, unknowns).
//
// WHAT'S NOT ON THIS LIST (intentionally, these ARE real holders):
//   - System Program — every EOA wallet (Phantom / Backpack / Solflare
//                       / Ledger / Jupiter Wallet / etc.)
//   - Squads multisig programs (team treasuries, user multisigs)
//   - Realms / SPL Governance treasuries (DAO treasuries)
//   - Any program ID not explicitly listed here — default-include

export const KNOWN_PDA_PROGRAMS = new Set<string>([
  // ── Pump.fun ────────────────────────────────────────────────────
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun bonding curve
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // PumpSwap AMM

  // ── Raydium ─────────────────────────────────────────────────────
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM (concentrated liquidity)
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM

  // ── Orca ────────────────────────────────────────────────────────
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool (CLMM)
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca legacy AMM v2

  // ── Meteora ─────────────────────────────────────────────────────
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora dynamic AMM

  // ── Jupiter DEFI PRODUCTS (NOT Jupiter Wallet — that's an EOA!) ─
  'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu', // Jupiter Perpetuals
  'j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X', // Jupiter Limit Orders v2

  // ── Lending ─────────────────────────────────────────────────────
  'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', // Kamino Lend
  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', // MarginFi v2
  'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', // Solend
  'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd', // Kamino Lending

  // ── Perps / margin ──────────────────────────────────────────────
  'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH', // Drift v2
  '4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg', // Mango v4

  // ── Vesting / streaming ─────────────────────────────────────────
  'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m', // Streamflow
]);
