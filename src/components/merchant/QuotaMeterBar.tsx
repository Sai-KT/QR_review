/**
 * QuotaMeterBar (CMP-12) — Monthly Generation Quota Progress Bar
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-03, SCR-OWN-10); §13 (CMP-12)
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.8 (public.tenant_quotas)
 *   - docs/API_SPEC.md (v1.2) §11.6 (API-OWN-06)
 *   - docs/ROADMAP.md (v1.1) Task M5-T09
 *
 * Responsibilities:
 * - Visually tracks monthly fair-use AI generation quota consumption against the tenant ceiling (default 150/mo).
 * - Distinguishes committed completed generations from in-flight quota reservations.
 * - Enforces accessible ARIA progressbar semantics (`role="progressbar"`, `aria-valuenow`, `aria-valuetext`).
 * - Color-coded and text-equivalent warning states:
 *     - Healthy (< 80% used): Brand primary / Emerald
 *     - High usage (>= 80% and < 100% used): Amber warning with guidance banner
 *     - Quota reached (>= 100% used or 0 remaining): Red destructive alert explaining graceful direct-to-Google bypass
 * - Formats next reset timestamp in Indian Standard Time (IST / Asia/Kolkata).
 * - Safe against zero max limit, negative counts, missing dates, and nulls.
 */

import * as React from 'react';
import { cn } from '../../lib/utils';
import { formatResetDate } from '../../lib/utils/subscription';
import { Badge } from '../ui/badge';

export interface QuotaMeterBarProps {
  /** Committed successful generation count (tenant_quotas.used_count) */
  usedCount: number;
  /** Monthly quota ceiling (tenant_quotas.max_limit, default 150) */
  maxLimit: number;
  /** In-flight two-phase reservation count (tenant_quotas.reserved_count) */
  reservedCount?: number;
  /** ISO timestamp for scheduled monthly rollover (tenant_quotas.reset_at) */
  resetAt?: string | null;
  /** Billing cycle string, e.g. '2026-11' */
  billingCycle?: string;
  /** Whether to render the contextual warning/alert banners (default: true) */
  showWarningBanner?: boolean;
  /** Optional custom title text */
  title?: string;
  /** Optional wrapper className */
  className?: string;
}

