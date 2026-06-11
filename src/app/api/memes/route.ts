import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { createServerClient } from '@/lib/supabase';
import { verifyDeposit } from '@/services/pumpfun';
import { encryptPrivateKey, verifySignedAuthMessage } from '@/lib/crypto';

// Free submission perk for PROOF holders.
// Holding >= this many PROOF (UI amount, 6 decimals) waives the 0.02 SOL
// submission fee. Threshold tunable via env (PROOF_FREE_SUBMISSION_MIN_TOKENS).
const PROOF_MINT = 'oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL';
const PROOF_DECIMALS = 6;
const FREE_SUBMISSION_THRESHOLD_TOKENS = Number(
  process.env.PROOF_FREE_SUBMISSION_MIN_TOKENS || '500000',
);

// Reads creator's effective PROOF balance (direct + Streamflow-locked) and
// returns true if it meets the free-submission threshold. Conservative: any
// RPC error returns false (= fee required), so we never accidentally waive
// the fee due to an upstream failure.
async function qualifiesForFreeSubmission(creatorWallet: string): Promise<boolean> {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!rpcUrl) return false;
  try {
    const conn = new Connection(rpcUrl, 'confirmed');
    const owner = new PublicKey(creatorWallet);
    const mint = new PublicKey(PROOF_MINT);
    const accts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    const directBalance = accts.value.reduce(
      (sum: number, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0),
      0,
    );
    // Phase 1: direct balance only. Streamflow-locked support can be added
    // later — most holders just hold liquid. Simpler to ship.
    return directBalance >= FREE_SUBMISSION_THRESHOLD_TOKENS;
  } catch (e) {
    console.warn('qualifiesForFreeSubmission RPC error:', e instanceof Error ? e.message : e);
    return false; // fail-closed: require the fee on any uncertainty
  }
}

