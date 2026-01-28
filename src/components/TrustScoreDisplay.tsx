'use client';

import { FC } from 'react';
import { Shield, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useState } from 'react';
import {
  TrustScoreBreakdown,
  getTrustScoreColor,
  getTrustScoreLabel,
  getTrustScoreBgColor,
} from '@/lib/trustScore';

interface TrustScoreDisplayProps {
  breakdown: TrustScoreBreakdown;
  compact?: boolean;
}

export const TrustScoreDisplay: FC<TrustScoreDisplayProps> = ({ breakdown, compact = false }) => {
  const [expanded, setExpanded] = useState(!compact);
  const scoreColor = getTrustScoreColor(breakdown.total);
  const scoreLabel = getTrustScoreLabel(breakdown.total);
  const scoreBg = getTrustScoreBgColor(breakdown.total);

  if (compact) {
    return (
      <div className={`rounded-lg ${scoreBg} p-3`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Shield className={`w-5 h-5 ${scoreColor}`} />
            <span className="font-semibold">Trust Score</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${scoreColor}`}>{breakdown.total}</span>
            <span className="text-xs text-[var(--muted)]">/100</span>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-[var(--muted)]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[var(--muted)]" />
            )}
          </div>
        </button>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2">
            {breakdown.components.map((component, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">{component.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{component.value}</span>
                  <span className={`text-xs ${component.points > component.maxPoints / 2 ? 'text-green-500' : 'text-orange-500'}`}>
                    +{component.points}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Full display
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Shield className={`w-5 h-5 ${scoreColor}`} />
          <h3 className="font-semibold">Trust Score</h3>
        </div>
        <div className="flex items-center gap-1">
          <span className={`text-3xl font-bold ${scoreColor}`}>{breakdown.total}</span>
          <span className="text-sm text-[var(--muted)]">/100</span>
        </div>
      </div>

      <div className={`text-center py-2 mb-4 rounded-lg ${scoreBg}`}>
        <span className={`font-semibold ${scoreColor}`}>{scoreLabel}</span>
      </div>

      {/* Score breakdown */}
      <div className="space-y-3">
        {breakdown.components.map((component, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">{component.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">{component.value}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  component.points >= component.maxPoints * 0.8
                    ? 'bg-green-500/20 text-green-500'
                    : component.points >= component.maxPoints * 0.5
                    ? 'bg-yellow-500/20 text-yellow-500'
                    : 'bg-red-500/20 text-red-500'
                }`}>
                  +{component.points}/{component.maxPoints}
                </span>
              </div>
            </div>
            <div className="text-xs text-[var(--muted)]">{component.description}</div>
            {/* Progress bar */}
            <div className="h-1.5 bg-[var(--background)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  component.points >= component.maxPoints * 0.8
                    ? 'bg-green-500'
                    : component.points >= component.maxPoints * 0.5
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${(component.points / component.maxPoints) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="mt-4 pt-3 border-t border-[var(--border)] flex gap-2 text-xs text-[var(--muted)]">
        <Info className="w-4 h-4 flex-shrink-0" />
        <p>
          Trust score is calculated from creator-set parameters. Higher scores indicate more backer-friendly terms.
        </p>
      </div>
    </div>
  );
};
