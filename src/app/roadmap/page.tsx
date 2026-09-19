'use client';

// The platform roadmap — PoolLaunch on Robinhood Chain. The Solana
// platform is live and maintained, but new development happens here:
// the trustless contracts made it the better product, so it gets the
// roadmap. (The old SOL roadmap was retired 2026-09-15 by founder call.)
import Link from 'next/link';
import {
  ArrowLeft, Compass, CheckCircle, Hammer, Users, Rocket, Coins, Bot,
  Shield, TrendingUp, DollarSign, Layers, Search, LucideIcon,
} from 'lucide-react';

const SHIPPED = [
  { icon: Rocket, title: 'Trustless pooled launches on pons', desc: 'The Campaign contract IS the token\'s creator. Backers pool ETH; one transaction creates the token and buys with the entire pool — snipe-exempt, on the launch block, identical price for everyone. No admin keys, no pause switch, no upgrade path: the platform cannot touch backer funds, by construction.' },
  { icon: Users, title: 'Two raise styles — Open Raise & Seat Round', desc: '⚡ Open Raise: ETH goal, unlimited backers (pull-based claims make the count truly unbounded), optional whale cap. 🎟 Seat Round: N identical seats at a fixed price — equal entry enforced by contract, and the last seat filling IS the launch trigger.' },
  { icon: Coins, title: '90% of creator fees → backers, forever', desc: 'The immutable FeeSplitter routes the creator fee stream 90% to backers pro-rata, 7% platform, 3% holder rewards. Pull-based: your share waits in the contract with your name on it; no operator has to be alive for anyone to get paid.' },
  { icon: Coins, title: 'Adjustable creator tax — earned by your backers', desc: 'The pons V2 tax dial (0–10% of every trade, locked at launch, can never be raised) — pointed at your campaign\'s FeeSplitter instead of one wallet. Community takeover as a cash flow, not a vibe.' },
  { icon: Bot, title: 'Trustless launch bots on Uniswap v4 — first on this chain', desc: '🔥 BURN buys the token (on the bonding curve pre-graduation, directly against the v4 PoolManager after) and sends it to the dead address. 🌊 POOL FEEDER mints full-range liquidity and compounds its own fees — the contract has NO withdraw function. Anyone can crank them; nobody, including us, can stop them.' },
  { icon: Bot, title: 'Vault legs + holder airdrops', desc: '🏦 Any wallet the creator names becomes an immutable fee leg (marketing, DAO, treasury). 📸 Opt-in holder snapshot airdrops run by the platform — the same machinery as our Solana launches, honestly labeled as the one non-trustless bot.' },
  { icon: Shield, title: 'Refunds as code', desc: 'Goal unmet by the deadline (+3-day grace) → refunds open unconditionally. Withdraw your full deposit any time before launch. Oversized raises that cross pons graduation get the excess refunded by the curve and claimable pro-rata. No support tickets anywhere in the flow.' },
];

const BUILDING = [
  { icon: Search, title: 'WalletProof — who is really buying', desc: 'Every trade on the chain\'s launchpad, replayed on-chain: independent buyers vs crew volume vs one-shot wallets vs launch bots, plus each deployer\'s full history. Counts only, no wallet doxxing. The engine runs today; the public reveal ships as part of the launch sequence.' },
  { icon: Shield, title: 'Signature addresses — 0x…5EED', desc: 'Every campaign (and eventually every token) deployed to an address ending in 5EED — "seed," because every launch here is seeded by its community. CREATE2 salt-grinding, done invisibly at submit. On Solana it was "…pooL"; here, if the address doesn\'t end in 5EED, it didn\'t come from us.' },
  { icon: Shield, title: 'External contract review → lift the beta cap', desc: 'The contracts passed 26/26 tests including live-pool fork verification of every money path. An independent review is the gate for removing the 2 ETH beta goal cap and opening full-size raises.' },
  { icon: Rocket, title: 'Platform token, launched through our own contracts', desc: 'Same factory, same terms every creator gets — eat your own cooking or don\'t cook. The 3% holder-rewards leg already accrues from every campaign as the flywheel feed.' },
  { icon: DollarSign, title: 'Stable-denominated raises (USDG)', desc: 'pons V2 already approves Global Dollar as a pair token. A vNext factory lets backers pool USDG instead of ETH — stable-quoted curves, stable-denominated fee streams, same trustless spine.' },
  { icon: Users, title: 'Team rounds — reserved seats, contract-enforced', desc: 'The SOL reserved-slots model, upgraded to trustless: creators name allowlisted wallets at creation, reserve N of the seats for them, and the CONTRACT enforces who can take a reserved seat — no server checking a list. Public always sees the raise and keeps its guaranteed open seats; fully-reserved rounds get the TEAM ROUND label. Ships in the next factory generation alongside the 0x…5EED signatures and the holder fee waiver.' },
  { icon: Layers, title: 'Campaign indexer', desc: 'The board currently reads every factory generation straight from the chain — perfect for trust, fine at beta scale. An event indexer keeps it instant as campaign count grows, without ever becoming the source of truth.' },
];

