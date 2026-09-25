'use client';

// PoolLaunch docs — the SOL /docs page twinned for Robinhood Chain.
// Same tabbed terminal skin; the content documents the trustless
// contract architecture, the fee split (v7: 90/7/3 → v8: the flywheel), and the launch-bot stack.
import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Rocket, Users, Shield, Coins, CheckCircle, AlertTriangle,
  TrendingUp, Zap, Receipt, Key, HelpCircle, Bot, ExternalLink,
  Undo2 as Undo2Icon, Wallet as WalletIcon, Lock, MessageCircle, Eye, Landmark,
} from 'lucide-react';
import { POOLLAUNCH_FACTORY, POOLLAUNCH_FACTORY_V4, POOLLAUNCH_FACTORY_V5, POOLLAUNCH_FACTORY_V6, POOLLAUNCH_FACTORY_V7, LEG_DEPLOYER_V3, PONS_FACTORY, AIRDROP_OPERATOR, explorerUrl } from '@/lib/rhc';
import { EQUITY_ROUTER } from '@/lib/rhcEquity';

const LEG_DEPLOYER = '0xA530b670762A5e82062A8f2256B0d877Afc8eBe4';
const LEG_DEPLOYER_V2 = '0x42a2495D9426fd5d88A01e724E62275DCe02dfF4';

type TabId = 'overview' | 'backers' | 'creators' | 'bots' | 'fees' | 'security' | 'faq';

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Rocket },
  { id: 'backers', label: 'For Backers', icon: Users },
  { id: 'creators', label: 'For Creators', icon: Zap },
  { id: 'bots', label: 'Bots', icon: Bot },
  { id: 'fees', label: 'Fees', icon: Receipt },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
];

