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
  Eye,
  Trophy,
  Signal,
  MessageSquare,
  Bell,
} from 'lucide-react';

// /roadmap — what's shipped, what's next, what we're exploring.
// Deliberately no dates. The roadmap is a direction, not a contract.
// Updated when reality changes, not on a schedule.

const SHIPPED = [
  { icon: Coins, title: 'Free submissions for PROOF holders', desc: 'Hold ≥500k PROOF → submission fee (0.02 SOL) waived. On-chain balance check at submission time. Real utility for holding PROOF: the more you hold, the more it pays off. Non-holders still launch normally — just pay the fee.' },
  { icon: Coins, title: 'Carry-forward airdrop accumulator', desc: 'Every PROOF holder accumulates their daily share, no matter how small. When your accumulated balance crosses the 0.001 SOL gas-economical floor, it pays out. Tiny holders get paid every few days instead of zero. No share is ever lost — everyone gets their pro-rata, eventually.' },
  { icon: Coins, title: 'Daily PROOF holder airdrop', desc: 'We cut our platform fee from 10% to 5%. The other 5% becomes a daily SOL airdrop to every PROOF holder, pro-rata to balance. No staking, no claim button, no minting — just hold PROOF and get paid native SOL every day. Streamflow-locked PROOF counts. Snapshot time varies daily (anti-gaming). First distribution 2026-05-23: 5.10 SOL across 217 wallets. Now runs automatically on a Vercel cron.' },
  { icon: Rocket, title: 'Pooled atomic launches', desc: 'createV2 + buy in a single transaction. Dev holds 0%. No sniper gap. Every backer enters at the identical price. Contract address ends in "…pooL" so anyone can verify it\'s a real Proof launch.' },
  { icon: Coins, title: 'Per-token trading fee distribution', desc: 'Every new token gets its own on-chain creator vault. The platform collects creator fees hourly, splits 90% backers / 5% platform / 5% PROOF-holder airdrop pool, and credits each backer\'s share to their wallet — automatic, on-chain verifiable, no claim window pressure.' },
  { icon: Bell, title: 'Live fee accrual counter', desc: 'Watch your share of every pump trade tick into "Pending" in near-real-time, before the hourly cron has even moved the SOL. Pending → Claimable on each cron tick → one-click claim to your wallet as native SOL. The whole fee flow, transparent and animated on your Portfolio.' },
  { icon: Users, title: 'Genesis Backer Roster', desc: 'Every launched token shows all of its original backers, their stakes, current on-chain hold %, realized fees, and live Pending share. Streamflow-locked tokens count toward hold %, so creators who lock their allocation read correctly instead of looking like dumps. 💎 = ≥80% hold · 🔒 = portion locked via Streamflow.' },
  { icon: Trophy, title: 'More backer slots — up to 24', desc: 'Max raised from 8 → 24 backer slots per token, per community feedback. Verified end-to-end with a controlled 24-backer launch (atomic createV2 + buy + 24 sequential distributions, all in one request under 30 seconds, zero supply leak).' },
  { icon: Shield, title: 'Refund protection', desc: '3-day backing deadline: if a token\'s slots don\'t fill within the creator\'s window, every backer is automatically refunded 100% — no fee, no support tickets, no human in the loop.' },
  { icon: TrendingUp, title: 'Proving Grounds', desc: 'Browse every token currently in the backing or funded phase. Funded tokens surface first so backers can see what\'s about to launch.' },
  { icon: MessageSquare, title: 'Per-token community chat', desc: 'Every token has its own real-time chat room where backers and the creator coordinate before launch.' },
];

const BUILDING = [
  { icon: Coins, title: 'PROOF staking (optional lock for boosted airdrop weight)', desc: 'V1 daily airdrop is already live for every holder. V2 adds an optional Streamflow lock: holders who lock PROOF for N days get a boosted multiplier on their daily airdrop share. Rewards commitment without forcing it — unlocked holders still earn normally, locked holders earn more. Same fee revenue source, no inflation.' },
  { icon: Activity, title: 'Live activity feed per token', desc: 'See backing events, launch milestones, fee distributions, and refund activity in real-time on each token page. Transparency by default.' },
  { icon: Award, title: 'Creator profile pages', desc: 'Surface each creator\'s lifetime stats (submissions, successful launches, reputation score) from the database tracking that\'s already in place. Backers can vet creators on their on-platform record before committing.' },
  { icon: Coins, title: 'Lower minimum backing', desc: 'Reduce the floor below current 0.05 SOL minimum, so smaller backers can participate in any pool.' },
];

const EXPLORING = [
  { icon: Trophy, title: 'Conviction Score', desc: '% of original genesis backers still holding at any given moment. A signal nobody else can compute, because nobody else knows who the OG backers were.' },
  { icon: Eye, title: 'Creator track record dashboard', desc: 'An analytics layer on top of the basic creator profile: peak market caps, current holder counts, reputation trends over time, time-to-launch averages. Helps backers vet repeat creators on the data, not just the vibe.' },
  { icon: Trophy, title: 'Diamond Hands leaderboard', desc: 'Cross-token reputation for backers who hold longest, biggest, across multiple successful launches. Soulbound on-chain reputation.' },
  { icon: Shield, title: 'Pool atomicity proof badge', desc: 'Each launched token\'s detail page links directly back to the on-chain createV2+buy bundle. Visual "verified Proof launch" stamp that traders can click to confirm authenticity.' },
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
