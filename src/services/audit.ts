import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, getMint,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT,
} from '@solana/spl-token';
import type { SupabaseClient } from '@supabase/supabase-js';

// Server-side audit. Mirrors the logic in tools/audit-meme.mjs so the
// public /proof page and partner-facing API can render the same checks
// the operator runs locally. Output is a structured JSON receipt so
// it's renderable by any client.
//
// Five checks (V1):
//   A. Phantom-success scan: every meme_buybacks row claiming
//      completed/partial must point at a tx that actually succeeded.
//   B. Bot wallet balance reconciliation: DB lifetime sums vs on-chain.
//   C. Uncollected fee surfaces: BC vault, PumpSwap auth PDA + wSOL,
//      sub-escrow native + wSOL ATA.
//   D. Mint supply drop vs DB burn deltas.
//   E. Backer credit totals (DB-only sanity).
//
// Severity:
//   CRITICAL → CRITICAL findings exist
//   warn     → at least one warn, no CRITICAL
//   clean    → only info findings or none

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const RENT_EXEMPT = 890_880;
const PUMPFUN_DEFAULT_SUPPLY = BigInt(1_000_000_000);
const DRAINABLE_THRESHOLD_LAMPORTS = 50_000;

export type Severity = 'CRITICAL' | 'warn' | 'info';
// 'na' = meme has no bot stack, so the audit checks don't meaningfully
// apply (nothing to reconcile, no phantoms possible, no fee surfaces
// beyond the cron's standard drain). We return it explicitly instead of
// silently running checks that would all pass and create false confidence.
export type AuditStatus = 'clean' | 'warn' | 'CRITICAL' | 'na';

export interface Finding {
  severity: Severity;
  area: string;
  msg: string;
}

export interface AuditReport {
  meme_id: string;
  symbol: string;
  name: string;
  mint_address: string | null;
  status: AuditStatus;
  ran_at: string;            // ISO timestamp
  findings: Finding[];
  summary: {
    rows_verified: number;
    rows_phantom: number;
    burn_on_chain: string;   // string for BigInt safety in JSON
    burn_db_sum: string;
    burn_drift_pct: number | null;
    uncollected_lamports: number;
    bot_count: number;
    backer_count: number;
    total_claimable_sol: number;
  };
}

interface MemeRow {
  id: string;
  symbol: string;
  name: string;
  status: string;
  mint_address: string | null;
  launch_platform: string | null;
  creator_subescrow_pubkey: string | null;
}

