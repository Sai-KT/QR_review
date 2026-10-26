/**
 * Frontend Domain Models and DTOs
 *
 * Source: docs/DATABASE_SCHEMA.md (v1.1), docs/API_SPEC.md (v1.2), docs/UI_UX.md (v1.1)
 *
 * Translates PostgreSQL snake_case database schema into clean, idiomatic camelCase
 * domain objects for UI presentation and form handling.
 *
 * Enforces security boundaries:
 * - Safe editable fields vs immutable / admin-only fields on Business (FR-OWNER-002)
 * - Anti-gating and authentic survey flow invariants
 */

import type { Json } from './database';

/* -------------------------------------------------------------------------- */
/* Business Verticals & Category Domain Types                                  */
/* -------------------------------------------------------------------------- */

export type BusinessCategoryType = 'salon' | 'cafe';

export interface BusinessCategory {
  id: BusinessCategoryType;
  displayName: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Business Tenant & Safe Field Boundaries                                     */
/* -------------------------------------------------------------------------- */

export type AccountStatus = 'active' | 'pilot' | 'suspended';

/**
 * Full business entity consumed by authenticated merchant owners and super-admins.
 */
export interface Business {
  id: string;
  ownerId: string;
  categoryId: BusinessCategoryType;
  publicQrId: string;
  vanitySlug: string;
  name: string;
  logoUrl: string | null;
  googlePlaceId: string | null;
  googleReviewUrl: string | null;
  whatsappNumber: string | null;
  accountStatus: AccountStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Safe fields editable by authenticated merchant owners (FR-OWNER-002 / API-OWN-02).
 * Hardware-locked and admin-guarded fields (publicQrId, ownerId, categoryId, accountStatus, isActive)
 * are strictly omitted to enforce security boundaries at compile-time.
 * Note: Google destination URL is updated via dedicated gateway API-OWN-03.
 */
export interface BusinessProfileUpdate {
  name?: string;
  vanitySlug?: string;
  whatsappNumber?: string | null;
  logoUrl?: string | null;
}

/**
 * Payload for updating Google Review destination URL via dedicated gateway (API-OWN-03).
 */
export interface DestinationUpdate {
  googleReviewUrl: string;
}

/**
 * Public business projection delivered to anonymous patrons scanning QR codes (API-PUB-01 / SCR-CUST-01).
 * Never exposes ownerId, surrogate business database ID, or billing details.
 */
export interface PublicBusinessProjection {
  publicQrId: string;
  name: string;
  logoUrl: string | null;
  categoryId: BusinessCategoryType;
  googleReviewUrl: string | null;
  whatsappNumber: string | null;
  accountStatus: AccountStatus;
  isActive: boolean;
  subscriptionStatus: SubscriptionStatus;
}

/* -------------------------------------------------------------------------- */
/* Survey Questions & Options Domain Types                                    */
/* -------------------------------------------------------------------------- */

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface SurveyOption {
  id: string;
  questionId: string;
  optionText: string;
  emojiAnchor: string;
  sentimentLabel: SentimentLabel;
  isNeutralNa: boolean;
  isActive: boolean;
  displayOrder: number;
  createdAt?: string;
}

export interface SurveyQuestion {
  id: string;
  categoryId: BusinessCategoryType;
  questionText: string;
  displayOrder: number;
  isActive: boolean;
  createdAt?: string;
  options?: SurveyOption[];
}

/* -------------------------------------------------------------------------- */
/* Customer Survey Feedback & Submission Contracts                            */
/* -------------------------------------------------------------------------- */

export interface SelectedSurveyOption {
  questionId: string;
  optionId: string;
}

export interface AffirmedFact {
  questionId: string;
  optionText: string;
  sentimentLabel: SentimentLabel;
}

/**
 * Validated customer survey submission payload (API-PUB-04 / SCR-CUST-05).
 * Free-text note is length-capped to 150 characters per Founder Decision M0-01.
 */
export interface CustomerFeedbackSubmission {
  businessId: string;
  categoryId: BusinessCategoryType;
  sessionUuid: string;
  responses: SelectedSurveyOption[];
  optionalNote: string | null;
}

export interface CustomerFeedbackSubmissionResult {
  responseId: string;
  submissionToken: string;
  expiresAt: string;
}

/**
 * Customer feedback item rendered in merchant dashboard feedback feed (API-OWN-05 / SCR-OWN-08).
 */
export interface CustomerFeedback {
  id: string;
  businessId: string;
  categoryId: BusinessCategoryType;
  selectedOptions: SelectedSurveyOption[];
  affirmedFactsSnapshot: AffirmedFact[] | Json;
  optionalNote: string | null;
  sessionUuid: string;
  purgedAt: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* AI Review Draft Contracts (API-PUB-03)                                     */
/* -------------------------------------------------------------------------- */

export interface ReviewDraftRequest {
  responseId: string;
  submissionToken: string;
  idempotencyKey: string;
}

export interface ReviewDraftResult {
  reviewDraft: string;
  wordCount: number;
  sentiment: 'positive' | 'mixed' | 'neutral';
  isFallback: boolean;
}

/* -------------------------------------------------------------------------- */
/* Analytics Telemetry & Event Taxonomy                                       */
/* -------------------------------------------------------------------------- */

export type AnalyticsEventName =
  | 'EVENT_QR_PAGE_VIEW'
  | 'EVENT_SURVEY_COMPLETED'
  | 'EVENT_GENERATION_REQUESTED'
  | 'EVENT_GENERATION_SUCCESS'
  | 'EVENT_COPY_ATTEMPTED'
  | 'EVENT_COPY_SUCCESS'
  | 'EVENT_GOOGLE_REDIRECT_CLICK'
  | 'EVENT_GOOGLE_BYPASS_CLICK';

export type UserAgentCategory = 'mobile' | 'desktop' | 'tablet';

export interface AnalyticsEvent {
  id: string;
  businessId: string;
  eventName: AnalyticsEventName;
  sessionUuid: string;
  userAgentCategory: UserAgentCategory;
  deduplicationKey: string;
  createdAt: string;
}

export interface TrackEventPayload {
  businessId: string;
  eventName: AnalyticsEventName;
  sessionUuid: string;
  userAgentCategory: UserAgentCategory;
  timestamp?: string;
}

/* -------------------------------------------------------------------------- */
/* Commercial Subscriptions & Quota Ledger                                    */
/* -------------------------------------------------------------------------- */

export type PlanTier = 'setup_package' | 'standard_recurring';

export type SubscriptionStatus = 'pilot' | 'active' | 'past_due' | 'canceled';

export interface Subscription {
  id: string;
  businessId: string;
  planTier: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodStartsAt: string;
  currentPeriodEndsAt: string;
  billingCurrency: string;
  lastPaymentAmount: number | null;
  lastPaymentRecordedAt: string | null;
  paymentReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReservationStatus = 'pending' | 'committed' | 'released' | 'expired';

/**
 * Quota representation matching tenant_quotas ledger.
 * Note on derived values: `remainingCount` is a computed property, not a database column.
 * Formula: `Math.max(0, maxLimit - usedCount - reservedCount)`
 */
export interface TenantQuota {
  id: string;
  businessId: string;
  billingCycle: string;
  maxLimit: number;
  usedCount: number;
  reservedCount: number;
  resetAt: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Optional client-derived remaining quota calculation:
   * Math.max(0, maxLimit - usedCount - reservedCount)
   */
  remainingCount?: number;
}

export interface QuotaReservation {
  id: string;
  businessId: string;
  quotaId: string;
  responseId?: string;
  idempotencyKey: string;
  payloadHash: string;
  status: ReservationStatus;
  tokensBilled: number;
  rawDraft?: string | null;
  ttlExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Frontend Analytics Summary & Merchant Metrics (FR-OWNER-005 / API-OWN-04)  */
/* -------------------------------------------------------------------------- */

/**
 * Frontend analytics funnel summary aggregated from analytics_events (API-OWN-04).
 * Denominators and rates adhere strictly to API_SPEC §15.2.
 */
export interface AnalyticsSummary {
  qrPageViews: number;
  surveysCompleted: number;
  generationsRequested: number;
  generationsSuccess: number;
  copySuccess: number;
  googleRedirectClicks: number;
  googleBypassClicks: number;
  completionRate: number;
  draftSuccessRate: number;
  copyRate: number;
  assistedHandoffRate: number;
  directBypassRate: number;
  totalHandoffRate: number;
}

export interface OwnerDashboardMetrics extends AnalyticsSummary {
  monthlyQuotaLimit: number;
  generationsUsed: number;
  generationsRemaining: number;
}

/* -------------------------------------------------------------------------- */
/* Canonical Error Envelope (API_SPEC §17)                                    */
/* -------------------------------------------------------------------------- */

export interface ApiError {
  code: string;
  message: string;
  correlationId: string;
  retryable: boolean;
}

export interface ApiErrorEnvelope {
  error: ApiError;
}

/* -------------------------------------------------------------------------- */
/* Administrative Domain Types (Super-Admin Console)                          */
/* -------------------------------------------------------------------------- */

export type AdminRole = 'super_admin';

export type ActorRole = 'super_admin' | 'owner' | 'system';

export interface AdminUser {
  userId: string;
  role: AdminRole;
  isActive: boolean;
  mfaEnforced: boolean;
  createdAt: string;
}

export interface AdminAuditLog {
  id: string;
  actorUserId: string | null;
  actorRole: ActorRole;
  targetBusinessId: string | null;
  action: string;
  payloadBefore: Json | null;
  payloadAfter: Json | null;
  ipHash: string | null;
  createdAt: string;
}
