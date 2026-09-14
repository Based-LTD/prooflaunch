#!/usr/bin/env node
// Posts the scheduled PoolLaunch tweet from docs/x-content-calendar.md.
//
// Scheduling is stateless: the post is picked by (days since
// X_QUEUE_START) and the slot, so the cron is idempotent per slot and
// there's no state file to commit. The queue wraps around when the
// calendar runs out (refresh the calendar to change the rotation).
//
//   node tools/x-post.mjs [1|2]     # slot; defaults by UTC hour (<19 → 1)
//   DRY_RUN=1 node tools/x-post.mjs # print, don't post
//
// Env (GitHub Actions secrets):
//   X_API_KEY / X_API_SECRET           — app consumer keys
//   X_ACCESS_TOKEN / X_ACCESS_SECRET   — user access token (OAuth 1.0a)
//   X_QUEUE_START                      — YYYY-MM-DD, day 1 of the queue
//
// Exits 0 with a notice (never fails the workflow) when keys are absent.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAL = path.join(root, 'docs', 'x-content-calendar.md');

const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
const DRY = !!process.env.DRY_RUN;
const QUEUE_START = process.env.X_QUEUE_START || '2026-09-16';

// ── pick the post ────────────────────────────────────────────────
function parseCalendar(md) {
  const days = {};
  let day = null, slot = null;
  for (const line of md.split('\n')) {
    const d = line.match(/^## D(\d+)\s*$/);
    const s = line.match(/^### SLOT([12])\s*$/);
    if (d) { day = Number(d[1]); days[day] = {}; slot = null; continue; }
    if (s && day) { slot = Number(s[1]); days[day][slot] = ''; continue; }
    if (day && slot) days[day][slot] += (days[day][slot] ? '\n' : '') + line;
  }
  for (const d of Object.values(days)) for (const k of Object.keys(d)) d[k] = d[k].trim();
  return days;
}

const days = parseCalendar(fs.readFileSync(CAL, 'utf8'));
const dayCount = Object.keys(days).length;
const slot = Number(process.argv[2]) || (new Date().getUTCHours() < 19 ? 1 : 2);
const elapsed = Math.floor((Date.now() - Date.parse(QUEUE_START + 'T00:00:00Z')) / 86400000);
if (elapsed < 0) { console.log(`queue starts ${QUEUE_START}; nothing to post yet`); process.exit(0); }
const dayIdx = (elapsed % dayCount) + 1;
const text = days[dayIdx]?.[slot];
if (!text) { console.log(`no post for D${dayIdx} SLOT${slot}`); process.exit(0); }

console.log(`── D${dayIdx} SLOT${slot} (${text.length} chars) ──\n${text}\n──`);
if (DRY) process.exit(0);
if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) {
  console.log('X API keys not configured — skipping (add repo secrets to arm the queue)');
  process.exit(0);
}

// ── OAuth 1.0a signing (HMAC-SHA1), no deps ─────────────────────
const enc = (v) => encodeURIComponent(v).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const url = 'https://api.x.com/2/tweets';
const oauth = {
  oauth_consumer_key: X_API_KEY,
  oauth_nonce: crypto.randomBytes(16).toString('hex'),
  oauth_signature_method: 'HMAC-SHA1',
  oauth_timestamp: String(Math.floor(Date.now() / 1000)),
  oauth_token: X_ACCESS_TOKEN,
  oauth_version: '1.0',
};
const paramString = Object.keys(oauth).sort().map((k) => `${enc(k)}=${enc(oauth[k])}`).join('&');
const base = ['POST', enc(url), enc(paramString)].join('&');
const signingKey = `${enc(X_API_SECRET)}&${enc(X_ACCESS_SECRET)}`;
oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
const authHeader = 'OAuth ' + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(', ');

const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`X API ${res.status}:`, JSON.stringify(body));
  process.exit(1);
}
console.log(`posted: https://x.com/i/status/${body.data?.id}`);