const EXPLORING = [
  { icon: TrendingUp, title: 'Raises denominated in tokenized stocks', desc: 'Robinhood Chain\'s signature asset is tokenized equities — and pons has already approved stock tokens (e.g. SPCX) as pair assets. A community raise pooled in tokenized SpaceX stock, with the fee stream paying out in it, is plumbing on top of what already exists — not a new promise. We\'d never issue or peg anything ourselves; Robinhood issues, pons pairs, we pool.' },
  { icon: Rocket, title: 'Auto-launch-at-goal', desc: 'An opt-in flag for creators who want zero discretion as a selling point: the moment the goal is met, anyone\'s crank fires the launch — "code launches it, not me."' },
  { icon: Coins, title: 'Hard raise caps for open raises', desc: 'A creator-set ceiling ("close the doors at 3 ETH") for scarcity plays on open raises — the seat round already covers the strict version.' },
  { icon: Search, title: 'WalletProof verdicts everywhere', desc: 'Surface the REAL / MANUFACTURED verdict on every launched token across the site, and open the engine\'s API so other frontends can stop their users from becoming exit liquidity.' },
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
        href="/rhc"
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
          What&apos;s live, what&apos;s being built, and what&apos;s being weighed — for ProofLaunch on Robinhood Chain
          on Robinhood Chain, where all new development happens. No dates: this is a direction,
          not a contract. Reality changes the order more often than calendars do.
        </p>
        <div className="border-l-4 border-[var(--accent-gold)] bg-[var(--background)] p-4">
          <h2 className="font-bold text-[var(--accent-gold)] mb-2 uppercase tracking-wide">
            How we choose what to build
          </h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            We build what only trustless pooled launches make possible — features that are
            contract state, not policy. If a promise can&apos;t be enforced by code nobody can
            edit, we either find the version that can or we don&apos;t ship it. No trading-terminal
            features, no casino alerts, nothing that contradicts the brand: creator holds 0%,
            same price for everyone, commitments are immutable.
          </p>
        </div>
        <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
          &gt; The Solana platform is live, maintained, and running every launch it always has —
          it&apos;s the proving ground this product graduated from. New capability ships here first.
        </p>
      </div>

      {/* SHIPPED */}
      <section className="border-2 border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-6 h-6 text-[var(--success)]" />
          <h2 className="text-2xl font-black uppercase tracking-tight text-[var(--success)]">
            Shipped
          </h2>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] ml-auto">
            {'// LIVE_TODAY'}
          </span>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Everything below is live on Robinhood Chain mainnet, verifiable on-chain — contracts
          are open source and ownerless.
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
            {'// COMMITTED'}
          </span>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Committed work. Order may shift based on what real launches reveal, but each item
          below is something we&apos;ve decided to build.
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
            {'// EVALUATING'}
          </span>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Ideas under consideration. We&apos;ll either commit them, refine them into something
          more on-brand, or set them aside. Not promises — possibilities.
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
          Got an idea that would make ProofLaunch better? Drop it in the Telegram or tag us on X.
          We read every suggestion. Not every one becomes a feature — but every one shapes how we think.
        </p>
        <p className="text-xs font-mono uppercase tracking-widest text-[var(--muted)]">
          &gt; The community has shipped more roadmap items here than any single product manager could.
        </p>
      </section>
    </div>
  );
}