export function QuotaMeterBar({
  usedCount,
  maxLimit,
  reservedCount = 0,
  resetAt,
  billingCycle,
  showWarningBanner = true,
  title = 'Monthly AI Review Quota',
  className,
}: QuotaMeterBarProps): React.JSX.Element {
  // Sanitize numeric inputs (clamp negatives to 0)
  const safeUsed = Math.max(0, Math.floor(Number(usedCount) || 0));
  const safeMax = Math.max(0, Math.floor(Number(maxLimit) || 0));
  const safeReserved = Math.max(0, Math.floor(Number(reservedCount) || 0));

  // Remaining available capacity (accounting for in-flight reservations)
  const remainingCount = Math.max(0, safeMax - safeUsed - safeReserved);

  // Calculate percentage used based on committed generations
  const percentUsed = safeMax > 0 ? Math.min(100, Math.round((safeUsed / safeMax) * 100)) : 0;

  // Calculate in-flight percentage
  const percentReserved =
    safeMax > 0 ? Math.min(100 - percentUsed, Math.round((safeReserved / safeMax) * 100)) : 0;

  // Determine threshold states
  // Warning triggers at >= 80% and < 100% committed usage
  // Exhausted triggers at >= 100% committed usage OR 0 remaining capacity
  const isExhausted = safeMax > 0 ? safeUsed >= safeMax || remainingCount === 0 : true;
  const isWarning = safeMax > 0 && percentUsed >= 80 && !isExhausted;

  const formattedReset = formatResetDate(resetAt);

  // Status badge details
  const statusBadge = React.useMemo(() => {
    if (safeMax === 0) {
      return { variant: 'outline' as const, label: 'Zero Limit' };
    }
    if (isExhausted) {
      return { variant: 'destructive' as const, label: 'Quota Reached' };
    }
    if (isWarning) {
      return { variant: 'warning' as const, label: 'High Usage (≥80%)' };
    }
    return { variant: 'success' as const, label: 'Healthy' };
  }, [safeMax, isExhausted, isWarning]);

  // Color classes for progress indicator bar
  const progressBarColor = React.useMemo(() => {
    if (isExhausted) return 'bg-rose-600 dark:bg-rose-500';
    if (isWarning) return 'bg-amber-500 dark:bg-amber-400';
    return 'bg-primary';
  }, [isExhausted, isWarning]);

  return (
    <div
      className={cn('space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5 shadow-xs', className)}
      data-testid="quota-meter-bar"
    >
      {/* Header Row: Title, Cycle & Status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
          {billingCycle && (
            <Badge variant="outline" className="text-[11px] font-mono font-medium">
              Cycle {billingCycle}
            </Badge>
          )}
        </div>

        <Badge variant={statusBadge.variant} shape="pill" className="text-xs font-medium">
          {statusBadge.label}
        </Badge>
      </div>

      {/* Numerical Metrics Summary */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <div>
          <span
            className="text-2xl font-bold tracking-tight text-foreground tabular-nums"
            data-testid="quota-used-count"
          >
            {safeUsed}
          </span>
          <span className="text-muted-foreground font-medium ml-1">/ {safeMax} used</span>
          {safeReserved > 0 && (
            <span
              className="ml-2 text-[11px] text-amber-600 dark:text-amber-400 font-medium"
              data-testid="quota-reserved-count"
            >
              (+{safeReserved} reserved)
            </span>
          )}
        </div>

        <div className="text-right">
          <span
            className={cn(
              'font-semibold tabular-nums text-sm',
              isExhausted
                ? 'text-rose-600 dark:text-rose-400'
                : isWarning
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-foreground',
            )}
            data-testid="quota-remaining-count"
          >
            {remainingCount} available
          </span>
          <span className="text-muted-foreground text-[11px] ml-1">({percentUsed}%)</span>
        </div>
      </div>

      {/* Accessible Progress Bar (CMP-12) */}
      <div
        role="progressbar"
        aria-label={title || 'Monthly AI generation quota'}
        aria-valuenow={safeUsed}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuetext={`${safeUsed} of ${safeMax} AI review drafts used (${percentUsed}%)${
          safeReserved > 0 ? `, ${safeReserved} in-flight reservations` : ''
        }`}
        className="h-3 w-full overflow-hidden rounded-full bg-surface-subtle border border-border/40 relative flex"
        data-testid="quota-progressbar"
      >
        {/* Committed Usage Segment */}
        <div
          className={cn('h-full transition-all duration-300', progressBarColor)}
          style={{ width: `${percentUsed}%` }}
          data-testid="quota-progressbar-fill"
        />

        {/* In-Flight Reservation Segment (Striped/Subtle Accent) */}
        {percentReserved > 0 && (
          <div
            className="h-full bg-amber-400/60 dark:bg-amber-500/50 transition-all duration-300"
            style={{ width: `${percentReserved}%` }}
            title={`${safeReserved} reservation(s) in flight`}
            data-testid="quota-progressbar-reserved"
          />
        )}
      </div>

      {/* Footnote: Next Scheduled Rollover & In-Flight Context */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[11px] text-muted-foreground pt-1">
        <div className="flex items-center gap-1.5" data-testid="quota-reset-text">
          <svg
            className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            Scheduled quota reset:{' '}
            <strong className="font-semibold text-foreground">{formattedReset}</strong>
          </span>
        </div>

        {safeReserved > 0 && (
          <span className="text-amber-600 dark:text-amber-400 italic">
            In-flight reservations automatically release if drafting times out.
          </span>
        )}
      </div>

      {/* Contextual Warning & Guidance Banners */}
      {showWarningBanner && (
        <>
          {/* Quota Exhausted Banner */}
          {isExhausted && safeMax > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-md border border-rose-200 dark:border-rose-900/50 bg-rose-50/80 dark:bg-rose-950/30 p-3 text-xs text-rose-900 dark:text-rose-200"
              data-testid="quota-exhausted-banner"
            >
              <svg
                className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div className="space-y-0.5">
                <p className="font-semibold text-rose-950 dark:text-rose-100">
                  Monthly AI Review Quota Reached
                </p>
                <p className="text-[11px] leading-relaxed text-rose-800 dark:text-rose-300">
                  All {safeMax} AI review generations have been used for this billing cycle. Customer
                  QR scans will safely route directly to your Google review link so customer feedback
                  is never interrupted. Quota resets on {formattedReset}.
                </p>
              </div>
            </div>
          )}

          {/* High Usage Warning Banner (>= 80% and < 100%) */}
          {isWarning && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200"
              data-testid="quota-warning-banner"
            >
              <svg
                className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="space-y-0.5">
                <p className="font-semibold text-amber-950 dark:text-amber-100">
                  Approaching Monthly Quota Limit ({percentUsed}%)
                </p>
                <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                  You have used {safeUsed} of your {safeMax} monthly generations. AI review drafting
                  remains active. If the ceiling is reached before {formattedReset}, customer scans
                  will automatically route directly to Google Reviews.
                </p>
              </div>
            </div>
          )}

          {/* Zero Limit Warning */}
          {safeMax === 0 && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-md border border-border bg-surface-subtle p-3 text-xs text-muted-foreground"
              data-testid="quota-zero-limit-banner"
            >
              <svg
                className="w-4 h-4 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-[11px] leading-relaxed">
                Zero AI generation allowance configured for this cycle. Direct Google review routing
                is active for all customer scans.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
