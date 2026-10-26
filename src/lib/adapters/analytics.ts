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
} from '../../types/domain';

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
