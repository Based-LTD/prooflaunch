'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle,
  Hammer,
  Compass,
  Rocket,
  Shield,
  Coins,
  Users,
  TrendingUp,
  Award,
  Activity,
  Trophy,
  Signal,
  MessageSquare,
  Bell,
  Bot,
  DollarSign,
  Layers,
} from 'lucide-react';

// /roadmap — what's shipped, what's next, what we're exploring.
// Deliberately no dates. The roadmap is a direction, not a contract.
// Updated when reality changes, not on a schedule.

const SHIPPED = [
  // === LIVE CONTEST ===
  { icon: Trophy, title: '5 SOL bounty — first rug-proof community launch to bond wins', desc: 'First non-founder token launched via prooflaunch atomic launch to bond wins 5 SOL — provided the token is still trading above its bond mcap 24 hours after bonding. The 24h anti-rug snapshot catches the classic post-bond insider dump: any token that gets rugged in the first day doesn\'t qualify, and the prize passes to the next legit bonded token. Dips within the window are fine; the check is at the 24h mark. Prize sent directly to the creator wallet after the snapshot confirms. Founder-launched tokens (SOL Music, GO, PROOF, TEST, BOTTEST) excluded. First rug-proof bond wins. Contest runs open-ended until a legitimate winner is confirmed. Verifiable end-to-end on chain.' },

  // === LAUNCH MECHANICS ===
  { icon: Rocket, title: 'Multi-platform pooled atomic launches', desc: 'createPool + first buy + token distribution in a single atomic transaction. Dev holds 0%. No sniper gap. Every backer enters at the identical price. Pick the launchpad at submit time: pump.fun, Meteora DBC, or Raydium LaunchLab. Every mint ends in "…pooL" so anyone can verify it on Solscan.' },
  { icon: Coins, title: 'Withdraw any time before launch', desc: 'Backers can withdraw their pledge any time while the meme is in backing OR funded state — right up until the creator presses launch. 2% withdrawal fee stays with the pool. Vacated slots are reclaimable by the same tier. Nobody\'s money is held hostage during dev delays. Once the launch button fires, remaining backers are locked in atomically.' },
  { icon: DollarSign, title: 'USDC raises (alongside SOL)', desc: 'Stable-denominated launches with full bot parity. Submit form picks the quote currency at submission; backers deposit USDC; the pool atomically launches into a Meteora DBC USDC-quoted bonding curve. All bot actions (burn, vaults, distribute, donate) work on USDC fees end-to-end. Verified on mainnet against live trading fees.' },
  { icon: Bot, title: 'Programmable bot stack — 12 bots, 9 actions', desc: 'Creator delegates up to 90% of trading fees to a stack of system-controlled bots. Each bot has its own Solscan wallet, runs its action every cron tick, fully auditable. Actions: BURN, HOLD (labeled vaults), distribute SOL or tokens to holders or backers, donate to a fixed wallet, post-graduation POOL FEEDER. Unlimited labeled vaults (Marketing, DAO, Liquidity) are creator-withdrawable; everything else is sealed.' },

  // === FEE DISTRIBUTION ===
  { icon: Coins, title: 'Hold-weighted fee distribution', desc: 'Diamond hands earn their full pro-rata share. Backers who dump give up their portion — and the freed share rolls forward to all $PROOF holders via the daily airdrop pool. Every fee cycle, every meme, every trade.' },
  { icon: Shield, title: 'Per-meme sub-escrow architecture', desc: 'Every new token gets its own on-chain creator vault and per-meme sub-escrow keypair. Fees from one token never commingle with another. The cron drains each sub-escrow into shared escrow, splits per the meme\'s configured ratio, credits backers automatically. Encrypted keypairs — even the platform can\'t drain a sub-escrow without the encrypted key.' },
  { icon: Coins, title: 'Configurable fee preset', desc: 'Creator picks a preset (standard / community-first / custom) or a 5-way split: backers / $PROOF holder rewards / platform / burn / charity. All ratios DB-enforced; no creator can sneak past 90% delegation. The preset shows on the token page so backers see exactly where each trade\'s fees flow.' },
  { icon: Bell, title: 'Live fee accrual counter', desc: 'Watch your share of every trade tick into "Pending" in near-real-time, before the hourly cron has even moved the SOL. Pending → Claimable on each cron tick → one-click claim to your wallet as native SOL. The whole fee flow, transparent and animated on your Portfolio.' },

  // === $PROOF ECOSYSTEM ===
  { icon: Coins, title: 'Daily $PROOF holder airdrop', desc: 'Platform fee was cut from 10% to 5%; the other 5% becomes a daily SOL airdrop to every $PROOF holder, pro-rata to balance. No staking, no claim button, no minting — just hold $PROOF and get paid SOL every day. Streamflow-locked $PROOF counts. Snapshot time varies daily (anti-gaming). Runs automatically on a Vercel cron.' },
  { icon: Coins, title: 'Carry-forward airdrop accumulator', desc: 'Every $PROOF holder accumulates their daily share, no matter how small. When your accumulated balance crosses the gas-economical floor, it pays out. Tiny holders get paid every few days instead of zero. No share is ever lost — everyone gets their pro-rata, eventually.' },
  { icon: Coins, title: 'Free submissions for $PROOF holders', desc: 'Hold ≥500k $PROOF → submission fee (0.02 SOL) waived. On-chain balance check at submission time. Real utility for holding $PROOF: the more you hold, the more it pays off. Non-holders still launch normally — just pay the fee.' },

  // === BACKER MODES + SAFETY ===
  { icon: Shield, title: 'Reserved slots + TEAM ROUND', desc: 'Creators can reserve N of M slots for specific wallets without hiding the launch from public. Hybrid mode shows "X open · Y reserved" so backers see exactly what\'s available; fully-reserved (TEAM ROUND) launches get a distinct amber label. Public always sees the launch — that\'s the brand promise.' },
  { icon: Shield, title: 'Per-backer cap (team-fairness)', desc: 'Optional ceiling on per-backer SOL set at submission. Applies universally (creator + team + public alike) so no wallet can out-back any other. Whales can\'t outsize your community.' },
  { icon: Trophy, title: 'Up to 24 backer slots', desc: 'Max raised from 8 → 24 backer slots per token. Verified end-to-end with a controlled 24-backer launch (atomic createPool + buy + 24 sequential distributions, all in one request under 30 seconds, zero supply leak).' },
  { icon: Shield, title: 'Refund protection', desc: '3-day backing deadline. If slots don\'t fill in the creator\'s window, every backer is automatically refunded 100% — no fee, no support tickets, no human in the loop.' },
  { icon: Shield, title: 'Auto-refund on rejected backings', desc: 'If the server rejects a backing after the deposit landed on chain (cap exceeded, slot taken in a race, reservation gate), the deposit is auto-refunded back to the backer in the same API response. No support tickets, no stranded funds.' },

  // === DISCOVERY + COMMUNITY ===
  { icon: Users, title: 'Genesis Backer Roster', desc: 'Every launched token shows all of its original backers, their stakes, current on-chain hold %, realized fees, and live Pending share. Streamflow-locked tokens count toward hold %, so creators who lock their allocation read correctly instead of looking like dumps. 💎 = ≥80% hold · 🔒 = portion locked via Streamflow.' },
  { icon: TrendingUp, title: 'Proving Grounds', desc: 'Browse every token currently in the backing or funded phase. Funded tokens surface first so backers see what\'s about to launch.' },
  { icon: MessageSquare, title: 'Holder content vault — Keycard integration', desc: 'Every funded token automatically gets a wallet-gated content slot via @keycardsol. Creator drops anything (alpha, whitelist codes, private links, surprise giveaways) into one file; holders unlock with their wallet to see the latest. Updates anytime, sell tokens → lose access. Auto-creates within 10 min of launch — no creator setup required.' },
  { icon: MessageSquare, title: 'Per-token community chat', desc: 'Every token has its own real-time chat room where backers and the creator coordinate before launch.' },
  { icon: Award, title: 'Creator-editable metadata + uploads', desc: 'Banner uploads, name / description / socials editable during the backing phase (creator-only). GitHub link supported alongside Twitter, Telegram, Discord, website. Locked once the token launches.' },
];

