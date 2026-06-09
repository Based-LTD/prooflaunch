'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Rocket,
  Users,
  Shield,
  Coins,
  Clock,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Undo2,
  Zap,
  Receipt,
  Key,
  Wallet,
  HelpCircle,
  Bot,
  ExternalLink,
} from 'lucide-react';

type TabId = 'overview' | 'backers' | 'creators' | 'bots' | 'fees' | 'security' | 'faq';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const tabs: Tab[] = [
  { id: 'overview', label: 'Overview', icon: Rocket },
  { id: 'backers', label: 'For Backers', icon: Users },
  { id: 'creators', label: 'For Creators', icon: Zap },
  { id: 'bots', label: 'Bots', icon: Bot },
  { id: 'fees', label: 'Fees', icon: Receipt },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
];

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--accent)] transition-colors text-xs font-mono uppercase tracking-widest"
      >
        <ArrowLeft className="w-3 h-3" />
        [&lt;] Back to Proving Grounds
      </Link>

      {/* Header — terminal block */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            // PROOF_LAUNCH.SYS // DOCS
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            v0.2.0
          </span>
        </div>
        <div className="p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-1">
            &gt; MANUAL
          </div>
          <h1 className="text-2xl sm:text-3xl font-mono font-semibold uppercase tracking-tight">
            Documentation
          </h1>
          <p className="text-xs font-mono text-[var(--muted)] mt-2">
            Everything you need to know about Proof Launch
          </p>
        </div>
      </div>

      {/* Tab Navigation — terminal tab bar */}
      <div className="border border-[var(--border)] bg-[var(--card)] flex overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-3 py-3 text-[11px] font-mono uppercase tracking-widest border-l border-[var(--border)] first:border-l-0 transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-[var(--accent)] text-[#0a0a0a]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {isActive && '> '}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            {/* What is Proof Launch */}
            <section className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
                // OVERVIEW
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Rocket className="w-6 h-6 text-[var(--accent)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">What is Proof Launch?</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Proof Launch is a community-pre-formed token launchpad on Solana. Unlike typical
                launches where developers control everything, here <strong>communities form BEFORE
                tokens launch</strong>. Creators set up to 24 backer slots, choose between <strong>Pump.fun</strong>,
                <strong> Meteora</strong>, or (coming soon) <strong>Raydium LaunchLab</strong> as the launchpad,
                and once all slots are filled the token launches with backers receiving supply proportional
                to their contribution.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">1</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Submit a Token</div>
                  <div className="text-xs text-[var(--muted)] mt-1">Set 2-24 slots + minimum</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">2</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Fill All Slots</div>
                  <div className="text-xs text-[var(--muted)] mt-1">Backers claim slots</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">3</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Launch on Pump.fun or Meteora</div>
                  <div className="text-xs text-[var(--muted)] mt-1">All buy instantly</div>
                </div>
              </div>
            </section>

            {/* How Backing Works — Pooled Atomic Launch */}
            <section className="relative border-2 border-[var(--warning)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--warning)] text-black text-xs font-bold uppercase tracking-wider">
                // KEY_INNOVATION
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Key className="w-6 h-6 text-[var(--warning)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">How Backing Works</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Backers pool their SOL into one transparent, on-chain wallet for the token.
                At launch, that pool creates the token and buys it in a <strong>single atomic
                transaction</strong> — the creator (dev) holds <strong>0%</strong>, there is
                no gap for snipers, and <strong>every backer gets the exact same entry price</strong>.
                Tokens are then distributed to each backer proportionally.
              </p>
              <div className="space-y-3 pt-2">
                {[
                  { num: '1', title: 'Back the Pool', desc: 'Send at least the creator\'s minimum to claim one of 2–24 slots. Your SOL goes to the token\'s transparent pool wallet — publicly visible on-chain.' },
                  { num: '2', title: 'Pool Locked Until Launch', desc: 'The pool simply holds the backers\' SOL until all slots fill. Nothing can be done with it but launch or refund.' },
                  { num: '3', title: 'One Atomic Launch', desc: 'When slots fill, the creator launches: ONE transaction creates the token and the pool buys it in the same block. No sniper gap. Dev holds 0%. The contract address ends in “pooL” so anyone can verify it\'s a real Proof launch.' },
                  { num: '4', title: 'Proportional Distribution', desc: 'Tokens are sent to every backer\'s own wallet, proportional to their backing. Same price for everyone — no slot is favored.' },
                ].map((step) => (
                  <div key={step.num} className="flex items-start gap-4 p-4 bg-[var(--background)] border-l-4 border-[var(--warning)]">
                    <div className="w-8 h-8 bg-[var(--warning)] text-black flex items-center justify-center text-sm font-black flex-shrink-0">
                      {step.num}
                    </div>
                    <div>
                      <h3 className="font-bold mb-1 uppercase tracking-wide">{step.title}</h3>
                      <p className="text-sm text-[var(--muted)]">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-[var(--accent-gold)]/10 border-2 border-[var(--accent-gold)]/30 p-4 mt-4">
                <h3 className="font-bold text-[var(--accent-gold)] mb-2 uppercase tracking-wide">Why This Is Different</h3>
                <ul className="text-sm text-[var(--muted)] space-y-1">
                  <li>· <strong className="text-[var(--accent-gold)]">Same price for all:</strong> one atomic pool buy — no backer is front-run or favored</li>
                  <li>· <strong className="text-[var(--accent)]">Dev holds 0%:</strong> the creator never holds the bag — nothing to rug</li>
                  <li>· <strong>No sniper gap:</strong> create + buy land in the same transaction</li>
                  <li>· <strong>Verifiable:</strong> the “…pooL” contract address marks every genuine Proof launch</li>
                  <li>· <strong>No max per wallet:</strong> back as much as you want (just meet the minimum)</li>
                </ul>
              </div>
            </section>

            {/* The Proving Phase */}
            <section className="relative border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6 text-[var(--accent-gold)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">The Proving Phase</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                When a token is submitted, it enters the "Proving" phase. Backers race to fill the available slots:
              </p>
              <ul className="space-y-3">
                {[
                  { title: 'Back the pool', desc: 'Send at least the creator\'s minimum to claim one of up to 24 slots. No maximum — back as much as you want! Your SOL joins the token\'s transparent pool.' },
                  { title: 'Same price for everyone', desc: 'At launch the pool makes ONE buy — every backer enters at the identical price. No slot is favored, no one is front-run.' },
                  { title: 'Proportional share', desc: 'You receive tokens proportional to how much you backed, sent straight to your wallet.' },
                  { title: 'Withdraw anytime', desc: 'Changed your mind? Withdraw before launch. If slots don\'t fill in 3 days, claim a refund from Portfolio.' },
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 p-3 bg-[var(--background)] border-l-4 border-[var(--success)]">
                    <CheckCircle className="w-5 h-5 text-[var(--success)] mt-0.5 flex-shrink-0" />
                    <span className="text-[var(--muted)]">
                      <strong className="text-[var(--foreground)]">{item.title}</strong> - {item.desc}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {/* BACKERS TAB */}
        {activeTab === 'backers' && (
          <section className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
              // FOR_BACKERS
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Users className="w-6 h-6 text-[var(--accent)]" />
              <h2 className="text-2xl font-black uppercase tracking-tight">For Backers</h2>
            </div>
            <div className="space-y-4 pt-2">
              {[
                { icon: Coins, color: 'text-[var(--accent)]', title: 'Back the Pool', desc: 'Browse the Proving Grounds and claim one of up to 24 backer slots. Your SOL joins the token\'s transparent on-chain pool.' },
                { icon: Key, color: 'text-[var(--warning)]', title: 'Dev Holds 0%', desc: 'The creator never holds the supply. The pool buys at launch and distributes to backers — nothing for a dev to rug.' },
                { icon: Zap, color: 'text-[var(--success)]', title: 'Same Price For Everyone', desc: 'One atomic pool buy at launch — every backer enters at the identical price. No front-running, no favored slot.' },
                { icon: Wallet, color: 'text-[var(--accent-gold)]', title: 'Tokens Sent To You', desc: 'After launch, your proportional share is distributed straight to your connected wallet. Trade anywhere instantly.' },
                { icon: Undo2, color: 'text-[var(--error)]', title: 'Withdraw Anytime', desc: 'Changed your mind? Withdraw before launch. Your SOL returns to your wallet (minus 2% fee).' },
                { icon: TrendingUp, color: 'text-[var(--success)]', title: 'Protocol Fee Routing', desc: 'Trading fees from each launched token are routed by the protocol: a portion is rebated pro-rata to genesis backers, a portion funds platform operations, and a portion may be allocated to discretionary $PROOF holder distributions.' },
              ].map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="flex items-start gap-4 p-4 bg-[var(--background)] border-2 border-[var(--border)] hover:border-[var(--accent)] transition-colors">
                    <Icon className={`w-6 h-6 ${item.color} flex-shrink-0`} />
                    <div>
                      <h3 className="font-bold mb-1 uppercase tracking-wide">{item.title}</h3>
                      <p className="text-sm text-[var(--muted)]">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Phantom token-visibility heads-up — common confusion post-distribution */}
            <div className="mt-6 border-l-4 border-[var(--warning)] bg-[var(--background)] p-4 space-y-2">
              <h3 className="font-bold text-[var(--warning)] uppercase tracking-wide flex items-center gap-2">
                <HelpCircle className="w-4 h-4" />
                After Launch — Finding Your Tokens in Phantom
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Your tokens are sent to your connected wallet automatically when the token launches.
                But Phantom (and most Solana wallets) hide brand-new tokens by default — a spam
                filter that protects users from random airdrop scams. <strong className="text-[var(--foreground)]">Your tokens are there,
                they&apos;re just hidden until the wallet recognizes them.</strong>
              </p>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Three ways to make them visible:
              </p>
              <ul className="text-sm text-[var(--muted)] space-y-1 pl-4">
                <li>· Open Phantom &rarr; Settings &rarr; <strong className="text-[var(--foreground)]">enable &quot;Show all tokens&quot;</strong> (or &quot;Show tokens with low value&quot;)</li>
                <li>· Trade the coin once on its market (Pump.fun or Meteora) — visibility usually triggers within a few minutes of any activity</li>
                <li>· Paste the contract address (CA) into Phantom&apos;s &quot;Manage Tokens&quot; search to manually un-hide it</li>
              </ul>
              <p className="text-xs font-mono text-[var(--muted)]/80 leading-relaxed pt-1">
                &gt; This is a Phantom UX behavior, not a Proof Launch bug. The on-chain transfer is real and verifiable —
                check Solscan with your wallet + the token mint to see the balance.
              </p>
            </div>
          </section>
        )}

        {/* CREATORS TAB */}
        {activeTab === 'creators' && (
          <section className="relative border-2 border-[var(--accent-gold)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent-gold)] text-black text-xs font-bold uppercase tracking-wider">
              // FOR_CREATORS
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Rocket className="w-6 h-6 text-[var(--accent-gold)]" />
              <h2 className="text-2xl font-black uppercase tracking-tight">For Creators</h2>
            </div>
            <div className="space-y-4 pt-2">
              {[
                { num: '1', title: 'Submit Your Token (0.02 SOL)', desc: 'Create your token with name, symbol, description, image, and socials (X, Telegram, Discord, Website, GitHub — GitHub links bake into the on-chain metadata extensions, so wallets and explorers can surface code-shipping devs). Set 2-24 backer slots and a minimum backing amount.' },
                { num: '2', title: 'Fill the Slots', desc: 'Share your token page, engage in the community chat, and rally backers to fill all slots within 3 days.' },
                { num: '3', title: 'Launch on Pump.fun or Meteora', desc: 'Once all slots are filled, click "Launch" when you\'re ready. Coordinate with whales, time the market, give yourself a runway. The pool waits for you — funded tokens don\'t expire.' },
              ].map((step) => (
                <div key={step.num} className="flex items-start gap-4 p-4 bg-[var(--background)] border-l-4 border-[var(--accent-gold)]">
                  <div className="w-8 h-8 bg-[var(--accent-gold)] text-black flex items-center justify-center text-sm font-black flex-shrink-0">
                    {step.num}
                  </div>
                  <div>
                    <h3 className="font-bold mb-1 uppercase tracking-wide">{step.title}</h3>
                    <p className="text-sm text-[var(--muted)]">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-[var(--warning)]/10 border-2 border-[var(--warning)]/30 p-4 mt-4">
              <p className="text-sm text-[var(--muted)]">
                <strong className="text-[var(--warning)]">Important:</strong> Creators are treated equally to other backers.
                To receive tokens at launch and a share of trading fees, you must back your own token.
                This ensures creators have skin in the game alongside backers.
              </p>
            </div>

            {/* Bot-stack callout — links to the bots tab for the deep dive */}
            <div className="bg-[var(--accent)]/10 border-2 border-[var(--accent)]/30 p-4 mt-4 space-y-2">
              <h3 className="font-bold text-[var(--accent)] uppercase tracking-wide flex items-center gap-2 text-sm">
                <Bot className="w-4 h-4" />
                Programmable Tokenomics
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                When submitting, you can stack up to 90% of trading fees across multiple bots —
                burn, labeled treasury vaults you control, holder/backer airdrops. Every bot is
                its own on-chain wallet, auditable forever. See the{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('bots')}
                  className="text-[var(--accent)] underline hover:text-[var(--foreground)]"
                >
                  Bots tab
                </button>{' '}
                for the full breakdown.
              </p>
            </div>
          </section>
        )}

        {/* BOTS TAB — Phase B programmable tokenomics */}
        {activeTab === 'bots' && (
          <>
            <section className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
                // PROGRAMMABLE_TOKENOMICS
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Bot className="w-6 h-6 text-[var(--accent)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Bots — Tokenomics is Lego</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Every Proof Launch token can stack a programmable engine that runs on every
                trade. Each bot gets its own dedicated Solscan wallet, receives a slice of
                the trading-fee stream, and performs one action every cycle — burn supply,
                hold tokens in a labeled treasury, or airdrop tokens / SOL to holders or
                backers. Stack any combination you want, up to a 90% fee-budget cap.
              </p>
              <div className="bg-[var(--background)] border border-[var(--accent)]/40 p-4 text-sm leading-relaxed text-[var(--muted)]">
                <strong className="text-[var(--accent)]">No other Pump.fun or Meteora launcher does this.</strong>{' '}
                Every bonding-curve trade has always been &quot;buy the curve and hope.&quot; Proof gives
                creators a real programmable layer — burn, treasury, holder distribution,
                backer rebate — automated, every block, every trade, auditable forever.
              </div>
            </section>

            {/* The 9 actions */}
            <section className="border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
              <h3 className="font-black uppercase tracking-tight text-lg flex items-center gap-2">
                <Zap className="w-5 h-5 text-[var(--accent-gold)]" /> The 9 actions
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {[
                  { emoji: '🔥', name: 'BURN', tag: 'Deflationary', desc: 'Buy tokens with delegated SOL, then burn them. Permanent, on-chain supply reduction every cycle.' },
                  { emoji: '🏦', name: 'VAULT', tag: 'Treasury', desc: 'Buy + park in a labeled wallet you control (Marketing, DAO, Liquidity, Charity). Unlimited vaults per token. Creator-withdrawable via signed message — operational bots are sealed.' },
                  { emoji: '🪙', name: 'TOKENS → HOLDERS', tag: 'Loyalty', desc: 'Buy tokens, then airdrop them pro-rata to every wallet currently holding the mint. Rewards holding, drives volume.' },
                  { emoji: '🎯', name: 'TOKENS → BACKERS', tag: 'OG reward', desc: 'Buy tokens, then airdrop pro-rata to the genesis backers who funded the launch.' },
                  { emoji: '💸', name: 'SOL → HOLDERS', tag: 'Distribution', desc: 'Skip the swap entirely. Route delegated SOL pro-rata to every current holder as a protocol distribution.' },
                  { emoji: '💰', name: 'SOL → BACKERS', tag: 'Distribution', desc: 'Skip the swap. Route delegated SOL pro-rata to genesis backers as a protocol distribution.' },
                  { emoji: '🎁', name: 'DONATE SOL', tag: 'Commitment', desc: 'Send delegated SOL straight to a fixed destination wallet (charity, DAO, partner). Address is locked in at submit — never changes.' },
                  { emoji: '🎀', name: 'DONATE TOKENS', tag: 'Commitment', desc: 'Buy tokens, send them to a fixed destination wallet. Same immutable destination model as Donate SOL.' },
                  { emoji: '🌊', name: 'POOL FEEDER', tag: 'Liquidity', desc: 'Auto-LP after graduation. Bot accumulates fees pre-grad, then swaps half SOL into tokens and deposits both as locked liquidity once the token graduates to a full AMM (PumpSwap for Pump.fun, DAMM v2 for Meteora). Bot owns the LP position forever — protocol-owned liquidity that compounds.' },
                ].map((a) => (
                  <div key={a.name} className="border border-[var(--border)] bg-[var(--background)] p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-base" aria-hidden>{a.emoji}</span>
                        <span className="font-mono text-xs font-bold tracking-wide">{a.name}</span>
                      </div>
                      <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--accent)] border border-[var(--accent)]/40 px-1.5 py-0.5">
                        {a.tag}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-[var(--muted)] leading-snug">{a.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Vaults & withdrawals */}
            <section className="border-2 border-[var(--accent-gold)] bg-[var(--card)] p-6 space-y-3">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent-gold)] text-black text-xs font-bold uppercase tracking-wider relative -mt-3 inline-block">
                // VAULTS
              </div>
              <h3 className="font-black uppercase tracking-tight text-lg flex items-center gap-2">
                <Key className="w-5 h-5 text-[var(--accent-gold)]" /> Labeled vaults you control
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Vault bots are the breakthrough. Each one is a separate labeled wallet —
                <strong className="text-[var(--foreground)]"> &ldquo;Marketing&rdquo;</strong>,
                <strong className="text-[var(--foreground)]"> &ldquo;DAO Treasury&rdquo;</strong>,
                <strong className="text-[var(--foreground)]"> &ldquo;Liquidity Reserve&rdquo;</strong>,
                whatever you want. The fees flow in automatically. You can withdraw whenever
                you want via a signed message from your creator wallet.
              </p>
              <ul className="text-sm text-[var(--muted)] space-y-1.5 pl-4">
                <li>· Withdrawals require an Ed25519 signature from the meme&apos;s creator wallet. No platform admin can drain your vault.</li>
                <li>· Every withdrawal is recorded in <code className="text-[var(--accent)]">meme_bot_withdrawals</code> — public-read, immutable audit trail.</li>
                <li>· Single-use nonces + ±5min replay window prevent any replayed withdrawal request.</li>
                <li>· Operational bots (BURN, distribute_*) are sealed — only VAULT bots can be withdrawn from. This prevents racing the bot mid-cycle.</li>
              </ul>
            </section>

            {/* Stacking + budget */}
            <section className="border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-3">
              <h3 className="font-black uppercase tracking-tight text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[var(--accent)]" /> Stacking + budget
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Every token has a 90% fee budget to delegate. The remaining 10% always
                goes to the platform. You design the split:
              </p>
              <div className="bg-[var(--background)] border border-[var(--border)] p-4 font-mono text-xs space-y-1">
                <div>BURN ............ 30%</div>
                <div>VAULT (Marketing) 15%</div>
                <div>SOL → HOLDERS ... 20%</div>
                <div className="border-t border-[var(--border)] pt-1 mt-1">
                  Total bots ...... 65%
                </div>
                <div className="text-[var(--accent)]">Backers ......... 25%</div>
                <div className="text-[var(--muted)]">Platform ........ 10%</div>
              </div>
              <ul className="text-sm text-[var(--muted)] space-y-1 pl-4 pt-2">
                <li>· Minimum 5% per bot · maximum 90% combined.</li>
                <li>· One of each non-vault action per stack (no point in two BURN bots — they collapse).</li>
                <li>· Unlimited labeled VAULTs (each is a distinct public commitment).</li>
                <li>· Stack edited later from the creator dashboard. Add or remove bots anytime.</li>
              </ul>
            </section>

            {/* Receipts */}
            <section className="border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-3">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--success)] text-white text-xs font-bold uppercase tracking-wider relative -mt-3 inline-block">
                // RECEIPTS
              </div>
              <h3 className="font-black uppercase tracking-tight text-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-[var(--success)]" /> Live-fire test
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Closed-loop validation on a test token (BOTTEST). All 5 action types fired
                on-chain — receipts:
              </p>
              <div className="grid grid-cols-1 gap-2 pt-2 text-xs font-mono">
                <ReceiptLink emoji="🔥" name="BURN — 219K tokens burned" href="https://solscan.io/tx/3vKYJ5XgCzgtC7FZb1Yq5tA7WxNb7y7VorMoNMihUiWpxxL9WWEPsWZoK53c2YJjtsHQVREKWFPAU8q7oRRa6rZK" />
                <ReceiptLink emoji="🏦" name="Marketing vault filled" href="https://solscan.io/tx/k2K1x7ywHdZ94bS2EmAWrPvrGfn3YvDuizZQJkzj4xJwKTBBq54hSNvCB7rpriXneEDsLPDfvxcP4WBGnnzxeDF" />
                <ReceiptLink emoji="🏦" name="DAO Treasury vault filled" href="https://solscan.io/tx/34N8L7caHTPKLiJwwBm3mTPJE4mSrrvNd42wGRCQnkq3iDwEWmmYxBiH6ER6YGdqPrXU9i8YjpqaFStzwsvpEyj7" />
                <ReceiptLink emoji="💸" name="SOL → HOLDERS — 0.021 SOL airdropped" href="https://solscan.io/tx/21kFuB84uHrWd7hboWW94aUVsVRpYEJvDKwf2qWzbooHX8NwW7jmxEhRo5KikZ1HRtXznW5cQ9Ea6iAQGh7ppnd6" />
                <ReceiptLink emoji="🎯" name="TOKENS → BACKERS — 504K tokens" href="https://solscan.io/tx/2tzmytM7zpYHJNzMBZMrBrjXJ3SiFEftPJbguJg4WWEbVdpNUpUHyPPgGyNx857MC4g2HQSwM5pSZmVVunumtoqr" />
              </div>
            </section>
          </>
        )}

        {/* FEES TAB */}
        {activeTab === 'fees' && (
          <>
            {/* Platform Fees */}
            <section className="relative border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Receipt className="w-6 h-6 text-[var(--accent)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Platform Fees</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Proof Launch is designed to be self-sustaining with minimal fees:
              </p>
              <div className="space-y-3 pt-2">
                {[
                  { label: 'Creation Fee', value: '0.02 SOL', color: 'border-[var(--accent)]', desc: 'One-time fee when submitting a token. Covers token creation on the chosen launchpad (Pump.fun or Meteora). Waived for $PROOF holders (≥500k).' },
                  { label: 'Backing Fee', value: 'None', color: 'border-[var(--success)]', desc: 'No fee on backing. 100% of your SOL goes to the token\'s pool wallet.' },
                  { label: 'Withdrawal Fee', value: '2%', color: 'border-[var(--warning)]', desc: 'If you withdraw your backing before launch, 2% is deducted to discourage frivolous backing/withdrawing.' },
                  { label: 'Trading Fees Routing', value: '90 / 5 / 5', color: 'border-[var(--accent)]', desc: 'Protocol routes trading fees: pro-rata rebate to genesis backers (hold-weighted), platform operations allocation, and a discretionary $PROOF distribution pool. Distributions are at protocol discretion.' },
                ].map((fee, i) => (
                  <div key={i} className={`bg-[var(--background)] p-4 border-l-4 ${fee.color}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold uppercase tracking-wide">{fee.label}</span>
                      <span className="text-sm font-black text-[var(--accent)]">{fee.value}</span>
                    </div>
                    <p className="text-sm text-[var(--muted)]">{fee.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Trading Fee Distribution */}
            <section className="relative border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--success)] text-white text-xs font-bold uppercase tracking-wider">
                // TRADING_FEES
              </div>
              <div className="flex items-center gap-3 pt-2">
                <TrendingUp className="w-6 h-6 text-[var(--success)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Trading Fee Distribution</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Both Pump.fun and Meteora route a percentage of trading volume to the token's creator vault
                (administered by Proof Launch). The protocol routes that vault three ways: a pro-rata rebate
                to genesis backers (hold-weighted), an allocation to platform operations, and an allocation
                to a discretionary $PROOF distribution pool. Creators are eligible for the backer rebate
                only by participating as backers themselves.
              </p>
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 mt-4">
                <h3 className="font-bold mb-3 uppercase tracking-wide">Example: How Fees Flow</h3>
                <p className="text-sm text-[var(--muted)] mb-3">
                  When 1 SOL is traded on a launched token:
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between p-2 bg-[var(--card)]">
                    <span className="text-[var(--muted)]">Launchpad creator fee (Pump.fun 0.5% / Meteora similar)</span>
                    <span className="font-bold">0.005 SOL</span>
                  </div>
                  <div className="border-t-2 border-[var(--border)] pt-3 mt-3 space-y-2">
                    <div className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide font-bold">Proof Launch splits the 0.005 SOL:</div>
                    <div className="flex justify-between p-2 bg-[var(--success)]/10">
                      <span className="text-[var(--success)] font-bold">Genesis Backers (90%, hold-weighted)</span>
                      <span className="font-bold">0.00450 SOL</span>
                    </div>
                    <div className="flex justify-between p-2 bg-[var(--accent)]/10">
                      <span className="text-[var(--accent)]">Platform Operations (5%)</span>
                      <span className="font-bold">0.00025 SOL</span>
                    </div>
                    <div className="flex justify-between p-2 bg-[var(--accent-gold)]/10">
                      <span className="text-[var(--accent-gold)] font-bold">$PROOF Holder Airdrop Pool (5%)</span>
                      <span className="font-bold">0.00025 SOL</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3 uppercase tracking-wide leading-relaxed">
                  Backer rebates are calculated pro-rata to current hold percentage. Rebate amounts
                  attributable to withdrawn positions are redirected to the $PROOF distribution pool,
                  so conviction in the cap table shifts the protocol's routing accordingly.
                </p>
              </div>
            </section>
          </>
        )}

        {/* SECURITY TAB */}
        {activeTab === 'security' && (
          <>
            <section className="relative border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--success)] text-white text-xs font-bold uppercase tracking-wider">
                // TRANSPARENCY
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Shield className="w-6 h-6 text-[var(--success)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Security & Transparency</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                We believe in full transparency. All funds flow is verifiable on-chain.
              </p>

              {/* Platform Fees */}
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 space-y-3">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide">
                  <Coins className="w-5 h-5 text-[var(--accent)]" />
                  Platform Operations
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  The 5% platform cut funds token creation on the chosen launchpad (Pump.fun or Meteora)
                  and ongoing operations. The other 5% platform-side allocation is routed to a
                  discretionary $PROOF distribution pool. All fee transactions are verifiable on-chain
                  — see the <a href="/" className="text-[var(--accent)] hover:underline">Wallets transparency tab</a> in
                  the navbar for every platform wallet, live balances, and Solscan links.
                </p>
              </div>

              {/* Token Wallet Security */}
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 space-y-3">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide">
                  <Key className="w-5 h-5 text-[var(--warning)]" />
                  The Pool & Distribution
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Your backing goes into the token&apos;s transparent on-chain pool wallet —
                  publicly viewable, key held encrypted server-side. It can only do two
                  things: launch (one atomic create+buy) or refund. After launch:
                </p>
                <ul className="text-sm text-[var(--muted)] space-y-1">
                  <li>· The pool buys at launch and tokens are distributed proportionally to backers</li>
                  <li>· Your tokens land in your own connected wallet — nothing to export or claim manually</li>
                  <li>· Trade them on Pump.fun, Meteora, or any DEX the moment they arrive</li>
                </ul>
              </div>

              {/* SOL-029/030/031 compliance */}
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 space-y-3">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide">
                  <Shield className="w-5 h-5 text-[var(--success)]" />
                  Solana Security Standard Compliance
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Proof Launch is the first integrator project at 100% compliance with the three
                  integrator-side rules in the Jelleo Solana Security Standard:
                </p>
                <ul className="text-sm text-[var(--muted)] space-y-1">
                  <li>· <strong>SOL-029</strong> · every wallet-signed transaction simulates first; we never blind-send.</li>
                  <li>· <strong>SOL-030</strong> · every priority fee reads the network fee market (adaptive); no hardcoded literals.</li>
                  <li>· <strong>SOL-031</strong> · every Jupiter quote is checked for <code>contextSlot</code> freshness before being consumed.</li>
                </ul>
                <p className="text-xs text-[var(--muted)]/80 leading-snug">
                  Three of the rules in the Standard (SOL-029/030/031) were added after we ran the
                  ruleset on our own buyback worker and reported the gaps.
                </p>
              </div>

              {/* Disclaimer pointer */}
              <div className="bg-[var(--background)] border-2 border-[var(--accent-gold)]/40 p-4 space-y-2">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide text-[var(--accent-gold)]">
                  <AlertTriangle className="w-5 h-5" />
                  Participation Disclaimer
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Proof Launch is an experimental, community-driven protocol. Nothing on this site
                  is investment advice, a securities offering, or a solicitation. You should have no
                  expectation of profit from holding $PROOF, backing a launch, or participating in
                  any program. Read the{' '}
                  <Link href="/legal" className="text-[var(--accent)] hover:underline font-bold">
                    full participation disclaimer →
                  </Link>
                </p>
              </div>

            </section>

            {/* Safety & Risks */}
            <section className="relative border-2 border-[var(--warning)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--warning)] text-black text-xs font-bold uppercase tracking-wider">
                // WARNING
              </div>
              <div className="flex items-center gap-3 pt-2">
                <AlertTriangle className="w-6 h-6 text-[var(--warning)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Safety & Risks</h2>
              </div>
              <div className="space-y-3 text-[var(--muted)]">
                <p>
                  <strong className="text-[var(--foreground)]">This is not financial advice.</strong> Tokens
                  launched here are highly speculative and volatile. Only invest what you can afford to lose.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--warning)]">★</span>
                    Research the creator and community before backing
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--warning)]">★</span>
                    Understand that most tokens go to zero
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--warning)]">★</span>
                    The platform does not guarantee any returns
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--warning)]">★</span>
                    Smart contract risks exist — use at your own risk
                  </li>
                </ul>
              </div>
            </section>
          </>
        )}

        {/* FAQ TAB */}
        {activeTab === 'faq' && (
          <section className="relative border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <HelpCircle className="w-6 h-6 text-[var(--accent)]" />
              <h2 className="text-2xl font-black uppercase tracking-tight">Frequently Asked Questions</h2>
            </div>
            <div className="space-y-3">
              {[
                { q: 'What happens if slots don\'t fill?', a: 'If all slots aren\'t filled within 3 days, the token expires. Backers can claim a refund from their Portfolio page — SOL is returned from the pool back to your main wallet.' },
                { q: 'How do I get my tokens after launch?', a: 'They\'re distributed to your connected wallet automatically — proportional to how much you backed. Nothing to export or claim manually. You\'ll see your allocation on the token page once distributed.' },
                { q: 'Does everyone get the same price?', a: 'Yes. At launch the pool makes ONE atomic buy, so every backer enters at the identical price. No slot is favored and no one can be front-run — that\'s the core fairness of the pooled model.' },
                { q: 'Can I back multiple times?', a: 'Currently one backing per wallet per token. Withdraw first if you want to change your backing amount.' },
                { q: 'What\'s the minimum/maximum backing?', a: 'The creator sets a minimum (at least 0.1 SOL). There is NO maximum — back as much as you want! Your token share is proportional to your contribution.' },
                { q: 'Where does my backed SOL go?', a: 'Into the token\'s transparent on-chain pool wallet (publicly viewable). It can only launch (one atomic create+buy) or refund — it never sits with the creator.' },
                { q: 'Why does the contract address end in "pooL"?', a: 'Every genuine Proof Launch token\'s contract address ends in “pooL”. It\'s a verifiable on-chain signature that the token was launched fairly through Proof — dev holds 0%, atomic pooled buy, proportional distribution.' },
                { q: 'How is this rug-resistant?', a: 'The creator never holds the supply (dev = 0%). The pool buys atomically with token creation — no sniper gap — and tokens go straight to backers. There is no concentrated dev bag to dump.' },
              ].map((faq, i) => (
                <div key={i} className="bg-[var(--background)] border-2 border-[var(--border)] p-4 hover:border-[var(--accent)] transition-colors">
                  <h3 className="font-bold mb-2 uppercase tracking-wide text-sm">{faq.q}</h3>
                  <p className="text-sm text-[var(--muted)]">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* CTA */}
      <div className="relative text-center py-8">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
        <p className="text-[var(--muted)] uppercase tracking-wide text-sm mb-4">Ready to get started?</p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/"
            className="px-6 py-3 bg-[var(--accent)] text-white font-black uppercase tracking-wide hover:opacity-90 transition-opacity border-2 border-[var(--accent)]"
          >
            Browse Tokens
          </Link>
          <Link
            href="/submit"
            className="px-6 py-3 bg-[var(--card)] border-2 border-[var(--border)] font-black uppercase tracking-wide hover:border-[var(--accent)] transition-colors"
          >
            Submit a Token
          </Link>
        </div>
        <p className="text-xs font-mono text-[var(--muted)] mt-6">
          Curious what we&apos;re building next?{' '}
          <Link href="/roadmap" className="text-[var(--accent)] hover:underline">
            See the roadmap &rarr;
          </Link>
        </p>
      </div>
    </div>
  );
}

// Compact one-line link row for the Bots tab receipts. Avoids polluting
// the full URL into the visible label so the row stays scannable.
function ReceiptLink({ emoji, name, href }: { emoji: string; name: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-2 px-3 py-2 border border-[var(--border)] hover:border-[var(--accent)] bg-[var(--background)] transition-colors group"
    >
      <span className="flex items-center gap-2 text-[var(--foreground)] truncate">
        <span aria-hidden>{emoji}</span> {name}
      </span>
      <span className="flex items-center gap-1 text-[var(--accent)] text-[10px] uppercase tracking-widest shrink-0">
        Solscan <ExternalLink className="w-3 h-3" />
      </span>
    </a>
  );
}
