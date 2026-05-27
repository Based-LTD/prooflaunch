# Handoff: Proof Launch UI Facelift

A brainstorm Claude (local-only, no prod access) explored design directions with the user. This doc hands off to the implementer Claude (you) to ship the chosen direction.

## TL;DR

**Leading direction:** Glass cards over an HD video background, glass navbar on top, "Launch infrastructure for token teams." as the new hero positioning. Brand color discipline preserved (gold/amber/cream only).

The decisions are locked. Your job is to pull the demos into the real homepage and ship clean.

---

## Branches to know about

| Branch | What's there | Status |
|---|---|---|
| `x-profile-logo` | Refined P/L wordmark + favicon + apple-icon + 3 logo concept routes (`/profile-image/seal`, `/terminal`, `/mark`) | ✅ Committed clean, safe to merge |
| `hero-rewrite` | Hero rewrite: "Launch infrastructure for token teams." + Prove/Launch/Earn action layer beneath, commit `f0fd210` | ✅ Committed WIP — copy is locked, may need to re-style for the facelift visual hierarchy |
| `ui-facelift-demos` | All `/demo/*` exploration routes + glass Navbar mode for demo paths + demo components in `src/components/demo/` | 🟡 Exploration scratchpad — pull the winning patterns into real pages |
| `strip-meme-wording` | Branch started, audit done, not finished. 4 user-visible "meme" strings still need swapping | 🟡 Small follow-up |
| `main` | Production state | — |

---

## Demo routes the user reviewed (all on `ui-facelift-demos`)

```
/demo/glass-video        ← LEADING CANDIDATE
/demo/glass-nebula       ← strong backup (no external asset dep)
/demo/glass-orbitals     ← 3D fallback (uses installed three + r3f)
/demo/glass-starfield-v2 ← runner-up
/demo/tech               ← Linear/Stripe restraint (passed over for being too quiet)
/demo/glass              ← original pumptracks-style (passed over for being too literal a copy)
/demo/glass-aurora       ← gradient blob drift
/demo/glass-stream       ← live activity scroll
/demo/glass-starfield    ← basic Win95-style starfield (v2 is the refined version)
/demo/terminal-starfield ← terminal cards over starfield (hybrid attempt)
```

Each demo uses the same content + same metrics + same 3 sample tokens so the visual differences are apples-to-apples.

---

## How to ship the winning direction

### 1. Background — video

User's source asset: `public/grok-bg.mp4` (~24MB, Grok Imagine generated with matching start/end frames so it loops cleanly).

Component to import: `src/components/demo/VideoBackground.tsx`

**Settings the user landed on (verified visually):**
```tsx
<VideoBackground
  src="/grok-bg.mp4"
  playbackRate={0.55}     // slowed for calm
  videoOpacity={0.65}     // recedes into bg
  brightness={0.85}       // tones down without softening
  saturation={0.9}        // less color-aggressive
  dim={0.4}               // overlay darkness
  blur={0}                // HD sharp — DO NOT add blur (explicitly rejected)
  vignette={true}
/>
```

**No crossfade trick needed.** User's video already loops well; single `<video loop>` is sufficient. The 2-video crossfade dance was prototyped earlier and then ripped out.

**Asset hardening before ship:**
- 24MB MP4 is fine for desktop but heavy on mobile. Consider:
  - Transcode to H.265 + AV1 with `<source>` fallback chain
  - Or move to a CDN (Cloudflare R2, Vercel Blob)
  - Or generate a 1080p version and a 720p version, swap based on viewport
- Test autoplay on mobile Safari + Firefox. `muted + playsInline` usually unblocks but worth verifying.

### 2. Backup if video can't ship

Use `src/components/demo/NebulaShaderBackground.tsx` — self-contained WebGL fragment shader (FBM noise, gold/amber palette, already tuned for text legibility). No external asset, no autoplay issues.

### 3. Cards — glass treatment

Pattern lives in `src/app/demo/glass/page.tsx` (search for `.glass-card`):
```css
background: rgba(10, 10, 10, 0.45);
backdrop-filter: blur(10px);
-webkit-backdrop-filter: blur(10px);
border: 1px solid rgba(255, 157, 0, 0.25);
transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;

/* hover */
border-color: rgba(255, 157, 0, 0.55);
box-shadow: 0 0 24px rgba(255, 157, 0, 0.25), 0 0 48px rgba(255, 157, 0, 0.12);
transform: translateY(-2px);
```

Apply this to: meme detail pages, hero blocks on home, submit form sections, launched page, portfolio page. Anywhere there's currently a bordered terminal card.

CTAs in the demo use:
```css
/* primary (amber glow + slow pulse) */
.glass-cta {
  background: rgba(255, 157, 0, 0.12);
  border: 1px solid #ff9d00;
  color: #ffb84d;
  text-shadow: 0 0 8px rgba(255, 157, 0, 0.6);
  box-shadow: 0 0 14px rgba(255, 157, 0, 0.35), inset 0 0 12px rgba(255, 157, 0, 0.08);
}
```

