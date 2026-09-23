'use client';

// Phone-only bar that keeps the page's one action in reach — the SOL
// page's MobileStickyCTA. It scrolls to the card that owns the action
// rather than duplicating the wallet logic.
import { useEffect, useState } from 'react';

export function MobileStickyCta({ label, targetId, tone = 'primary' }: { label: string | null; targetId: string; tone?: 'primary' | 'gold' }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [targetId, label]);
  if (!label || hidden) return null;
  return (
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--background)]/95 backdrop-blur px-4 py-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}>
      <button onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className={`w-full py-3 text-xs font-mono uppercase tracking-widest ${tone === 'gold' ? 'bg-[var(--accent-gold)] text-black' : 'btn-primary'}`}>
        {label}
      </button>
    </div>
  );
}
