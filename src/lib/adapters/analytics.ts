/**
 * Analytics, Quota & Subscription DTO Adapters
 *
 * Source: docs/API_SPEC.md (v1.2) §9, §11.4, §11.6, §15, §16.1; docs/DATABASE_SCHEMA.md (v1.1) §5.6, §5.7, §5.8
 *
 * Maps high-velocity telemetry events, monthly quota balances, and commercial subscriptions.
 * Enforces attribution boundaries:
 * - Assisted Google redirect clicks never equal confirmed published reviews (API_SPEC §10.2)
 * - Conversion denominators adhere strictly to the standardized formulas in API_SPEC §15.2
 */

import type { AnalyticsEventRow, TenantQuotaRow, SubscriptionRow } from '../../types/database';
import type {
  AnalyticsEvent,
  TrackEventPayload,
  TenantQuota,
  Subscription,
  AnalyticsSummary,
  OwnerDashboardMetrics,
  DashboardAnalyticsPeriod,
  OwnerDashboardFunnelMetrics,
  OwnerDashboardQuota,
  OwnerDashboardResponse,
} from '../../types/domain';

export const CANONICAL_ATTRIBUTION_DISCLAIMER =
  'Google Maps does not notify third-party platforms when reviews are published. Outbound clicks represent high-intent customer handoffs, not confirmed reviews.';

export const CANONICAL_GOOGLE_HANDOFF_DISCLAIMER =
  'Google handoff clicks measure customers directed to Google Maps. Actual review publication is not tracked.';

/**
 * Maps a raw PostgreSQL analytics_events row to AnalyticsEvent DTO.
 */
export function toAnalyticsEventDto(row: AnalyticsEventRow): AnalyticsEvent {
  return {
    id: row.id,
    businessId: row.business_id,
    eventName: row.event_name,
    sessionUuid: row.session_uuid,
    userAgentCategory: row.user_agent_category,
    deduplicationKey: row.deduplication_key,
    createdAt: row.created_at,
  };
}

/**
 * Explicit alias matching M1-T05 prompt convention.
 */
export const toAnalyticsDto = toAnalyticsEventDto;

/**
 * Serializes a frontend TrackEventPayload into the API-PUB-05 wire body.
 */
export function toTrackEventPayload(payload: TrackEventPayload): {
  business_id: string;
  event_name: string;
  session_uuid: string;
  user_agent_category: string;
} {
  return {
    business_id: payload.businessId,
    event_name: payload.eventName,
    session_uuid: payload.sessionUuid,
    user_agent_category: payload.userAgentCategory,
  };
}

/**
 * Maps a raw tenant_quotas row to TenantQuota DTO, computing derived remainingCount.
 */
export function toTenantQuotaDto(row: TenantQuotaRow): TenantQuota {
  const remainingCount = Math.max(0, row.max_limit - row.used_count - row.reserved_count);

  return {
    id: row.id,
    businessId: row.business_id,
    billingCycle: row.billing_cycle,
    maxLimit: row.max_limit,
    usedCount: row.used_count,
    reservedCount: row.reserved_count,
    resetAt: row.reset_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    remainingCount,
  };
}

/**
 * Explicit alias matching M1-T05 prompt convention.
 */
export const toQuotaDto = toTenantQuotaDto;

/**
 * Maps a raw subscriptions row to Subscription DTO.
 */