export async function runAudit(
  supabase: SupabaseClient,
  conn: Connection,
  memeId: string,
): Promise<AuditReport> {
  const { data: meme, error: memeErr } = await supabase
    .from('memes')
    .select('id, symbol, name, status, mint_address, launch_platform, creator_subescrow_pubkey')
    .eq('id', memeId)
    .single();
  if (memeErr || !meme) {
    throw new Error(`audit: meme not found (${memeId})`);
  }
  const m = meme as MemeRow;

  const findings: Finding[] = [];
  const summary: AuditReport['summary'] = {
    rows_verified: 0,
    rows_phantom: 0,
    burn_on_chain: '0',
    burn_db_sum: '0',
    burn_drift_pct: null,
    uncollected_lamports: 0,
    bot_count: 0,
    backer_count: 0,
    total_claimable_sol: 0,
  };

  // ── Mint info ─────────────────────────────────────────────────────
  let mintInfo: Awaited<ReturnType<typeof getMint>> | null = null;
  let tokenProgramId = TOKEN_PROGRAM_ID;
  let decimals = 6;
  if (m.mint_address) {
    try {
      const mintPub = new PublicKey(m.mint_address);
      const mintAcc = await conn.getAccountInfo(mintPub);
      if (mintAcc) {
        tokenProgramId = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        mintInfo = await getMint(conn, mintPub, 'confirmed', tokenProgramId);
        decimals = mintInfo.decimals;
      }
    } catch { /* unlaunched or RPC hiccup — handled below */ }
  }

  // ── A. PHANTOM-SUCCESS SCAN ──────────────────────────────────────
  const { data: buybacks } = await supabase
    .from('meme_buybacks')
    .select('id, executed_at, action, status, action_tx, swap_tx, sol_spent_lamports, tokens_acted_raw')
    .eq('meme_id', m.id)
    .in('status', ['completed', 'partial'])
    .order('executed_at', { ascending: false });
  for (const r of buybacks || []) {
    const sig = r.action_tx || r.swap_tx;
    if (!sig) continue;
    summary.rows_verified++;
    try {
      const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!tx) {
        findings.push({
          severity: 'warn', area: 'A',
          msg: `tx not found (RPC may not have it): ${sig.slice(0, 12)}… action=${r.action}`,
        });
        continue;
      }
      if (tx.meta?.err) {
        summary.rows_phantom++;
        const sol = (Number(r.sol_spent_lamports) / LAMPORTS_PER_SOL).toFixed(4);
        findings.push({
          severity: 'CRITICAL', area: 'A',
          msg: `PHANTOM: DB says ${r.status}, on-chain reverted. action=${r.action} spent=${sol} SOL tx=${sig} err=${JSON.stringify(tx.meta.err)}`,
        });
      }
    } catch (e) {
      findings.push({
        severity: 'warn', area: 'A',
        msg: `RPC error verifying ${sig.slice(0, 12)}…: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`,
      });
    }
  }

  // ── B. BOT WALLET RECONCILIATION ─────────────────────────────────
  const { data: bots } = await supabase
    .from('meme_bots')
    .select('id, action, fee_pct, bot_wallet, total_sol_spent, total_tokens_acted')
    .eq('meme_id', m.id);
  summary.bot_count = bots?.length || 0;

  // Early-exit for no-bot memes: the rest of the audit would all be
  // trivially clean (nothing to reconcile against). Return 'na' so the
  // UI can show "no bot stack — audit doesn't apply" honestly.
  if (summary.bot_count === 0) {
    const { data: backings0 } = await supabase
      .from('backings')
      .select('id, claimable_fees_sol, status')
      .eq('meme_id', m.id);
    summary.backer_count = backings0?.length || 0;
    summary.total_claimable_sol = (backings0 || []).reduce(
      (s, b) => s + Number(b.claimable_fees_sol || 0),
      0,
    );
    return {
      meme_id: m.id,
      symbol: m.symbol,
      name: m.name,
      mint_address: m.mint_address,
      status: 'na',
      ran_at: new Date().toISOString(),
      findings: [],
      summary,
    };
  }

  for (const b of bots || []) {
    try {
      const wal = new PublicKey(b.bot_wallet);
      const tokenAta = m.mint_address
        ? getAssociatedTokenAddressSync(new PublicKey(m.mint_address), wal, false, tokenProgramId)
        : null;
      let tokenBal = BigInt(0);
      if (tokenAta) {
        const info = await conn.getAccountInfo(tokenAta);
        if (info) tokenBal = info.data.readBigUInt64LE(64);
      }
      if (b.action === 'hold') {
        const dbSnapshot = BigInt(b.total_tokens_acted || 0);
        if (dbSnapshot !== tokenBal) {
          findings.push({
            severity: 'warn', area: 'B',
            msg: `HOLD bot DB tokens (${dbSnapshot.toString()}) ≠ on-chain ATA (${tokenBal.toString()}).`,
          });
        }
      } else if (b.action === 'burn' && tokenBal !== BigInt(0)) {
        const decTok = (Number(tokenBal) / Math.pow(10, decimals)).toFixed(2);
        findings.push({
          severity: 'warn', area: 'B',
          msg: `BURN bot wallet still holds ${decTok} ${m.symbol} tokens (expected 0 after burn).`,
        });
      }
    } catch (e) {
      findings.push({
        severity: 'warn', area: 'B',
        msg: `bot ${b.action} balance read failed: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`,
      });
    }
  }

  // ── C. UNCOLLECTED FEE SURFACES ──────────────────────────────────
  if (m.creator_subescrow_pubkey) {
    try {
      const sub = new PublicKey(m.creator_subescrow_pubkey);
      const [bcVault] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), sub.toBuffer()], PUMP_PROGRAM_ID);
      const [ammAuth] = PublicKey.findProgramAddressSync([Buffer.from('creator_vault'), sub.toBuffer()], PUMP_AMM_PROGRAM_ID);
      const ammWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, ammAuth, true);
      const subWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, sub, true);
      const [bcBal, ammAuthBal, ammWsolInfo, subBal, subWsolInfo] = await Promise.all([
        conn.getBalance(bcVault),
        conn.getBalance(ammAuth),
        conn.getAccountInfo(ammWsolAta),
        conn.getBalance(sub),
        conn.getAccountInfo(subWsolAta),
      ]);
      const ammAuthFees = Math.max(0, ammAuthBal - RENT_EXEMPT);
      const ammWsol = ammWsolInfo ? Number(ammWsolInfo.data.readBigUInt64LE(64)) : 0;
      const subWsol = subWsolInfo ? Number(subWsolInfo.data.readBigUInt64LE(64)) : 0;
      const totalUncollected = bcBal + ammAuthFees + ammWsol + subBal + subWsol;
      summary.uncollected_lamports = totalUncollected;
      if (totalUncollected > LAMPORTS_PER_SOL) {
        findings.push({
          severity: 'warn', area: 'C',
          msg: `${(totalUncollected / LAMPORTS_PER_SOL).toFixed(4)} SOL uncollected across fee surfaces — cron should clear, investigate if persistent.`,
        });
      } else if (totalUncollected > DRAINABLE_THRESHOLD_LAMPORTS) {
        findings.push({
          severity: 'info', area: 'C',
          msg: `${(totalUncollected / LAMPORTS_PER_SOL).toFixed(6)} SOL across uncollected fee surfaces (normal between cron ticks).`,
        });
      }
    } catch (e) {
      findings.push({
        severity: 'warn', area: 'C',
        msg: `uncollected probe failed: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`,
      });
    }
  }

  // ── D. BURN SUPPLY vs DB DELTAS ──────────────────────────────────
  if (mintInfo) {
    try {
      const originalRaw = PUMPFUN_DEFAULT_SUPPLY * BigInt(Math.pow(10, decimals));
      const supply = mintInfo.supply;
      const onChainBurned = originalRaw - supply;
      summary.burn_on_chain = onChainBurned.toString();
      const { data: burnRuns } = await supabase
        .from('meme_buybacks')
        .select('tokens_acted_raw')
        .eq('meme_id', m.id)
        .eq('action', 'burn')
        .in('status', ['completed', 'partial']);
      const dbBurned = (burnRuns || []).reduce(
        (s: bigint, r: { tokens_acted_raw: string | number | null }) => s + BigInt(r.tokens_acted_raw || 0),
        BigInt(0),
      );
      summary.burn_db_sum = dbBurned.toString();
      if (onChainBurned !== dbBurned && onChainBurned > BigInt(0)) {
        const driftAbs = onChainBurned > dbBurned ? onChainBurned - dbBurned : dbBurned - onChainBurned;
        const driftPct = (Number(driftAbs) / Number(onChainBurned)) * 100;
        summary.burn_drift_pct = driftPct;
        if (driftPct < 1) {
          findings.push({
            severity: 'info', area: 'D',
            msg: `burn drift ${(Number(driftAbs) / Math.pow(10, decimals)).toFixed(2)} ${m.symbol} (${driftPct.toFixed(3)}% of on-chain) — likely rounding from swap-vs-burn-ix decimals.`,
          });
        } else {
          findings.push({
            severity: 'warn', area: 'D',
            msg: `burn drift ${(Number(driftAbs) / Math.pow(10, decimals)).toFixed(2)} ${m.symbol} (${driftPct.toFixed(2)}% of on-chain) — investigate.`,
          });
        }
      }
    } catch (e) {
      findings.push({
        severity: 'warn', area: 'D',
        msg: `burn reconciliation failed: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`,
      });
    }
  }

  // ── E. BACKER CREDIT TOTALS ──────────────────────────────────────
  const { data: backings } = await supabase
    .from('backings')
    .select('id, claimable_fees_sol, status')
    .eq('meme_id', m.id);
  summary.backer_count = backings?.length || 0;
  summary.total_claimable_sol = (backings || []).reduce(
    (s, b) => s + Number(b.claimable_fees_sol || 0),
    0,
  );

  // ── Roll up status ───────────────────────────────────────────────
  const hasCritical = findings.some((f) => f.severity === 'CRITICAL');
  const hasWarn = findings.some((f) => f.severity === 'warn');
  const status: AuditStatus = hasCritical ? 'CRITICAL' : hasWarn ? 'warn' : 'clean';

  return {
    meme_id: m.id,
    symbol: m.symbol,
    name: m.name,
    mint_address: m.mint_address,
    status,
    ran_at: new Date().toISOString(),
    findings,
    summary,
  };
}