export default function RhcDocsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <Link
        href="/rhc"
        className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--accent)] transition-colors text-xs font-mono uppercase tracking-widest"
      >
        <ArrowLeft className="w-3 h-3" />
        [&lt;] Back to the Board
      </Link>

      {/* Header — terminal block */}
      <div className="border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
            {'// PROOF_LAUNCH.SYS // DOCS'}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-gold)]">
            ROBINHOOD CHAIN · v0.3.0
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
            ProofLaunch on Robinhood Chain — the pooled launch model, enforced by ownerless contracts
          </p>
        </div>
      </div>

      {/* Tab bar */}
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

      <div className="space-y-6">
        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <>
            <section className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
                {'// OVERVIEW'}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Rocket className="w-6 h-6 text-[var(--accent)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">What is ProofLaunch on Robinhood Chain?</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                ProofLaunch on Robinhood Chain is our pooled-launch model, rebuilt as <strong>trustless
                smart contracts</strong>. Communities pool ETH toward a raise
                goal; when the goal is met, one transaction launches the token on{' '}
                <strong>pons</strong> and buys it with the entire pool — snipe-exempt, on the
                launch block. Backers claim tokens pro-rata and earn{' '}
                <strong>the majority of the creator&apos;s trading fees, forever</strong> — up to 90% on today&apos;s
                factory, less whatever bot legs the creator stacked; the remainder after a fixed 30% $PLAUNCH burn and 10% platform leg on the next. On Solana we
                enforce these promises operationally. Here the contracts enforce them:
                no admin keys, no pause switch, no upgrade path — <strong>the platform
                cannot touch your funds even if it wanted to</strong>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">1</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Submit a Token</div>
                  <div className="text-xs text-[var(--muted)] mt-1">Goal + terms, immutable at creation</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">2</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Pool the Raise</div>
                  <div className="text-xs text-[var(--muted)] mt-1">Backers deposit ETH into the contract</div>
                </div>
                <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 text-center">
                  <div className="text-3xl font-black text-[var(--accent)]">3</div>
                  <div className="text-sm text-[var(--muted)] uppercase tracking-wide font-bold">Launch on pons</div>
                  <div className="text-xs text-[var(--muted)] mt-1">One tx: create + pooled buy</div>
                </div>
              </div>
            </section>

            <section className="relative border-2 border-[var(--warning)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--warning)] text-black text-xs font-bold uppercase tracking-wider">
                {'// KEY_INNOVATION'}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Key className="w-6 h-6 text-[var(--warning)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">The Campaign IS the Creator</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Every raise deploys its own <strong>Campaign contract</strong>, and that contract —
                not any person — is the token&apos;s creator on pons. It holds the pool, executes
                the launch, receives the tokens, and routes the creator fee stream into an
                immutable <strong>FeeSplitter</strong>. There is no human in the money path.
              </p>
              <div className="space-y-3 pt-2">
                {[
                  { num: '1', title: 'Back the Pool', desc: 'Deposit ETH into the Campaign contract. Withdraw in full any time before launch — the contract can\'t say no.' },
                  { num: '2', title: 'Goal Met → Launch', desc: 'The creator launches early, or anyone can trigger it after the deadline. One transaction creates the token on pons and buys it with the whole pool — snipe-exempt on the launch block. Creator holds 0%.' },
                  { num: '3', title: 'Claim Pro-Rata', desc: 'Your token share equals your share of the raise, snapshotted at launch. Claim from the campaign page — the contract computes it, nobody can adjust it.' },
                  { num: '4', title: 'Fees Stream Forever', desc: 'Every trade pays creator fees into the FeeSplitter. The 90% that is not platform-fixed is the creator\u2019s budget: whatever bot legs they stacked come out of it and backers get the rest, pro-rata and pull-based — claim whenever you like, in ETH or, if the creator set one, as tokenized stock (SpaceX, Microsoft…) swapped in the same transaction.' },
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
                  <li>· <strong className="text-[var(--accent-gold)]">Trustless:</strong> ownerless contracts — no admin, no pause, no upgrade, nothing for us to rug</li>
                  <li>· <strong className="text-[var(--accent)]">Same price for all:</strong> one atomic pooled buy — no backer is front-run or favored</li>
                  <li>· <strong>Snipe-exempt:</strong> the pooled buy executes on the launch block, before snipers can</li>
                  <li>· <strong>Refunds are code:</strong> goal unmet by deadline (+3-day grace) → refunds open unconditionally</li>
                  <li>· <strong>Backer revenue, not creator revenue:</strong> launchpads route the fee stream to the creator by default. Here the campaign contract is the creator, so it goes to the wallets that funded the launch</li>
                </ul>
              </div>
            </section>
          </>
        )}

        {/* BACKERS */}
        {activeTab === 'backers' && (
          <section className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
              {'// FOR_BACKERS'}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Users className="w-6 h-6 text-[var(--accent)]" />
              <h2 className="text-2xl font-black uppercase tracking-tight">For Backers</h2>
            </div>
            <div className="space-y-4 pt-2">
              {[
                { icon: Coins, color: 'text-[var(--accent)]', title: 'Back the Pool', desc: 'Deposit ETH into a campaign from its page (Phantom\'s EVM side, MetaMask, or Rabby — the site switches your wallet to Robinhood Chain automatically).' },
                { icon: Undo2Icon, color: 'text-[var(--error)]', title: 'Withdraw Anytime Pre-Launch', desc: 'Full-amount withdrawal until the moment of launch, no fee, no permission. It\'s a contract function — the platform can\'t block it.' },
                { icon: Key, color: 'text-[var(--warning)]', title: 'Creator Holds 0%', desc: 'The Campaign contract is the pons creator. The pooled buy lands in the contract and is claimable only pro-rata by backers.' },
                { icon: Zap, color: 'text-[var(--success)]', title: 'Same Price For Everyone', desc: 'One atomic pooled buy at launch, snipe-exempt on the launch block. Every backer enters at the identical price.' },
                { icon: WalletIcon, color: 'text-[var(--accent-gold)]', title: 'Claim Tokens + Fees', desc: 'After launch, claim your token share once, then claim your fee share whenever you like — the backer share of the creator tax on every trade (up to 90% on today\u2019s factory and 50\u201360% on the flywheel factory, in both cases less any bot legs the creator stacked) flows to backers pro-rata, in ETH, forever. Pull-based: your money waits for you in the contract.' },
                { icon: Landmark, color: 'text-[var(--accent)]', title: 'Fees in Stock, If the Creator Says So', desc: 'Creators can set the payout asset to a tokenized stock. Your ETH fee share is swapped through the Uniswap v4 pool on the way to your wallet, in the same transaction you claim — the contract never holds the shares. Plain ETH is always one click away as the safety hatch.' },
                { icon: Eye, color: 'text-[var(--success)]', title: 'The Roster Shows Who Is Still In', desc: 'Every backer wallet, its stake, and after launch its live token balance against what it was allocated. Read from the contract, not self-reported. If a genesis wallet sold, everyone can see it.' },
                { icon: MessageCircle, color: 'text-[var(--muted)]', title: 'Chat With the Room', desc: 'Every campaign page has a chat. One wallet signature to post; the server verifies every message came from the wallet it says.' },
                { icon: Lock, color: 'text-[var(--accent-gold)]', title: 'Lock Your Seat, Earn More (next contract generation)', desc: 'Pick a lock when you take a seat — 3 months to 2 years after launch. Your tokens stay in the campaign contract until then, visible to every backer before launch; only ever extendable, and nobody can shorten it, including us. Locking pays: six months weights your fee share ×1.25, a year or more ×1.5, out of the same pool sellers forfeit. Tokens are not weighted, only fees. Built and tested, ships with v8.' },
                { icon: TrendingUp, color: 'text-[var(--error)]', title: 'Sell and You Stop Earning (next contract generation)', desc: 'Your fee share follows the tokens: sell half, earn half; sell all and your share buys and burns $PLAUNCH. Locked and unclaimed tokens count as held. Built and tested, ships with v8.' },
                { icon: TrendingUp, color: 'text-[var(--success)]', title: 'Refunds Are Automatic Law', desc: 'Goal unmet by the deadline plus a 3-day grace window → refunds open unconditionally. No support ticket, no discretion — code.' },
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
            <div className="mt-6 border-l-4 border-[var(--warning)] bg-[var(--background)] p-4 space-y-2">
              <h3 className="font-bold text-[var(--warning)] uppercase tracking-wide flex items-center gap-2">
                <HelpCircle className="w-4 h-4" />
                Why claim instead of auto-send?
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                On Solana we push tokens to your wallet. Trustless EVM contracts use{' '}
                <strong className="text-[var(--foreground)]">pull-based claims</strong> instead — the
                contract can&apos;t be griefed by a recipient that rejects a transfer, and your
                entitlement can never expire or be redirected. Your tokens and fees sit in the
                contract with your name on them until you claim. Gas on Robinhood Chain costs a
                fraction of a cent.
              </p>
            </div>
          </section>
        )}

        {/* CREATORS */}
        {activeTab === 'creators' && (
          <section className="relative border-2 border-[var(--accent-gold)] bg-[var(--card)] p-6 space-y-4">
            <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent-gold)] text-black text-xs font-bold uppercase tracking-wider">
              {'// FOR_CREATORS'}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Rocket className="w-6 h-6 text-[var(--accent-gold)]" />
              <h2 className="text-2xl font-black uppercase tracking-tight">For Creators</h2>
            </div>
            <div className="space-y-4 pt-2">
              {[
                { num: '1', title: 'Submit Your Token (0.001 ETH + gas)', desc: 'Name, symbol, logo, banner, socials, raise goal, per-backer min/max, seat count, deadline, creator tax (0\u201310%, the pons dial \u2014 except here your BACKERS earn it), pons buyback toggle, bot stack. Team rounds: reserve seats for an allowlist. Token gating: require a balance to back. Raise in ETH, USDG or a tokenized stock. Everything becomes immutable contract state \u2014 backers can verify the exact terms on-chain before depositing a single wei.' },
                { num: '1b', title: 'Set the Payout Asset', desc: 'Choose what your backers\u2019 fee stream pays out in: ETH, or a tokenized stock such as SpaceX or Microsoft. \u201cHolders earn SpaceX\u201d is set at creation and read from the contract. Backers can always take ETH instead.' },
                { num: '2', title: 'Rally the Raise', desc: 'Share your campaign link. Backers deposit ETH; the board shows live progress read straight from the chain.' },
                { num: '3', title: 'Launch When Ready', desc: 'Goal met → you launch whenever you want (or anyone can after the deadline, so a funded raise can never be held hostage). One transaction: token created on pons + the whole pool buys, snipe-exempt.' },
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
                <strong className="text-[var(--warning)]">Important:</strong> Creators are backers.
                To hold tokens and earn the backer fee share, back your own raise — the contract
                treats you identically to everyone else. Your only special power is launching
                early once the goal is met.
              </p>
            </div>
            <div className="bg-[var(--accent)]/10 border-2 border-[var(--accent)]/30 p-4 mt-4 space-y-2">
              <h3 className="font-bold text-[var(--accent)] uppercase tracking-wide flex items-center gap-2 text-sm">
                <Bot className="w-4 h-4" />
                The Trustless Bot Stack
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Carve up to 90% of the fee stream into launch bots — burn and pool-feeder bots deployed
                as ownerless contracts alongside your campaign: no operator, no off switch, anyone can
                crank them. See the{' '}
                <button type="button" onClick={() => setActiveTab('bots')} className="text-[var(--accent)] underline hover:text-[var(--foreground)]">
                  Bots tab
                </button>{' '}
                for the full breakdown.
              </p>
            </div>
          </section>
        )}

        {/* BOTS */}
        {activeTab === 'bots' && (
          <>
            <section className="relative border-2 border-[var(--accent)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--accent)] text-white text-xs font-bold uppercase tracking-wider">
                {'// CONTRACTS_NOT_COMPANIES'}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Bot className="w-6 h-6 text-[var(--accent)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Trustless Launch Bots</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                The SOL launch bots, reborn as <strong>ownerless contracts</strong>. When you add
                a Burn or Pool Feeder bot, the factory deploys a dedicated contract wired to your
                campaign&apos;s fee splitter. It has no owner, no operator, and no off switch:{' '}
                <strong>anyone</strong> can crank it, <strong>nobody</strong> can stop it, and its
                terms can never change. They are <strong>dual-phase</strong>: during the bonding-curve
                phase they trade on the curve itself; after graduation they talk to the Uniswap-v4
                PoolManager directly (no router, proven third-party-allowed on live-pool forks).
              </p>
              <div className="bg-[var(--background)] border border-[var(--accent)]/40 p-4 text-sm leading-relaxed text-[var(--muted)]">
                <strong className="text-[var(--accent)]">Honesty note:</strong> the Holder Airdrop
                bot is the exception — snapshot airdrops need someone to take the snapshot, so it
                runs platform-operated (the same machinery as our Solana launches) and is labeled
                that way everywhere. The trustless holder reward is BURN: supply cuts pay every
                holder pro-rata with no snapshot authority at all.
              </div>
            </section>

            <section className="border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
              <h3 className="font-black uppercase tracking-tight text-lg flex items-center gap-2">
                <Zap className="w-5 h-5 text-[var(--accent-gold)]" /> The 4 legs
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {[
                  { emoji: '🔥', name: 'BURN', tag: 'Deflationary · Trustless', desc: 'Claims its fee share (ETH), market-buys the token on its pons pool, sends everything to the dead address. Per-crank cap keeps sandwich extraction negligible. Totals readable on-chain forever.' },
                  { emoji: '🌊', name: 'POOL FEEDER', tag: 'Liquidity · Trustless', desc: 'Mints full-range liquidity with its fee share and compounds the position\'s own earned trading fees every crank. The contract has NO withdraw function — protocol-owned liquidity locked by construction, not by promise \u2014 the code to withdraw was never written.' },
                  { emoji: '🏦', name: 'VAULT', tag: 'Treasury', desc: 'Any wallet you name (marketing, DAO, treasury) becomes a fee leg and pulls its share anytime. The address is immutable from creation — a public, permanent commitment.' },
                  { emoji: '📸', name: 'HOLDER AIRDROP', tag: 'Loyalty · Platform-run', desc: 'ProofLaunch snapshots your token\'s holders and airdrops the leg\'s fees pro-rata (ETH + tokens), dust-filtered, with the snapshot reconciled against total supply before a single payment goes out. Platform-operated and labeled so.' },
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

            <section className="border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-3">
              <h3 className="font-black uppercase tracking-tight text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[var(--accent)]" /> Stacking + budget
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Bots are carved from the backer share. The fixed legs (today: platform 7% + a retired 3% leg
                that pays nobody; on the flywheel factory: $PLAUNCH burn 30% + platform 10%) never move; you design the rest:
              </p>
              <div className="bg-[var(--background)] border border-[var(--border)] p-4 font-mono text-xs space-y-1">
                <div>BURN ............ 20%</div>
                <div>POOL FEEDER ..... 10%</div>
                <div>VAULT (Marketing) 10%</div>
                <div className="border-t border-[var(--border)] pt-1 mt-1">Total bots ...... 40%</div>
                <div className="text-[var(--accent)]">Backers ......... 50%</div>
                <div className="text-[var(--muted)]">Platform ........ 7% · Retired leg 3% (pays nobody)</div>
              </div>
              <ul className="text-sm text-[var(--muted)] space-y-1 pl-4 pt-2">
                <li>· One BURN + one POOL FEEDER per campaign; up to 3 vault-type legs.</li>
                <li>· The stack is immutable after creation — unlike Solana, not even the creator can edit it. That&apos;s the point.</li>
                <li>· Crank any bot yourself from a block explorer — they&apos;re public functions.</li>
              </ul>
            </section>

            <section className="border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-3">
              <h3 className="font-black uppercase tracking-tight text-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-[var(--success)]" /> Proven on the live pool
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Every bot was proven against the live pons trading pool in fork tests before
                deployment: real launches, real swaps, burn balances verifiably at the dead
                address, LP positions minted and compounding, and the full fee flow
                measured in ETH and tokens — 21/21 tests green. The full suite ships in
                the open-source repo.
              </p>
            </section>
          </>
        )}

        {/* FEES */}
        {activeTab === 'fees' && (
          <>
            <section className="relative border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Receipt className="w-6 h-6 text-[var(--accent)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Platform Fees</h2>
              </div>
              <div className="space-y-3 pt-2">
                {[
                  { label: 'Creation Fee', value: '0.001 ETH', color: 'border-[var(--accent)]', desc: 'A one-time buy-in when creating a campaign, paid on-chain to the platform — spam control, exact-amount enforced by the factory contract. Will be waived for platform-token holders once the token launches (an on-chain balance check, not a policy). pons separately charges 0.0005 ETH at launch time, paid from the pool.' },
                  { label: 'Backing Fee', value: 'None', color: 'border-[var(--success)]', desc: '100% of your ETH goes into the campaign contract.' },
                  { label: 'Withdrawal Fee', value: 'None', color: 'border-[var(--success)]', desc: 'Withdraw your full deposit any time before launch. Refunds after an expired raise are also full-amount.' },
                  { label: 'Creator Tax', value: '0\u201310%', color: 'border-[var(--accent-gold)]', desc: 'The pons V2 trading tax, set at creation and never raisable. On pons it pays the dev; here it pays your campaign\u2019s FeeSplitter \u2014 which means the backers. Every launch buy pays it too, and it round-trips straight back to the pool.' },
                  { label: 'Creator Tax Routing', value: '90 / 7 / 3 today', color: 'border-[var(--accent)]', desc: 'Of every launch\u2019s creator tax: 30% buys and burns $PLAUNCH, 10% platform, the rest to backers pro-rata (minus any bots the creator stacked \u2014 50% on the default preset). Today\u2019s factory, until $PLAUNCH launches: 90 / 7 / 3. Immutable per campaign, enforced by the FeeSplitter contract. Fees arrive as native ETH and the token itself.' },
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

            <section className="relative border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--success)] text-white text-xs font-bold uppercase tracking-wider">
                {'// TRADING_FEES'}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <TrendingUp className="w-6 h-6 text-[var(--success)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">How Fees Flow</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                Every trade on pons pays a <strong>1% protocol fee to pons</strong> plus the token&apos;s
                <strong> creator tax</strong> (0–10%, set at creation). The creator is your
                Campaign&apos;s FeeSplitter, so the creator tax is what gets split below. It accrues
                in ETH at pons&apos; fee escrow until anyone cranks it into the splitter — the
                campaign page&apos;s claim button does that for you as its first signature.
              </p>
              <div className="bg-[var(--background)] border-2 border-[var(--accent-gold)]/50 p-4 mt-4">
                <h3 className="font-bold mb-1 uppercase tracking-wide text-[var(--accent-gold)]">The Flywheel Split — every launch after $PLAUNCH</h3>
                <p className="text-xs text-[var(--muted)] mb-3">Two legs will be fixed in the factory and immutable in every campaign it creates. Backers get the rest. Shown on the Flywheel preset (10% coin burn).</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between p-2 bg-[var(--success)]/10">
                    <span className="text-[var(--success)] font-bold">Backers, weighted by stake and lock (50%)</span>
                    <span className="font-bold">pull anytime · sellers forfeit</span>
                  </div>
                  <div className="flex justify-between p-2 bg-[var(--accent-gold)]/10">
                    <span className="text-[var(--accent-gold)] font-bold">$PLAUNCH buy &amp; burn (30%)</span>
                    <span className="font-bold">anyone cranks</span>
                  </div>
                  <div className="flex justify-between p-2 bg-[var(--accent)]/10">
                    <span className="text-[var(--accent)]">Platform (10%)</span>
                    <span className="font-bold">pull anytime</span>
                  </div>
                  <div className="flex justify-between p-2 bg-[var(--error)]/10">
                    <span className="text-[var(--error)]">The coin&apos;s own burn (creator dial, 10% default)</span>
                    <span className="font-bold">anyone cranks</span>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3 leading-relaxed">
                  Backer Max preset: no coin burn, backers 60%. Burn Heavy: coin burn 30%, backers 30%.
                  Every creation fee and every share a seller forfeits will go to the $PLAUNCH burn on top of the 30%.
                </p>
              </div>
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 mt-4">
                <h3 className="font-bold mb-1 uppercase tracking-wide">Today&apos;s factory (v7) — until $PLAUNCH launches</h3>
                <p className="text-xs text-[var(--muted)] mb-3">Campaigns created before the flywheel factory keep these terms forever; $PLAUNCH itself launches on this one.</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between p-2 bg-[var(--success)]/10">
                    <span className="text-[var(--success)] font-bold">Backers, pro-rata to the raise (90%)</span>
                    <span className="font-bold">pull anytime</span>
                  </div>
                  <div className="flex justify-between p-2 bg-[var(--accent)]/10">
                    <span className="text-[var(--accent)]">Platform (7%)</span>
                    <span className="font-bold">pull anytime</span>
                  </div>
                  <div className="flex justify-between p-2 bg-[var(--muted)]/10">
                    <span className="text-[var(--muted)]">Retired leg (3%) — a plain wallet, pays no holders</span>
                    <span className="font-bold">nothing to claim</span>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3 uppercase tracking-wide leading-relaxed">
                  Everything is pull-based: the splitter only does accounting, so no recipient can
                  grief anyone else&apos;s claim and no operator needs to be alive for you to get
                  paid. distribute() and pokeHarvest() are permissionless cranks — run them
                  yourself from any explorer.
                </p>
              </div>

              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 mt-4 space-y-2">
                <h3 className="font-bold uppercase tracking-wide flex items-center gap-2"><Landmark className="w-4 h-4 text-[var(--accent)]" /> Claim as stock</h3>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  The splitter only ever owes ETH. When you claim, it can route your ETH through the
                  <strong> EquityRouter</strong> into an ETH-paired Uniswap v4 pool — SpaceX, Microsoft,
                  Meta, Snap, Eli Lilly — and the shares land in your wallet straight from the pool.
                  Neither the splitter nor the router ever holds the stock. You set your own slippage
                  bound; if the pool can&apos;t fill, the claim reverts and stays yours. The creator
                  picks the default; the page shows the live share quote before you sign. First
                  mainnet claim: 0.0008 ETH → 0.0139 SPCX, receipts in the repo.
                </p>
              </div>

              <div className="bg-[var(--accent-gold)]/10 border-2 border-[var(--accent-gold)]/30 p-4 mt-4 space-y-2">
                <h3 className="font-bold text-[var(--accent-gold)] uppercase tracking-wide flex items-center gap-2"><Lock className="w-4 h-4" /> Coming with v8: the fee stream follows the tokens</h3>
                <ul className="text-sm text-[var(--muted)] space-y-1 leading-relaxed">
                  <li>· <strong className="text-[var(--foreground)]">The flywheel.</strong> Two fixed legs on every campaign's creator tax, set in the factory and immutable in every splitter: <strong>30% buys and burns $PLAUNCH</strong>, 10% to the platform. Backers get the rest — 50% on the default preset, 60% with no coin burn. Every creation fee and every seller's forfeited share burns $PLAUNCH too. An ownerless burner does the buying: pons curve before graduation, Uniswap v4 after, 0.2 ETH per block, anyone can crank it, nobody can stop it or point it anywhere else.</li>
                  <li>· <strong className="text-[var(--foreground)]">Sell and you stop earning.</strong> A claim pays your share times the fraction of your launch allocation you still hold. Sell half, earn half. Sell all, and that share buys and burns $PLAUNCH.</li>
                  <li>· <strong className="text-[var(--foreground)]">Locking pays.</strong> A seat locked six months earns fees at ×1.25, a year or more at ×1.5, out of the backer pool. Locks are measured from launch and frozen with their weight the moment the token exists.</li>
                  <li>· <strong className="text-[var(--foreground)]">Judged once.</strong> Anyone can call settle() on a wallet that sold, locking its forfeiture in. Buying back right before a claim recovers nothing that accrued while you were out. Fees judged while you held are banked and stay yours.</li>
                  <li>· <strong className="text-[var(--foreground)]">Held means held.</strong> Tokens still in the campaign, unclaimed or locked, count as held.</li>
                  <li>· <strong className="text-[var(--foreground)]">Status:</strong> built, fork-tested against live pons, not yet deployed. The order is fixed: $PLAUNCH launches first on the current factory, then the burner (it needs the token's address), then v8.</li>
                </ul>
              </div>
            </section>
          </>
        )}

        {/* SECURITY */}
        {activeTab === 'security' && (
          <>
            <section className="relative border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
              <div className="absolute -top-3 left-4 px-4 py-1 bg-[var(--success)] text-white text-xs font-bold uppercase tracking-wider">
                {'// TRUSTLESS'}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Shield className="w-6 h-6 text-[var(--success)]" />
                <h2 className="text-2xl font-black uppercase tracking-tight">Security Model</h2>
              </div>
              <p className="text-[var(--foreground)]/80 leading-relaxed">
                On Solana, ProofLaunch earns trust operationally. On Robinhood Chain, the contracts remove the need:
              </p>
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 space-y-3">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide">
                  <Key className="w-5 h-5 text-[var(--warning)]" />
                  What does not exist
                </h3>
                <ul className="text-sm text-[var(--muted)] space-y-1">
                  <li>· No owner or admin role on any contract — the deployer was a throwaway with zero post-deploy authority</li>
                  <li>· No pause switch, no upgrade path, no fee-change function</li>
                  <li>· No custodial wallets — the platform never holds user funds at any point in the flow</li>
                  <li>· No withdraw function on the Pool Feeder&apos;s liquidity — locked by construction</li>
                </ul>
              </div>
              <div className="bg-[var(--background)] border-2 border-[var(--border)] p-4 space-y-3">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide">
                  <Coins className="w-5 h-5 text-[var(--accent)]" />
                  Contract addresses
                </h3>
                <div className="space-y-2 text-xs font-mono">
                  <AddrRow name="CampaignFactory v7 (ACTIVE — team rounds, token gating, stock-quoted raises, claim-as-stock)" addr={POOLLAUNCH_FACTORY_V7} />
                  <AddrRow name="EquityRouter (claim-as-stock; no allowlist, no owner)" addr={EQUITY_ROUTER} />
                  <AddrRow name="LegDeployerV3 (v7 bot-leg code — EIP-170 satellite)" addr={LEG_DEPLOYER_V3} />
                  <AddrRow name="CampaignFactory v6 (superseded — creation buy-in, trustless v4 bots, creator tax)" addr={POOLLAUNCH_FACTORY_V6} />
                  <AddrRow name="CampaignFactory v5 (pons V2 + trustless Uniswap-v4 bot legs)" addr={POOLLAUNCH_FACTORY_V5} />
                  <AddrRow name="CampaignFactory v4 (pons V2, creator tax — no bot legs)" addr={POOLLAUNCH_FACTORY_V4} />
                  <AddrRow name="CampaignFactory v3 (pons V1 — original bot stack)" addr={POOLLAUNCH_FACTORY} />
                  <AddrRow name="LegDeployerV2 (v4 bot-leg code — EIP-170 satellite)" addr={LEG_DEPLOYER_V2} />
                  <AddrRow name="LegDeployer (v3 bot-leg code)" addr={LEG_DEPLOYER} />
                  <AddrRow name="pons factory (launch target)" addr={PONS_FACTORY} />
                  <AddrRow name="Airdrop operator (📸 legs)" addr={AIRDROP_OPERATOR} />
                </div>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Every campaign pins its own immutable copies of these at creation — factory
                  upgrades never touch existing campaigns. Full list with live balances on the{' '}
                  <Link href="/rhc/audit" className="text-[var(--accent)] hover:underline">Audit page</Link>.
                  Contracts are open source in the{' '}
                  <a href="https://github.com/Based-LTD/prooflaunch" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">repo</a>.
                </p>
              </div>
              <div className="bg-[var(--background)] border-2 border-[var(--warning)]/40 p-4 space-y-2">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide text-[var(--accent)]">
                  <Shield className="w-5 h-5" />
                  For reviewers
                </h3>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  Everything a security review needs is in the public repo, written for that reader:
                </p>
                <ul className="text-sm space-y-1">
                  {[
                    ['Review scope', 'docs/rhc-review-scope.md', 'live v7 addresses, trust surface (pons), focus areas in priority order, the built-not-deployed v8, known accepted risks, and the questions we want answered'],
                    ['Our own findings', 'docs/rhc-review-findings.md', 'the adversarial self-review — one test per finding in test/Review.t.sol'],
                    ['Receipts', 'docs/rhc-receipts.md', 'a mainnet transaction hash for every claim made here'],
                    ['Contracts + tests', 'contracts/rhc', 'Foundry; forge test --threads 1; every live contract is an exact source match on Sourcify'],
                  ].map(([name, path, desc]) => (
                    <li key={path} className="flex flex-col sm:flex-row sm:items-baseline gap-x-2">
                      <a href={`https://github.com/Based-LTD/prooflaunch/blob/main/${path}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline font-bold shrink-0">{name} ↗</a>
                      <span className="text-[var(--muted)]">{desc}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Findings: open an issue on the repo or DM. There is no bounty program yet; there is no admin key
                  to hand anyone either.
                </p>

                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide text-[var(--warning)]">
                  <AlertTriangle className="w-5 h-5" />
                  Beta status
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Every live contract is source-verified (exact bytecode match on Sourcify, imported by
                  the explorer), so what you read on-chain is what runs. The contracts pass 115 tests
                  across 18 suites, including live-pool fork verification of every money path and a
                  self-review with one test per finding, but have not yet completed external review. Until then the UI caps
                  raise goals at 2 ETH. Oversized raises are proven safe (they graduate at
                  launch); we&apos;re walking before running.
                </p>
              </div>
              <div className="bg-[var(--background)] border-2 border-[var(--accent-gold)]/40 p-4 space-y-2">
                <h3 className="font-bold flex items-center gap-2 uppercase tracking-wide text-[var(--accent-gold)]">
                  <AlertTriangle className="w-5 h-5" />
                  Participation Disclaimer
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  ProofLaunch on Robinhood Chain is an experimental protocol. Nothing on this site is investment
                  advice, a securities offering, or a solicitation. Tokens launched here are
                  highly speculative; most go to zero. Read the{' '}
                  <Link href="/legal" className="text-[var(--accent)] hover:underline font-bold">
                    full participation disclaimer →
                  </Link>
                </p>
              </div>
            </section>
          </>
        )}

        {/* FAQ */}
        {activeTab === 'faq' && (
          <section className="relative border-2 border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <HelpCircle className="w-6 h-6 text-[var(--accent)]" />
              <h2 className="text-2xl font-black uppercase tracking-tight">Frequently Asked Questions</h2>
            </div>
            <div className="space-y-3">
              {[
                { q: 'What happens if the goal isn\'t met?', a: 'After the deadline plus a 3-day grace window, refunds open unconditionally — a contract guarantee, not a policy. Withdraw your full deposit from the campaign page.' },
                { q: 'What if the raise overshoots the goal?', a: 'Nothing breaks. Oversized raises are proven safe: the pooled buy simply pushes the token straight through pons graduation at birth, and backers own proportionally more of the supply. Nothing gets stranded.' },
                { q: 'Why do I claim tokens instead of receiving them automatically?', a: 'Pull-based claims are the trustless EVM pattern: nobody can grief the distribution, nothing can expire, and your entitlement is contract state — it waits for you forever. Gas costs a fraction of a cent.' },
                { q: 'Can the creator or platform change the fee split later?', a: 'No. The FeeSplitter has no owner and no setter functions. The split you see at creation is the split forever. Bots included — even the creator can\'t edit the stack after deployment.' },
                { q: 'What wallet do I use?', a: 'Phantom works — it has an EVM side. MetaMask and Rabby too. The connect button adds and switches to Robinhood Chain automatically.' },
                { q: 'How do I get ETH on Robinhood Chain?', a: 'Bridge through the official Robinhood Chain bridge, or transfer from Robinhood. Gas is ~0.1 gwei, so a little goes a very long way.' },
                { q: 'What happens if pons rotates its factory?', a: 'Existing campaigns are unaffected — each pins the pons factory address it was created with. New campaigns launch through whatever factory the UI currently targets; a health sensor watches for rotations.' },
                { q: 'Can I get my fees paid in stock?', a: 'Yes. If the creator set a payout asset, the claim button shows your share quoted in that stock and swaps your ETH into it in the same transaction, straight from the Uniswap v4 pool to your wallet. You can always take ETH instead. The contract never holds shares.' },
                { q: 'What does the lock do?', a: 'A lock is a date you choose when you take a seat. Your tokens stay in the campaign contract until then and the claim function refuses to release them earlier. It is visible on the roster before launch, can only be extended, and nobody — including us — can shorten it. Locked tokens still earn your full fee share. Ships with the v8 contracts.' },
                { q: 'Do backers who sell keep earning fees?', a: 'On the current contracts, yes — the split is fixed at launch. On v8 (built and tested, not yet deployed) the fee stream follows the tokens: sell half, earn half; sell all and your share buys and burns $PLAUNCH. The roster already shows every backer\u2019s live hold so you can see who sold.' },
                { q: 'What does $PLAUNCH do?', a: 'Nothing is paid to holders. Supply will shrink: 30% of every campaign\u2019s creator tax, every creation fee and every seller\u2019s forfeited share will buy $PLAUNCH and send it to the dead address, through an ownerless contract anyone can crank. Holding $PLAUNCH will also waive the creation fee once that hook is armed. None of this is live yet: the burner deploys after $PLAUNCH launches, and every counter reads zero until then.' },
                { q: 'Is the roster self-reported?', a: 'No. The wallet list comes from the campaign contract\u2019s deposit events and every number — stake, hold, fees claimed, fees pending — is a live read from the contract. The chat is the only thing on the page that lives off-chain, and every message is wallet-signed.' },
                { q: 'Is this the same platform as the Solana site?', a: 'Same team, same pooled-launch model, different chain and a different token. Solana promises are kept operationally and its token is $PROOF; Robinhood Chain promises are kept by ownerless contracts and its token is $PLAUNCH. The two never share a fee stream. The Solana site is at sol.prooflaunch.fun.' },
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
            href="/rhc"
            className="px-6 py-3 bg-[var(--accent)] text-white font-black uppercase tracking-wide hover:opacity-90 transition-opacity border-2 border-[var(--accent)]"
          >
            Browse Campaigns
          </Link>
          <Link
            href="/rhc/create"
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

function AddrRow({ name, addr }: { name: string; addr: string }) {
  return (
    <a
      href={explorerUrl(addr)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-2 px-3 py-2 border border-[var(--border)] hover:border-[var(--accent)] bg-[var(--card)] transition-colors"
    >
      <span className="text-[var(--foreground)] truncate">{name}</span>
      <span className="flex items-center gap-1 text-[var(--accent)] shrink-0">
        {addr.slice(0, 8)}…{addr.slice(-6)} <ExternalLink className="w-3 h-3" />
      </span>
    </a>
  );
}
