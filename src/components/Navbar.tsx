'use client';

import { FC, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { PlatformWalletsModal } from './PlatformWalletsModal';

// Dynamically import wallet button to avoid SSR hydration mismatch
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);
// RHC twin — same slot, same chrome, EVM wallet (self-provides wagmi).
const RhcNavConnect = dynamic(() => import('@/app/rhc/RhcNavConnect'), { ssr: false });

// ── nav model ────────────────────────────────────────────────────────
// Nine flat items outgrew the bar: desktop crowded the logo and mobile
// squeezed nine flex-1 cells into unreadable 10px stubs. So the two
// things people actually come to do stay top-level, and the rest group
// into dropdowns. Both chains keep the same shape — same labels, same
// order, different targets.
interface NavItem {
  href?: string;
  label: string;
  /// Opens the platform-wallets modal instead of navigating (SOL only).
  action?: 'wallets';
}
interface NavGroup {
  label: string;
  items: NavItem[];
}
type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => 'items' in e;

const solNav: NavEntry[] = [
  { href: '/', label: 'Proving' },
  { href: '/submit', label: 'Submit' },
  { label: 'Explore', items: [
    { href: '/launched', label: 'Launched' },
    { href: '/portfolio', label: 'Portfolio' },
  ]},
  { label: 'More', items: [
    { href: '/docs', label: 'Docs' },
    { href: '/roadmap', label: 'Roadmap' },
    { href: '/proof', label: 'Audit' },
    { label: 'Wallets', action: 'wallets' },
  ]},
];

// The RHC world gets its own nav — two clearly-scoped worlds, one brand.
// Naming stays descriptive ("RHC"), never "Robinhood" alone (trademark
// care, docs/rhc-poollaunch-spec.md §6).
const rhcNav: NavEntry[] = [
  { href: '/rhc', label: 'Proving' },
  { href: '/rhc/create', label: 'Submit' },
  { label: 'Explore', items: [
    { href: '/rhc/launched', label: 'Launched' },
    { href: '/rhc/portfolio', label: 'Portfolio' },
    { href: '/rhc/check', label: 'Check' },
  ]},
  { label: 'More', items: [
    { href: '/rhc/docs', label: 'Docs' },
    { href: '/roadmap', label: 'Roadmap' },
    // RHC's audit page IS the wallets page — the old nav listed both and
    // sent them to the same URL.
    { href: '/rhc/audit', label: 'Audit & Wallets' },
  ]},
];

