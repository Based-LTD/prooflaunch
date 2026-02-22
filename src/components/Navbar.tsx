'use client';

import { FC } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Star, Plus, BarChart3, Coins, BookOpen } from 'lucide-react';

// Dynamically import wallet button to avoid SSR hydration mismatch
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

export const Navbar: FC = () => {
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'The Revolution', icon: Star },
    { href: '/submit', label: 'Submit Meme', icon: Plus },
    { href: '/launched', label: 'Launched', icon: BarChart3 },
    { href: '/portfolio', label: 'Portfolio', icon: Coins },
    { href: '/docs', label: 'Manifesto', icon: BookOpen },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center group -ml-16">
            <div className="w-40 h-40 -my-12 -mr-8 relative">
              <Image
                src="/images/new favcoin.png"
                alt="Commie Launch"
                fill
                className="object-contain"
              />
            </div>
            <span className="text-xl font-bold gradient-text uppercase tracking-wider">
              Commie Launch
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                      : 'text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card)]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* X + Wallet Button */}
          <div className="flex items-center gap-3">
            <a
              href="https://x.com/CommieLaunch"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              aria-label="Follow on X"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <WalletMultiButton />
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-[var(--border)]">
        <div className="flex justify-around py-2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center gap-1 px-3 py-1 text-xs ${
                  isActive
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--muted)]'
                }`}
              >
                <Icon className="w-5 h-5" />
                {link.label.split(' ')[0]}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
