/**
 * Merchant Subscription & AI Quota Monitor Page (/dashboard/subscription — SCR-OWN-10)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-10); §13 (CMP-12)
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.7 (subscriptions), §5.8 (tenant_quotas)
 *   - docs/API_SPEC.md (v1.2) §11.6 (API-OWN-06), §11.9 (API-OWN-09)
 *   - docs/ROADMAP.md (v1.1) Task M5-T09
 *   - docs/PRD.md (v1.1) §FR-OWNER-007, §FR-BILLING-001, §FR-BILLING-002
 *   - docs/TEST_PLAN.md (v1.1) TC-OWN-15, TC-OWN-16, TC-API-20, TC-API-24
 *
 * Responsibilities:
 * - Read-only commercial subscription and fair-use AI quota monitoring for the authenticated merchant owner.
 * - Displays active plan tier: Setup Package (`setup_package`) or Monthly Recurring Plan (`standard_recurring`).
 * - Displays subscription status: `pilot` (14-day trial), `active`, `past_due`, or `canceled`.
 * - Displays visual QuotaMeterBar (CMP-12) tracking monthly generation burn rate (default 150/mo limit).
 * - Distinguishes committed completed generations from in-flight reservations.
 * - Displays authoritative reset date in Indian Standard Time (IST / Asia/Kolkata).
 * - Displays authoritative payment settlement history (amount, date, UPI reference) without fabrication.
 * - Provides honest manual renewal & upgrade guidance: direct UPI settlement with administrative verification.
 * - Historical billing cycle table showing past monthly quota ledgers.
 * - Resilient against missing rows, zero quota limits, 80% warning boundaries, and 320px mobile reflow.
 */

import * as React from 'react';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import {
  fetchMerchantSubscription,
  fetchMerchantQuotaLedger,
} from '../../lib/api/merchant';
import { QuotaMeterBar } from '../../components/merchant/QuotaMeterBar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import {
  formatDate,
  formatDateTime,
  resolvePlanTierInfo,
  resolveSubscriptionStatusInfo,
} from '../../lib/utils/subscription';
import type { Subscription, TenantQuota } from '../../types/domain';

