import { Connection, PublicKey } from '@solana/web3.js';
import { createServerClient } from '@/lib/supabase';
import {
  JITO_TIP_ACCOUNTS,
  BUYBACK_FEE_RECIPIENTS,
  EXPECTED_PUMP_BUY_ACCOUNT_COUNT,
} from './pumpfun';

// READ-ONLY drift detector.
//
// This never touches the launch path. It only reads authoritative
// sources and compares them to the constants the launch code depends
// on, so we learn that pump.fun or Jito changed something BEFORE a
// real creator's launch hits it. Findings are persisted to
// launch_events (meme_id null) and logged loudly.
//
// Covers exactly the two break classes that have actually bitten us:
//   - Jito rotating their tip-account list
//   - pump.fun changing the buy instruction's account shape
// Anything subtler is still bounded financially by the reconcile/
// auto-refund net — that is the backstop, this is the early warning.

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JITO_TIP_RPC = 'https://mainnet.block-engine.jito.wtf/api/v1/getTipAccounts';

// pump.fun mainnet program + the stable `buy` instruction discriminator.
// Protocol constants; duplicated here intentionally so the read-only
// checker stays decoupled from the launch service internals.
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const BUY_DISCRIMINATOR_HEX = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]).toString('hex');

export interface DriftResult {
  ok: boolean;
  checkedAt: string;
  jito: { ok: boolean; detail: string };
  pump: { ok: boolean; detail: string };
}

async function checkJitoTips(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(JITO_TIP_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
    });
    const json = await res.json();
    const live: string[] = json?.result || [];
    if (!Array.isArray(live) || live.length === 0) {
      return { ok: false, detail: 'Jito getTipAccounts returned no accounts (RPC issue?)' };
    }
    const liveSet = new Set(live);
    const ourSet = new Set(JITO_TIP_ACCOUNTS);
    const missing = JITO_TIP_ACCOUNTS.filter((a) => !liveSet.has(a));
    const added = live.filter((a) => !ourSet.has(a));
    if (missing.length === 0 && added.length === 0) {
      return { ok: true, detail: `all ${JITO_TIP_ACCOUNTS.length} tip accounts current` };
    }
    return {
      ok: false,
      detail: `JITO TIP DRIFT — ours-no-longer-valid: [${missing.join(', ')}] ; new-on-jito: [${added.join(', ')}]`,
    };
  } catch (e) {
    return { ok: false, detail: `Jito tip check failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function checkPumpBuyLayout(): Promise<{ ok: boolean; detail: string }> {
  try {
    const conn = new Connection(RPC_URL, 'confirmed');
    const pump = new PublicKey(PUMP_PROGRAM_ID);
    const sigs = await conn.getSignaturesForAddress(pump, { limit: 80 });

    let inspected = 0;
    const countMismatches: number[] = [];
    let buybackHits = 0;
    let buybackChecked = 0;

    for (const s of sigs) {
      if (s.err) continue;
      const tx = await conn.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (!tx) continue;
      const m = tx.transaction.message;
      const staticKeys = (m.staticAccountKeys || []).map((k) => k.toBase58());
      const ld = tx.meta?.loadedAddresses;
      const allKeys = [
        ...staticKeys,
        ...((ld?.writable || []).map((k) => k.toString())),
        ...((ld?.readonly || []).map((k) => k.toString())),
      ];
      for (const ix of m.compiledInstructions || []) {
        if (allKeys[ix.programIdIndex] !== PUMP_PROGRAM_ID) continue;
        const data = ix.data instanceof Uint8Array ? Buffer.from(ix.data) : Buffer.from(ix.data, 'base64');
        if (data.subarray(0, 8).toString('hex') !== BUY_DISCRIMINATOR_HEX) continue;
        const acctIdx = ix.accountKeyIndexes || [];
        inspected++;
        if (acctIdx.length !== EXPECTED_PUMP_BUY_ACCOUNT_COUNT) {
          countMismatches.push(acctIdx.length);
        } else {
          // account index 17 is the buyback fee recipient we append
          buybackChecked++;
          const a17 = allKeys[acctIdx[17]];
          if ((BUYBACK_FEE_RECIPIENTS as PublicKey[]).some((p) => p.toBase58() === a17)) {
            buybackHits++;
          }
        }
        break;
      }
      if (inspected >= 5) break;
    }

    if (inspected === 0) {
      return { ok: false, detail: 'no live pump.fun buy found to compare (RPC/sampling issue, not necessarily drift)' };
    }
    if (countMismatches.length > 0) {
      return {
        ok: false,
        detail: `PUMP BUY LAYOUT DRIFT — live buys have ${[...new Set(countMismatches)].join('/')} accounts, we send ${EXPECTED_PUMP_BUY_ACCOUNT_COUNT}`,
      };
    }
    if (buybackChecked > 0 && buybackHits === 0) {
      return {
        ok: false,
        detail: `PUMP BUYBACK RECIPIENT DRIFT — none of ${buybackChecked} live buys' account[17] is in our buyback list`,
      };
    }
    return {
      ok: true,
      detail: `${inspected} live buys all ${EXPECTED_PUMP_BUY_ACCOUNT_COUNT} accounts; buyback recipient matched ${buybackHits}/${buybackChecked}`,
    };
  } catch (e) {
    return { ok: false, detail: `pump buy check failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function runDriftCheck(persist = true): Promise<DriftResult> {
  const [jito, pump] = await Promise.all([checkJitoTips(), checkPumpBuyLayout()]);
  const result: DriftResult = {
    ok: jito.ok && pump.ok,
    checkedAt: new Date().toISOString(),
    jito,
    pump,
  };

  if (result.ok) {
    console.log(`[drift] OK — jito: ${jito.detail} | pump: ${pump.detail}`);
  } else {
    console.error(`[drift] DRIFT DETECTED — jito(${jito.ok ? 'ok' : 'FAIL'}): ${jito.detail} | pump(${pump.ok ? 'ok' : 'FAIL'}): ${pump.detail}`);
  }

  if (persist) {
    try {
      const sb = createServerClient();
      await sb.from('launch_events').insert({
        meme_id: null,
        backer_wallet: null,
        phase: result.ok ? 'drift_ok' : 'drift_detected',
        ok: result.ok,
        signature: null,
        detail: result as unknown as Record<string, unknown>,
      });
    } catch (e) {
      console.error('[drift] failed to persist result:', e instanceof Error ? e.message : String(e));
    }
  }

  return result;
}
