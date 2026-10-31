/**
 * Offline Adapter Verification Script (Task M1-T05 Batch C)
 *
 * Verifies bidirectional DTO transformations, privacy redactions, narrow merchant
 * update serialization, runtime JSON handling, quota derivations, conversion rate formulas,
 * and Supabase client configuration safety without live network or database connections.
 *
 * Run via: npm run test:adapters
 */

import {
  toBusinessDto,
  toPublicBusinessProjection,
  toBusinessUpdateRow,
  toBusinessUpdatePayload,
  toDestinationUpdatePayload,
  toSurveyOptionDto,
  toSurveyQuestionDto,
  toFeedbackDto,
  toCustomerFeedbackDto,
  toFeedbackSubmissionPayload,
  toQuotaDto,
  toTenantQuotaDto,
  toAnalyticsDto,
  toAnalyticsEventDto,
  toSubscriptionDto,
  toTrackEventPayload,
  toAnalyticsSummary,
  toOwnerDashboardMetrics,
} from '../src/lib/adapters/index.ts';

import {
  isSupabaseConfigured,
  getSupabaseClient,
  getSupabaseBrowserClient,
} from '../src/lib/supabase.ts';

import type {
  BusinessRow,
  SurveyQuestionRow,
  SurveyOptionRow,
  SurveyResponseRow,
  TenantQuotaRow,
  SubscriptionRow,
  AnalyticsEventRow,
} from '../src/types/database.ts';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${testName}`);
    if (details) {
      console.error(`    Details: ${details}`);
    }
  }
}

function assertEquals<T>(actual: T, expected: T, testName: string, details?: string): void {
  const isEqual = JSON.stringify(actual) === JSON.stringify(expected);
  assert(
    isEqual,
    testName,
    details || `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`,
  );
}

console.log('================================================================');
console.log('   M1-T05 OFFLINE ADAPTER & CLIENT VERIFICATION TEST SUITE');
console.log('================================================================\n');

/* -------------------------------------------------------------------------- */
/* Suite 1: Business DTO Adapter Tests                                        */
/* -------------------------------------------------------------------------- */
console.log('1. Business Adapter Suite:');

const MOCK_BUSINESS_ROW: BusinessRow = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  owner_id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
  category_id: 'salon',
  public_qr_id: 'abc123xyz0',
  vanity_slug: 'green-salon-koramangala',
  name: 'Green Salon & Spa',
  logo_url: 'https://cdn.example.com/logo.png',
  google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  google_review_url:
    'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
  whatsapp_number: '9876543210',
  account_status: 'active',
  is_active: true,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-21T12:00:00.000Z',
};

const businessDto = toBusinessDto(MOCK_BUSINESS_ROW);

assertEquals(businessDto.id, MOCK_BUSINESS_ROW.id, 'toBusinessDto maps id correctly');
assertEquals(
  businessDto.ownerId,
  MOCK_BUSINESS_ROW.owner_id,
  'toBusinessDto maps owner_id -> ownerId',
);
assertEquals(businessDto.categoryId, 'salon', 'toBusinessDto maps category_id -> categoryId');
assertEquals(businessDto.publicQrId, 'abc123xyz0', 'toBusinessDto maps public_qr_id -> publicQrId');
assertEquals(
  businessDto.vanitySlug,
  'green-salon-koramangala',
  'toBusinessDto maps vanity_slug -> vanitySlug',
);
assertEquals(businessDto.name, 'Green Salon & Spa', 'toBusinessDto maps name -> name');
assertEquals(
  businessDto.logoUrl,
  MOCK_BUSINESS_ROW.logo_url,
  'toBusinessDto maps logo_url -> logoUrl',
);
assertEquals(
  businessDto.googlePlaceId,
  MOCK_BUSINESS_ROW.google_place_id,
  'toBusinessDto maps google_place_id -> googlePlaceId',
);
assertEquals(
  businessDto.googleReviewUrl,
  MOCK_BUSINESS_ROW.google_review_url,
  'toBusinessDto maps google_review_url -> googleReviewUrl',
);
assertEquals(
  businessDto.whatsappNumber,
  '9876543210',
  'toBusinessDto maps whatsapp_number -> whatsappNumber',
);
assertEquals(
  businessDto.accountStatus,
  'active',
  'toBusinessDto maps account_status -> accountStatus',
);
assertEquals(businessDto.isActive, true, 'toBusinessDto maps is_active -> isActive');
assertEquals(
  businessDto.createdAt,
  MOCK_BUSINESS_ROW.created_at,
  'toBusinessDto maps created_at -> createdAt',
);

// Public QR projection mapping
const publicProjection = toPublicBusinessProjection({
  public_qr_id: 'abc123xyz0',
  name: 'Green Salon & Spa',
  logo_url: 'https://cdn.example.com/logo.png',
  category_id: 'salon',
  google_review_url: 'https://search.google.com/local/writereview?placeid=123',
  whatsapp_number: '9876543210',
  account_status: 'active',
  is_active: true,
  subscription_status: 'active',
});

assert(
  !('id' in publicProjection) && !('ownerId' in publicProjection),
  'toPublicBusinessProjection strips internal surrogate id and ownerId',
);
assertEquals(
  publicProjection.publicQrId,
  'abc123xyz0',
  'toPublicBusinessProjection maps publicQrId',
);
assertEquals(
  publicProjection.subscriptionStatus,
  'active',
  'toPublicBusinessProjection maps subscriptionStatus',
);
assertEquals(
  publicProjection.isDirectGoogleOnly,
  false,
  'toPublicBusinessProjection sets isDirectGoogleOnly to false for active subscription',
);
assertEquals(
  publicProjection.isSuspended,
  false,
  'toPublicBusinessProjection sets isSuspended to false for active account',
);

const pastDueProjection = toPublicBusinessProjection({
  public_qr_id: 'abc123xyz0',
  name: 'Past Due Cafe',
  logo_url: null,
  category_id: 'cafe',
  google_review_url: 'https://search.google.com/local/writereview?placeid=123',
  whatsapp_number: null,
  account_status: 'active',
  is_active: true,
  subscription_status: 'past_due',
});
assertEquals(
  pastDueProjection.isDirectGoogleOnly,
  true,
  'toPublicBusinessProjection flags isDirectGoogleOnly for past_due subscription',
);

const suspendedProjection = toPublicBusinessProjection({
  public_qr_id: 'abc123xyz0',
  name: 'Suspended Salon',
  logo_url: null,
  category_id: 'salon',
  google_review_url: null,
  whatsapp_number: null,
  account_status: 'suspended',
  is_active: true,
});
assertEquals(
  suspendedProjection.isSuspended,
  true,
  'toPublicBusinessProjection flags isSuspended for suspended account_status',
);

// Destination update mapping
const destinationPayload = toDestinationUpdatePayload({
  googleReviewUrl: 'https://search.google.com/local/writereview?placeid=new123',
});
assertEquals(
  destinationPayload.google_review_url,
  'https://search.google.com/local/writereview?placeid=new123',
  'toDestinationUpdatePayload maps googleReviewUrl -> google_review_url',
);

/* -------------------------------------------------------------------------- */
/* Suite 2: Narrow Merchant Profile Update Serialization & Allowlisting       */
/* -------------------------------------------------------------------------- */
console.log('\n2. Merchant Profile Update Serialization & Security Boundary:');

const safeUpdate = {
  name: 'Green Salon & Luxury Spa',
  vanitySlug: 'green-salon-luxury',
  whatsappNumber: '9876543211',
};

const serializedUpdate = toBusinessUpdateRow(safeUpdate);
assertEquals(serializedUpdate.name, 'Green Salon & Luxury Spa', 'toBusinessUpdateRow maps name');
assertEquals(
  serializedUpdate.vanity_slug,
  'green-salon-luxury',
  'toBusinessUpdateRow maps vanitySlug -> vanity_slug',
);
assertEquals(
  serializedUpdate.whatsapp_number,
  '9876543211',
  'toBusinessUpdateRow maps whatsappNumber -> whatsapp_number',
);

// Preserves nullability
const nullPhoneUpdate = toBusinessUpdateRow({ whatsappNumber: null });
assert(
  serializedUpdate !== undefined && nullPhoneUpdate.whatsapp_number === null,
  'toBusinessUpdateRow preserves explicit null for whatsapp_number',
);

// Security test: Malicious / Privileged Property Drop (TC-API-15)
const injectedUpdate = {
  name: 'Legit Name Change',
  ownerId: 'hacker-uuid',
  publicQrId: 'tampered-qr',
  categoryId: 'cafe',
  accountStatus: 'active',
  isActive: true,
  id: 'other-uuid',
  logoUrl: 'https://attacker.com/logo.png',
  googleReviewUrl: 'https://attacker.com/review',
};

const safeFilteredRow = toBusinessUpdateRow(injectedUpdate as unknown as typeof safeUpdate);
assert(
  !('owner_id' in safeFilteredRow) &&
    !('ownerId' in safeFilteredRow) &&
    !('public_qr_id' in safeFilteredRow) &&
    !('publicQrId' in safeFilteredRow) &&
    !('category_id' in safeFilteredRow) &&
    !('account_status' in safeFilteredRow) &&
    !('is_active' in safeFilteredRow) &&
    !('id' in safeFilteredRow) &&
    !('logo_url' in safeFilteredRow) &&
    !('google_review_url' in safeFilteredRow),
  'toBusinessUpdateRow strictly drops privileged and excluded fields at runtime',
);
assertEquals(
  Object.keys(safeFilteredRow),
  ['name'],
  'toBusinessUpdateRow only forwards allowlisted safe fields',
);

// Alias verification
assertEquals(
  toBusinessUpdatePayload(safeUpdate),
  serializedUpdate,
  'toBusinessUpdatePayload alias equals toBusinessUpdateRow',
);

/* -------------------------------------------------------------------------- */
/* Suite 3: Customer Feedback & Survey Question Adapter Tests                 */
/* -------------------------------------------------------------------------- */
console.log('\n3. Customer Feedback & Survey Question Suite:');

const MOCK_OPTION_ROW: SurveyOptionRow = {
  id: 'opt-001-uuid',
  question_id: 'q-001-uuid',
  option_text: 'Expert haircut & attentive styling',
  emoji_anchor: '💇',
  sentiment_label: 'positive',
  is_neutral_na: false,
  is_active: true,
  display_order: 1,
  created_at: '2026-10-20T10:00:00.000Z',
};

const optionDto = toSurveyOptionDto(MOCK_OPTION_ROW);
assertEquals(optionDto.id, 'opt-001-uuid', 'toSurveyOptionDto maps id correctly');
assertEquals(optionDto.questionId, 'q-001-uuid', 'toSurveyOptionDto maps questionId');
assertEquals(optionDto.emojiAnchor, '💇', 'toSurveyOptionDto maps emojiAnchor');
assertEquals(optionDto.sentimentLabel, 'positive', 'toSurveyOptionDto maps sentimentLabel');
assertEquals(optionDto.isNeutralNa, false, 'toSurveyOptionDto maps isNeutralNa');

const MOCK_QUESTION_ROW: SurveyQuestionRow = {
  id: 'q-001-uuid',
  category_id: 'salon',
  question_text: 'How was your haircut or service today?',
  display_order: 1,
  is_active: true,
  created_at: '2026-10-20T10:00:00.000Z',
};

const questionDto = toSurveyQuestionDto(MOCK_QUESTION_ROW, [MOCK_OPTION_ROW]);
assertEquals(questionDto.id, 'q-001-uuid', 'toSurveyQuestionDto maps question id');
assertEquals(questionDto.categoryId, 'salon', 'toSurveyQuestionDto maps categoryId');
assertEquals(questionDto.options?.length, 1, 'toSurveyQuestionDto embeds child options array');
assertEquals(
  questionDto.options?.[0]?.optionText,
  'Expert haircut & attentive styling',
  'toSurveyQuestionDto correctly transforms nested options',
);

// Feedback response mapping with valid JSON
const MOCK_FEEDBACK_ROW: SurveyResponseRow = {
  id: 'resp-001-uuid',
  business_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  category_id: 'salon',
  selected_options: [
    { questionId: 'q-001-uuid', optionId: 'opt-001-uuid' },
    { questionId: 'q-002-uuid', optionId: 'opt-005-uuid' },
    { questionId: 'q-003-uuid', optionId: 'opt-009-uuid' },
  ],
  affirmed_facts_snapshot: [
    {
      questionId: 'q-001-uuid',
      optionText: 'Expert haircut',
      sentimentLabel: 'positive',
    },
  ],
  optional_note: 'Loved the scalp massage!',
  session_uuid: 'session-uuid-1234',
  purged_at: null,
  created_at: '2026-10-20T11:00:00.000Z',
  is_generated: false,
  generation_attempts: 0,
};

const feedbackDto = toFeedbackDto(MOCK_FEEDBACK_ROW);
assertEquals(feedbackDto.id, 'resp-001-uuid', 'toFeedbackDto maps response id');
assertEquals(
  feedbackDto.selectedOptions.length,
  3,
  'toFeedbackDto safely parses selectedOptions array',
);
assertEquals(
  feedbackDto.optionalNote,
  'Loved the scalp massage!',
  'toFeedbackDto preserves active optionalNote',
);

// Alias verification
assertEquals(
  toCustomerFeedbackDto(MOCK_FEEDBACK_ROW),
  feedbackDto,
  'toCustomerFeedbackDto alias equals toFeedbackDto',
);

// Privacy Redaction Test (Founder Decision M0-01): purged_at clears note
const MOCK_PURGED_ROW: SurveyResponseRow = {
  ...MOCK_FEEDBACK_ROW,
  optional_note: 'Old note that should have been scrubbed',
  purged_at: '2026-11-20T00:00:00.000Z',
};

const purgedFeedbackDto = toFeedbackDto(MOCK_PURGED_ROW);
assertEquals(
  purgedFeedbackDto.optionalNote,
  null,
  'toFeedbackDto strictly redacts optionalNote to null when purged_at is populated',
);

// Malformed / stringified JSON handling
const MOCK_STRINGIFIED_ROW: SurveyResponseRow = {
  ...MOCK_FEEDBACK_ROW,
  selected_options: JSON.stringify([{ question_id: 'q-001-uuid', option_id: 'opt-001-uuid' }]),
  affirmed_facts_snapshot: JSON.stringify([
    {
      question_id: 'q-001-uuid',
      option_text: 'Expert haircut',
      sentiment_label: 'positive',
    },
  ]),
};

const stringifiedFeedbackDto = toFeedbackDto(MOCK_STRINGIFIED_ROW);
assertEquals(
  stringifiedFeedbackDto.selectedOptions.length,
  1,
  'toFeedbackDto handles stringified JSON and snake_case keys for selectedOptions',
);
assertEquals(
  stringifiedFeedbackDto.selectedOptions[0]?.questionId,
  'q-001-uuid',
  'toFeedbackDto narrows snake_case question_id -> questionId',
);

const MOCK_CORRUPT_ROW: SurveyResponseRow = {
  ...MOCK_FEEDBACK_ROW,
  selected_options: 'not-json{{{',
  affirmed_facts_snapshot: 12345 as unknown as SurveyResponseRow['affirmed_facts_snapshot'],
};

const corruptFeedbackDto = toFeedbackDto(MOCK_CORRUPT_ROW);
assertEquals(
  corruptFeedbackDto.selectedOptions,
  [],
  'toFeedbackDto safely recovers with empty array on invalid JSON without throwing',
);
assertEquals(
  corruptFeedbackDto.affirmedFactsSnapshot,
  [],
  'toFeedbackDto safely recovers on non-array affirmed_facts_snapshot',
);

// Feedback submission payload serialization with 150-char ceiling
const submission = {
  businessId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  categoryId: 'salon' as const,
  sessionUuid: 'session-123',
  responses: [{ questionId: 'q-001', optionId: 'opt-001' }],
  optionalNote: 'A'.repeat(200), // Exceeds 150-char cap
};

const submissionPayload = toFeedbackSubmissionPayload(submission);
assertEquals(
  submissionPayload.business_id,
  submission.businessId,
  'toFeedbackSubmissionPayload maps businessId -> business_id',
);
assertEquals(
  submissionPayload.optional_note?.length,
  150,
  'toFeedbackSubmissionPayload truncates optionalNote to max 150 chars (M0-01)',
);

/* -------------------------------------------------------------------------- */
/* Suite 4: Analytics, Subscription & Quota Adapter Tests                     */
/* -------------------------------------------------------------------------- */
console.log('\n4. Analytics, Subscription & Quota Suite:');

const MOCK_QUOTA_ROW: TenantQuotaRow = {
  id: 'quota-001-uuid',
  business_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  billing_cycle: '2026-10',
  max_limit: 150,
  used_count: 42,
  reserved_count: 3,
  reset_at: '2026-11-01T00:00:00.000Z',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
};

const quotaDto = toQuotaDto(MOCK_QUOTA_ROW);
assertEquals(quotaDto.id, 'quota-001-uuid', 'toQuotaDto maps quota id');
assertEquals(quotaDto.maxLimit, 150, 'toQuotaDto maps maxLimit');
assertEquals(quotaDto.usedCount, 42, 'toQuotaDto maps usedCount');
assertEquals(quotaDto.reservedCount, 3, 'toQuotaDto maps reservedCount');
assertEquals(
  quotaDto.remainingCount,
  105,
  'toQuotaDto derives remainingCount: Math.max(0, 150 - 42 - 3) = 105',
);

// Alias verification
assertEquals(
  toTenantQuotaDto(MOCK_QUOTA_ROW),
  quotaDto,
  'toTenantQuotaDto alias equals toQuotaDto',
);

// Quota exhaustion clamping: ensure non-negative lower bound
const MOCK_EXHAUSTED_QUOTA: TenantQuotaRow = {
  ...MOCK_QUOTA_ROW,
  used_count: 148,
  reserved_count: 5, // total 153 > 150 limit
};
const exhaustedQuotaDto = toQuotaDto(MOCK_EXHAUSTED_QUOTA);
assertEquals(
  exhaustedQuotaDto.remainingCount,
  0,
  'toQuotaDto clamps remainingCount to 0 when usage exceeds limit (no negative remaining)',
);

// Subscription mapping
const MOCK_SUBSCRIPTION_ROW: SubscriptionRow = {
  id: 'sub-001-uuid',
  business_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  plan_tier: 'standard_recurring',
  subscription_status: 'active',
  trial_ends_at: null,
  current_period_starts_at: '2026-10-01',
  current_period_ends_at: '2026-10-31',
  billing_currency: 'INR',
  last_payment_amount: 999.0,
  last_payment_recorded_at: '2026-10-01T10:00:00.000Z',
  payment_reference: 'UPI-REF-998877',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
};

const subDto = toSubscriptionDto(MOCK_SUBSCRIPTION_ROW);
assertEquals(subDto.planTier, 'standard_recurring', 'toSubscriptionDto maps planTier');
assertEquals(subDto.subscriptionStatus, 'active', 'toSubscriptionDto maps subscriptionStatus');
assertEquals(subDto.lastPaymentAmount, 999.0, 'toSubscriptionDto maps lastPaymentAmount');
assertEquals(subDto.paymentReference, 'UPI-REF-998877', 'toSubscriptionDto maps paymentReference');

// Analytics event mapping
const MOCK_EVENT_ROW: AnalyticsEventRow = {
  id: 'event-001-uuid',
  business_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  event_name: 'EVENT_QR_PAGE_VIEW',
  session_uuid: 'session-uuid-1',
  user_agent_category: 'mobile',
  deduplication_key: 'dedup-hash-1',
  created_at: '2026-10-20T10:00:00.000Z',
};

const eventDto = toAnalyticsDto(MOCK_EVENT_ROW);
assertEquals(eventDto.eventName, 'EVENT_QR_PAGE_VIEW', 'toAnalyticsDto maps eventName');
assertEquals(eventDto.userAgentCategory, 'mobile', 'toAnalyticsDto maps userAgentCategory');
assertEquals(
  toAnalyticsEventDto(MOCK_EVENT_ROW),
  eventDto,
  'toAnalyticsEventDto alias equals toAnalyticsDto',
);

const trackPayload = toTrackEventPayload({
  businessId: 'biz-123',
  eventName: 'EVENT_COPY_SUCCESS',
  sessionUuid: 'sess-123',
  userAgentCategory: 'mobile',
});
assertEquals(trackPayload.business_id, 'biz-123', 'toTrackEventPayload maps business_id');
assertEquals(trackPayload.event_name, 'EVENT_COPY_SUCCESS', 'toTrackEventPayload maps event_name');

// Analytics conversion aggregation per API_SPEC §15.2
const MOCK_EVENTS_LIST: Pick<AnalyticsEventRow, 'event_name'>[] = [
  ...Array(100).fill({ event_name: 'EVENT_QR_PAGE_VIEW' }),
  ...Array(80).fill({ event_name: 'EVENT_SURVEY_COMPLETED' }),
  ...Array(60).fill({ event_name: 'EVENT_GENERATION_REQUESTED' }),
  ...Array(50).fill({ event_name: 'EVENT_GENERATION_SUCCESS' }),
  ...Array(30).fill({ event_name: 'EVENT_COPY_SUCCESS' }),
  ...Array(20).fill({ event_name: 'EVENT_GOOGLE_REDIRECT_CLICK' }),
  ...Array(10).fill({ event_name: 'EVENT_GOOGLE_BYPASS_CLICK' }),
];

const summary = toAnalyticsSummary(MOCK_EVENTS_LIST);

assertEquals(summary.qrPageViews, 100, 'toAnalyticsSummary counts EVENT_QR_PAGE_VIEW');
assertEquals(summary.surveysCompleted, 80, 'toAnalyticsSummary counts EVENT_SURVEY_COMPLETED');
assertEquals(
  summary.generationsRequested,
  60,
  'toAnalyticsSummary counts EVENT_GENERATION_REQUESTED',
);
assertEquals(summary.generationsSuccess, 50, 'toAnalyticsSummary counts EVENT_GENERATION_SUCCESS');
assertEquals(summary.copySuccess, 30, 'toAnalyticsSummary counts EVENT_COPY_SUCCESS');
assertEquals(
  summary.googleRedirectClicks,
  20,
  'toAnalyticsSummary counts EVENT_GOOGLE_REDIRECT_CLICK',
);
assertEquals(summary.googleBypassClicks, 10, 'toAnalyticsSummary counts EVENT_GOOGLE_BYPASS_CLICK');

// Formula validation
assertEquals(
  summary.completionRate,
  0.8, // 80 / 100
  'toAnalyticsSummary calculates completionRate = surveysCompleted / qrPageViews',
);
assertEquals(
  summary.draftSuccessRate,
  0.625, // 50 / 80
  'toAnalyticsSummary calculates draftSuccessRate = generationsSuccess / surveysCompleted',
);
assertEquals(
  summary.copyRate,
  0.6, // 30 / 50
  'toAnalyticsSummary calculates copyRate = copySuccess / generationsSuccess',
);
assertEquals(
  summary.assistedHandoffRate,
  20 / 30, // 20 / 30 ≈ 0.6666...
  'toAnalyticsSummary calculates assistedHandoffRate = googleRedirectClicks / copySuccess',
);
assertEquals(
  summary.directBypassRate,
  0.1, // 10 / 100
  'toAnalyticsSummary calculates directBypassRate = googleBypassClicks / qrPageViews',
);
assertEquals(
  summary.totalHandoffRate,
  0.3, // (20 + 10) / 100
  'toAnalyticsSummary calculates totalHandoffRate = (redirect + bypass) / qrPageViews',
);

// Zero-division safety test
const zeroSummary = toAnalyticsSummary([]);
assert(
  zeroSummary.completionRate === 0 &&
    zeroSummary.draftSuccessRate === 0 &&
    zeroSummary.copyRate === 0 &&
    zeroSummary.assistedHandoffRate === 0 &&
    zeroSummary.directBypassRate === 0 &&
    zeroSummary.totalHandoffRate === 0,
  'toAnalyticsSummary protects against zero division without NaN or Infinity',
);

// Dashboard metrics combination
const dashboardMetrics = toOwnerDashboardMetrics(MOCK_EVENTS_LIST, MOCK_QUOTA_ROW);
assertEquals(
  dashboardMetrics.monthlyQuotaLimit,
  150,
  'toOwnerDashboardMetrics includes monthlyQuotaLimit',
);
assertEquals(
  dashboardMetrics.generationsUsed,
  42,
  'toOwnerDashboardMetrics includes generationsUsed',
);
assertEquals(
  dashboardMetrics.generationsRemaining,
  105,
  'toOwnerDashboardMetrics includes generationsRemaining',
);
assertEquals(dashboardMetrics.completionRate, 0.8, 'toOwnerDashboardMetrics includes funnel rates');

/* -------------------------------------------------------------------------- */
/* Suite 5: Supabase Client Configuration & Missing-Config Safety             */
/* -------------------------------------------------------------------------- */
console.log('\n5. Supabase Client Configuration Safety Suite:');

// Probe missing configuration behavior
const configured = isSupabaseConfigured();
assert(
  configured === false,
  'isSupabaseConfigured returns false when environment variables are unset in test environment',
);

// Invariant: Importing does not throw (already verified by reaching here)
assert(
  typeof getSupabaseClient === 'function' && typeof getSupabaseBrowserClient === 'function',
  'Supabase client accessors are functions and safe to import without live config',
);

// Invariant: Calling getSupabaseClient without config throws descriptive error
let clientErrorCaught = false;
let clientErrorMessage = '';
try {
  getSupabaseClient();
} catch (err) {
  clientErrorCaught = true;
  clientErrorMessage = (err as Error).message;
}

assert(
  clientErrorCaught === true,
  'getSupabaseClient() throws when invoked without environment variables',
);
assert(
  clientErrorMessage.includes('Missing VITE_SUPABASE_URL'),
  'getSupabaseClient() error message explains missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY',
);

/* -------------------------------------------------------------------------- */
/* Final Summary                                                              */
/* -------------------------------------------------------------------------- */
console.log('\n================================================================');
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log('================================================================');

if (failedTests > 0) {
  console.error('\nVerification FAILED with errors.');
  process.exit(1);
} else {
  console.log('\nVerification PASSED: All 5 adapter suites passed with 100% success.');
  process.exit(0);
}
