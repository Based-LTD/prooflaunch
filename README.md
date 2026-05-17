![Proof Launch](.github/banner.png)

# Proof Launch

**The proving grounds for meme coins.** A pre-launch commitment layer on top of [Pump.fun](https://pump.fun) — communities form *before* a token exists. A meme can only launch once all its backer slots are claimed, and when they fill, every backer's wallet buys in automatically on the bonding curve.

🌐 [prooflaunch.fun](https://prooflaunch.fun) · 𝕏 [@ProofLaunch](https://x.com/ProofLaunch)

---

## How it works

1. A creator submits a meme and sets **2–8 backer slots**, each with a minimum SOL contribution.
2. Backers claim slots first-come, first-served. Each backing generates a unique **burner wallet** that holds the backer's SOL, locked until launch (anti-frontrun, anti-manipulation).
3. When all slots fill, the creator launches. The token deploys on Pump.fun and the burners buy in two batches:
   - **Genesis** (slots 1–4) buy first, at the lowest prices on the curve.
   - **Wave 2** (slots 5–8) follow in the second batch.
4. If slots don't fill within 3 days, every backer is automatically refunded.

After launch, backers can claim tokens to their main wallet, sell on Pump.fun, or export the burner's private key into Phantom — non-custodial by design.

**Trading fees:** Pump.fun routes 0.5% of trading volume to the token creator wallet. Proof Launch splits that **90% to backers** (proportional to backing size) and 10% to the platform.

## Stack

- **Frontend:** Next.js (App Router) + React + TypeScript, hosted on Vercel
- **Wallet:** Solana Wallet Adapter (Phantom, Solflare, …)
- **Database:** Supabase (Postgres + RLS)
- **Chain:** `@solana/web3.js`
- **Token launches:** [`pumpdotfun-sdk`](https://www.npmjs.com/package/pumpdotfun-sdk)

Core launch logic: [`src/services/pumpfun.ts`](src/services/pumpfun.ts). Burner key encryption (AES-256-GCM) and signature verification: [`src/lib/crypto.ts`](src/lib/crypto.ts).

## Local development

```bash
npm install
npm run dev
```

Requires a `.env.local` with Supabase, Solana RPC, escrow wallet, and burner encryption keys. The repo intentionally ships no secrets.

## Security

Funds are non-custodial — backer SOL sits in per-backing burner wallets the backer can export any time after launch. See [SECURITY.md](SECURITY.md) for responsible disclosure and audit status.

> ⚠️ Not formally audited by a third-party firm. Meme coins are highly speculative. Don't back more than you can afford to lose.

## License

[AGPL-3.0](LICENSE) — fork and modify freely, but if you run a modified version as a network service you must publish your source.
