/**
 * Funnel Analytics & Conversion Attribution Page (/dashboard/analytics — SCR-OWN-09)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.4 (SCR-OWN-09); §13 (CMP-14)
 *   - docs/ROADMAP.md (v1.1) Task M5-T08
 *   - docs/API_SPEC.md (v1.2) §11.4 (API-OWN-04); §15.2 (Conversion Rate Formulas)
 *   - docs/SECURITY.md (v1.1) Attribution Safeguards (Zero confirmed review claims)
 *
 * Responsibilities:
 * - Displays multi-tenant conversion funnel analytics for the authenticated merchant owner.
 * - Supports period filtering: 7d, 30d (default), 90d, all.
 * - Displays 6 primary conversion metric summary cards.
 * - Displays visual FunnelChart with step-over-step denominators and drop-offs.
 * - Displays branching Direct Google Bypass card (anti-gating path).
 * - Displays secondary monthly quota context (used, remaining, limit).
 * - Enforces Attribution Safeguard: Outbound clicks represent high-intent customer handoffs,
 *   never confirmed or published Google reviews.
 * - Empty state with direct link to Digital QR Studio (/dashboard/qr).
 * - WCAG 2.2 AA contrast, 320px responsive reflow, and full keyboard navigation.
 */

import * as React from 'react';
import { useNavigate } from 'react-router';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import { fetchOwnerDashboard } from '../../lib/api/merchant';
import type {
  DashboardAnalyticsPeriod,
  OwnerDashboardResponse,
  OwnerDashboardFunnelMetrics,
} from '../../types/domain';
import {
  CANONICAL_ATTRIBUTION_DISCLAIMER,
  CANONICAL_GOOGLE_HANDOFF_DISCLAIMER,
  formatPercentage,
} from '../../lib/adapters/analytics';
import { FunnelChart } from '../../components/merchant/FunnelChart';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';

const PERIOD_OPTIONS: Array<{
  id: DashboardAnalyticsPeriod;
  label: string;
}> = [
  { id: '7d', label: 'Last 7 Days' },
  { id: '30d', label: 'Last 30 Days' },
  { id: '90d', label: 'Last 90 Days' },
  { id: 'all', label: 'All Time' },
];

const DEFAULT_METRICS: OwnerDashboardFunnelMetrics = {
  qrVisits: 0,
  qrPageViews: 0,
  surveysCompleted: 0,
  surveyCompletionRate: 0,
  completionRate: 0,
  reviewsDrafted: 0,
  generationsSuccess: 0,
  generationsRequested: 0,
  draftSuccessRate: 0,
  clipboardCopies: 0,
  copySuccess: 0,
  copyRate: 0,
  googleHandoffClicks: 0,
  googleRedirectClicks: 0,
  handoffRate: 0,
  assistedHandoffRate: 0,
  directBypassClicks: 0,
  directBypassRate: 0,
  totalHandoffRate: 0,
};