// GET /api/memes - List all memes with optional filters
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const creator = searchParams.get('creator');
    const limit = parseInt(searchParams.get('limit') || '1000');
    const offset = parseInt(searchParams.get('offset') || '0');
    // Hide expired-backing memes from listings immediately (no grace period).
    // Exemptions: when querying a specific creator (so they/their backers can
    // still see + handle refunds in Portfolio), or when explicitly requested
    // via includeStaleExpired=true (admin / debug use).
    const includeStaleExpired = searchParams.get('includeStaleExpired') === 'true';

    let query = supabase
      .from('memes_with_stats')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (creator) {
      query = query.eq('creator_wallet', creator);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Hide failed/expired memes from public listings IMMEDIATELY.
    // Whitelist what's allowed to show — defends against any new failure-
    // shaped statuses (refunded, cancelled, etc.) added later without us
    // having to revisit this filter.
    //   - 'backing'  → show only if deadline hasn't passed
    //   - 'funded'   → always (filled pool, awaiting launch)
    //   - 'live'     → always (already launched, trading)
    //   - everything else (failed, refunded, etc.) → HIDDEN
    // Plus visibility filter (Launch Config v2 — Phase 1):
    //   - 'open'      → show normally
    //   - 'spectator' → show (public listing, only backing is gated)
    //   - 'stealth'   → HIDE from public listings (creator-scoped queries
    //                   are exempt so creators see their own stealth launches)
    // Creator-scoped queries (Portfolio) and admin (includeStaleExpired)
    // remain exempt so refunds can still be tracked / handled.
    let filteredData = data;
    if (!creator && !includeStaleExpired) {
      const now = new Date();
      const PUBLIC_STATUSES = new Set(['backing', 'funded', 'live']);
      filteredData = data?.filter((meme) => {
        if (!PUBLIC_STATUSES.has(meme.status)) return false;
        // Hide stealth launches from public listings — they only become
        // visible when the creator flips visibility (manually or auto on funded)
        if (meme.visibility === 'stealth') return false;
        // For backing memes, also require an unexpired deadline
        if (meme.status === 'backing') {
          const deadline = new Date(meme.backing_deadline);
          return deadline > now;
        }
        return true;
      });
    }

    // Augment each meme with extra card-level signals that the cached
    // memes_with_stats view doesn't carry:
    //   - bot_count             (Phase B meme_bots rows + legacy single-bot)
    //   - reserved_slots        (migration 037; view's SELECT m.* is cached
    //                             and doesn't auto-pick up new columns —
    //                             same issue documented in /api/memes/[id])
    //   - github                (migration 050; card-level social icon)
    //   - launch_platform       (migration 046; card-level platform badge)
    //   - banner_url            (migration 052; not used on card today
    //                             but flowed through so client can opt in)
    // Single batched query to keep list-view cheap.
    if (filteredData && filteredData.length > 0) {
      const memeIds = filteredData.map((m) => m.id);
      const [{ data: botRows }, { data: poolRows }] = await Promise.all([
        supabase.from('meme_bots').select('meme_id').in('meme_id', memeIds),
        supabase.from('memes').select('id, reserved_slots, github, launch_platform, banner_url, quote_currency').in('id', memeIds),
      ]);
      const botCountByMeme = new Map<string, number>();
      for (const row of botRows ?? []) {
        botCountByMeme.set(row.meme_id, (botCountByMeme.get(row.meme_id) ?? 0) + 1);
      }
      const extrasByMeme = new Map<string, { reserved_slots: number; github: string | null; launch_platform: string | null; banner_url: string | null; quote_currency: string }>();
      for (const row of poolRows ?? []) {
        extrasByMeme.set(row.id, {
          reserved_slots: row.reserved_slots ?? 0,
          github: row.github ?? null,
          launch_platform: row.launch_platform ?? null,
          banner_url: row.banner_url ?? null,
          quote_currency: row.quote_currency ?? 'sol',
        });
      }
      filteredData = filteredData.map((m) => ({
        ...m,
        bot_count: botCountByMeme.get(m.id) ?? (m.buyback_bot_enabled ? 1 : 0),
        ...(extrasByMeme.get(m.id) ?? { reserved_slots: 0, github: null, launch_platform: null, banner_url: null, quote_currency: 'sol' }),
      }));
    }

    // Hot fix for landing-page payload bloat. Historically some submits
    // stored the uploaded image as a base64 data URL directly in
    // `image_url` (up to 3 MB per meme), so a list of 8 memes shipped
    // ~10 MB of inline image data on every page load. Until the
    // Storage-upload migration backfills these to real CDN URLs, strip
    // any `data:` URL from the list response and let MemeCard fall
    // back to its symbol-initial avatar. Detail page (/api/memes/[id])
    // still returns the full url so it can render the original image.
    if (filteredData) {
      filteredData = filteredData.map((m) => {
        if (typeof m.image_url === 'string' && m.image_url.startsWith('data:')) {
          return { ...m, image_url: null };
        }
        return m;
      });
    }

    return NextResponse.json({ memes: filteredData });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Required creation fee in SOL
const CREATION_FEE_SOL = 0.02; // Goes to escrow to cover launch costs

// POST /api/memes - Submit a new meme
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const {
      // Signed-message auth — proves the caller controls creator_wallet.
      // Prefix is domain-separated ("create-meme") so a signature for
      // another action (claim, withdraw, etc.) cannot be replayed here.
      auth_signature,
      auth_message,
      creator_wallet,
      name,
      symbol,
      description,
      image_url,
      banner_url,
      creator_twitter,
      twitter,
      telegram,
      discord,
      website,
      github,
      // New slot-based backing system
      total_slots,         // 2-24 backer slots
      min_backing_sol,     // Minimum SOL per backer
      max_backing_sol,     // Optional per-backer ceiling (Phase 3.5). NULL = uncapped.
      reserved_slots = 0,  // Reserved-for-allowlist slots (Phase 7). 0 = fully open.
      // Legacy field (unused, kept for old client compatibility)
      backing_days,
      // Legacy trust score parameters (no longer used in fee distribution)
      // All backers (including creator) now split 90% equally
      creator_fee_pct = 0, // Creator gets no special cut - must back to earn fees
      backer_share_pct = 90, // Max allowed by DB constraint (actual distribution uses feeTracker.ts)
      dev_initial_buy_sol = 0,
      trust_score = 75,
      // Creation fee payment (goes to escrow for platform costs)
      creation_fee_signature,
      creation_fee_sol,
      // Partner attribution — set when the user arrived via a partner
      // hosted-checkout URL (?session=pls_xxx). The session row carries
      // the partner_id and validation context.
      partner_session_id,
      // Quote currency (migration 053). 'sol' (default) keeps existing
      // SOL-quoted behavior. 'usdc' routes through the USDC-quoted
      // Meteora DBC config — Phase 2 of USDC support. Cross-validated
      // below against launch_platform (USDC requires meteora today).
      quote_currency = 'sol',
      // Multi-launchpad dispatch key (migration 046). The /api/launch
      // route reads this column to route through src/services/launch/
      // dispatcher. Default 'pumpfun' preserves legacy behavior for
      // any submit path that doesn't supply it.
      launch_platform = 'pumpfun',
      // Launch Configuration v2 — visibility mode + initial allowlist.
      // visibility defaults to 'open' (legacy behavior). Stealth and
      // spectator require an allowlist; the creator's own wallet is
      // auto-added below so they can always back their own launch.
      visibility = 'open',
      initial_allowlist = [],
      // Launch Configuration v2 — fee distribution preset + percentages.
      // All five _pct fields must sum to 100. fee_preset is the user's
      // chosen template ('standard' | 'community_first' | ... | 'custom').
      // If fee_preset is missing entirely we leave the columns NULL,
      // which the distribution code treats as "use legacy hardcoded".
      fee_preset,
      fee_backer_pct,
      fee_holder_rewards_pct,
      fee_platform_pct,
      fee_burn_pct,
      fee_charity_pct,
      fee_charity_wallet,
      // Phase 5 — legacy single-bot fields (still accepted for back-compat
      // with any clients on the previous wire shape).
      buyback_bot_enabled = false,
      buyback_bot_action,
      buyback_bot_fee_pct = 0,
      // Phase B — bot stack array. Each item: { action, fee_pct }. If
      // present and non-empty, supersedes the single-bot fields above.
      bots = [],
    } = body;

    // ── Wallet ownership proof ─────────────────────────────────────
    // Verify the caller actually controls creator_wallet before doing
    // ANY work (DB lookups, fee verification, key generation). Without
    // this, anyone could POST with any wallet string and have a meme
    // attributed to them — subsequent PATCH routes (visibility, allowlist,
    // reset-window, launch, withdraw) all gate on creator_wallet equality,
    // so this is the foundational identity check.
    if (!creator_wallet || typeof creator_wallet !== 'string') {
      return NextResponse.json({ error: 'creator_wallet is required' }, { status: 400 });
    }
    try {
      new PublicKey(creator_wallet);
    } catch {
      return NextResponse.json({ error: 'Invalid creator_wallet' }, { status: 400 });
    }
    if (typeof auth_signature !== 'string' || typeof auth_message !== 'string') {
      return NextResponse.json(
        { error: 'Wallet signature required — please reconnect and retry' },
        { status: 401 },
      );
    }
    const authCheck = verifySignedAuthMessage(
      `create-meme:${creator_wallet}`,
      auth_message,
      auth_signature,
      creator_wallet,
    );
    if (!authCheck.ok) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    // ── Partner session lookup (optional) ──────────────────────────
    // If a partner_session_id was supplied, look it up and validate it
    // BEFORE we charge any fees. Reject early if the session is dead so
    // the user doesn't pay the creation fee on a doomed submission.
    let partnerSessionRow: {
      id: string; partner_id: string; creator_wallet: string;
      status: string; expires_at: string; meme_id: string | null;
    } | null = null;
    if (partner_session_id) {
      const { data: sess, error: sessErr } = await supabase
        .from('partner_sessions')
        .select('id, partner_id, creator_wallet, status, expires_at, meme_id')
        .eq('id', partner_session_id)
        .maybeSingle();
      if (sessErr) {
        console.error('Partner session lookup error:', sessErr);
        return NextResponse.json({ error: 'Failed to validate partner session' }, { status: 500 });
      }
      if (!sess) {
        return NextResponse.json({ error: 'Partner session not found' }, { status: 400 });
      }
      if (sess.status !== 'pending') {
        return NextResponse.json({ error: `Partner session is ${sess.status} and cannot be used` }, { status: 400 });
      }
      if (new Date(sess.expires_at) <= new Date()) {
        return NextResponse.json({ error: 'Partner session has expired' }, { status: 400 });
      }
      // Wallet identity check: only the wallet the partner registered can
      // complete the session. Prevents an attacker from hijacking someone
      // else's checkout link to mint a token under their name.
      if (sess.creator_wallet !== creator_wallet) {
        return NextResponse.json(
          { error: 'Connected wallet does not match the partner session creator_wallet' },
          { status: 403 },
        );
      }
      partnerSessionRow = sess;
    }

    // Validation
    if (!creator_wallet || !name || !symbol || !description || !image_url) {
      const missing = [];
      if (!creator_wallet) missing.push('creator_wallet');
      if (!name) missing.push('name');
      if (!symbol) missing.push('symbol');
      if (!description) missing.push('description');
      if (!image_url) missing.push('image_url');
      console.log('Missing fields:', missing);
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(', ')}` },
        { status: 400 }
      );
    }

    // Check for free-submission perk: holding >= threshold PROOF waives the
    // 0.02 SOL creation fee. Fail-closed: any RPC issue → fee required as
    // normal.
    const freeSubmission = await qualifiesForFreeSubmission(creator_wallet);

    if (!freeSubmission) {
      // Require creation fee payment
      if (!creation_fee_signature) {
        return NextResponse.json(
          { error: `Creation fee payment required (or hold ≥${FREE_SUBMISSION_THRESHOLD_TOKENS.toLocaleString()} PROOF for free submissions)` },
          { status: 400 }
        );
      }

      if (!creation_fee_sol || creation_fee_sol < CREATION_FEE_SOL) {
        return NextResponse.json(
          { error: `Creation fee must be at least ${CREATION_FEE_SOL} SOL` },
          { status: 400 }
        );
      }

      // Prevent replay — ensure this tx signature hasn't already been used for another meme
      const { data: existingMemeWithTx } = await supabase
        .from('memes')
        .select('id')
        .eq('creation_fee_signature', creation_fee_signature)
        .maybeSingle();
      if (existingMemeWithTx) {
        return NextResponse.json(
          { error: 'This creation fee transaction has already been used' },
          { status: 400 }
        );
      }

      // Verify the creation fee tx on-chain: creator_wallet spent >= CREATION_FEE_SOL
      // and the escrow received the fee
      const feeValid = await verifyDeposit(creation_fee_signature, CREATION_FEE_SOL, creator_wallet);
      if (!feeValid) {
        return NextResponse.json(
          { error: 'Creation fee transaction could not be verified on-chain' },
          { status: 400 }
        );
      }
    } else {
      console.log(`Free submission granted to ${creator_wallet} (PROOF holder perk)`);
    }

    // Validate slot-based backing system (max raised 8 → 24 in migration 021)
    if (!total_slots || total_slots < 2 || total_slots > 24) {
      return NextResponse.json(
        { error: 'Total slots must be between 2 and 24' },
        { status: 400 }
      );
    }

    if (!min_backing_sol || min_backing_sol < 0.05) {
      return NextResponse.json(
        { error: 'Minimum backing must be at least 0.05 SOL' },
        { status: 400 }
      );
    }

    // Optional per-backer ceiling (Phase 3.5). When set, must be ≥ min.
    if (max_backing_sol !== undefined && max_backing_sol !== null) {
      if (typeof max_backing_sol !== 'number' || max_backing_sol < min_backing_sol) {
        return NextResponse.json(
          { error: 'max_backing_sol must be a number ≥ min_backing_sol' },
          { status: 400 },
        );
      }
    }

    // Reserved slots (Phase 7). 0..total_slots inclusive.
    //   0                          = fully open launch
    //   1..total_slots - 1         = hybrid (some open, some reserved)
    //   total_slots                = TEAM ROUND (no public slots; UI shows the
    //                                "TEAM ROUND" badge so visitors see it upfront)
    // When > 0, initial_allowlist must have at least reserved_slots wallets.
    const reservedSlotsNum = Number.isFinite(Number(reserved_slots)) ? Math.floor(Number(reserved_slots)) : 0;
    if (reservedSlotsNum < 0 || reservedSlotsNum > total_slots) {
      return NextResponse.json(
        { error: `reserved_slots must be between 0 and ${total_slots}` },
        { status: 400 },
      );
    }
    if (reservedSlotsNum > 0) {
      // Creator wallet is auto-seeded into the allowlist below, so it
      // counts toward filling reserved slots. Dedup via Set in case the
      // user also pasted their own wallet into the textarea.
      const userWallets = Array.isArray(initial_allowlist)
        ? initial_allowlist.filter((w: unknown) => typeof w === 'string' && w.trim().length >= 32)
        : [];
      const distinct = new Set<string>((userWallets as string[]).map((w) => w.trim()));
      distinct.add(creator_wallet);
      if (distinct.size < reservedSlotsNum) {
        const needed = Math.max(0, reservedSlotsNum - 1 - (userWallets.length));
        return NextResponse.json(
          {
            error: `reserved_slots=${reservedSlotsNum} but only ${distinct.size} unique allowlist wallets (incl. creator). Add ${needed} more wallet${needed === 1 ? '' : 's'} to the allowlist.`,
          },
          { status: 400 },
        );
      }
    }

    if (symbol.length > 10) {
      return NextResponse.json(
        { error: 'Symbol must be 10 characters or less' },
        { status: 400 }
      );
    }

    // ── Visibility validation (Launch Config v2 — Phase 1) ──────────
    const VALID_VISIBILITIES = new Set(['open', 'stealth', 'spectator']);
    if (!VALID_VISIBILITIES.has(visibility)) {
      return NextResponse.json(
        { error: `visibility must be one of: open, stealth, spectator` },
        { status: 400 },
      );
    }
    // Fee distribution validation (Launch Config v2 — Phase 2). When
    // fee_preset is supplied, all five _pct fields must be present,
    // each 0-100, summing to exactly 100. Charity wallet required when
    // fee_charity_pct > 0. Missing fee_preset = NULL row = legacy behavior.
    const VALID_FEE_PRESETS = new Set(['standard', 'community_first', 'deflationary', 'charity_aligned', 'custom']);
    if (fee_preset !== undefined && fee_preset !== null) {
      if (!VALID_FEE_PRESETS.has(fee_preset)) {
        return NextResponse.json(
          { error: 'fee_preset must be one of: standard, community_first, deflationary, charity_aligned, custom' },
          { status: 400 },
        );
      }
      const pcts = [fee_backer_pct, fee_holder_rewards_pct, fee_platform_pct, fee_burn_pct, fee_charity_pct];
      if (pcts.some((p) => typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p > 100)) {
        return NextResponse.json(
          { error: 'All fee_*_pct fields must be integers 0-100' },
          { status: 400 },
        );
      }
      const sum = pcts.reduce((a: number, b: number) => a + b, 0);
      if (sum !== 100) {
        return NextResponse.json(
          { error: `Fee percentages must sum to 100 (got ${sum})` },
          { status: 400 },
        );
      }
      if (fee_charity_pct > 0) {
        if (typeof fee_charity_wallet !== 'string'
            || fee_charity_wallet.length < 32
            || fee_charity_wallet.length > 50) {
          return NextResponse.json(
            { error: 'fee_charity_wallet (valid Solana address) required when fee_charity_pct > 0' },
            { status: 400 },
          );
        }
      }
    }

    // Buyback bot validation (Phase 3 — migration 031). When enabled,
    // action must be one of the four supported modes. Currently 'burn'
    // and 'hold' are wired end-to-end; distribute_* return early in the
    // cron with a "Phase 3.1" notice but are accepted at submit so the
    // creator can flip later via dashboard.
    const VALID_BOT_ACTIONS = new Set([
      'burn',
      'hold',
      'distribute_tokens_holders',
      'distribute_tokens_backers',
      'distribute_sol_holders',
      'distribute_sol_backers',
      // DONATE — fire-and-forget to a fixed destination wallet
      // (committed at submit, immutable). Multiple allowed per meme
      // when destinations differ.
      'donate_sol',
      'donate_tokens',
      // POOL_FEEDER — auto-LP / protocol-owned liquidity. Single instance
      // per meme. Accumulates pre-grad, deploys LP post-grad.
      'feed_lp',
      // Legacy synonyms accepted for backwards compat.
      'distribute_holders',
      'distribute_backers',
    ]);
    // Server-side defense: USDC raises don't support buyback bots in
    // this release. UI hides the section, but a client that forges the
    // request must still get rejected. Same rule applies to the legacy
    // single-bot field and the new bots[] stack.
    if (quote_currency === 'usdc' && (buyback_bot_enabled || (Array.isArray(bots) && bots.length > 0))) {
      return NextResponse.json(
        { error: 'Buyback bots are not yet supported for USDC-quoted launches. Submit without bots; USDC bot support ships in a follow-up.' },
        { status: 400 },
      );
    }
    if (buyback_bot_enabled) {
      if (typeof buyback_bot_action !== 'string' || !VALID_BOT_ACTIONS.has(buyback_bot_action)) {
        return NextResponse.json(
          { error: 'buyback_bot_action must be one of: burn, hold, distribute_tokens_holders, distribute_tokens_backers, distribute_sol_holders, distribute_sol_backers' },
          { status: 400 },
        );
      }
      if (typeof buyback_bot_fee_pct !== 'number'
          || !Number.isFinite(buyback_bot_fee_pct)
          || buyback_bot_fee_pct < 0
          || buyback_bot_fee_pct > 100) {
        return NextResponse.json(
          { error: 'buyback_bot_fee_pct must be a number 0-100 (% of the backer pool routed to the bot)' },
          { status: 400 },
        );
      }
    }

    // Phase B — Bot stack validation. When `bots` array is supplied
    // (and non-empty), it supersedes the single-bot field above.
    // Constraints (must match what the UI enforces + migrations 042 / 043):
    //   - max 12 bots total (soft UI cap; real cap is the 90% budget)
    //   - single-instance actions (burn / distribute_*) at most once
    //   - HOLD (vault) can repeat — each requires a 1-24 char label
    //   - DONATE_* can repeat — each requires a destination_wallet
    //     (Solana pubkey 32-44 base58 chars), distinct per (action, dest)
    //   - each fee_pct in [5, 90]
    //   - total fee_pct across the stack ≤ 90
    interface BotInput {
      action: string;
      fee_pct: number;
      label?: string | null;
      destination_wallet?: string | null;
    }
    const VAULT_LABEL_RE = /^[A-Za-z0-9 _\-]+$/;
    // Solana base58 pubkey — 32-44 chars, alphabet excludes 0/I/O/l.
    const BASE58_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const HARD_CAP = 12;
    const REPEATABLE_ACTIONS = new Set(['hold', 'donate_sol', 'donate_tokens']);
    const DONATE_ACTIONS = new Set(['donate_sol', 'donate_tokens']);
    const botStack: BotInput[] = [];
    if (Array.isArray(bots) && bots.length > 0) {
      if (bots.length > HARD_CAP) {
        return NextResponse.json({ error: `Bot stack capped at ${HARD_CAP}` }, { status: 400 });
      }
      let stackSum = 0;
      const seenSingleAction = new Set<string>();
      const seenDonate = new Set<string>(); // `${action}::${destination}`
      for (const raw of bots) {
        if (!raw || typeof raw !== 'object') {
          return NextResponse.json({ error: 'each bot must be {action, fee_pct}' }, { status: 400 });
        }
        const action = (raw as { action?: unknown }).action;
        const feePct = (raw as { fee_pct?: unknown }).fee_pct;
        const labelRaw = (raw as { label?: unknown }).label;
        const destRaw  = (raw as { destination_wallet?: unknown }).destination_wallet;
        if (typeof action !== 'string' || !VALID_BOT_ACTIONS.has(action)) {
          return NextResponse.json({ error: `invalid bot action: ${String(action)}` }, { status: 400 });
        }
        if (!REPEATABLE_ACTIONS.has(action)) {
          if (seenSingleAction.has(action)) {
            return NextResponse.json(
              { error: `duplicate single-instance action: ${action} (only HOLD vaults + DONATE bots may repeat)` },
              { status: 400 },
            );
          }
          seenSingleAction.add(action);
        }
        if (typeof feePct !== 'number' || !Number.isFinite(feePct) || feePct < 5 || feePct > 90) {
          return NextResponse.json({ error: `bot ${action}: fee_pct must be a number 5-90` }, { status: 400 });
        }

        // Label rules (HOLD requires, DONATE optional, others forbid).
        let label: string | null = null;
        if (action === 'hold') {
          if (typeof labelRaw !== 'string') {
            return NextResponse.json({ error: 'vault bot requires a string label' }, { status: 400 });
          }
          const trimmed = labelRaw.trim();
          if (trimmed.length < 1 || trimmed.length > 24 || !VAULT_LABEL_RE.test(trimmed)) {
            return NextResponse.json(
              { error: `vault label "${trimmed}" must be 1-24 chars of letters / numbers / spaces / _ / -` },
              { status: 400 },
            );
          }
          label = trimmed;
        } else if (DONATE_ACTIONS.has(action)) {
          if (labelRaw != null && labelRaw !== '') {
            if (typeof labelRaw !== 'string') {
              return NextResponse.json({ error: 'donate bot label must be a string' }, { status: 400 });
            }
            const trimmed = labelRaw.trim();
            if (trimmed.length > 0) {
              if (trimmed.length > 24 || !VAULT_LABEL_RE.test(trimmed)) {
                return NextResponse.json(
                  { error: `donate label "${trimmed}" must be ≤24 chars of letters / numbers / spaces / _ / -` },
                  { status: 400 },
                );
              }
              label = trimmed;
            }
          }
        } else {
          if (labelRaw !== undefined && labelRaw !== null && labelRaw !== '') {
            return NextResponse.json(
              { error: `bot ${action}: only VAULT / DONATE bots can have a label` },
              { status: 400 },
            );
          }
        }

        // Destination wallet (DONATE only — required + valid pubkey).
        let destination_wallet: string | null = null;
        if (DONATE_ACTIONS.has(action)) {
          if (typeof destRaw !== 'string') {
            return NextResponse.json({ error: `bot ${action}: destination_wallet required` }, { status: 400 });
          }
          const trimmed = destRaw.trim();
          if (!BASE58_PUBKEY_RE.test(trimmed)) {
            return NextResponse.json({ error: `bot ${action}: destination_wallet must be a valid Solana base58 pubkey` }, { status: 400 });
          }
          // Final sanity — PublicKey constructor catches anything the
          // regex lets through (curve / length quirks).
          try { new (await import('@solana/web3.js')).PublicKey(trimmed); }
          catch { return NextResponse.json({ error: `bot ${action}: destination_wallet not a valid pubkey` }, { status: 400 }); }
          destination_wallet = trimmed;

          // No-dup on (action, destination) at API layer — DB partial
          // unique index also enforces this, but earlier feedback is nicer.
          const key = `${action}::${destination_wallet}`;
          if (seenDonate.has(key)) {
            return NextResponse.json(
              { error: `duplicate ${action} bot with same destination — combine into one with the summed fee_pct` },
              { status: 400 },
            );
          }
          seenDonate.add(key);
        } else if (destRaw != null && destRaw !== '') {
          return NextResponse.json(
            { error: `bot ${action}: destination_wallet is only valid for DONATE bots` },
            { status: 400 },
          );
        }

        botStack.push({ action, fee_pct: feePct, label, destination_wallet });
        stackSum += feePct;
      }
      if (stackSum > 90) {
        return NextResponse.json(
          { error: `Bot stack total ${stackSum}% exceeds the 90% cap (10% always to platform)` },
          { status: 400 },
        );
      }
    }

    // Parse + validate the initial allowlist. Used by:
    //   - Gated launches (visibility = stealth | spectator) — controls ALL backing
    //   - Reserved-slot launches (reserved_slots > 0) — controls reserved slot positions
    // Creator's own wallet gets auto-added after the meme insert.
    let validatedAllowlist: string[] = [];
    const needsAllowlist = visibility !== 'open' || reservedSlotsNum > 0;
    if (needsAllowlist) {
      if (!Array.isArray(initial_allowlist)) {
        return NextResponse.json(
          { error: 'initial_allowlist must be an array of wallet addresses' },
          { status: 400 },
        );
      }
      // Dedupe + filter empty + reject obvious non-pubkey shapes
      // (full base58 validation would require a PublicKey import here;
      //  the DB UNIQUE constraint will catch duplicates and any bad
      //  insert would fail loud — this is a cheap pre-filter.)
      validatedAllowlist = Array.from(new Set(
        initial_allowlist
          .filter((w: unknown): w is string => typeof w === 'string')
          .map((w: string) => w.trim())
          .filter((w: string) => w.length >= 32 && w.length <= 50),
      ));
    }

    // Calculate deadline
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + (backing_days || 7));

    // Ensure user exists
    const { error: userError } = await supabase
      .from('users')
      .upsert({ wallet_address: creator_wallet }, { onConflict: 'wallet_address' });

    if (userError) {
      console.error('User upsert error:', userError);
    }

    // Phase B — If the caller supplied a bots[] stack, that's the source
    // of truth and we generate one keypair per bot. Otherwise, fall back
    // to the legacy single-bot shape and synthesize a 1-item stack.
    const effectiveStack: { action: string; fee_pct: number; label?: string | null; destination_wallet?: string | null }[] = botStack.length > 0
      ? botStack
      : (buyback_bot_enabled
          ? [{ action: buyback_bot_action as string, fee_pct: Number(buyback_bot_fee_pct) }]
          : []);

    const generatedBots: { action: string; fee_pct: number; label: string | null; destination_wallet: string | null; wallet: string; encryptedKey: string }[] =
      effectiveStack.map((bot) => {
        const kp = Keypair.generate();
        return {
          action: bot.action,
          fee_pct: bot.fee_pct,
          // HOLD: label defaults to 'Vault' (legacy single-bot path); else
          // preserved as-is. DONATE: label optional.
          label: bot.action === 'hold' ? (bot.label || 'Vault') : (bot.label ?? null),
          // DONATE: destination set at validation time above; immutable.
          destination_wallet: bot.destination_wallet ?? null,
          wallet: kp.publicKey.toBase58(),
          encryptedKey: encryptPrivateKey(bs58.encode(kp.secretKey)),
        };
      });

    // The legacy memes.buyback_bot_* columns stay populated when there's
    // EXACTLY one bot (so the DB CHECK constraint is satisfied). For
    // multi-bot stacks we leave the legacy fields empty + enabled=false;
    // the new meme_bots table is the source of truth from here on.
    const legacyMode = generatedBots.length === 1;
    const buybackBotWallet: string | null = legacyMode ? generatedBots[0].wallet : null;
    const encryptedBuybackBotKey: string | null = legacyMode ? generatedBots[0].encryptedKey : null;
    const legacyAction = legacyMode ? generatedBots[0].action : null;
    const legacyFeePct = legacyMode ? generatedBots[0].fee_pct : 0;

    // Create meme with slot-based backing system
    const { data, error } = await supabase
      .from('memes')
      .insert({
        creator_wallet,
        name,
        symbol: symbol.toUpperCase(),
        description,
        image_url,
        banner_url: banner_url || null,
        creator_twitter,
        twitter,
        telegram,
        discord,
        website,
        github,
        // Slot-based backing system
        total_slots,
        reserved_slots: reservedSlotsNum,
        min_backing_sol,
        max_backing_sol: (typeof max_backing_sol === 'number') ? max_backing_sol : null,
        backing_goal_sol: min_backing_sol * total_slots, // Minimum possible raise (for compatibility)
        backing_deadline: deadline.toISOString(),
        status: 'backing', // Start in backing phase
        submission_fee_paid: true, // Fee paid via creation_fee_signature (or waived for PROOF holders)
        current_backing_sol: 0, // Starts at 0, backers add to this
        // Trust score parameters
        creator_fee_pct,
        backer_share_pct,
        dev_initial_buy_sol,
        auto_refund: true, // Always auto-refund on failure - no option to hold backer funds
        trust_score,
        // Partner attribution — set only when this submission came from a
        // partner hosted-checkout session. Drives the "Launched via X" badge
        // on the public token page and rev-share routing at fee distribution.
        partner_id: partnerSessionRow?.partner_id ?? null,
        partner_session_id: partnerSessionRow?.id ?? null,
        // Launch Configuration v2 — visibility mode
        visibility,
        // Multi-launchpad dispatch (migration 046). Validated below
        // against the same allowlist /services/launch/index.ts knows
        // about — anything outside the set falls back to 'pumpfun'.
        launch_platform:
          ['pumpfun', 'meteora', 'bags', 'bonk', 'launchlab'].includes(launch_platform)
            ? launch_platform
            : 'pumpfun',
        // Quote currency (migration 053). 'sol' is the universal default
        // — keeps every existing flow unchanged. 'usdc' is only accepted
        // when paired with launch_platform='meteora' (the only launchpad
        // with USDC config support today). Anything else gets demoted to
        // 'sol' silently so a malformed submit doesn't strand SOL in a
        // pool that can't actually launch.
        quote_currency:
          quote_currency === 'usdc' && launch_platform === 'meteora'
            ? 'usdc'
            : 'sol',
        // Launch Configuration v2 — fee distribution config.
        // When fee_preset is undefined we pass NULL across the board,
        // which the distribution code treats as legacy hardcoded behavior.
        fee_preset:             fee_preset ?? null,
        fee_backer_pct:         fee_preset ? fee_backer_pct : null,
        fee_holder_rewards_pct: fee_preset ? fee_holder_rewards_pct : null,
        fee_platform_pct:       fee_preset ? fee_platform_pct : null,
        fee_burn_pct:           fee_preset ? fee_burn_pct : null,
        fee_charity_pct:        fee_preset ? fee_charity_pct : null,
        fee_charity_wallet:     fee_preset && fee_charity_pct > 0 ? fee_charity_wallet : null,
        // Phase 5 → Phase B. Legacy single-bot fields stay populated
        // ONLY when the stack has exactly 1 bot (so DB constraint passes
        // + backwards-compat queries still work). For 2+ bots, legacy
        // fields are NULL/false and the real source of truth is the
        // meme_bots rows inserted below.
        buyback_bot_enabled:        legacyMode,
        buyback_bot_action:         legacyAction,
        buyback_bot_fee_pct:        legacyFeePct,
        buyback_bot_wallet:         buybackBotWallet,
        encrypted_buyback_bot_key:  encryptedBuybackBotKey,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ── Bot stack rows (Phase B) ───────────────────────────────────
    // Insert one meme_bots row per bot in the stack. Per-bot wallets
    // already generated above. Slot_order matches the input order so
    // the UI can render the stack consistently. Failure here surfaces
    // but doesn't roll back the meme (creator can re-create bots from
    // their dashboard).
    if (generatedBots.length > 0 && data) {
      const botRows = generatedBots.map((bot, i) => ({
        meme_id: data.id,
        slot_order: i,
        action: bot.action,
        fee_pct: bot.fee_pct,
        bot_wallet: bot.wallet,
        encrypted_bot_key: bot.encryptedKey,
        // Label: required for HOLD, optional for DONATE, NULL for others.
        // Destination wallet: required for DONATE_*, NULL otherwise.
        // generatedBots already enforces this shape; DB CHECKs reject anything off.
        label: bot.label,
        destination_wallet: bot.destination_wallet,
      }));
      const { error: botInsertErr } = await supabase
        .from('meme_bots')
        .insert(botRows);
      if (botInsertErr) {
        console.error('Bot stack insert failed (meme created, bots can be added via dashboard):', botInsertErr);
      }
    }

    // ── Allowlist setup (Launch Config v2 — Phase 1) ────────────────
    // For stealth + spectator launches, seed the backing_allowlist with:
    //   1. The creator's own wallet (always, so they can back their own launch)
    //   2. Any wallets they supplied in initial_allowlist
    // Failures here log but don't roll back the meme — the creator can
    // re-add wallets via the dashboard if anything went wrong.
    if (needsAllowlist && data) {
      const allowlistRows = [
        { meme_id: data.id, wallet: creator_wallet, added_by: creator_wallet, note: 'creator (auto)' },
        ...validatedAllowlist
          .filter((w) => w !== creator_wallet)
          .map((wallet) => ({ meme_id: data.id, wallet, added_by: creator_wallet, note: null })),
      ];
      const { error: allowlistErr } = await supabase
        .from('backing_allowlist')
        .insert(allowlistRows);
      if (allowlistErr) {
        console.error('Allowlist seed failed (meme created, creator can re-add):', allowlistErr);
      }

      // Audit log the initial visibility state for the transparency trail.
      await supabase.from('meme_visibility_changes').insert({
        meme_id: data.id,
        from_value: null,
        to_value: visibility,
        changed_by: creator_wallet,
        reason: 'initial_at_submission',
      });
    }

    // Provision this meme's POOL wallet — the wallet backers fund and
    // that does the atomic createV2+buy at launch. This is a plain
    // RANDOM keypair: the vanity is reserved for the token CA (the
    // mint), consumed at launch — that's the most-visible address and
    // the brand signal. The pool wallet doesn't need to be vanity.
    const poolKp = Keypair.generate();
    const poolWallet = poolKp.publicKey.toBase58();
    const encryptedPoolKey = encryptPrivateKey(bs58.encode(poolKp.secretKey));

    // Also provision this meme's per-coin CREATOR sub-escrow keypair.
    // It will be passed as the `creator` arg to createV2 at launch
    // (instead of the shared platform escrow), so pump.fun's
    // creator-vault PDA is keyed per-meme — isolating this coin's
    // trading fees in its own vault we can collect from independently.
    // Holds 0% tokens, never buys, signs only at fee-distribution time.
    // Backwards compatible: launchPooledAtomic falls back to shared
    // escrow when this column is NULL (i.e. for pre-Phase-2 memes).
    const subKp = Keypair.generate();
    const subPub = subKp.publicKey.toBase58();
    const encryptedSubKey = encryptPrivateKey(bs58.encode(subKp.secretKey));

    // Bot keypair already generated + inserted above (constraint required
    // it to be present at INSERT time). Pool + sub-escrow get patched
    // via UPDATE because they have no constraint forcing co-presence.
    const { error: poolErr } = await supabase
      .from('memes')
      .update({
        pool_wallet: poolWallet,
        encrypted_pool_key: encryptedPoolKey,
        creator_subescrow_pubkey: subPub,
        encrypted_creator_subescrow_key: encryptedSubKey,
      })
      .eq('id', data.id);
    if (poolErr) {
      // Pool/sub-escrow are essential — fail the submission cleanly
      // rather than leave a meme that can never launch or share fees.
      // (The co-presence CHECK constraint also guarantees we never end
      // up with one sub-escrow column set without the other.)
      await supabase.from('memes').delete().eq('id', data.id);
      return NextResponse.json({ error: `Wallet provisioning failed: ${poolErr.message}` }, { status: 500 });
    }
    (data as { pool_wallet?: string; creator_subescrow_pubkey?: string; buyback_bot_wallet?: string | null }).pool_wallet = poolWallet;
    (data as { creator_subescrow_pubkey?: string }).creator_subescrow_pubkey = subPub;

    // Note: Creation fee goes to escrow, not recorded as a backing
    // The creator's token wallet is stored on the meme itself, not as a backing record
    // This prevents the creation fee from showing in portfolio as a "backing"

    // Update user's meme count
    await supabase.rpc('increment_memes_created', { wallet: creator_wallet });

    // Mark the partner session as submitted so polling + future webhooks
    // see the linked meme_id. Best-effort — failure here doesn't roll
    // back the meme creation (the meme is already valid; we just lose
    // partner attribution polling if this fails, which is recoverable
    // via the partner_id column on memes).
    if (partnerSessionRow) {
      const { error: sessUpdateErr } = await supabase
        .from('partner_sessions')
        .update({
          status: 'submitted',
          meme_id: data.id,
          submitted_at: new Date().toISOString(),
        })
        .eq('id', partnerSessionRow.id);
      if (sessUpdateErr) {
        console.warn('Partner session update failed (meme still created):', sessUpdateErr.message);
      }
    }

    return NextResponse.json({ meme: data }, { status: 201 });
  } catch (error) {
    console.error('Create meme error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
