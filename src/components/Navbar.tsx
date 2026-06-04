'use client';

import { FC, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { PlatformWalletsModal } from './PlatformWalletsModal';

// Dynamically import wallet button to avoid SSR hydration mismatch
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

// Navbar links — matches prod layout plus Roadmap. Logo still handles
// "/" but Proving stays in the nav for discoverability (users who
// scrolled away from the hero can jump back). Submit also kept in nav
// since the hero CTA isn't visible on every page.
const navLinks = [
  { href: '/', label: 'Proving' },
  { href: '/submit', label: 'Submit' },
  { href: '/launched', label: 'Launched' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/docs', label: 'Docs' },
  { href: '/roadmap', label: 'Roadmap' },
];

export const Navbar: FC = () => {
  const pathname = usePathname();
  const isDemo = pathname?.startsWith('/demo');
  const [walletsOpen, setWalletsOpen] = useState(false);
  // Demo routes still need the translucent + blurred bar since they
  // bring their own backgrounds. All other routes (flat shell now,
  // post-video-removal) get the solid bar.
  const barBg = isDemo
    ? 'bg-[rgba(10,10,10,0.45)] backdrop-blur-md border-white/10'
    : 'bg-[var(--background)] border-[var(--border)]';

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 border-b ${barBg}`}>
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
            {/* Platform Wallets — opens a modal instead of navigating */}
            <button
              type="button"
              onClick={() => setWalletsOpen(true)}
              aria-haspopup="dialog"
              className="px-4 py-2 text-xs font-mono uppercase tracking-widest transition-colors border-l border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Wallets
            </button>
          </div>

          {/* X + Dexscreener + GitHub + Wallet */}
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
            <a
              href="https://dexscreener.com/solana/oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              aria-label="View $PROOF on Dexscreener"
            >
              <svg className="w-4 h-4" viewBox="0 0 252 300" fill="currentColor" fillRule="evenodd">
                <path d="M151.818 106.866c9.177-4.576 20.854-11.312 32.545-20.541 2.465 5.119 2.735 9.586 1.465 13.193-.9 2.542-2.596 4.753-4.826 6.512-2.415 1.901-5.431 3.285-8.765 4.033-6.326 1.425-13.712.593-20.419-3.197m1.591 46.886l12.148 7.017c-24.804 13.902-31.547 39.716-39.557 64.859-8.009-25.143-14.753-50.957-39.556-64.859l12.148-7.017a5.95 5.95 0 003.84-5.845c-1.113-23.547 5.245-33.96 13.821-40.498 3.076-2.342 6.434-3.518 9.747-3.518s6.671 1.176 9.748 3.518c8.576 6.538 14.934 16.951 13.821 40.498a5.95 5.95 0 003.84 5.845zM126 0c14.042.377 28.119 3.103 40.336 8.406 8.46 3.677 16.354 8.534 23.502 14.342 3.228 2.622 5.886 5.155 8.814 8.071 7.897.273 19.438-8.5 24.796-16.709-9.221 30.23-51.299 65.929-80.43 79.589-.012-.005-.02-.012-.029-.018-5.228-3.992-11.108-5.988-16.989-5.988s-11.76 1.996-16.988 5.988c-.009.005-.017.014-.029.018-29.132-13.66-71.209-49.359-80.43-79.589 5.357 8.209 16.898 16.982 24.795 16.709 2.929-2.915 5.587-5.449 8.814-8.071C69.31 16.94 77.204 12.083 85.664 8.406 97.882 3.103 111.959.377 126 0m-25.818 106.866c-9.176-4.576-20.854-11.312-32.544-20.541-2.465 5.119-2.735 9.586-1.466 13.193.901 2.542 2.597 4.753 4.826 6.512 2.416 1.901 5.432 3.285 8.766 4.033 6.326 1.425 13.711.593 20.418-3.197" />
                <path d="M197.167 75.016c6.436-6.495 12.107-13.684 16.667-20.099l2.316 4.359c7.456 14.917 11.33 29.774 11.33 46.494l-.016 26.532.14 13.754c.54 33.766 7.846 67.929 24.396 99.193l-34.627-27.922-24.501 39.759-25.74-24.231L126 299.604l-41.132-66.748-25.739 24.231-24.501-39.759L0 245.25c16.55-31.264 23.856-65.427 24.397-99.193l.14-13.754-.016-26.532c0-16.721 3.873-31.578 11.331-46.494l2.315-4.359c4.56 6.415 10.23 13.603 16.667 20.099l-2.01 4.175c-3.905 8.109-5.198 17.176-2.156 25.799 1.961 5.554 5.54 10.317 10.154 13.953 4.48 3.531 9.782 5.911 15.333 7.161 3.616.814 7.3 1.149 10.96 1.035-.854 4.841-1.227 9.862-1.251 14.978L53.2 160.984l25.206 14.129a41.926 41.926 0 015.734 3.869c20.781 18.658 33.275 73.855 41.861 100.816 8.587-26.961 21.08-82.158 41.862-100.816a41.865 41.865 0 015.734-3.869l25.206-14.129-32.665-18.866c-.024-5.116-.397-10.137-1.251-14.978 3.66.114 7.344-.221 10.96-1.035 5.551-1.25 10.854-3.63 15.333-7.161 4.613-3.636 8.193-8.399 10.153-13.953 3.043-8.623 1.749-17.689-2.155-25.799l-2.01-4.175z" />
              </svg>
            </a>
            <a
              href="https://github.com/Based-LTD/prooflaunch"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              aria-label="View source on GitHub"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
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
          <button
            type="button"
            onClick={() => setWalletsOpen(true)}
            aria-haspopup="dialog"
            className="flex-1 text-center py-2 text-[10px] font-mono uppercase tracking-widest border-l border-[var(--border)] text-[var(--muted)]"
          >
            Wallets
          </button>
        </div>
      </div>

      <PlatformWalletsModal open={walletsOpen} onClose={() => setWalletsOpen(false)} />
    </nav>
  );
};