export function SubscriptionPage(): React.JSX.Element {
  const { business, loading: authLoading, error: authError } = useMerchantAuth();

  const [subscription, setSubscription] = React.useState<Subscription | null>(null);
  const [quotaLedger, setQuotaLedger] = React.useState<TenantQuota[]>([]);
  const [activeQuota, setActiveQuota] = React.useState<TenantQuota | null>(null);

  const [dataLoading, setDataLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showInquiryModal, setShowInquiryModal] = React.useState(false);

  // Load subscription and quota ledger records concurrently
  React.useEffect(() => {
    let cancelled = false;

    async function loadSubscriptionAndQuota() {
      if (!business?.id) return;

      setDataLoading(true);
      setFetchError(null);

      try {
        const [subResult, quotaResult] = await Promise.all([
          fetchMerchantSubscription(business.id),
          fetchMerchantQuotaLedger(business.id),
        ]);

        if (cancelled) return;

        if (subResult.error && quotaResult.error) {
          setFetchError('Unable to load subscription and quota records. Please try again.');
          return;
        }

        if (subResult.error) {
          // If only subscription fails, keep quota data
          setFetchError(`Subscription status: ${subResult.error.message}`);
        } else {
          setSubscription(subResult.data);
        }

        if (quotaResult.error) {
          setFetchError(`Quota ledger: ${quotaResult.error.message}`);
        } else {
          setQuotaLedger(quotaResult.data || []);
          setActiveQuota(quotaResult.activeQuota);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : 'An unexpected error occurred while loading data.',
          );
        }
      } finally {
        if (!cancelled) {
          setDataLoading(false);
        }
      }
    }

    if (business?.id) {
      void loadSubscriptionAndQuota();
    }

    return () => {
      cancelled = true;
    };
  }, [business?.id, refreshKey]);

  const handleRetry = React.useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // 1. Auth Error
  if (authError) {
    return (
      <div className="max-w-5xl mx-auto p-4 sm:p-6" data-testid="subscription-auth-error">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Authentication Error</CardTitle>
            <CardDescription>{authError}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // 2. Loading Skeleton
  if (authLoading || (dataLoading && !subscription && !activeQuota)) {
    return (
      <div
        className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6"
        data-testid="subscription-loading-skeleton"
      >
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>

        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  // Derived presentation helpers
  const planInfo = resolvePlanTierInfo(subscription?.planTier);
  const statusInfo = resolveSubscriptionStatusInfo(subscription?.subscriptionStatus);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6" data-testid="subscription-page">
      {/* Page Title & Context Header */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-heading-1 font-bold text-foreground tracking-tight">
              Subscription & AI Quota
            </h1>
            <p className="text-sm text-muted-foreground">
              Review your active commercial plan, renewal schedule, and monthly AI generation quota.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={dataLoading}
            className="text-xs"
            data-testid="refresh-subscription-btn"
          >
            {dataLoading ? 'Refreshing...' : 'Refresh Status'}
          </Button>
        </div>
      </div>

      {/* Error Alert with Retry */}
      {fetchError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-4 text-xs text-rose-800 dark:text-rose-200"
          data-testid="subscription-fetch-error"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{fetchError}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="text-xs shrink-0"
            data-testid="error-retry-btn"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Main Grid: Subscription Details & Quota Meter */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Subscription Plan Details (API-OWN-09, TC-OWN-16) */}
        <Card className="border border-border bg-card shadow-xs flex flex-col justify-between" data-testid="subscription-plan-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current Plan
              </span>
              <Badge variant={statusInfo.variant} shape="pill" className="text-xs font-medium" data-testid="subscription-status-badge">
                {statusInfo.badgeLabel}
              </Badge>
            </div>
            <h2 className="text-xl font-bold text-foreground mt-1 tracking-tight" data-testid="subscription-plan-name">
              {subscription ? planInfo.name : 'No Subscription Record'}
            </h2>
            <CardDescription className="text-xs leading-relaxed mt-1">
              {subscription
                ? planInfo.description
                : 'No subscription row was found for this business. Please contact the administrator.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 pt-0">
            {/* Status Guidance Banner */}
            <div className="rounded-md bg-surface-subtle border border-border/60 p-3 text-xs text-foreground/90">
              <p className="leading-relaxed">{statusInfo.description}</p>
            </div>

            {/* Subscription Period Dates */}
            {subscription && (
              <div className="grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Current Cycle Start</span>
                  <span className="font-semibold text-foreground" data-testid="sub-period-start">
                    {formatDate(subscription.currentPeriodStartsAt)}
                  </span>
                </div>

                <div>
                  <span className="text-muted-foreground block text-[11px]">Next Renewal Date</span>
                  <span className="font-semibold text-foreground" data-testid="sub-period-end">
                    {formatDate(subscription.currentPeriodEndsAt)}
                  </span>
                </div>

                {subscription.trialEndsAt && (
                  <div className="col-span-2 bg-blue-50/60 dark:bg-blue-950/20 p-2 rounded border border-blue-100 dark:border-blue-900/40">
                    <span className="text-blue-900 dark:text-blue-200 block text-[11px] font-medium">
                      Pilot Trial Expiration
                    </span>
                    <span className="font-bold text-blue-950 dark:text-blue-100" data-testid="sub-trial-end">
                      {formatDate(subscription.trialEndsAt)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Authoritative Payment Settlement Record */}
            {subscription && (subscription.lastPaymentAmount !== null || subscription.paymentReference) && (
              <div className="rounded-md border border-border/60 bg-card p-3 space-y-1.5 text-xs" data-testid="sub-payment-record">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block">
                  Last Recorded Settlement
                </span>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-foreground text-sm" data-testid="sub-payment-amount">
                    ₹{Number(subscription.lastPaymentAmount).toFixed(2)}
                  </span>
                  {subscription.paymentReference && (
                    <Badge variant="outline" className="font-mono text-[11px]" data-testid="sub-payment-ref">
                      {subscription.paymentReference}
                    </Badge>
                  )}
                </div>
                {subscription.lastPaymentRecordedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Recorded on {formatDateTime(subscription.lastPaymentRecordedAt)}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Monthly Generation Quota Meter (API-OWN-06, CMP-12, TC-OWN-15) */}
        <div className="flex flex-col justify-between">
          {activeQuota ? (
            <QuotaMeterBar
              usedCount={activeQuota.usedCount}
              maxLimit={activeQuota.maxLimit}
              reservedCount={activeQuota.reservedCount}
              resetAt={activeQuota.resetAt}
              billingCycle={activeQuota.billingCycle}
              className="h-full"
            />
          ) : (
            <Card className="border border-border bg-card p-6 h-full flex flex-col justify-center items-center text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-surface-subtle flex items-center justify-center text-muted-foreground">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h2 className="font-semibold text-foreground text-sm">No Active Quota Ledger</h2>
              <p className="text-xs text-muted-foreground max-w-xs">
                No monthly quota ledger has been generated yet for this business. Once customer reviews begin, your 150-generation monthly ledger will appear here.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Card 3: Manual UPI Renewal & Support Guidance (Section 9 Safeguards) */}
      <Card className="border border-border bg-card shadow-xs" data-testid="manual-renewal-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground tracking-tight">
              Subscription Renewal & Upgrade Inquiries
            </h2>
            <Badge variant="outline" className="text-[11px] font-medium">
              Manual UPI Settlement
            </Badge>
          </div>
          <CardDescription className="text-xs leading-relaxed">
            QR_Review uses direct UPI settlement verified manually by the platform administrator. No automated recurring card charges or third-party debit mandates are used.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border border-border/50 bg-surface-subtle p-3 space-y-1">
              <span className="font-bold text-foreground block">1. Confirm Inquiry</span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Reach out to the founder to request a plan extension, transition from Pilot to Recurring, or add quota.
              </p>
            </div>

            <div className="rounded-md border border-border/50 bg-surface-subtle p-3 space-y-1">
              <span className="font-bold text-foreground block">2. Direct UPI Transfer</span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                The administrator provides the authorized destination UPI VPA directly. Settle via any standard UPI app.
              </p>
            </div>

            <div className="rounded-md border border-border/50 bg-surface-subtle p-3 space-y-1">
              <span className="font-bold text-foreground block">3. Manual Verification</span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                The administrator verifies the transaction reference and extends your subscription dates and quota.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/50">
            <p className="text-[11px] text-muted-foreground italic">
              Notice: If your quota is reached, customer scans continue to route directly to Google Reviews without interruption.
            </p>

            <Button
              variant="default"
              size="sm"
              onClick={() => setShowInquiryModal(true)}
              className="text-xs"
              data-testid="contact-founder-upgrade-btn"
            >
              Contact Founder for Renewal / Upgrade
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 4: Historical Billing Cycle Ledgers */}
      {quotaLedger.length > 0 && (
        <Card className="border border-border bg-card shadow-xs" data-testid="quota-history-card">
          <CardHeader className="pb-3">
            <h2 className="text-base font-semibold text-foreground tracking-tight">
              Billing Cycle History
            </h2>
            <CardDescription className="text-xs">
              Past monthly generation ledgers and historical consumption records.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Billing cycle history table">
              <table className="w-full text-left text-xs border-collapse" data-testid="quota-history-table">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-[11px] font-semibold uppercase">
                    <th className="py-2.5 px-3">Billing Cycle</th>
                    <th className="py-2.5 px-3">Generations Used</th>
                    <th className="py-2.5 px-3">Monthly Ceiling</th>
                    <th className="py-2.5 px-3">Remaining</th>
                    <th className="py-2.5 px-3">Rollover Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {quotaLedger.map((q) => {
                    const remaining = Math.max(0, q.maxLimit - q.usedCount - q.reservedCount);
                    const isCurrent = q.billingCycle === activeQuota?.billingCycle;
                    return (
                      <tr
                        key={q.id || q.billingCycle}
                        className={isCurrent ? 'bg-primary/5 font-medium' : 'text-foreground/90'}
                      >
                        <td className="py-2.5 px-3 flex items-center gap-1.5 font-mono">
                          {q.billingCycle}
                          {isCurrent && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              Current
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums font-semibold">
                          {q.usedCount}
                          {q.reservedCount > 0 && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-1">
                              (+{q.reservedCount})
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums">{q.maxLimit}</td>
                        <td className="py-2.5 px-3 tabular-nums text-muted-foreground">
                          {remaining}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground text-[11px]">
                          {formatDateTime(q.resetAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Renewal Inquiry Modal */}
      {showInquiryModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="inquiry-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          data-testid="inquiry-modal"
        >
          <div className="bg-card text-card-foreground border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 id="inquiry-modal-title" className="text-base font-bold text-foreground">
                Manual Renewal & Upgrades
              </h3>
              <button
                type="button"
                onClick={() => setShowInquiryModal(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
                aria-label="Close dialog"
                data-testid="close-inquiry-modal"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-foreground/90">
              <p>
                Subscription plans, renewals, and monthly AI generation quota expansions are coordinated directly with platform administration via manual UPI settlement during the pilot phase.
              </p>

              <div className="rounded-md border border-border bg-surface-subtle p-3 space-y-1.5">
                <span className="font-semibold text-foreground block">Venue Details:</span>
                <p className="text-[11px]">
                  <strong>Business:</strong> {business?.name || 'Local Venue'}
                </p>
                <p className="text-[11px]">
                  <strong>Current Tier:</strong> {planInfo.name} ({statusInfo.badgeLabel})
                </p>
                {business?.whatsappNumber && (
                  <p className="text-[11px]">
                    <strong>Registered WhatsApp:</strong> {business.whatsappNumber}
                  </p>
                )}
              </div>

              <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 text-[11px] text-amber-900 dark:text-amber-200">
                Official destination UPI VPA details are provided directly by platform administration upon verified request. No automated card debits or third-party gateways are active.
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Note: Dedicated platform support channels (support email and WhatsApp hotline) are pending founder configuration prior to pilot rollout. To request plan adjustments or quota additions, coordinate directly with your designated onboarding administrator.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowInquiryModal(false)}
                className="text-xs"
                data-testid="close-inquiry-modal-footer"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
