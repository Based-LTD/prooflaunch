import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { createGate } from '@/services/keycard';
import { authorizeCron } from '@/lib/cronAuth';

// Phase 4 — Keycard backer-lounge sync.
//
// Cron + manual trigger. Iterates live memes that don't yet have a
// keycard_gate_id and creates a gate scoped to >0 balance of the
// meme's mint. Idempotent: once a meme has a gate_id, it's skipped
// forever (only re-run if you NULL the column manually).
//
// No API key required — Keycard's /v1/gates is open. Auth is per-call
// via SIWS challenge → sign with platform escrow wallet. See
// src/services/keycard.ts for the full flow.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// All pump.fun launches use 6 decimals. If we ever support custom
// decimals tokens we'll need to fetch via getMint() — for now this is
// always correct and saves an RPC call per sync.
const PUMP_DECIMALS = 6;

function welcomeContent(meme: { name: string; symbol: string; twitter?: string | null; website?: string | null; id: string }): string {
  const lines = [
    `# Welcome to the $${meme.symbol} backer lounge`,
    '',
    `You're here because you hold **$${meme.symbol}** — a token launched on [Proof Launch](https://prooflaunch.fun).`,
    '',
    `**${meme.name}**`,
    '',
    'This is a private space for holders. Watch for:',
    '- Project updates from the creator',
    '- Holder-only drops + opportunities',
    '- Direct comms with the team',
    '',
    'Your access is checked live against your on-chain balance. Sell your tokens, lose your access.',
    '',
  ];
  if (meme.twitter) lines.push(`Twitter: ${meme.twitter}`);
  if (meme.website) lines.push(`Website: ${meme.website}`);
  lines.push('');
  lines.push(`[View token on Proof Launch](https://prooflaunch.fun/meme/${meme.id})`);
  return lines.join('\n');
}

export async function GET(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createServerClient();
    const { data: memes } = await supabase
      .from('memes')
      .select('id, name, symbol, mint_address, twitter, website')
      .eq('status', 'live')
      .is('keycard_gate_id', null)
      .not('mint_address', 'is', null)
      .limit(20);

    const results: Array<{ memeId: string; symbol: string; ok: boolean; openUrl?: string; error?: string }> = [];

    for (const m of memes || []) {
      if (!m.mint_address) continue;
      const res = await createGate({
        name: `$${m.symbol} backer lounge`,
        description: `Holder-only space for ${m.name}. Verify your wallet to enter.`,
        mint: m.mint_address,
        symbol: `$${m.symbol}`,
        minAmount: 1,
        decimals: PUMP_DECIMALS,
        getAccessUrl: `https://prooflaunch.fun/meme/${m.id}`,
        fileContent: welcomeContent(m),
        fileName: `${m.symbol}-welcome.md`,
      });
      if (res.ok && res.gate) {
        await supabase
          .from('memes')
          .update({
            keycard_gate_id: res.gate.gateId,
            keycard_gate_url: res.gate.openUrl,
            keycard_admin_url: res.gate.adminUrl,
            keycard_synced_at: new Date().toISOString(),
          })
          .eq('id', m.id);
        results.push({ memeId: m.id, symbol: m.symbol, ok: true, openUrl: res.gate.openUrl });
        console.log(`[keycard/sync] gate created for ${m.symbol} (${m.id}): ${res.gate.openUrl}`);
      } else {
        results.push({ memeId: m.id, symbol: m.symbol, ok: false, error: res.error });
        console.error(`[keycard/sync] FAILED for ${m.symbol} (${m.id}): ${res.error}`);
      }
    }

    return NextResponse.json({
      success: true,
      scanned: memes?.length || 0,
      created: results.filter((r) => r.ok).length,
      results,
    });
  } catch (e) {
    console.error('[keycard/sync] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}
