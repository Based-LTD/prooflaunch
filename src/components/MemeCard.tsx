'use client';

import { FC, useState } from 'react';
import Link from 'next/link';
import { Copy, Check } from 'lucide-react';
import type { Meme } from '@/types/database';

interface MemeCardProps {
  meme: Meme & {
    backer_count?: number;
    progress_percent?: number;
    // Populated by /api/memes (list); counts both Phase B meme_bots rows
    // and legacy single-bot memes (buyback_bot_enabled = 1).
    bot_count?: number;
  };
}

function getTimeRemaining(deadline: string): string {
  const now = new Date();
  const end = new Date(deadline);
  const diff = end.getTime() - now.getTime();

  if (diff <= 0) return 'ENDED';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}D ${hours}H`;
  if (hours > 0) return `${hours}H ${minutes}M`;
  return `${minutes}M`;
}

function getStatusConfig(status: string) {
  const configs: Record<string, { label: string; class: string }> = {
    pending: { label: 'PENDING', class: 'badge-proving' },
    backing: { label: 'PROVING', class: 'badge-proving' },
    funded: { label: 'FUNDED', class: 'badge-launched' },
    launching: { label: 'LAUNCHING', class: 'badge-launched' },
    live: { label: 'LIVE', class: 'badge-launched' },
    failed: { label: 'FAILED', class: 'badge-failed' },
  };
  return configs[status] || { label: status.toUpperCase(), class: 'badge-proving' };
}

export const MemeCard: FC<MemeCardProps> = ({ meme }) => {
  const [caCopied, setCaCopied] = useState(false);

  const {
    id,
    name,
    symbol,
    description,
    status,
    total_slots = 8,
    reserved_slots = 0,
    current_backing_sol,
    backing_deadline,
    launch_deadline,
    creator_wallet,
    image_url,
    pump_fun_url,
    mint_address,
    backer_count = 0,
    bot_count = 0,
  } = meme;

  const handleCopyCA = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (mint_address) {
      navigator.clipboard.writeText(mint_address);
      setCaCopied(true);
      setTimeout(() => setCaCopied(false), 2000);
    }
  };

  const totalSlots = Number(total_slots) || 8;
  const reservedSlots = Number(reserved_slots) || 0;
  const isTeamRound = reservedSlots > 0 && reservedSlots === totalSlots;
  const hasReservedSlots = reservedSlots > 0;
  const filledSlots = Number(backer_count) || 0;
  const timeRemaining = getTimeRemaining(backing_deadline);
  const { label: statusLabel, class: statusClass } = getStatusConfig(status);

  // Launch-window countdown for funded memes (migration 027).
  // Tight format — card has very limited space.
  const launchTimeRemaining = launch_deadline ? getTimeRemaining(launch_deadline) : null;
  const launchExpired = launchTimeRemaining === 'ENDED';
  const launchLowTime = launchTimeRemaining
    ? (launchTimeRemaining.endsWith('M') && !launchTimeRemaining.includes('H'))   // <1h
      || (launchTimeRemaining.includes('H') && !launchTimeRemaining.includes('D') // <24h
        && parseInt(launchTimeRemaining) < 6)                                      // and <6h
    : false;

  return (
    <Link href={`/meme/${id}`} className="block">
      <div className="border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)] transition-colors">
        {/* Top bar — system path + status + reservation/team-round chip */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] truncate">
            // {symbol.slice(0, 12)}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isTeamRound && (
              <span
                className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent-gold)]/60 text-[var(--accent-gold)] bg-[var(--accent-gold)]/5"
                title="Team round — all slots reserved for declared wallets, no public slots"
              >
                TEAM ROUND
              </span>
            )}
            {hasReservedSlots && !isTeamRound && (
              <span
                className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent-gold)]/60 text-[var(--accent-gold)] bg-[var(--accent-gold)]/5"
                title={`Team launch — ${reservedSlots} of ${totalSlots} slots reserved for declared wallets · ${totalSlots - reservedSlots} open to public`}
              >
                TEAM · {reservedSlots}/{totalSlots}
              </span>
            )}
            {bot_count > 0 && (
              <span
                className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border border-[var(--accent)]/60 text-[var(--accent)] bg-[var(--accent)]/5"
                title={`Programmable tokenomics — ${bot_count} active bot${bot_count === 1 ? '' : 's'} (burn / vaults / airdrops)`}
              >
                {bot_count} BOT{bot_count === 1 ? '' : 'S'}
              </span>
            )}
            <span className={statusClass}>{statusLabel}</span>
          </div>
        </div>

        {/* Main */}
        <div className="p-4 space-y-4">
          {/* Avatar + name */}
          <div className="flex items-start gap-3">
            {image_url ? (
              <img
                src={image_url}
                alt={name}
                className="w-12 h-12 object-cover border border-[var(--border)] flex-shrink-0"
              />
            ) : (
              <div className="w-12 h-12 border border-[var(--accent)] bg-[var(--background)] flex items-center justify-center flex-shrink-0">
                <span className="font-mono font-semibold text-[var(--accent)] text-sm">
                  {symbol.charAt(0)}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-mono font-semibold uppercase tracking-tight text-base truncate">
                {name}
              </h3>
              <div className="text-xs font-mono text-[var(--accent)]">${symbol}</div>
            </div>
          </div>

          {/* Description */}
          <p className="text-xs font-mono text-[var(--muted)] line-clamp-2 leading-relaxed">
            {description || 'No description provided.'}
          </p>

          {/* Backing-phase block */}
          {status === 'backing' && (
            <div className="space-y-3 pt-1">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                    Slots
                  </span>
                  <span className="text-xs font-mono text-[var(--accent)]">
                    {filledSlots} / {totalSlots}
                  </span>
                </div>
                {/* Slot grid — visual blocks matching the favicon */}
                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: totalSlots }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-3 ${
                        i < filledSlots
                          ? 'bg-[var(--accent)]'
                          : 'border border-[var(--accent)]'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                <span className="text-[var(--muted)]">
                  Pledged: <span className="text-[var(--foreground)]">{Number(current_backing_sol).toFixed(2)} SOL</span>
                </span>
                <span className="text-[var(--muted)]">
                  {timeRemaining} left
                </span>
              </div>
            </div>
          )}

          {/* Live-phase block */}
          {status === 'live' && (
            <div className="space-y-3 pt-1">
              {mint_address && (
                <button
                  onClick={handleCopyCA}
                  className="w-full flex items-center gap-2 px-2 py-1.5 bg-[var(--background)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
                >
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">CA:</span>
                  <code className="flex-1 text-[10px] font-mono truncate text-left">{mint_address}</code>
                  {caCopied ? (
                    <Check className="w-3 h-3 text-[var(--success)] flex-shrink-0" />
                  ) : (
                    <Copy className="w-3 h-3 text-[var(--muted)] flex-shrink-0" />
                  )}
                </button>
              )}
              {pump_fun_url && (
                <div
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(pump_fun_url, '_blank', 'noopener,noreferrer');
                  }}
                  className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
                >
                  [↗] Trade on pump.fun
                </div>
              )}
            </div>
          )}

          {/* Funded block — countdown to launch deadline (migration 027) */}
          {status === 'funded' && (
            <div className={`border bg-[var(--background)] px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest ${
              launchExpired
                ? 'border-[var(--error)] text-[var(--error)]'
                : launchLowTime
                  ? 'border-[var(--warning)] text-[var(--warning)] pulse-glow'
                  : 'border-[var(--accent)] text-[var(--accent)] pulse-glow'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <span>[!] {launchExpired ? 'Window expired' : 'Ready to deploy'}</span>
                {launchTimeRemaining && (
                  <span className="text-[9px] opacity-90">
                    {launchExpired ? 'refund pending' : `${launchTimeRemaining} left`}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
          <span>by {creator_wallet.slice(0, 4)}…{creator_wallet.slice(-4)}</span>
          <span>&gt; OPEN</span>
        </div>
      </div>
    </Link>
  );
};