const BUILDING = [

  { icon: Bot, title: 'USDC bot parity for POOL FEEDER', desc: 'Every other USDC bot action shipped this week (burn, hold, distribute SOL/tokens, donate). The post-graduation LP-add (feed_lp) is the one remaining SOL-only path — needs DAMM v2 USDC/token LP-add support. Until it ships, USDC POOL FEEDER bots accumulate USDC; once it ships, they auto-deploy LP same as SOL launches do today.' },
  { icon: Layers, title: 'Multi-launchpad expansion — Bonk.fun, Believe, Daos.fun', desc: 'Multi-platform pooled-atomic launches are live for pump.fun, Meteora DBC, and Raydium LaunchLab. Next wave: Bonk.fun, Believe, Daos.fun. Each gets a dedicated adapter behind the same pooled launch dispatcher. Same fair-launch spine, more launchpads to choose from at submit.' },
  { icon: Shield, title: 'Structured Team Round v2 (disclosure + auto-vesting)', desc: 'Phase 7 shipped reserved slots + TEAM ROUND label. Phase 8 turns that into a real product: require team identity declaration at submission, auto-create a Streamflow vesting contract for team-backer allocations, surface the disclosure publicly on the token page. Teams get the structure they need; backers get certainty team tokens are locked. Pump.fun doesn\'t offer this.' },
  { icon: Coins, title: '$PROOF staking (optional lock for boosted airdrop weight)', desc: 'V1 daily airdrop is already live for every holder. V2 adds an optional Streamflow lock: holders who lock $PROOF for N days get a boosted multiplier on their daily airdrop share. Rewards commitment without forcing it — unlocked holders still earn normally, locked holders earn more. Same fee revenue source, no inflation.' },
  { icon: Activity, title: 'Live activity feed per token', desc: 'See backing events, launch milestones, fee distributions, and refund activity in real-time on each token page. Transparency by default.' },
  { icon: Award, title: 'Creator profile pages', desc: 'Surface each creator\'s lifetime stats (submissions, successful launches, reputation score) from the database tracking that\'s already in place. Backers can vet creators on their on-platform record before committing.' },
];