export function AnalyticsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { business, loading: authLoading } = useMerchantAuth();

  const [period, setPeriod] = React.useState<DashboardAnalyticsPeriod>('30d');
  const [dashboardData, setDashboardData] = React.useState<OwnerDashboardResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState<number>(0);

  // Fetch Owner Dashboard metrics from API-OWN-04
  React.useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      if (!business?.id) return;

      setLoading(true);
      setError(null);

      const result = await fetchOwnerDashboard({
        businessId: business.id,
        period,
      });

      if (!cancelled) {
        if (result.error) {
          setError(result.error.message);
          setDashboardData(null);
        } else {
          setDashboardData(result.data);
          setError(null);
        }
        setLoading(false);
      }
    }

    if (business?.id) {
      void loadDashboard();
    }

    return () => {
      cancelled = true;
    };
  }, [business?.id, period, refreshKey]);

  const handleRetry = React.useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const metrics = dashboardData?.metrics || DEFAULT_METRICS;
  const quota = dashboardData?.quota;

  // 1. Auth Loading Skeleton
  if (authLoading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6" data-testid="analytics-auth-loading">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array(6)
            .fill(0)
            .map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // 2. Unauthenticated / No Business Fallback
  if (!business) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto p-4 sm:p-6 text-center py-16" data-testid="analytics-no-business">
        <h2 className="text-xl font-semibold text-foreground">No Business Profile Found</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Please complete your business profile setup before viewing conversion analytics.
        </p>
        <Button
          onClick={() => navigate('/dashboard/profile')}
          className="mt-4"
        >
          Go to Profile Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6" data-testid="analytics-page">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Funnel Analytics & Conversion Attribution
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Operational visibility into customer progression from QR landing to Google Maps handoff
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1 italic">
            * Landing page visits can originate from physical QR scans, digital link sharing, or WhatsApp distribution.
          </p>
        </div>

        {/* Period Selector */}
        <div
          className="inline-flex rounded-lg border border-border bg-card p-1 shadow-xs self-start sm:self-auto"
          role="group"
          aria-label="Analytics Time Period Filter"
          data-testid="period-selector"
        >
          {PERIOD_OPTIONS.map((opt) => {
            const isActive = period === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod(opt.id)}
                aria-pressed={isActive}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
                data-testid={`period-btn-${opt.id}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Prominent Attribution Safeguard Notice */}
      <div
        className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-1.5"
        role="region"
        aria-label="Google Review Attribution Notice"
        data-testid="page-attribution-notice"
      >
        <div className="flex items-start gap-2.5">
          <svg
            className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
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
            <h2 className="font-semibold text-sm">
              Attribution Safeguard & Tracking Notice
            </h2>
            <p className="leading-relaxed">
              {CANONICAL_ATTRIBUTION_DISCLAIMER}
            </p>
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              {CANONICAL_GOOGLE_HANDOFF_DISCLAIMER}
            </p>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5" data-testid="analytics-error-card">
          <CardContent className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center sm:text-left">
              <h3 className="text-sm font-semibold text-destructive">
                Failed to load conversion analytics
              </h3>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              data-testid="analytics-retry-btn"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading Skeleton during Period Changes */}
      {loading && !dashboardData && (
        <div className="space-y-6" data-testid="analytics-data-loading">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array(6)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      )}

      {/* Main Content Area */}
      {(!loading || dashboardData) && (
        <>
          {/* Key Metric Summary Cards Grid (6 cards) */}
          <div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
            role="region"
            aria-label="Funnel Metric Summary Cards"
            data-testid="metrics-summary-grid"
          >
            {/* Card 1: QR Landing Visits */}
            <Card className="border border-border bg-card shadow-xs">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  QR Landing Visits
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                <div className="text-xl font-bold text-foreground tabular-nums" data-testid="metric-qr-visits">
                  {metrics.qrVisits.toLocaleString()}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  100% initial visits
                </p>
              </CardContent>
            </Card>

            {/* Card 2: Feedback Completed */}
            <Card className="border border-border bg-card shadow-xs">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Feedback Completed
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                <div className="text-xl font-bold text-foreground tabular-nums" data-testid="metric-surveys-completed">
                  {metrics.surveysCompleted.toLocaleString()}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {formatPercentage(metrics.surveyCompletionRate)} completion
                </p>
              </CardContent>
            </Card>

            {/* Card 3: AI Reviews Drafted */}
            <Card className="border border-border bg-card shadow-xs">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  AI Reviews Drafted
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                <div className="text-xl font-bold text-foreground tabular-nums" data-testid="metric-reviews-drafted">
                  {metrics.reviewsDrafted.toLocaleString()}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {formatPercentage(metrics.draftSuccessRate)} draft rate
                </p>
              </CardContent>
            </Card>

            {/* Card 4: Copied to Clipboard */}
            <Card className="border border-border bg-card shadow-xs">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Copied to Clipboard
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                <div className="text-xl font-bold text-foreground tabular-nums" data-testid="metric-clipboard-copies">
                  {metrics.clipboardCopies.toLocaleString()}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {formatPercentage(metrics.copyRate)} copy rate
                </p>
              </CardContent>
            </Card>

            {/* Card 5: Assisted Google Handoffs */}
            <Card className="border border-border bg-card shadow-xs">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Google Handoffs
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums" data-testid="metric-google-handoffs">
                  {metrics.googleHandoffClicks.toLocaleString()}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {formatPercentage(metrics.handoffRate)} of copies
                </p>
              </CardContent>
            </Card>

            {/* Card 6: Direct Google Bypasses */}
            <Card className="border border-border bg-card shadow-xs">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Direct Bypasses
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                <div className="text-xl font-bold text-blue-600 dark:text-blue-400 tabular-nums" data-testid="metric-direct-bypasses">
                  {metrics.directBypassClicks.toLocaleString()}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {formatPercentage(metrics.directBypassRate)} of QR visits
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Empty State Banner if 0 QR visits */}
          {metrics.qrVisits === 0 && (
            <Card className="border border-dashed border-border bg-muted/20" data-testid="analytics-empty-state">
              <CardContent className="py-10 text-center space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <svg
                    className="h-6 w-6 text-muted-foreground"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 3h6v6H3z" />
                    <path d="M15 3h6v6h-6z" />
                    <path d="M3 15h6v6H3z" />
                    <path d="M15 15h3v3h-3z" />
                    <path d="M18 18h3v3h-3z" />
                  </svg>
                </div>
                <div className="space-y-1 max-w-md mx-auto">
                  <h3 className="text-base font-semibold text-foreground">
                    No Visitor Activity in this Period
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    No customer scans or landing visits have been recorded for the selected period. Share your digital QR code or first-party link with patrons to start tracking conversions.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/dashboard/qr')}
                  className="mt-2"
                  data-testid="empty-go-to-qr-btn"
                >
                  Open Digital QR Studio
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Embedded Funnel Chart */}
          <FunnelChart metrics={metrics} />

          {/* Secondary Quota Context Card */}
          {quota && (
            <Card className="border border-border bg-card shadow-xs" data-testid="quota-context-card">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">
                      Monthly AI Generation Quota:
                    </span>
                    <Badge variant="outline" className="text-[11px] font-medium">
                      Cycle {quota.billingCycle}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    Usage context for customer draft generation in the current billing period
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div>
                    <span className="font-bold text-foreground text-sm tabular-nums">
                      {quota.generationsUsed}
                    </span>
                    <span className="text-muted-foreground"> / {quota.monthlyQuotaLimit} used</span>
                  </div>
                  <Badge variant="secondary" className="font-semibold text-xs">
                    {quota.generationsRemaining} remaining
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

