'use client';

import { FC } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamically import wallet button to avoid SSR hydration mismatch
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

const navLinks = [
  { href: '/', label: 'Proving' },
  { href: '/submit', label: 'Submit' },
  { href: '/launched', label: 'Launched' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/docs', label: 'Docs' },
];

export const Navbar: FC = () => {
  const pathname = usePathname();

  return (
    <>
      {/* Status bar — sits above the nav, always visible */}
      <div className="fixed top-0 left-0 right-0 z-[60] h-6 border-b border-[var(--border)] bg-[var(--background)] flex items-center justify-between px-4 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-[var(--status-up)] inline-block pulse-glow" />
            <span>MAINNET · LIVE</span>
          </span>
          <span className="hidden sm:inline opacity-50">v0.2.0</span>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <span>SOL/USD —</span>
          <span>SLOTS OPEN —</span>
          <span className="text-[var(--accent)]">PROOF.LAUNCH</span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="fixed top-6 left-0 right-0 z-50 border-b border-[var(--border)] bg-[var(--background)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo wordmark */}
            <Link href="/" className="flex items-center gap-3 group">
              <span className="text-[var(--accent)] text-xl leading-none">▮</span>
              <span className="font-mono text-base font-semibold tracking-wider uppercase">
                Proof<span className="text-[var(--accent)]">/</span>Launch
              </span>
            </Link>

            {/* Nav links */}
            <div className="hidden md:flex items-center">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-4 py-2 text-xs font-mono uppercase tracking-widest transition-colors border-l border-[var(--border)] ${
                      isActive
                        ? 'text-[var(--accent)]'
                        : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {isActive && '> '}
                    {link.label}
                  </Link>
                );
              })}
            </div>

            {/* X + Wallet */}
            <div className="flex items-center gap-3">
              <a
                href="https://x.com/ProofLaunch"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                aria-label="Follow on X"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <WalletMultiButton />
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="md:hidden border-t border-[var(--border)]">
          <div className="flex">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex-1 text-center py-2 text-[10px] font-mono uppercase tracking-widest border-l border-[var(--border)] first:border-l-0 ${
                    isActive ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
};
