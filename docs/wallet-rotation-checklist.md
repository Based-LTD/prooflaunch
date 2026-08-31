# Wallet Rotation Checklist

Two of this platform's three wallet rotations half-took, and each half-rotation
caused a real incident:

- **June 2026 escrow rotation** — new key set locally but never landed in prod
  Vercel env. Prod kept signing with the old (exposed) key until the attacker
  drained CEGG for 0.715 SOL on July 25.
- **May 2026 buyback rotation** — `NEXT_PUBLIC_PROOF_BUYBACK_WALLET` (display
  address) was updated to the new wallet, but `PROOF_BUYBACK_WALLET_PRIVATE_KEY`
  still held the old key in BOTH prod and local. Result: `buy-and-burn.mjs`
  bricked by its own mismatch guard, the buyback→rewards sweep never ran, and
  0.175 SOL stranded on a wallet whose key is unlocated.

The failure mode is always the same: **the address moves, the key doesn't (or
moves in one env but not the other).** Nothing errors at rotation time; the
damage surfaces weeks later.

## The checklist

Do ALL steps. Do not stop after step 3 — that is exactly the half-rotation trap.

1. **Generate** the new keypair. Record the pubkey.
2. **Set the private key in prod** (Vercel env). Watch for the literal-`\n`
   gotcha: prod values may store `\n` as two characters; all consuming code
   must normalize (`.replace(/\\n/g, '\n').trim()`).
3. **Set the private key in local** `.env.local`.
4. **Update every companion var** that names the address
   (`*_WALLET_ADDRESS`, `NEXT_PUBLIC_*`) in BOTH envs.
5. **VERIFY BY DERIVATION — the step that was skipped both times.**
   Pull prod env (`vercel env pull /tmp/prod.env --environment=production`)
   and derive the pubkey from the actual prod private key:

   ```bash
   node -e "
   const {Keypair}=require('@solana/web3.js');const bs58=require('bs58').default||require('bs58');
   const fs=require('fs');
   const raw=fs.readFileSync('/tmp/prod.env','utf8');
   const m=raw.match(/^THE_KEY_VAR=(.*)$/m);
   const kp=Keypair.fromSecretKey(bs58.decode(m[1].replace(/^[\"']|[\"']$/g,'').replace(/\\\\n/g,'\n').trim()));
   console.log(kp.publicKey.toBase58());  // MUST equal the new address
   "
   ```

   Repeat for local. **Derived pubkey must equal the new address in both
   envs.** If it doesn't, the rotation has not happened, whatever the
   dashboard says.
6. **Redeploy prod** (env changes don't apply to running deployments).
7. **Exercise the key in prod** — trigger one real operation that signs with
   it (a fee drain, a sweep dry-run) and confirm the tx signer on-chain is
   the NEW address.
8. **Sweep the old wallet** to the new one. Remember the pool-key rule:
   sweep BEFORE deleting any DB row that is the only holder of a key.
9. **Update hardcoded addresses** — grep the repo for the old address
   (`grep -rn OLD_ADDR src/ tools/ .github/`). Exclusion lists
   (`EXCLUDED_WALLETS` in `src/app/api/airdrop/daily/route.ts` +
   `tools/airdrop-snapshot.mjs`), sweep tools, and workflow files all
   hardcode addresses. The airdrop leak to `ELFjjx7` happened because this
   step was skipped.
10. **Add the NEW wallet to the airdrop exclusion lists** if it is a platform
    wallet (both files in step 9 — they must mirror).
11. **Record it** — update the wallet-compromise-history / rotation log with
    date, old addr, new addr, and who holds the key backup.