const EXPLORING = [
  { icon: Trophy, title: 'Conviction Score', desc: '% of original genesis backers still holding at any given moment. A signal nobody else can compute, because nobody else knows who the OG backers were.' },
  { icon: Trophy, title: 'Diamond Hands leaderboard', desc: 'Cross-token reputation for backers who hold longest, biggest, across multiple successful launches. Soulbound on-chain reputation.' },
  { icon: Shield, title: 'Pool atomicity proof badge', desc: 'Each launched token\'s detail page links directly back to the on-chain createPool+buy bundle. Visual "verified Proof launch" stamp that traders can click to confirm authenticity.' },
  { icon: Signal, title: 'Momentum signals (informational)', desc: 'Volume sparklines, recent trade size, holder count deltas on each launched token. Information-only — never push notifications or alert sounds. We are not a trading terminal.' },
  { icon: Users, title: 'Torch-passing launch authority', desc: 'If a funded token isn\'t launched within a reasonable window, the right to launch passes sequentially to backers in commitment order. Means a token can still launch even if the original creator vanishes — refund becomes a last-resort safety net rather than the only outcome. Reinforces the brand promise: the pool always becomes a token.' },
  { icon: MessageSquare, title: 'Persistent post-launch chat', desc: 'Keep the token\'s chat alive after launch for the project\'s lifetime — a permanent rallying point for holders.' },
  { icon: Bell, title: 'Notification preferences', desc: 'Optional email or Telegram alerts for specific events you care about: fee credits crossing a threshold, momentum spikes on tokens you back, refunds triggered. Opt-in only.' },
];

interface RowProps {
  icon: LucideIcon;
  title: string;
  desc: string;
  accentColor: string;
}

