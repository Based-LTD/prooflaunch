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
} from 'lucide-react';

type TabId = 'overview' | 'backers' | 'creators' | 'fees' | 'security' | 'faq';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const tabs: Tab[] = [
  { id: 'overview', label: 'Overview', icon: Rocket },
  { id: 'backers', label: 'For Backers', icon: Users },
  { id: 'creators', label: 'For Creators', icon: Zap },
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
                Proof Launch is a community-curated meme coin launchpad on Solana. Unlike typical
                launches where developers control everything, here <strong>communities form BEFORE
                tokens launch</strong>. Creators set up to 8 backer slots, and once all slots are filled,
                the token launches on Pump.fun with backers receiving tokens proportional to their contribution.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">1</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Submit a Meme</div>
                  <div className="text-xs text-[var(--muted)] mt-1">Set 2-8 slots + minimum</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">2</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Fill All Slots</div>
                  <div className="text-xs text-[var(--muted)] mt-1">Backers claim slots</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">3</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Launch on Pump.fun</div>
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
                Backers pool their SOL into one transparent, on-chain wallet for the meme.
                At launch, that pool creates the token and buys it in a <strong>single atomic
                transaction</strong> — the creator (dev) holds <strong>0%</strong>, there is
                no gap for snipers, and <strong>every backer gets the exact same entry price</strong>.
                Tokens are then distributed to each backer proportionally.
              </p>
              <div className="space-y-3 pt-2">
                {[
                  { num: '1', title: 'Back the Pool', desc: 'Send at least the creator\'s minimum to claim one of 2–8 slots. Your SOL goes to the meme\'s transparent pool wallet — publicly visible on-chain.' },
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
                When a meme is submitted, it enters the "Proving" phase. Backers race to fill the available slots:
              </p>
              <ul className="space-y-3">
                {[
                  { title: 'Back the pool', desc: 'Send at least the creator\'s minimum to claim one of 2-8 slots. No maximum — back as much as you want! Your SOL joins the meme\'s transparent pool.' },
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
                { icon: Coins, color: 'text-[var(--accent)]', title: 'Back the Pool', desc: 'Browse the Proving Grounds and claim one of 2-8 backer slots. Your SOL joins the meme\'s transparent on-chain pool.' },
                { icon: Key, color: 'text-[var(--warning)]', title: 'Dev Holds 0%', desc: 'The creator never holds the supply. The pool buys at launch and distributes to backers — nothing for a dev to rug.' },
                { icon: Zap, color: 'text-[var(--success)]', title: 'Same Price For Everyone', desc: 'One atomic pool buy at launch — every backer enters at the identical price. No front-running, no favored slot.' },
                { icon: Wallet, color: 'text-[var(--accent-gold)]', title: 'Tokens Sent To You', desc: 'After launch, your proportional share is distributed straight to your connected wallet. Trade anywhere instantly.' },
                { icon: Undo2, color: 'text-[var(--error)]', title: 'Withdraw Anytime', desc: 'Changed your mind? Withdraw before launch. Your SOL returns to your wallet (minus 2% fee).' },
                { icon: TrendingUp, color: 'text-[var(--success)]', title: 'Earn Trading Fees', desc: 'Genesis backers earn 90% of all trading fees proportional to contribution. Platform takes 10%.' },
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
                Your tokens are sent to your connected wallet automatically when the meme launches.
                But Phantom (and most Solana wallets) hide brand-new tokens by default — a spam
                filter that protects users from random airdrop scams. <strong className="text-[var(--foreground)]">Your tokens are there,
                they&apos;re just hidden until the wallet recognizes them.</strong>
              </p>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Three ways to make them visible:
              </p>
              <ul className="text-sm text-[var(--muted)] space-y-1 pl-4">
                <li>· Open Phantom &rarr; Settings &rarr; <strong className="text-[var(--foreground)]">enable &quot;Show all tokens&quot;</strong> (or &quot;Show tokens with low value&quot;)</li>
                <li>· Trade the coin once on pump.fun — visibility usually triggers within a few minutes of any activity</li>
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
                { num: '1', title: 'Submit Your Meme (0.02 SOL)', desc: 'Create your meme with name, symbol, description, and image. Set 2-8 backer slots and a minimum backing amount.' },
                { num: '2', title: 'Fill the Slots', desc: 'Share your meme page, engage in the community chat, and rally backers to fill all slots within 3 days.' },
                { num: '3', title: 'Launch on Pump.fun', desc: 'Once all slots are filled, click "Launch" when you\'re ready. Coordinate with whales, time the market, give yourself a runway. The pool waits for you — funded memes don\'t expire.' },
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
                To receive tokens at launch and a share of trading fees, you must back your own meme.
                This ensures creators have skin in the game alongside backers.
              </p>
            </div>
          </section>
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
                  { label: 'Creation Fee', value: '0.02 SOL', color: 'border-[var(--accent)]', desc: 'One-time fee when submitting a meme. Covers token creation costs on Pump.fun.' },
                  { label: 'Platform Fee (Backing)', value: '2%', color: 'border-[var(--success)]', desc: 'Added to each backing: 2% of your backing amount.' },
                  { label: 'Withdrawal Fee', value: '2%', color: 'border-[var(--warning)]', desc: 'If you withdraw your backing before launch, 2% is deducted to discourage frivolous backing/withdrawing.' },
                  { label: 'Trading Fees', value: '10% platform cut', color: 'border-[var(--accent)]', desc: 'Platform takes 10% of Pump.fun creator fees for sustainability. The remaining 90% goes to all backers proportionally.' },
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
                Pump.fun sends 0.5% of all trading volume to the token creator wallet (controlled by Proof Launch).
                This is distributed to all backers proportionally. Creators must back their own meme to earn fees.
              </p>
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 mt-4">
                <h3 className="font-bold mb-3 uppercase tracking-wide">Example: How Fees Flow</h3>
                <p className="text-sm text-[var(--muted)] mb-3">
                  When 1 SOL is traded on a launched token:
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between p-2 bg-[var(--card)]">
                    <span className="text-[var(--muted)]">Pump.fun creator fee (0.5%)</span>
                    <span className="font-bold">0.005 SOL</span>
                  </div>
                  <div className="border-t-2 border-[var(--border)] pt-3 mt-3 space-y-2">
                    <div className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide font-bold">Proof Launch distributes the 0.005 SOL:</div>
                    <div className="flex justify-between p-2 bg-[var(--accent)]/10">
                      <span className="text-[var(--accent)] font-bold">Platform (10%)</span>
                      <span className="font-bold">0.0005 SOL</span>
                    </div>
                    <div className="flex justify-between p-2 bg-[var(--success)]/10">
                      <span className="text-[var(--success)]">All Backers (90%)</span>
                      <span className="font-bold">0.0045 SOL</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3 uppercase tracking-wide">
                  Backers split their share proportionally based on how much they backed.
                  Creators are treated equally — back your meme to earn fees!
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
                  Platform fees fund token creation costs on Pump.fun and ongoing operations.
                  All fee transactions are verifiable on-chain.
                </p>
              </div>

              {/* Token Wallet Security */}
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 space-y-3">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide">
                  <Key className="w-5 h-5 text-[var(--warning)]" />
                  The Pool & Distribution
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Your backing goes into the meme&apos;s transparent on-chain pool wallet —
                  publicly viewable, key held encrypted server-side. It can only do two
                  things: launch (one atomic create+buy) or refund. After launch:
                </p>
                <ul className="text-sm text-[var(--muted)] space-y-1">
                  <li>· The pool buys at launch and tokens are distributed proportionally to backers</li>
                  <li>· Your tokens land in your own connected wallet — nothing to export or claim manually</li>
                  <li>· Trade them anywhere (pump.fun, any DEX) the moment they arrive</li>
                </ul>
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
                  <strong className="text-[var(--foreground)]">This is not financial advice.</strong> Meme
                  coins are highly speculative and volatile. Only invest what you can afford to lose.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--warning)]">★</span>
                    Research the creator and community before backing
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[var(--warning)]">★</span>
                    Understand that most meme coins go to zero
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
                { q: 'What happens if slots don\'t fill?', a: 'If all slots aren\'t filled within 3 days, the meme expires. Backers can claim a refund from their Portfolio page — SOL is returned from the pool back to your main wallet.' },
                { q: 'How do I get my tokens after launch?', a: 'They\'re distributed to your connected wallet automatically — proportional to how much you backed. Nothing to export or claim manually. You\'ll see your allocation on the meme page once distributed.' },
                { q: 'Does everyone get the same price?', a: 'Yes. At launch the pool makes ONE atomic buy, so every backer enters at the identical price. No slot is favored and no one can be front-run — that\'s the core fairness of the pooled model.' },
                { q: 'Can I back multiple times?', a: 'Currently one backing per wallet per meme. Withdraw first if you want to change your backing amount.' },
                { q: 'What\'s the minimum/maximum backing?', a: 'The creator sets a minimum (at least 0.1 SOL). There is NO maximum — back as much as you want! Your token share is proportional to your contribution.' },
                { q: 'Where does my backed SOL go?', a: 'Into the meme\'s transparent on-chain pool wallet (publicly viewable). It can only launch (one atomic create+buy) or refund — it never sits with the creator.' },
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
            Browse Memes
          </Link>
          <Link
            href="/submit"
            className="px-6 py-3 bg-[var(--card)] border-2 border-[var(--border)] font-black uppercase tracking-wide hover:border-[var(--accent)] transition-colors"
          >
            Submit a Meme
          </Link>
        </div>
      </div>
    </div>
  );
}