### 4. Navbar — glass mode

`src/components/Navbar.tsx` already has a glass mode prototyped, currently scoped to `pathname.startsWith('/demo')`. For the real ship, you have two options:

**A.** Make glass always-on (recommended if the facelift ships sitewide). Replace the conditional with the glass classes unconditionally.

**B.** Tie it to a feature flag or path-based gating for a phased rollout.

Glass values used:
```
bg: rgba(10, 10, 10, 0.45)
backdrop-filter: blur(md) /* 12px */
border: rgba(255, 255, 255, 0.10)
```

### 5. Hero copy

On `hero-rewrite` branch already (commit `f0fd210`):
- Headline: **"Launch infrastructure for token teams."**
- Action layer below the headline: **"Prove. Launch. Earn."** (preserved as brand DNA, with per-word colored glows)
- Existing two-line mechanic stays:
  - `> Back a token → buy the first supply + earn from its trades.`
  - `> Hold $PROOF → earn from every launch on the platform.`

This copy is locked. Visual styling may need a glass-card refactor to match the rest of the facelift.

### 6. Wording cleanup ("meme" → "token")

Four places still say "meme" in user-visible text:

| File | Line | Current | Should be |
|---|---|---|---|
| `src/app/page.tsx` | 142 | `[>] Submit Meme` | `[>] Submit Token` |
| `src/app/launched/page.tsx` | 68 | `Memes that hit all slots...` | `Tokens that hit all slots...` |
| `src/app/opengraph-image.tsx` | 4 | `'...The Proving Grounds for Meme Coins'` | `'...The Proving Grounds for Token Launches'` |
| `src/app/meme/[id]/page.tsx` | 120 | `'This meme has no pool wallet...'` | `'This token has no pool wallet...'` |

**Do NOT change:** API routes (`/api/memes`), DB table names (`memes`), URL paths (`/meme/[id]`), component names (`MemeCard`, `MemeChat`), variable names. Those are internal and breaking them is more work than it's worth.

---

## Suggested merge order

1. **`x-profile-logo`** first — pure win, zero UI risk, no visual changes to the live site beyond the favicon + profile image
2. **Wording cleanup** — 4 mechanical edits, can cherry-pick or do directly on a tiny branch
3. **Facelift build** — pull `VideoBackground` + glass card pattern + glass Navbar into real pages. Probably needs its own branch + careful testing
4. **`hero-rewrite`** last — only after the facelift visual hierarchy is set, so the hero styling matches

---

## Gotchas

- **Type error in `src/app/roadmap/page.tsx:69`** is pre-existing, unrelated to the demos, blocks `tsc --noEmit`. Fix before deploy.
- **Browser autoplay blocking** — test on mobile Safari + Firefox. `muted + playsInline` usually bypasses, but not always.
- **Video file size** — `grok-bg.mp4` is 24MB. Mobile bandwidth concern. Transcode or CDN before shipping.
- **`three` + `@react-three/fiber` + `@react-three/drei`** are already installed (for `/demo/glass-orbitals`). If 3D path is dropped, can uninstall.
- **Demo routes** under `/demo/*` are exploration scratch — either keep for further A/B testing, or delete the directory when shipping the chosen direction. They're not linked from anywhere user-facing.

---

## User's design preferences (locked-in, don't relitigate)

- **Wants:** glass cards, atmospheric, premium, "looks expensive," tech-meta credible
- **Doesn't want:** dated screensaver feel, vaporwave/neon (pulls back to crypto-bro), excessive motion, blurry video, anything that obscures text
- **Brand discipline:** monochromatic gold/amber/cream only; `#ff9d00` primary; `#cc6600` deep amber and `#ffd9a3` cream as accents; no other hues
- **Voice:** terminal/mono retained but evolved. `> SYSTEM` labels, `// SECTION_LABEL` headers, `[>]` bracket buttons all kept. Square corners on terminal cards OK; rounded on glass cards OK.
- **Process boundary:** brainstorm Claude (the one who wrote this) doesn't touch prod. You (implementer) ship everything. Don't merge to main without explicit user nod. See `~/.claude/projects/-Users-danielsproul-proof-of-meme/memory/prod-deploy-boundary.md` if you have memory access.

---

## Pending non-facelift work (also assigned to you)

These were on the brainstorm Claude's todo list but require implementation/external action:

- **X Gold checkmark application** — logo work done, but bio audit + Premium+ subscription confirmation + application submission still TODO
- **Smart Likes campaign for PROOF on Jupiter** — strategy only outlined, not executed
- **Spaces outreach** — target list + DM templates not yet drafted
- **`proof-distribute-fees.mjs` stale-RPC retry** — known bug, untouched
- **PROOF staking V2** — design exists in memory, no implementation
- **Backed by Proof program** — concept only
- **Graduate Oracle integration** — pending
- **Diagnose African site access issues** — open question

Pick these up as priorities allow.

---

*Handoff prepared 2026-05-27.*