function Row({ icon: Icon, title, desc, accentColor }: RowProps) {
  return (
    <div className="flex items-start gap-4 p-4 bg-[var(--background)] border-2 border-[var(--border)] hover:border-[var(--accent)] transition-colors">
      <Icon className={`w-6 h-6 ${accentColor} flex-shrink-0 mt-0.5`} />
      <div>
        <h3 className="font-bold mb-1 uppercase tracking-wide">{title}</h3>
        <p className="text-sm text-[var(--muted)]">{desc}</p>
      </div>
    </div>
  );
}

export default function RoadmapPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--accent)] transition-colors text-xs font-mono uppercase tracking-widest"
      >
        <ArrowLeft className="w-3 h-3" />
        [&lt;] Back
      </Link>

      {/* Header */}
      <div className="border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Compass className="w-7 h-7 text-[var(--accent)]" />
          <h1 className="text-3xl font-black uppercase tracking-tight">Roadmap</h1>
        </div>
        <p className="text-[var(--foreground)]/80 leading-relaxed">
          What we&apos;ve shipped, what we&apos;re building next, and the ideas we&apos;re considering.
          No dates — this is a direction, not a contract. Reality changes the order more often than calendars do.
        </p>
        <div className="border-l-4 border-[var(--accent-gold)] bg-[var(--background)] p-4">
          <h2 className="font-bold text-[var(--accent-gold)] mb-2 uppercase tracking-wide">
            How we choose what to build
          </h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            We build what only Proof Launch can build — features that flow from the pooled-atomic
            model and that no trading terminal, screener, or copycat launchpad can replicate.
            We don&apos;t try to be a trading terminal. We don&apos;t add casino-style alerts.
            We don&apos;t ship features that contradict the brand: dev holds 0%, same price for everyone,
            commitments are real.
          </p>
        </div>
      </div>

      {/* SHIPPED */}
      <section className="border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-6 h-6 text-[var(--success)]" />
          <h2 className="text-2xl font-black uppercase tracking-tight text-[var(--success)]">
            Shipped
          </h2>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] ml-auto">
            // LIVE_TODAY
          </span>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Everything below is live in production, on Solana mainnet, verifiable on-chain.
        </p>
        <div className="space-y-3">
          {SHIPPED.map((item) => (
            <Row key={item.title} {...item} accentColor="text-[var(--success)]" />
          ))}
        </div>
      </section>

      {/* BUILDING NEXT */}
      <section className="border-2 border-[var(--warning)] bg-[var(--card)] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Hammer className="w-6 h-6 text-[var(--warning)]" />
          <h2 className="text-2xl font-black uppercase tracking-tight text-[var(--warning)]">
            Building Next
          </h2>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] ml-auto">
            // COMMITTED
          </span>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Committed work. Order may shift based on what real launches reveal, but each item below is something we&apos;ve decided to build.
        </p>
        <div className="space-y-3">
          {BUILDING.map((item) => (
            <Row key={item.title} {...item} accentColor="text-[var(--warning)]" />
          ))}
        </div>
      </section>

      {/* EXPLORING */}
      <section className="border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Compass className="w-6 h-6 text-[var(--accent)]" />
          <h2 className="text-2xl font-black uppercase tracking-tight text-[var(--accent)]">
            Exploring
          </h2>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] ml-auto">
            // EVALUATING
          </span>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Ideas under consideration. Some came from the community, some from our own brainstorms.
          We&apos;ll either commit them, refine them into something more on-brand, or set them aside.
          Not promises — possibilities.
        </p>
        <div className="space-y-3">
          {EXPLORING.map((item) => (
            <Row key={item.title} {...item} accentColor="text-[var(--accent)]" />
          ))}
        </div>
      </section>

      {/* Community footer */}
      <section className="border-2 border-[var(--accent-gold)] bg-[var(--card)] p-6 space-y-3">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-[var(--accent-gold)]" />
          <h2 className="text-2xl font-black uppercase tracking-tight">Suggest Something</h2>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Got an idea that would make Proof Launch better? Drop it in the Telegram or tag us on X.
          We read every suggestion. Not every one becomes a feature — but every one shapes how we think.
        </p>
        <p className="text-xs font-mono uppercase tracking-widest text-[var(--muted)]">
          &gt; The community has shipped more roadmap items here than any single product manager could.
        </p>
      </section>
    </div>
  );
}
