/**
 * Funnel Chart & Conversion Attribution Component (CMP-14 / SCR-OWN-09)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.4 (SCR-OWN-09); §13 (CMP-14)
 *   - docs/ROADMAP.md (v1.1) Task M5-T08
 *   - docs/API_SPEC.md (v1.2) §11.4 (API-OWN-04); §15.2 (Conversion Rate Formulas)
 *   - docs/SECURITY.md (v1.1) Attribution Boundaries (Zero confirmed review claims)
 *
 * Visual & Semantic Requirements:
 * 1. 5 sequential conversion stages in the customer journey:
 *    - Stage 1: QR Landing Visits
 *    - Stage 2: Feedback Completed
 *    - Stage 3: AI Reviews Drafted
 *    - Stage 4: Copied to Clipboard
 *    - Stage 5: Google Maps Outbound Handoffs
 * 2. Step-over-step denominators and drop-off attrition:
 *    - Stage 2 / Stage 1, Stage 3 / Stage 2, Stage 4 / Stage 3, Stage 5 / Stage 4
 * 3. Branching Direct Bypass Card (Anti-gating direct path):
 *    - directBypassClicks, directBypassRate (denom: qrVisits)
 *    - totalGoogleHandoffs & totalGoogleHandoffRate
 * 4. Attribution Safeguard Disclaimers:
 *    - CANONICAL_ATTRIBUTION_DISCLAIMER
 *    - CANONICAL_GOOGLE_HANDOFF_DISCLAIMER
 *    - Strictly no claims of "Confirmed Reviews", "Verified Reviews", or "Published Reviews".
 * 5. Accessible Semantic HTML table (`<table>`) for screen readers / assistive tech.
 * 6. Responsive reflow down to 320px mobile viewport without horizontal scrolling.
 */

import * as React from 'react';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import type { OwnerDashboardFunnelMetrics } from '../../types/domain';
import {
  CANONICAL_ATTRIBUTION_DISCLAIMER,
  CANONICAL_GOOGLE_HANDOFF_DISCLAIMER,
  formatPercentage,
} from '../../lib/adapters/analytics';

export interface FunnelChartProps {
  metrics: OwnerDashboardFunnelMetrics;
  className?: string;
  showTableDefault?: boolean;
}

interface FunnelStageConfig {
  id: string;
  stageNumber: number;
  label: string;
  count: number;
  stepRate: number;
  dropOffRate: number;
  denominatorLabel: string;
  helperText?: string;
  barColor: string;
}

