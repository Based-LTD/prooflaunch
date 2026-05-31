'use client';

import { ReactNode } from 'react';

// Generic card wrapper for the meme dashboard grid. Gives every panel
// the same chrome: a tiny uppercase label header + optional right-aligned
// meta (count, status, etc), then the panel body. Keeps cards visually
// uniform across the grid even when their content is structurally
// different (bot list vs. trust info vs. creator controls).

interface Props {
  label: string;
  meta?: ReactNode;
  children: ReactNode;
  /** Extra className for the outer wrapper (e.g. col-span). */
  className?: string;
  /** Removes the body padding when the child already has its own.
   *  Useful for BuybackBotPanel which has its own card-per-bot layout. */
  noBodyPadding?: boolean;
}

export const DashboardCard: React.FC<Props> = ({
  label, meta, children, className = '', noBodyPadding = false,
}) => {
  return (
    <section className={`border border-[var(--border)] bg-[var(--card)] flex flex-col ${className}`}>
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          // {label}
        </span>
        {meta != null && (
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
            {meta}
          </span>
        )}
      </header>
      <div className={noBodyPadding ? '' : 'p-3 sm:p-4 flex-1'}>{children}</div>
    </section>
  );
};
