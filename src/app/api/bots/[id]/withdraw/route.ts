import { NextRequest, NextResponse } from 'next/server';
import {
  Connection, Keypair, PublicKey,
  Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getMint,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { createServerClient } from '@/lib/supabase';
import { decryptPrivateKey, verifySignedAuthMessage } from '@/lib/crypto';

// POST /api/bots/[id]/withdraw
//
// Creator-initiated withdrawal from a VAULT (action='hold') bot wallet.
// The withdrawal pattern intentionally restricts to vault bots only —
// operational bots (BURN, distribute_*) must NEVER be drainable by a
// signed request, because a creator (or a compromised creator key) could
// race the bot's intended on-chain action mid-cycle. Stuck-bot recovery
// is handled separately by the buyback cron's pre-flight check.
//
// Security model — every one of these must hold:
//
//   1. Bot exists and is a vault bot (action='hold').
//   2. Signer is the meme's current creator_wallet.
//   3. Ed25519 signature verifies against signer's pubkey.
//   4. Signed message starts with the literal prefix
//      "bot-withdraw:<bot_id>:<signer>" (domain-separation — prevents
//      cross-protocol replay of any other thing the user has signed).
//   5. Signed-message timestamp within ±5 min of server time.
//   6. Nonce (UUID) is single-use — INSERT into bot_withdrawal_nonces
//      with UNIQUE PK acts as the atomic dedupe lock.
//   7. Body destination/asset/amount fields must equal what's encoded in
//      the signed message (defense in depth).
//   8. Destination is a valid base58 Solana pubkey.
//   9. Amount, if specified, is positive and within wallet balance.
//
// On success: signs+sends the transfer, INSERTs into meme_bot_withdrawals,
// returns tx hash. The bot's encrypted_bot_key NEVER leaves the server
// memory and is never logged.

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Minimum we leave behind for rent + future tx fees so the bot wallet
// doesn't get garbage-collected and so subsequent withdrawals (or, for
// VAULT bots, future incoming fee transfers) don't bounce.
const MIN_VAULT_RESERVE_LAMPORTS = 0.001 * LAMPORTS_PER_SOL;

interface WithdrawBody {
  signer: string;
  signature: string;
  message: string;
  destination: string;
  asset: 'sol' | 'token';
  // Raw units: lamports for SOL, mint base-units for token. String to
  // sidestep JS number precision for large token totals. The literal
  // string "all" means "drain available balance (less reserve)".
  amount: string;
  nonce: string;
}

function parsePubkey(addr: string): PublicKey | null {
  try {
    const pk = new PublicKey(addr);
    // PublicKey constructor accepts 32-byte buffers that decode but
    // aren't on the curve (PDAs). For a destination wallet we want
    // on-curve only — sending to a PDA risks unrecoverable tokens.
    // Allow both but flag PDA destinations so the UI can warn.
    return pk;
  } catch {
    return null;
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: botId } = await params;
    if (!isUuid(botId)) {
      return NextResponse.json({ error: 'invalid bot id' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as WithdrawBody | null;
    if (!body) return NextResponse.json({ error: 'invalid json' }, { status: 400 });
    const { signer, signature, message, destination, asset, amount, nonce } = body;

    if (!signer || !signature || !message || !destination || !asset || !amount || !nonce) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 });
    }
    if (asset !== 'sol' && asset !== 'token') {
      return NextResponse.json({ error: 'asset must be sol or token' }, { status: 400 });
    }
    if (!isUuid(nonce)) {
      return NextResponse.json({ error: 'nonce must be a uuid' }, { status: 400 });
    }
    const destPk = parsePubkey(destination);
    if (!destPk) {
      return NextResponse.json({ error: 'invalid destination address' }, { status: 400 });
    }
    const signerPk = parsePubkey(signer);
    if (!signerPk) {
      return NextResponse.json({ error: 'invalid signer address' }, { status: 400 });
    }
    // amount is either "all" or a positive integer string
    if (amount !== 'all') {
      if (!/^[0-9]+$/.test(amount) || amount === '0') {
        return NextResponse.json({ error: 'amount must be positive integer or "all"' }, { status: 400 });
      }
    }

    // ── Signature: prefix verifies that this exact payload was signed
    // by this signer for THIS bot, with timestamp replay protection ──
    //
    // Signed message format:
    //   "bot-withdraw:<bot_id>:<signer>:<destination>:<asset>:<amount>:<nonce>:<unix_ms>"
    //
    // verifySignedAuthMessage handles the trailing :<unix_ms> + ±5min check
    // and the ed25519 verify against signer.
    const prefix =
      `bot-withdraw:${botId}:${signer}:${destination}:${asset}:${amount}:${nonce}`;
    const auth = verifySignedAuthMessage(prefix, message, signature, signer);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    // Extract the signed timestamp for the audit log (we already verified
    // it's within the replay window).
    const signedTsMs = parseInt(message.slice(prefix.length + 1), 10);
    const signedAt = new Date(signedTsMs).toISOString();

    const supabase = createServerClient();

    // ── Atomic dedupe — INSERT-or-fail BEFORE decrypting any keys ──
    // If the nonce is already used, the UNIQUE PK constraint rejects
    // the insert and we bail. This is the only protection against a
    // replay within the 5-min signature window.
    const { error: nonceErr } = await supabase
      .from('bot_withdrawal_nonces')
      .insert({ nonce, bot_id: botId });
    if (nonceErr) {
      // 23505 = unique_violation
      const code = (nonceErr as { code?: string }).code;
      if (code === '23505') {
        return NextResponse.json({ error: 'nonce already used' }, { status: 409 });
      }
      return NextResponse.json({ error: `nonce insert: ${nonceErr.message}` }, { status: 500 });
    }

    // ── Load bot + meme; verify auth ──
    const { data: bot } = await supabase
      .from('meme_bots')
      .select('id, meme_id, action, label, bot_wallet, encrypted_bot_key')
      .eq('id', botId)
      .single();
    if (!bot) {
      return NextResponse.json({ error: 'bot not found' }, { status: 404 });
    }
    if (bot.action !== 'hold') {
      return NextResponse.json(
        { error: 'only vault (hold) bots are withdrawable; operational bots are sealed' },
        { status: 403 },
      );
    }

    const { data: meme } = await supabase
      .from('memes')
      .select('id, creator_wallet, symbol')
      .eq('id', bot.meme_id)
      .single();
    if (!meme) {
      return NextResponse.json({ error: 'meme not found' }, { status: 404 });
    }
    if (meme.creator_wallet !== signer) {
      return NextResponse.json(
        { error: 'only the meme creator can withdraw from this vault' },
        { status: 403 },
      );
    }

    // ── Decrypt bot key (last possible moment) ──
    let botKp: Keypair;
    try {
      botKp = Keypair.fromSecretKey(bs58.decode(decryptPrivateKey(bot.encrypted_bot_key)));
    } catch {
      return NextResponse.json(
        { error: 'failed to decrypt bot key (server error, contact support)' },
        { status: 500 },
      );
    }
    // Defense in depth — DB-stored pubkey MUST match decrypted key.
    if (botKp.publicKey.toBase58() !== bot.bot_wallet) {
      return NextResponse.json(
        { error: 'bot key/pubkey mismatch — refusing to sign' },
        { status: 500 },
      );
    }

    const conn = new Connection(RPC_URL, 'confirmed');

    // ── Execute transfer ──
    let txSignature: string;
    let actualAmountRaw: bigint;

    if (asset === 'sol') {
      const balance = await conn.getBalance(botKp.publicKey);
      const available = Math.max(0, balance - MIN_VAULT_RESERVE_LAMPORTS);
      const wantLamports = amount === 'all' ? available : BigInt(amount);
      const sendLamports = typeof wantLamports === 'bigint' ? Number(wantLamports) : wantLamports;

      if (sendLamports <= 0) {
        return NextResponse.json({ error: 'nothing to withdraw' }, { status: 400 });
      }
      if (sendLamports > available) {
        return NextResponse.json(
          { error: `requested ${sendLamports} lamports exceeds available ${available} (reserve kept for rent)` },
          { status: 400 },
        );
      }

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        SystemProgram.transfer({
          fromPubkey: botKp.publicKey,
          toPubkey: destPk,
          lamports: sendLamports,
        }),
      );
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = botKp.publicKey;
      txSignature = await conn.sendTransaction(tx, [botKp], { maxRetries: 3 });
      const conf = await conn.confirmTransaction(txSignature, 'confirmed');
      if (conf.value.err) {
        return NextResponse.json(
          { error: `tx failed: ${JSON.stringify(conf.value.err)}` },
          { status: 500 },
        );
      }
      actualAmountRaw = BigInt(sendLamports);
    } else {
      // asset === 'token' — we need the meme's mint to know what to send.
      // VAULT bots accumulate the meme's own token, never some arbitrary
      // mint, so we lock the withdrawal to that mint specifically.
      const { data: memeMint } = await supabase
        .from('memes')
        .select('mint_address')
        .eq('id', bot.meme_id)
        .single();
      if (!memeMint?.mint_address) {
        return NextResponse.json({ error: 'meme has no mint address (pre-launch?)' }, { status: 400 });
      }
      const mintPk = new PublicKey(memeMint.mint_address);

      // Detect token program (SPL vs Token-2022).
      const mintAcc = await conn.getAccountInfo(mintPk);
      if (!mintAcc) {
        return NextResponse.json({ error: 'mint account not found on-chain' }, { status: 400 });
      }
      const tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const mintInfo = await getMint(conn, mintPk, 'confirmed', tokenProgramId);

      const fromAta = getAssociatedTokenAddressSync(mintPk, botKp.publicKey, false, tokenProgramId);
      const toAta   = getAssociatedTokenAddressSync(mintPk, destPk,           true,  tokenProgramId);

      const fromBalRes = await conn.getTokenAccountBalance(fromAta).catch(() => null);
      const fromBalRaw = BigInt(fromBalRes?.value?.amount || '0');
      if (fromBalRaw === BigInt(0)) {
        return NextResponse.json({ error: 'vault token balance is 0' }, { status: 400 });
      }

      const wantRaw = amount === 'all' ? fromBalRaw : BigInt(amount);
      if (wantRaw <= BigInt(0)) {
        return NextResponse.json({ error: 'amount must be positive' }, { status: 400 });
      }
      if (wantRaw > fromBalRaw) {
        return NextResponse.json(
          { error: `requested ${wantRaw} exceeds vault balance ${fromBalRaw}` },
          { status: 400 },
        );
      }

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        // Create destination ATA if it doesn't exist (idempotent — no-op
        // when present). Bot wallet pays the rent (~0.002 SOL).
        createAssociatedTokenAccountIdempotentInstruction(
          botKp.publicKey, toAta, destPk, mintPk, tokenProgramId,
        ),
        createTransferCheckedInstruction(
          fromAta, mintPk, toAta, botKp.publicKey,
          wantRaw, mintInfo.decimals, [], tokenProgramId,
        ),
      );
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = botKp.publicKey;
      txSignature = await conn.sendTransaction(tx, [botKp], { maxRetries: 3 });
      const conf = await conn.confirmTransaction(txSignature, 'confirmed');
      if (conf.value.err) {
        return NextResponse.json(
          { error: `tx failed: ${JSON.stringify(conf.value.err)}` },
          { status: 500 },
        );
      }
      actualAmountRaw = wantRaw;
    }

    // ── Immutable audit log ──
    await supabase.from('meme_bot_withdrawals').insert({
      bot_id: bot.id,
      meme_id: bot.meme_id,
      signer_wallet: signer,
      destination,
      asset,
      amount_raw: actualAmountRaw.toString(),
      tx_signature: txSignature,
      nonce,
      signed_at: signedAt,
    });

    return NextResponse.json({
      ok: true,
      tx: txSignature,
      asset,
      amount_raw: actualAmountRaw.toString(),
      destination,
      bot_label: bot.label ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'internal error' },
      { status: 500 },
    );
  }
}