export function FunnelChart({
  metrics,
  className = '',
  showTableDefault = false,
}: FunnelChartProps): React.JSX.Element {
  const [showTable, setShowTable] = React.useState<boolean>(showTableDefault);

  const qrVisits = Math.max(0, metrics.qrVisits);
  const surveysCompleted = Math.max(0, metrics.surveysCompleted);
  const reviewsDrafted = Math.max(0, metrics.reviewsDrafted);
  const clipboardCopies = Math.max(0, metrics.clipboardCopies);
  const googleHandoffClicks = Math.max(0, metrics.googleHandoffClicks);
  const directBypassClicks = Math.max(0, metrics.directBypassClicks);

  // Drop-off calculations step-over-step
  const surveyDropOff = qrVisits > 0 ? Math.max(0, 1 - metrics.surveyCompletionRate) : 0;
  const draftDropOff = surveysCompleted > 0 ? Math.max(0, 1 - metrics.draftSuccessRate) : 0;
  const copyDropOff = reviewsDrafted > 0 ? Math.max(0, 1 - metrics.copyRate) : 0;
  const handoffDropOff = clipboardCopies > 0 ? Math.max(0, 1 - metrics.handoffRate) : 0;

  const totalHandoffs = googleHandoffClicks + directBypassClicks;
  const totalHandoffRate = metrics.totalHandoffRate ?? (qrVisits > 0 ? totalHandoffs / qrVisits : 0);

  const stages: FunnelStageConfig[] = [
    {
      id: 'qr-visits',
      stageNumber: 1,
      label: 'QR Landing Visits',
      count: qrVisits,
      stepRate: 1.0,
      dropOffRate: 0,
      denominatorLabel: 'Initial landing page visits',
      helperText: 'Patrons who opened the QR landing page via physical scan or digital link',
      barColor: 'bg-blue-600 dark:bg-blue-500',
    },
    {
      id: 'surveys-completed',
      stageNumber: 2,
      label: 'Feedback Completed',
      count: surveysCompleted,
      stepRate: metrics.surveyCompletionRate,
      dropOffRate: surveyDropOff,
      denominatorLabel: 'of QR Landing Visits',
      helperText: 'Patrons who answered all 3 MCQs and submitted feedback',
      barColor: 'bg-indigo-600 dark:bg-indigo-500',
    },
    {
      id: 'reviews-drafted',
      stageNumber: 3,
      label: 'AI Reviews Drafted',
      count: reviewsDrafted,
      stepRate: metrics.draftSuccessRate,
      dropOffRate: draftDropOff,
      denominatorLabel: 'of Feedback Completed',
      helperText: 'Grounded drafts generated from affirmative feedback answers',
      barColor: 'bg-purple-600 dark:bg-purple-500',
    },
    {
      id: 'clipboard-copies',
      stageNumber: 4,
      label: 'Copied to Clipboard',
      count: clipboardCopies,
      stepRate: metrics.copyRate,
      dropOffRate: copyDropOff,
      denominatorLabel: 'of AI Reviews Drafted',
      helperText: 'Patrons who tapped copy to place the draft on their clipboard',
      barColor: 'bg-amber-600 dark:bg-amber-500',
    },
    {
      id: 'google-handoffs',
      stageNumber: 5,
      label: 'Google Maps Outbound Handoffs',
      count: googleHandoffClicks,
      stepRate: metrics.handoffRate,
      dropOffRate: handoffDropOff,
      denominatorLabel: 'of Copied Reviews',
      helperText: 'Patrons directed to Google Maps review form with copied review draft',
      barColor: 'bg-emerald-600 dark:bg-emerald-500',
    },
  ];

  return (
    <div className={`space-y-6 ${className}`} data-testid="funnel-chart-container">
      {/* Visual Funnel Card */}
      <Card className="border border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Customer Conversion Funnel
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Step-over-step progression from initial landing scan to outbound Google Maps handoff
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTable((prev) => !prev)}
              className="self-start sm:self-auto text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-2 py-1 bg-muted/60"
              aria-expanded={showTable}
              data-testid="toggle-table-btn"
            >
              {showTable ? 'Hide Accessible Table' : 'Show Accessible Table'}
            </button>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {/* Sequential Funnel Stages */}
          <div className="space-y-5" role="list" aria-label="Customer Conversion Funnel Stages">
            {stages.map((stage, idx) => {
              const widthPct =
                qrVisits > 0 ? Math.min(100, Math.max(stage.count > 0 ? 3 : 0, (stage.count / qrVisits) * 100)) : 0;

              return (
                <div
                  key={stage.id}
                  role="listitem"
                  className="space-y-1.5"
                  data-testid={`funnel-stage-${stage.id}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                        {stage.stageNumber}
                      </span>
                      <span className="font-medium text-foreground">{stage.label}</span>
                    </div>

                    <div className="flex items-baseline gap-2 text-right">
                      <span className="font-bold text-foreground tabular-nums text-base">
                        {stage.count.toLocaleString()}
                      </span>

                      {idx === 0 ? (
                        <span className="text-xs text-muted-foreground font-medium">
                          (100% baseline)
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-xs font-semibold px-1.5 py-0">
                            {formatPercentage(stage.stepRate)}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {stage.denominatorLabel}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Horizontal Bar Track */}
                  <div className="relative h-4 w-full overflow-hidden rounded-full bg-muted/70">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${stage.barColor}`}
                      style={{ width: `${widthPct}%` }}
                      role="progressbar"
                      aria-valuenow={stage.count === 0 ? 0 : Math.round(stage.stepRate * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${stage.label}: ${stage.count} customers`}
                    />
                  </div>

                  {/* Step Drop-Off & Helper Detail */}
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground pt-0.5">
                    <span className="truncate max-w-full">{stage.helperText}</span>
                    {idx > 0 && stage.dropOffRate > 0 && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium shrink-0">
                        {formatPercentage(stage.dropOffRate)} step drop-off
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Branching Path: Direct Google Bypasses */}
          <div
            className="rounded-lg border border-dashed border-border bg-muted/30 p-4 space-y-3"
            data-testid="funnel-direct-bypass-card"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    Anti-Gating Direct Path
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">
                    Direct Google Bypasses
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Patrons who navigated directly to your Google Maps review page without drafting an AI review.
                </p>
              </div>

              <div className="text-left sm:text-right">
                <div className="font-bold text-base text-foreground tabular-nums">
                  {directBypassClicks.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatPercentage(metrics.directBypassRate)} of QR visits
                </div>
              </div>
            </div>

            {/* Total Google Handoffs (Assisted + Direct) */}
            <div className="pt-2 border-t border-border/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
              <span className="font-medium text-foreground">
                Total Google Outbound Handoffs (Assisted + Direct Bypass):
              </span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground tabular-nums text-sm">
                  {totalHandoffs.toLocaleString()}
                </span>
                <Badge variant="secondary" className="font-semibold text-xs">
                  {formatPercentage(totalHandoffRate)} of QR visits
                </Badge>
              </div>
            </div>
          </div>

          {/* Attribution Safeguard Disclaimer Card */}
          <div
            className="rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 space-y-1.5"
            role="note"
            aria-label="Google Review Attribution Safeguard Disclaimer"
            data-testid="attribution-disclaimer-card"
          >
            <div className="flex items-start gap-2">
              <svg
                className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-semibold">
                  Google Review Attribution Safeguard
                </p>
                <p className="leading-relaxed">
                  {CANONICAL_ATTRIBUTION_DISCLAIMER}
                </p>
                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                  {CANONICAL_GOOGLE_HANDOFF_DISCLAIMER}
                </p>
              </div>
            </div>
          </div>

          {/* Accessible Semantic HTML Table */}
          {showTable && (
            <div className="mt-4 pt-4 border-t border-border overflow-x-auto" data-testid="funnel-table-container">
              <table className="w-full text-left text-xs border-collapse">
                <caption className="text-left font-semibold text-sm text-foreground mb-2">
                  Conversion Funnel Step-by-Step Breakdown
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th scope="col" className="py-2 px-3 font-semibold text-foreground">
                      Funnel Stage
                    </th>
                    <th scope="col" className="py-2 px-3 font-semibold text-foreground text-right">
                      Patron Count
                    </th>
                    <th scope="col" className="py-2 px-3 font-semibold text-foreground text-right">
                      Step Conversion
                    </th>
                    <th scope="col" className="py-2 px-3 font-semibold text-foreground text-right">
                      Step Drop-off
                    </th>
                    <th scope="col" className="py-2 px-3 font-semibold text-foreground">
                      Denominator Base
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stages.map((stage, idx) => (
                    <tr key={stage.id} className="hover:bg-muted/20">
                      <th scope="row" className="py-2 px-3 font-medium text-foreground">
                        {stage.stageNumber}. {stage.label}
                      </th>
                      <td className="py-2 px-3 text-right tabular-nums text-foreground font-semibold">
                        {stage.count.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-foreground">
                        {idx === 0 ? '100.0%' : formatPercentage(stage.stepRate)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                        {idx === 0 ? '—' : formatPercentage(stage.dropOffRate)}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {stage.denominatorLabel}
                      </td>
                    </tr>
                  ))}
                  <tr className="hover:bg-muted/20 bg-muted/10 font-medium">
                    <th scope="row" className="py-2 px-3 text-foreground">
                      ↳ Direct Google Bypasses
                    </th>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground font-semibold">
                      {directBypassClicks.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground">
                      {formatPercentage(metrics.directBypassRate)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      —
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      of QR Landing Visits
                    </td>
                  </tr>
                  <tr className="hover:bg-muted/20 bg-muted/20 font-semibold border-t-2 border-border">
                    <th scope="row" className="py-2 px-3 text-foreground">
                      Total Outbound Handoffs
                    </th>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground font-bold">
                      {totalHandoffs.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground">
                      {formatPercentage(totalHandoffRate)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      —
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      of QR Landing Visits
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
