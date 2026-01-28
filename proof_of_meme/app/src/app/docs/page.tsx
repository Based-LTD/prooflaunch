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
      {/* Back Button */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors uppercase text-sm font-bold tracking-wide"
      >
        <ArrowLeft className="w-4 h-4" />
        Return to Revolution
      </Link>

      {/* Header */}
      <div className="relative text-center py-8">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
        <h1 className="text-4xl font-black uppercase tracking-tight mb-2">
          <span className="gradient-text">The Manifesto</span>
        </h1>
        <p className="text-[var(--muted)] uppercase tracking-wide text-sm">
          Everything you need to know about Commie Launch
        </p>
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
      </div>

      {/* Tab Navigation */}
      <div className="border-2 border-[var(--border)] bg-[var(--card)] p-2">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center gap-1 px-3 py-3 text-xs font-bold uppercase tracking-wide transition-all ${
                  isActive
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--background)]/80'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="hidden sm:block">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            {/* What is Commie Launch */}
            <section className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
                ★ The Revolution
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Rocket className="w-6 h-6 text-[var(--accent)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">What is Commie Launch?</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Commie Launch is the people's meme coin launchpad on Solana. Unlike bourgeois
                launches where developers control everything, here <strong>the people unite BEFORE
                tokens launch</strong>. Comrades pool SOL to prove solidarity in a meme, and once the
                goal is reached, the token launches on Pump.fun with comrades receiving tokens
                proportional to their contribution.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">1</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Submit a Meme</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">2</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Comrades Unite</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">3</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Launch on Pump.fun</div>
                </div>
              </div>
            </section>

            {/* How Backing Works - Burner Wallets */}
            <section className="relative border-2 border-[var(--warning)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--warning)] text-black text-xs font-bold uppercase tracking-wider">
                ★ Key Innovation
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Key className="w-6 h-6 text-[var(--warning)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">How Backing Works</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                When you back a meme, a unique <strong>token wallet</strong> is created just for your backing.
                This is the key innovation that makes Commie Launch different from other launchpads.
              </p>
              <div className="space-y-3 pt-2">
                {[
                  { num: '1', title: 'You Back a Meme', desc: 'When you click "Join the Revolution", a fresh keypair (token wallet) is generated. Your SOL goes directly to this wallet - not to a shared pool.' },
                  { num: '2', title: 'Wallet is Locked', desc: 'Until launch, your token wallet is locked - you cannot add more SOL or spend from it. This ensures fair ordering and prevents manipulation.' },
                  { num: '3', title: 'Token Launches', desc: 'When the goal is reached and the creator launches, each token wallet executes its own buy on Pump.fun. Earlier backers get better prices!' },
                  { num: '4', title: 'Full Access', desc: 'Immediately after launch, your token wallet is unlocked. Transfer tokens to your main wallet, export the private key to Phantom, or sell directly.' },
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
              <div className="bg-[var(--success)]/10 border-2 border-[var(--success)]/30 p-4 mt-4">
                <h3 className="font-bold text-[var(--success)] mb-2 uppercase tracking-wide">Why Token Wallets?</h3>
                <ul className="text-sm text-[var(--muted)] space-y-1">
                  <li>★ <strong>Organic on-chain activity:</strong> Each buy is a separate transaction from a unique wallet</li>
                  <li>★ <strong>Fair ordering:</strong> Earlier backers buy first and get better prices</li>
                  <li>★ <strong>No front-running:</strong> Nobody can snipe ahead of the community</li>
                  <li>★ <strong>Transparent:</strong> All buys are visible on-chain from identifiable wallets</li>
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
                When a meme is submitted, it enters the "Proving" phase. During this time:
              </p>
              <ul className="space-y-3">
                {[
                  { title: 'Backers pledge SOL', desc: 'Send SOL to your token wallet to show support. Your funds stay in your wallet until launch.' },
                  { title: 'Max 10% per wallet', desc: 'No single wallet can back more than 10% of the goal, ensuring fair distribution.' },
                  { title: 'Withdraw anytime', desc: 'Changed your mind? Withdraw your backing before launch (2% withdrawal fee).' },
                  { title: 'Time-limited', desc: 'Each meme has a deadline. If the goal isn\'t reached, backers can claim a refund from Portfolio.' },
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
              ★ For Comrades
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Users className="w-6 h-6 text-[var(--accent)]" />
              <h2 className="text-2xl font-black uppercase tracking-tight">For Backers</h2>
            </div>
            <div className="space-y-4 pt-2">
              {[
                { icon: Coins, color: 'text-[var(--accent)]', title: 'Back Memes You Believe In', desc: 'Browse the Proving Grounds and back memes with SOL. Your backing shows community support and helps reach the launch goal.' },
                { icon: Key, color: 'text-[var(--warning)]', title: 'Your Own Token Wallet', desc: 'Each backing creates a unique wallet. You can export the private key and import it into Phantom for full control of your tokens.' },
                { icon: Zap, color: 'text-[var(--success)]', title: 'Early Backers Get Better Prices', desc: 'Token wallets buy in order of backing time. Be early to get lower prices on the bonding curve and more tokens for your SOL!' },
                { icon: Wallet, color: 'text-[var(--accent-gold)]', title: 'Transfer or Sell After Launch', desc: 'After launch, visit your Portfolio to transfer tokens to your main wallet, or sell directly from the token wallet. You have full control.' },
                { icon: Undo2, color: 'text-[var(--error)]', title: 'Withdraw Anytime', desc: 'Changed your mind? Withdraw your backing before the token launches. Your SOL is returned directly to your wallet (minus 2% fee).' },
                { icon: TrendingUp, color: 'text-[var(--success)]', title: 'Earn Trading Fees', desc: 'Genesis backers earn a share of all trading fees proportional to their contribution. 90% of fees go to backers, 10% to the platform.' },
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
          </section>
        )}

        {/* CREATORS TAB */}
        {activeTab === 'creators' && (
          <section className="relative border-2 border-[var(--accent-gold)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent-gold)] text-black text-xs font-bold uppercase tracking-wider">
              ★ For Revolutionaries
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Rocket className="w-6 h-6 text-[var(--accent-gold)]" />
              <h2 className="text-2xl font-black uppercase tracking-tight">For Creators</h2>
            </div>
            <div className="space-y-4 pt-2">
              {[
                { num: '1', title: 'Submit Your Meme (0.02 SOL)', desc: 'Create your meme with name, symbol, description, and image. Set your backing goal and duration.' },
                { num: '2', title: 'Build Community', desc: 'Share your meme page, engage in the comrade chat, and rally backers to reach your goal before the deadline.' },
                { num: '3', title: 'Launch on Pump.fun', desc: 'Once fully funded, click "Launch" to deploy your token on Pump.fun. Each backer\'s token wallet then buys tokens in order of backing time.' },
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
                This ensures creators have skin in the game alongside the people.
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
                Commie Launch is designed to be self-sustaining with minimal fees:
              </p>
              <div className="space-y-3 pt-2">
                {[
                  { label: 'Creation Fee', value: '0.02 SOL', color: 'border-[var(--accent)]', desc: 'One-time fee when submitting a meme. Covers token creation costs on Pump.fun.' },
                  { label: 'Platform Fee (Backing)', value: '2% or 0.01 SOL min', color: 'border-[var(--success)]', desc: 'Added to each backing: 2% of your backing amount, or 0.01 SOL minimum (whichever is higher).' },
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
                ★ Spoils of War
              </div>
              <div className="flex items-center gap-3 pt-2">
                <TrendingUp className="w-6 h-6 text-[var(--success)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Trading Fee Distribution</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Pump.fun sends 0.5% of all trading volume to the token creator wallet (controlled by Commie Launch).
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
                    <div className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide font-bold">Commie Launch distributes the 0.005 SOL:</div>
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
                  Creators are treated equally - back your meme to earn fees!
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
                ★ Transparency
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
                  Token Wallet Security
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Your backing goes to your own token wallet, not a shared pool. The private key
                  is encrypted and stored server-side until launch. After launch, you can:
                </p>
                <ul className="text-sm text-[var(--muted)] space-y-1">
                  <li>★ Export the private key and import into Phantom</li>
                  <li>★ Transfer tokens directly from Portfolio</li>
                  <li>★ Sell tokens directly from Portfolio</li>
                </ul>
              </div>

              {/* Open Source */}
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 space-y-3">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                  Open Source Code
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Our entire codebase is open source. Review the code, verify the escrow logic,
                  or contribute improvements.
                </p>
                <a
                  href="https://github.com/anthropics/proof-of-meme"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--card)] border-2 border-[var(--border)] text-sm font-bold uppercase tracking-wide hover:border-[var(--accent)] transition-colors"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                  View on GitHub
                </a>
              </div>
            </section>

            {/* Safety & Risks */}
            <section className="relative border-2 border-[var(--warning)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--warning)] text-black text-xs font-bold uppercase tracking-wider">
                ★ Warning
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
                    Smart contract risks exist - use at your own risk
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
                { q: 'What happens if the goal isn\'t reached?', a: 'If the backing deadline passes without reaching the goal, backers can claim a refund from their Portfolio page. Refunds return SOL from your token wallet back to your main wallet.' },
                { q: 'How do I get my tokens after launch?', a: 'Your tokens are in your token wallet after launch. You can transfer them from the meme page or from Portfolio. Click "Transfer" to move them to your main wallet, or "Export Key" to import the wallet into Phantom.' },
                { q: 'Why do earlier backers get better prices?', a: 'Each token wallet buys tokens in order of when you backed. Pump.fun uses a bonding curve where price increases with each purchase. Being first = lower price!' },
                { q: 'Can I back multiple times?', a: 'Currently one backing per wallet per meme. Withdraw first if you want to change your backing amount.' },
                { q: 'What\'s the minimum backing amount?', a: 'The minimum is 0.01 SOL. Maximum is 10% of the goal to ensure fair distribution.' },
                { q: 'Where does my backed SOL go?', a: 'Your SOL goes to your own token wallet (unique keypair). On launch, that wallet executes a buy on Pump.fun. The tokens stay in the wallet until you transfer them.' },
                { q: 'Can I access my token wallet before launch?', a: 'No. Token wallets are locked until the meme launches. You cannot add more SOL or spend from it. After launch, you get full access immediately - transfer tokens, export the key, or sell.' },
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
            Start Revolution
          </Link>
        </div>
      </div>
    </div>
  );
}