export function toSubscriptionDto(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    businessId: row.business_id,
    planTier: row.plan_tier,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodStartsAt: row.current_period_starts_at,
    currentPeriodEndsAt: row.current_period_ends_at,
    billingCurrency: row.billing_currency,
    lastPaymentAmount: row.last_payment_amount,
    lastPaymentRecordedAt: row.last_payment_recorded_at,
    paymentReference: row.payment_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Aggregates a list of raw event names into the standardized AnalyticsSummary.
 *
 * FORMULA SPECIFICATION (API_SPEC §15.2):
 * - Survey Completion Rate = surveysCompleted / qrPageViews
 * - Draft Success Rate = generationsSuccess / surveysCompleted
 * - Clipboard Copy Rate = copySuccess / generationsSuccess
 * - Assisted Google Handoff Rate = googleRedirectClicks / copySuccess
 * - Direct Bypass Rate = googleBypassClicks / qrPageViews
 * - Total Google Handoff Rate = (googleRedirectClicks + googleBypassClicks) / qrPageViews
 */
export function toAnalyticsSummary(
  events: Pick<AnalyticsEventRow, 'event_name'>[],
): AnalyticsSummary {
  let qrPageViews = 0;
  let surveysCompleted = 0;
  let generationsRequested = 0;
  let generationsSuccess = 0;
  let copySuccess = 0;
  let googleRedirectClicks = 0;
  let googleBypassClicks = 0;

  for (const event of events) {
    switch (event.event_name) {
      case 'EVENT_QR_PAGE_VIEW':
        qrPageViews++;
        break;
      case 'EVENT_SURVEY_COMPLETED':
        surveysCompleted++;
        break;
      case 'EVENT_GENERATION_REQUESTED':
        generationsRequested++;
        break;
      case 'EVENT_GENERATION_SUCCESS':
        generationsSuccess++;
        break;
      case 'EVENT_COPY_SUCCESS':
        copySuccess++;
        break;
      case 'EVENT_GOOGLE_REDIRECT_CLICK':
        googleRedirectClicks++;
        break;
      case 'EVENT_GOOGLE_BYPASS_CLICK':
        googleBypassClicks++;
        break;
      default:
        // Ignore unclassified or intermediate telemetry events (e.g., EVENT_COPY_ATTEMPTED)
        break;
    }
  }

  const completionRate = qrPageViews > 0 ? surveysCompleted / qrPageViews : 0;
  const draftSuccessRate = surveysCompleted > 0 ? generationsSuccess / surveysCompleted : 0;
  const copyRate = generationsSuccess > 0 ? copySuccess / generationsSuccess : 0;
  const assistedHandoffRate = copySuccess > 0 ? googleRedirectClicks / copySuccess : 0;
  const directBypassRate = qrPageViews > 0 ? googleBypassClicks / qrPageViews : 0;
  const totalHandoffRate =
    qrPageViews > 0 ? (googleRedirectClicks + googleBypassClicks) / qrPageViews : 0;

  return {
    qrPageViews,
    surveysCompleted,
    generationsRequested,
    generationsSuccess,
    copySuccess,
    googleRedirectClicks,
    googleBypassClicks,
    completionRate,
    draftSuccessRate,
    copyRate,
    assistedHandoffRate,
    directBypassRate,
    totalHandoffRate,
  };
}

/**
 * Combines aggregated event analytics with a merchant's active quota ledger row
 * to assemble the full OwnerDashboardMetrics object (API-OWN-04).
 */
export function toOwnerDashboardMetrics(
  events: Pick<AnalyticsEventRow, 'event_name'>[],
  quota: TenantQuotaRow,
): OwnerDashboardMetrics {
  const summary = toAnalyticsSummary(events);
  const generationsRemaining = Math.max(
    0,
    quota.max_limit - quota.used_count - quota.reserved_count,
  );

  return {
    ...summary,
    monthlyQuotaLimit: quota.max_limit,
    generationsUsed: quota.used_count,
    generationsRemaining,
  };
}

/**
 * Builds the canonical API-OWN-04 response structure either from an API/Edge Function payload
 * or from raw database event rows and quota state.
 */
export function toOwnerDashboardResponse(raw: unknown): OwnerDashboardResponse;
export function toOwnerDashboardResponse(
  businessId: string,
  period: DashboardAnalyticsPeriod,
  events: Pick<AnalyticsEventRow, 'event_name'>[],
  quota?: TenantQuotaRow | null,
): OwnerDashboardResponse;
export function toOwnerDashboardResponse(
  rawOrBusinessId: unknown,
  maybePeriod?: DashboardAnalyticsPeriod,
  maybeEvents?: Pick<AnalyticsEventRow, 'event_name'>[],
  maybeQuota?: TenantQuotaRow | null,
): OwnerDashboardResponse {
  if (typeof rawOrBusinessId === 'object' && rawOrBusinessId !== null) {
    const raw = rawOrBusinessId as Record<string, unknown>;
    const businessId = String(raw.businessId || raw.business_id || '');
    const period = (raw.period as DashboardAnalyticsPeriod) || '30d';

    const sourceMetrics = (raw.metrics || raw.funnel || {}) as Record<string, unknown>;

    const qrVisits = Number(
      sourceMetrics.qrVisits ??
        sourceMetrics.qr_visits ??
        sourceMetrics.qrPageViews ??
        sourceMetrics.qr_page_views ??
        0,
    );
    const surveysCompleted = Number(
      sourceMetrics.surveysCompleted ?? sourceMetrics.surveys_completed ?? 0,
    );
    const surveyCompletionRate = Number(
      sourceMetrics.surveyCompletionRate ??
        sourceMetrics.survey_completion_rate ??
        sourceMetrics.completionRate ??
        0,
    );
    const reviewsDrafted = Number(
      sourceMetrics.reviewsDrafted ??
        sourceMetrics.reviews_drafted ??
        sourceMetrics.generationsSuccess ??
        sourceMetrics.generations_success ??
        0,
    );
    const draftSuccessRate = Number(
      sourceMetrics.draftSuccessRate ?? sourceMetrics.draft_success_rate ?? 0,
    );
    const clipboardCopies = Number(
      sourceMetrics.clipboardCopies ??
        sourceMetrics.clipboard_copies ??
        sourceMetrics.copySuccess ??
        sourceMetrics.copy_success ??
        0,
    );
    const copyRate = Number(
      sourceMetrics.copyRate ??
        sourceMetrics.copy_rate ??
        sourceMetrics.clipboard_copy_rate ??
        0,
    );
    const googleHandoffClicks = Number(
      sourceMetrics.googleHandoffClicks ??
        sourceMetrics.google_handoff_clicks ??
        sourceMetrics.googleRedirectClicks ??
        sourceMetrics.google_redirect_clicks ??
        0,
    );
    const handoffRate = Number(
      sourceMetrics.handoffRate ??
        sourceMetrics.handoff_rate ??
        sourceMetrics.assistedHandoffRate ??
        sourceMetrics.assisted_handoff_rate ??
        sourceMetrics.google_handoff_rate ??
        0,
    );
    const directBypassClicks = Number(
      sourceMetrics.directBypassClicks ??
        sourceMetrics.direct_bypass_clicks ??
        sourceMetrics.googleBypassClicks ??
        sourceMetrics.google_bypass_clicks ??
        0,
    );
    const directBypassRate = Number(
      sourceMetrics.directBypassRate ?? sourceMetrics.direct_bypass_rate ?? 0,
    );
    const totalHandoffRate = Number(
      sourceMetrics.totalHandoffRate ?? sourceMetrics.total_handoff_rate ?? 0,
    );
    const generationsRequested = Number(
      sourceMetrics.generationsRequested ?? sourceMetrics.generations_requested ?? 0,
    );

    const metrics: OwnerDashboardFunnelMetrics = {
      qrVisits,
      qrPageViews: qrVisits,
      surveysCompleted,
      surveyCompletionRate,
      completionRate: surveyCompletionRate,
      reviewsDrafted,
      generationsSuccess: reviewsDrafted,
      generationsRequested,
      draftSuccessRate,
      clipboardCopies,
      copySuccess: clipboardCopies,
      copyRate,
      googleHandoffClicks,
      googleRedirectClicks: googleHandoffClicks,
      handoffRate,
      assistedHandoffRate: handoffRate,
      directBypassClicks,
      directBypassRate,
      totalHandoffRate,
    };

    let quota: OwnerDashboardQuota | undefined = undefined;
    if (raw.quota && typeof raw.quota === 'object') {
      const q = raw.quota as Record<string, unknown>;
      const maxLimit = Number(q.monthlyQuotaLimit ?? q.max_limit ?? 0);
      const usedCount = Number(q.generationsUsed ?? q.used_count ?? 0);
      const reservedCount = Number(q.reserved_count ?? 0);
      const remainingCount =
        q.generationsRemaining !== undefined
          ? Number(q.generationsRemaining)
          : Math.max(0, maxLimit - usedCount - reservedCount);

      quota = {
        billingCycle: String(q.billingCycle || q.billing_cycle || ''),
        monthlyQuotaLimit: maxLimit,
        maxLimit,
        generationsUsed: usedCount,
        usedCount,
        generationsRemaining: remainingCount,
        resetDate: String(q.resetDate || q.reset_at || ''),
      };
    }

    return {
      businessId,
      period,
      metrics,
      funnel: metrics,
      quota,
      disclaimer: String(
        raw.disclaimer || raw.attribution_disclaimer || CANONICAL_ATTRIBUTION_DISCLAIMER,
      ),
    };
  }

  const businessId = String(rawOrBusinessId);
  const period = maybePeriod || '30d';
  const events = maybeEvents || [];
  const quotaRow = maybeQuota;

  const summary = toAnalyticsSummary(events);

  const metrics: OwnerDashboardFunnelMetrics = {
    qrVisits: summary.qrPageViews,
    qrPageViews: summary.qrPageViews,
    surveysCompleted: summary.surveysCompleted,
    surveyCompletionRate: summary.completionRate,
    completionRate: summary.completionRate,
    reviewsDrafted: summary.generationsSuccess,
    generationsSuccess: summary.generationsSuccess,
    generationsRequested: summary.generationsRequested,
    draftSuccessRate: summary.draftSuccessRate,
    clipboardCopies: summary.copySuccess,
    copySuccess: summary.copySuccess,
    copyRate: summary.copyRate,
    googleHandoffClicks: summary.googleRedirectClicks,
    googleRedirectClicks: summary.googleRedirectClicks,
    handoffRate: summary.assistedHandoffRate,
    assistedHandoffRate: summary.assistedHandoffRate,
    directBypassClicks: summary.googleBypassClicks,
    directBypassRate: summary.directBypassRate,
    totalHandoffRate: summary.totalHandoffRate,
  };

  const quotaDto: OwnerDashboardQuota | undefined = quotaRow
    ? {
        billingCycle: quotaRow.billing_cycle,
        monthlyQuotaLimit: quotaRow.max_limit,
        maxLimit: quotaRow.max_limit,
        generationsUsed: quotaRow.used_count,
        usedCount: quotaRow.used_count,
        generationsRemaining: Math.max(0, quotaRow.max_limit - quotaRow.used_count - quotaRow.reserved_count),
        resetDate: quotaRow.reset_at,
      }
    : undefined;

  return {
    businessId,
    period,
    metrics,
    funnel: metrics,
    quota: quotaDto,
    disclaimer: CANONICAL_ATTRIBUTION_DISCLAIMER,
  };
}

/**
 * Formats a conversion decimal rate [0, 1] into a user-friendly percentage string.
 */
export function formatPercentage(rate: number, decimals = 1): string {
  if (!Number.isFinite(rate) || rate < 0) return '0.0%';
  return `${(rate * 100).toFixed(decimals)}%`;
}

export type {
  DashboardAnalyticsPeriod,
  OwnerDashboardFunnelMetrics,
  OwnerDashboardQuota,
  OwnerDashboardResponse,
};