// Persistent chain switcher: one click between worlds, remembered so the
// landing gate on "/" stops asking once you've chosen.
const ChainToggle: FC<{ isRhc: boolean; className?: string }> = ({ isRhc, className = '' }) => (
  <div className={`flex items-center border border-[var(--border)] font-mono text-[10px] uppercase tracking-widest ${className}`}>
    <Link
      href="/"
      onClick={() => { try { localStorage.setItem('pl-chain', 'sol'); } catch {} }}
      className={`px-2.5 py-1 transition-colors ${!isRhc ? 'bg-[var(--accent)] text-black' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
    >
      SOL
    </Link>
    <Link
      href="/rhc"
      onClick={() => { try { localStorage.setItem('pl-chain', 'rhc'); } catch {} }}
      className={`px-2.5 py-1 transition-colors ${isRhc ? 'bg-[var(--accent-gold)] text-black' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
    >
      RHC
    </Link>
  </div>
);

// X · Dexscreener · GitHub. Lives inside the "More" menu and the mobile
// panel footer — not in the bar. Three icons in the header were a third of
// its width for links nobody clicks from a nav.
const SocialLinks: FC<{ className?: string }> = ({ className = '' }) => (
  <div className={className}>
    <a href="https://x.com/ProofLaunch" target="_blank" rel="noopener noreferrer" aria-label="Follow on X"
      className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
    </a>
    <a href="https://dexscreener.com/solana/oaBXM2rCnWFeQc9ufdTSSpASwSrMBPrSmg8xtiepooL" target="_blank" rel="noopener noreferrer" aria-label="View $PROOF on Dexscreener"
      className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 252 300" fill="currentColor" fillRule="evenodd">
                <path d="M151.818 106.866c9.177-4.576 20.854-11.312 32.545-20.541 2.465 5.119 2.735 9.586 1.465 13.193-.9 2.542-2.596 4.753-4.826 6.512-2.415 1.901-5.431 3.285-8.765 4.033-6.326 1.425-13.712.593-20.419-3.197m1.591 46.886l12.148 7.017c-24.804 13.902-31.547 39.716-39.557 64.859-8.009-25.143-14.753-50.957-39.556-64.859l12.148-7.017a5.95 5.95 0 003.84-5.845c-1.113-23.547 5.245-33.96 13.821-40.498 3.076-2.342 6.434-3.518 9.747-3.518s6.671 1.176 9.748 3.518c8.576 6.538 14.934 16.951 13.821 40.498a5.95 5.95 0 003.84 5.845zM126 0c14.042.377 28.119 3.103 40.336 8.406 8.46 3.677 16.354 8.534 23.502 14.342 3.228 2.622 5.886 5.155 8.814 8.071 7.897.273 19.438-8.5 24.796-16.709-9.221 30.23-51.299 65.929-80.43 79.589-.012-.005-.02-.012-.029-.018-5.228-3.992-11.108-5.988-16.989-5.988s-11.76 1.996-16.988 5.988c-.009.005-.017.014-.029.018-29.132-13.66-71.209-49.359-80.43-79.589 5.357 8.209 16.898 16.982 24.795 16.709 2.929-2.915 5.587-5.449 8.814-8.071C69.31 16.94 77.204 12.083 85.664 8.406 97.882 3.103 111.959.377 126 0m-25.818 106.866c-9.176-4.576-20.854-11.312-32.544-20.541-2.465 5.119-2.735 9.586-1.466 13.193.901 2.542 2.597 4.753 4.826 6.512 2.416 1.901 5.432 3.285 8.766 4.033 6.326 1.425 13.711.593 20.418-3.197" />
                <path d="M197.167 75.016c6.436-6.495 12.107-13.684 16.667-20.099l2.316 4.359c7.456 14.917 11.33 29.774 11.33 46.494l-.016 26.532.14 13.754c.54 33.766 7.846 67.929 24.396 99.193l-34.627-27.922-24.501 39.759-25.74-24.231L126 299.604l-41.132-66.748-25.739 24.231-24.501-39.759L0 245.25c16.55-31.264 23.856-65.427 24.397-99.193l.14-13.754-.016-26.532c0-16.721 3.873-31.578 11.331-46.494l2.315-4.359c4.56 6.415 10.23 13.603 16.667 20.099l-2.01 4.175c-3.905 8.109-5.198 17.176-2.156 25.799 1.961 5.554 5.54 10.317 10.154 13.953 4.48 3.531 9.782 5.911 15.333 7.161 3.616.814 7.3 1.149 10.96 1.035-.854 4.841-1.227 9.862-1.251 14.978L53.2 160.984l25.206 14.129a41.926 41.926 0 015.734 3.869c20.781 18.658 33.275 73.855 41.861 100.816 8.587-26.961 21.08-82.158 41.862-100.816a41.865 41.865 0 015.734-3.869l25.206-14.129-32.665-18.866c-.024-5.116-.397-10.137-1.251-14.978 3.66.114 7.344-.221 10.96-1.035 5.551-1.25 10.854-3.63 15.333-7.161 4.613-3.636 8.193-8.399 10.153-13.953 3.043-8.623 1.749-17.689-2.155-25.799l-2.01-4.175z" />
              </svg>
    </a>
    <a href="https://github.com/Based-LTD/prooflaunch" target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub"
      className="text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
    </a>
  </div>
);

export const Navbar: FC = () => {
  const pathname = usePathname();
  const isDemo = pathname?.startsWith('/demo');
  const isRhc = pathname?.startsWith('/rhc') ?? false;
  const entries = isRhc ? rhcNav : solNav;
  // RHC world uses a gold accent so you always know which chain you're on
  const accent = isRhc ? 'text-[var(--accent-gold)]' : 'text-[var(--accent)]';

  const [walletsOpen, setWalletsOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Navigating must close whatever is open, or the panel hangs over the
  // page you just asked for.
  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes; click outside closes. A dropdown you can't dismiss
  // without picking something is a trap.
  useEffect(() => {
    if (!openMenu && !mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenMenu(null); setMobileOpen(false); }
    };
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [openMenu, mobileOpen]);

  const isDemoBar = isDemo;
  // Demo routes still need the translucent + blurred bar since they
  // bring their own backgrounds. All other routes get the solid bar.
  const barBg = isDemoBar
    ? 'bg-[rgba(10,10,10,0.45)] backdrop-blur-md border-white/10'
    : 'bg-[var(--background)] border-[var(--border)]';

  const itemActive = (i: NavItem) => !!i.href && pathname === i.href;
  const groupActive = (g: NavGroup) => g.items.some(itemActive);

  const onItemClick = (i: NavItem) => {
    if (i.action === 'wallets') setWalletsOpen(true);
    setOpenMenu(null);
    setMobileOpen(false);
  };

  return (
    <nav ref={navRef} className={`fixed top-0 left-0 right-0 z-50 border-b ${barBg}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 gap-3">
          {/* Logo wordmark */}
          <Link href="/" className="flex items-center gap-3 group shrink-0">
            <span className="text-[var(--accent)] text-xl leading-none">▮</span>
            <span className="font-mono text-base font-semibold tracking-wider uppercase">
              Proof<span className="text-[var(--accent)]">/</span>Launch
            </span>
          </Link>

          <ChainToggle isRhc={isRhc} className="hidden sm:flex" />

          {/* ── desktop nav ──────────────────────────────────────── */}
          <div className="hidden md:flex items-center ml-auto">
            {entries.map((entry) => {
              if (!isGroup(entry)) {
                const active = itemActive(entry);
                return (
                  <Link
                    key={entry.href}
                    href={entry.href!}
                    className={`px-4 py-2 text-xs font-mono uppercase tracking-widest transition-colors border-l border-[var(--border)] ${
                      active ? accent : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {active && '> '}
                    {entry.label}
                  </Link>
                );
              }

              const open = openMenu === entry.label;
              const active = groupActive(entry);
              return (
                <div key={entry.label} className="relative">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-haspopup="menu"
                    onClick={() => setOpenMenu(open ? null : entry.label)}
                    className={`px-4 py-2 text-xs font-mono uppercase tracking-widest transition-colors border-l border-[var(--border)] ${
                      active || open ? accent : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {entry.label}
                    <span className="ml-1.5 text-[9px]">{open ? '▴' : '▾'}</span>
                  </button>

                  {open && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full min-w-[11rem] border border-[var(--border)] bg-[var(--background)] shadow-lg"
                    >
                      {entry.items.map((i) =>
                        i.action ? (
                          <button
                            key={i.label}
                            type="button"
                            role="menuitem"
                            aria-haspopup="dialog"
                            onClick={() => onItemClick(i)}
                            className="block w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card)] transition-colors"
                          >
                            {i.label}
                          </button>
                        ) : (
                          <Link
                            key={`${i.label}-${i.href}`}
                            href={i.href!}
                            role="menuitem"
                            onClick={() => onItemClick(i)}
                            className={`block px-4 py-2.5 text-xs font-mono uppercase tracking-widest transition-colors hover:bg-[var(--card)] ${
                              itemActive(i) ? accent : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                            }`}
                          >
                            {itemActive(i) && '> '}
                            {i.label}
                          </Link>
                        )
                      )}
                      {entry.label === 'More' && (
                        <SocialLinks className="flex items-center gap-4 px-4 py-3 border-t border-[var(--border)]" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── right rail: socials + wallet ─────────────────────── */}
          <div className="flex items-center gap-3 shrink-0">
{isRhc ? <RhcNavConnect /> : <WalletMultiButton />}

            {/* ── hamburger (mobile only) ────────────────────────── */}
            <button
              type="button"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden flex flex-col justify-center gap-[5px] w-9 h-9 items-center border border-[var(--border)] text-[var(--foreground)]"
            >
              <span className={`block h-[1.5px] w-4 bg-current transition-transform ${mobileOpen ? 'translate-y-[6.5px] rotate-45' : ''}`} />
              <span className={`block h-[1.5px] w-4 bg-current transition-opacity ${mobileOpen ? 'opacity-0' : ''}`} />
              <span className={`block h-[1.5px] w-4 bg-current transition-transform ${mobileOpen ? '-translate-y-[6.5px] -rotate-45' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ── mobile panel ───────────────────────────────────────────
          One tappable column instead of nine 10px stubs jammed across
          the width. Groups keep their headings so the shape matches
          desktop and nothing is hidden behind a second tap. */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--background)] max-h-[calc(100vh-3.5rem)] overflow-y-auto">
          <div className="px-4 py-3">
            <ChainToggle isRhc={isRhc} className="sm:hidden mb-3 w-fit" />
          </div>

          {entries.map((entry) =>
            !isGroup(entry) ? (
              <Link
                key={entry.href}
                href={entry.href!}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-3 text-sm font-mono uppercase tracking-widest border-t border-[var(--border)] ${
                  itemActive(entry) ? accent : 'text-[var(--foreground)]'
                }`}
              >
                {itemActive(entry) && '> '}
                {entry.label}
              </Link>
            ) : (
              <div key={entry.label} className="border-t border-[var(--border)]">
                <div className="px-4 pt-3 pb-1 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                  {'// '}{entry.label}
                </div>
                {entry.items.map((i) =>
                  i.action ? (
                    <button
                      key={i.label}
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => onItemClick(i)}
                      className="block w-full text-left px-4 py-3 text-sm font-mono uppercase tracking-widest text-[var(--foreground)]"
                    >
                      {i.label}
                    </button>
                  ) : (
                    <Link
                      key={`${i.label}-${i.href}`}
                      href={i.href!}
                      onClick={() => onItemClick(i)}
                      className={`block px-4 py-3 text-sm font-mono uppercase tracking-widest ${
                        itemActive(i) ? accent : 'text-[var(--foreground)]'
                      }`}
                    >
                      {itemActive(i) && '> '}
                      {i.label}
                    </Link>
                  )
                )}
              </div>
            )
          )}

          <SocialLinks className="flex items-center gap-5 px-4 py-4 border-t border-[var(--border)]" />
        </div>
      )}

      <PlatformWalletsModal open={walletsOpen} onClose={() => setWalletsOpen(false)} />
    </nav>
  );
};
