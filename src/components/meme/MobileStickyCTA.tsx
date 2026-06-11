'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';

// Mobile-only sticky bar that mirrors the page's primary action so the
// CTA is always one tap away as the user scrolls through tabs, chat,
// roster, etc. Hidden once the user has scrolled into / past the
// inline action panel (no point in showing two big buttons on screen),
// then reappears once it scrolls off again.

interface BackingMode {
  mode: 'backing';
  amount: string;
  minBacking: number;
  onPledge: () => void;
  disabled: boolean;
  pledging: boolean;
  unit?: 'SOL' | 'USDC';
}

interface FundedMode {
  mode: 'funded';
  isCreator: boolean;
  onLaunch: () => void;
  launching: boolean;
}

interface LiveMode {
  mode: 'live';
  symbol: string;
  tradeUrl: string;
}

interface ConnectMode {
  mode: 'connect';
  label: string;
}

type Mode = BackingMode | FundedMode | LiveMode | ConnectMode;

interface Props {
  mode: Mode;
  // Element selector or ref — when this element is on screen, the
  // sticky bar hides so it doesn't compete with the inline panel.
  hideWhenVisibleId: string;
}

export const MobileStickyCTA: React.FC<Props> = ({ mode, hideWhenVisibleId }) => {
  const [hide, setHide] = useState(false);

  useEffect(() => {
    const el = document.getElementById(hideWhenVisibleId);
    if (!el) return;
    // Hide when ANY part of the action panel is on screen. Once it's
    // entirely scrolled off, the sticky reappears.
    const obs = new IntersectionObserver(
      ([entry]) => setHide(entry.isIntersecting),
      { rootMargin: '0px 0px -60px 0px', threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hideWhenVisibleId]);

  if (hide) return null;

  return (
    <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--card)] p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      {mode.mode === 'backing' && (
        <button
          onClick={mode.onPledge}
          disabled={mode.disabled || mode.pledging}
          className="w-full py-3 bg-[var(--accent)] hover:opacity-90 text-[#0a0a0a] font-mono font-bold uppercase tracking-widest text-sm transition-opacity disabled:opacity-40"
        >
          {mode.pledging ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Pledging…
            </span>
          ) : (
            <>▶ BACK WITH {mode.amount || mode.minBacking} {mode.unit ?? 'SOL'}</>
          )}
        </button>
      )}

      {mode.mode === 'funded' && mode.isCreator && (
        <button
          onClick={mode.onLaunch}
          disabled={mode.launching}
          className="w-full py-3 bg-[var(--accent-gold)] hover:opacity-90 text-[#0a0a0a] font-mono font-bold uppercase tracking-widest text-sm transition-opacity disabled:opacity-50"
        >
          {mode.launching ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Deploying…
            </span>
          ) : (
            <>▶ LAUNCH TOKEN</>
          )}
        </button>
      )}

      {mode.mode === 'live' && (
        <a
          href={mode.tradeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center py-3 bg-[var(--success)] hover:opacity-90 text-[#0a0a0a] font-mono font-bold uppercase tracking-widest text-sm transition-opacity"
        >
          <span className="inline-flex items-center justify-center gap-2">
            BUY ${mode.symbol} <ExternalLink className="w-4 h-4" />
          </span>
        </a>
      )}

      {mode.mode === 'connect' && (
        <div className="text-center py-2 text-[11px] font-mono uppercase tracking-widest text-[var(--muted)] border border-[var(--border)]">
          &gt; {mode.label}
        </div>
      )}
    </div>
  );
};
