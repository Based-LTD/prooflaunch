import Link from 'next/link';

// Interim legal / participation disclaimer. Not legal advice; will be
// replaced/reviewed with counsel. Goal: position Proof Launch as an
// experimental, community-driven, permissionless protocol — not a
// centrally-managed yield product. Footer linked from every public page.

export const metadata = {
  title: 'Disclaimer · Proof Launch',
  description: 'Participation disclaimer for Proof Launch — an experimental, community-driven protocol on Solana.',
};

export default function LegalPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-6 font-sans">
      <header className="border-b border-[var(--border)] pb-4 mb-6">
        <Link href="/" className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:underline">
          ← back to proof launch
        </Link>
        <h1 className="mt-3 text-2xl sm:text-3xl font-mono font-semibold uppercase tracking-tight">
          Participation Disclaimer
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)] font-mono">
          Last updated: 2026-06-06 · Interim disclaimer pending review with counsel.
        </p>
      </header>

      <Section title="Experimental, Community-Driven Protocol">
        <p>
          Proof Launch is a permissionless, experimental protocol for community-driven
          token launches on Solana. The protocol does not offer investment products,
          securities, or financial advice of any kind. Nothing on this site, in this
          interface, or in our documentation constitutes a solicitation to purchase,
          sell, or hold any token, asset, or financial instrument.
        </p>
        <p>
          The protocol is operated as open, auditable smart contract logic. Token
          launches are initiated by community members, funded by community backers,
          and traded through external, decentralized markets such as Pump.fun,
          Meteora, and Jupiter. Proof Launch does not actively manage capital on
          your behalf and does not exercise discretion over individual launches.
        </p>
      </Section>

      <Section title="No Expectation of Profit">
        <p>
          References on this site to &quot;rebates,&quot; &quot;distributions,&quot; &quot;routing,&quot;
          &quot;airdrops,&quot; or similar terms describe automated, protocol-level transfers
          executed by transparent on-chain logic. They are <strong>not</strong>:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>guaranteed financial returns;</li>
          <li>promises of profit, yield, dividends, or interest;</li>
          <li>securities-like instruments;</li>
          <li>investment contracts.</li>
        </ul>
        <p>
          Distributions to $PROOF holders are discretionary. The protocol&apos;s
          distribution programs may change, pause, or end at any time without
          notice. $PROOF is intended as a utility and access token; it is not
          marketed, sold, or held out as a security or investment instrument.
          Trading-fee rebates available to certain participants are automated
          rewards for protocol participation, not investment returns.
        </p>
        <p>
          You should have <strong>no expectation of profit</strong> from holding $PROOF,
          backing a launch, deploying a programmable bot, or otherwise participating
          in the protocol. Token prices and on-chain activity are highly volatile
          and unpredictable, and total loss of all participating funds is possible
          and not unusual in this space.
        </p>
      </Section>

      <Section title="Risks of Participation">
        <p>By using this protocol, you acknowledge and accept that:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>All cryptocurrency activity carries substantial risk, including total loss of funds.</li>
          <li>The protocol is experimental software. Smart contracts may contain bugs, vulnerabilities, or unintended behavior.</li>
          <li>Token prices, market liquidity, and on-chain behavior are highly volatile and beyond the protocol&apos;s control.</li>
          <li>External markets (Pump.fun, Meteora, Jupiter, etc.) operate under their own terms; Proof Launch is not responsible for their behavior.</li>
          <li>Past performance of any launch, token, or distribution program does not predict future results.</li>
          <li>You are solely responsible for the security of your wallet, private keys, and signed messages.</li>
        </ul>
      </Section>

      <Section title="Your Responsibility for Legal Compliance">
        <p>
          It is your sole responsibility to determine whether use of this protocol
          is permitted under the laws of your jurisdiction, and to comply with all
          applicable laws, including but not limited to securities, tax, anti-money-
          laundering, and sanctions regulations.
        </p>
        <p>
          You may not use this protocol if you are a resident of, located in, or
          otherwise subject to the jurisdiction of any country, territory, or region
          subject to comprehensive sanctions administered by the U.S. Department of
          Treasury&apos;s Office of Foreign Assets Control (OFAC), the United Nations
          Security Council, the European Union, or other applicable authority,
          including (without limitation) Cuba, Iran, North Korea, Syria, and the
          Crimea, Donetsk, Luhansk, and Sevastopol regions of Ukraine.
        </p>
      </Section>

      <Section title="No Legal, Financial, or Tax Advice">
        <p>
          Nothing on this site, in our documentation, or in any communication from
          the protocol or its contributors constitutes legal, financial, tax,
          accounting, or investment advice. You should consult qualified, licensed
          professionals in your jurisdiction before making any decision related to
          your participation in the protocol or in any associated token.
        </p>
      </Section>

      <Section title="No Central Management of Funds">
        <p>
          Capital committed by backers is held in per-launch pool wallets, governed
          by the protocol&apos;s smart contract logic, and disbursed automatically
          according to that logic. Proof Launch contributors do not exercise
          discretionary control over individual launches, individual user balances,
          or individual distribution events. Where the protocol holds operational
          wallets (e.g., for fee collection or distribution program administration),
          those wallets and their balances are publicly viewable on-chain.
        </p>
      </Section>

      <Section title="Forward-Looking Statements">
        <p>
          Documentation, roadmaps, blog posts, and public communications may
          contain forward-looking statements about future protocol features or
          milestones. These statements are aspirational and not commitments. The
          protocol may modify, delay, or cancel any planned feature at any time.
        </p>
      </Section>

      <Section title="Updates to This Disclaimer">
        <p>
          This disclaimer may be updated at any time. Continued use of the
          protocol following an update constitutes acceptance of the current terms.
          The current version is always available at <Link href="/legal" className="text-[var(--accent)] hover:underline">prooflaunch.fun/legal</Link>.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For non-legal correspondence about the protocol, reach the team via{' '}
          <a
            href="https://x.com/ProofLaunch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            @ProofLaunch on X
          </a>.
        </p>
      </Section>

      <footer className="border-t border-[var(--border)] pt-6 mt-10 text-xs text-[var(--muted)] font-mono">
        <p>
          This disclaimer is interim and provided for informational purposes only.
          It is not a legal opinion and does not establish an attorney-client
          relationship. The protocol is in active review with legal counsel and
          this language may change.
        </p>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base sm:text-lg font-mono font-semibold uppercase tracking-tight text-[var(--accent)] border-l-2 border-[var(--accent)] pl-3">
        {title}
      </h2>
      <div className="space-y-3 text-sm sm:text-base leading-relaxed text-[var(--foreground)]/90">
        {children}
      </div>
    </section>
  );
}
