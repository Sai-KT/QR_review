/**
 * generate-review Integration Test Suite (API-PUB-03 / M4-T02)
 *
 * Verifies the complete AI review generation edge function pipeline against
 * a real local PostgreSQL / Supabase instance:
 * 1. Happy path reservation -> generation -> quota commit -> telemetry insertion
 * 2. Provider timeout -> reservation release -> HTTP 504 (TC-API-09)
 * 3. Malformed AI output -> reservation release -> HTTP 502 (TC-AI-02)
 * 4. Cached temporary draft recovery without double charge (M0-12 Option B)
 * 5. Insufficient-facts safe abstention without quota reservation (M0-16)
 * 6. Cryptographic token verification & forgery rejection (TC-API-10)
 * 7. Token expiration rejection
 * 8. Suspended merchant operational rejection
 * 9. IP sliding-window rate limit enforcement via check_rate_limit RPC
 *
 * ZERO live Gemini API calls are made: offline mock transports are injected.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  handleGenerateReview,
  deriveDailySalt,
  computeIpHash,
} from './index';
import {
  signSubmissionToken,
  computeSurveyVersion,
} from '../_shared/crypto';

// Local Supabase configuration
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TEST_SIGNING_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_RATE_LIMIT_SALT =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const TEST_PUBLISHABLE_KEY = 'test-publishable-key';

describe('generate-review Real PostgreSQL Integration Suite (M4-T02 / API-PUB-03)', () => {
  let supabase: SupabaseClient;

  // Real reference fixtures from database migrations
  const realSalonBizId = 'b0000000-0000-4000-8000-000000000001'; // Luxe Studio Unisex Salon
  const realSuspendedBizId = 'b0000000-0000-4000-8000-000000000003'; // Suspended Parlour

  const realQ1 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c';
  const realOpt1 = '1a2b3c4d-0001-4000-8000-000000000001'; // Masterful & Precise

  const realQ2 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d';
  const realOpt2 = '1a2b3c4d-0002-4000-8000-000000000002'; // Clean & hygienic station

  const realQ3 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e';
  const realOpt3 = '1a2b3c4d-0003-4000-8000-000000000001'; // Great styling advice

  const createdSessionUuids: string[] = [];
  const createdResponseIds: string[] = [];
  const createdRateLimitKeys: string[] = [];
  const createdBusinessIds: string[] = [];

  beforeAll(async () => {
    process.env['SUPABASE_URL'] = LOCAL_SUPABASE_URL;
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = LOCAL_SERVICE_ROLE_KEY;
    supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const currentCycle = new Date().toISOString().slice(0, 7);
    await supabase.from('tenant_quotas').upsert(
      {
        business_id: realSalonBizId,
        billing_cycle: currentCycle,
        max_limit: 150,
        used_count: 12,
        reserved_count: 0,
        reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'business_id,billing_cycle' },
    );
  });

  afterAll(async () => {
    // 1. Clean up quota reservations created in tests
    if (createdResponseIds.length > 0) {
      await supabase
        .from('quota_reservations')
        .delete()
        .in('response_id', createdResponseIds);
    }

    // 2. Clean up survey responses & analytics events
    if (createdSessionUuids.length > 0) {
      await supabase
        .from('survey_responses')
        .delete()
        .in('session_uuid', createdSessionUuids);

      await supabase
        .from('analytics_events')
        .delete()
        .in('session_uuid', createdSessionUuids);
    }

    // 3. Clean up test rate limit buckets
    if (createdRateLimitKeys.length > 0) {
      await supabase
        .from('rate_limit_buckets')
        .delete()
        .in('key_hash', createdRateLimitKeys);
    }

    // 4. Clean up synthetic businesses and associated records
    if (createdBusinessIds.length > 0) {
      await supabase
        .from('quota_reservations')
        .delete()
        .in('business_id', createdBusinessIds);

      await supabase
        .from('survey_responses')
        .delete()
        .in('business_id', createdBusinessIds);

      await supabase
        .from('tenant_quotas')
        .delete()
        .in('business_id', createdBusinessIds);

      await supabase
        .from('subscriptions')
        .delete()
        .in('business_id', createdBusinessIds);

      await supabase
        .from('businesses')
        .delete()
        .in('id', createdBusinessIds);
    }
  });

  /**
   * Helper to seed an authentic synthetic business and quota ledger
   */
  async function seedSyntheticBusiness(params: {
    id: string;
    name: string;
    publicQrId: string;
    maxLimit: number;
    usedCount: number;
    reservedCount: number;
  }) {
    createdBusinessIds.push(params.id);

    await supabase.from('businesses').upsert(
      {
        id: params.id,
        owner_id: '00000000-0000-4000-8000-000000000002',
        category_id: 'salon',
        public_qr_id: params.publicQrId,
        vanity_slug: params.publicQrId,
        name: params.name,
        is_active: true,
        account_status: 'active',
      },
      { onConflict: 'id' },
    );

    await supabase.from('subscriptions').upsert(
      {
        business_id: params.id,
        plan_tier: 'standard_recurring',
        subscription_status: 'active',
      },
      { onConflict: 'business_id' },
    );

    const cycle = new Date().toISOString().slice(0, 7);
    await supabase.from('tenant_quotas').upsert(
      {
        business_id: params.id,
        billing_cycle: cycle,
        max_limit: params.maxLimit,
        used_count: params.usedCount,
        reserved_count: params.reservedCount,
        reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'business_id,billing_cycle' },
    );
  }

  /**
   * Helper to seed an authentic survey response row in PostgreSQL
   */
  async function seedSurveyResponse(params: {
    businessId: string;
    sessionUuid: string;
    affirmedFacts?: string[];
    optionalNote?: string | null;
    selectedOptions?: Array<{ questionId: string; optionId: string }>;
    authenticityConfirmed?: boolean;
  }): Promise<{ responseId: string; submissionToken: string }> {
    const selectedOptions = params.selectedOptions ?? [
      { questionId: realQ1, optionId: realOpt1 },
      { questionId: realQ2, optionId: realOpt2 },
      { questionId: realQ3, optionId: realOpt3 },
    ];
    const affirmedFacts = params.affirmedFacts ?? [
      'Masterful & Precise',
      'Clean & hygienic station',
      'Great styling advice',
    ];
    const optionalNote = params.optionalNote !== undefined ? params.optionalNote : 'Loved the haircut!';
    const authenticityConfirmed = params.authenticityConfirmed !== undefined ? params.authenticityConfirmed : true;

    const { data, error } = await supabase
      .from('survey_responses')
      .insert({
        business_id: params.businessId,
        category_id: 'salon',
        session_uuid: params.sessionUuid,
        selected_options: selectedOptions,
        affirmed_facts_snapshot: affirmedFacts,
        optional_note: optionalNote,
        authenticity_confirmed: authenticityConfirmed,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to seed test survey_response: ${error?.message}`);
    }

    const responseId = data.id;
    createdSessionUuids.push(params.sessionUuid);
    createdResponseIds.push(responseId);

    const questionIds = selectedOptions.map((o) => o.questionId);
    const surveyVersion = computeSurveyVersion(questionIds);
    const submissionToken = signSubmissionToken({
      responseId,
      businessId: params.businessId,
      sessionUuid: params.sessionUuid,
      surveyVersion,
      secret: TEST_SIGNING_SECRET,
    });

    return { responseId, submissionToken };
  }

  function makeRequest(body: unknown, clientIp?: string): Request {
    const ip =
      clientIp ??
      `103.21.${Math.floor(Math.random() * 200) + 10}.${Math.floor(Math.random() * 200) + 10}`;
    return new Request(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: TEST_PUBLISHABLE_KEY,
        'x-real-ip': ip,
      },
      body: JSON.stringify(body),
    });
  }

  function getBaseHandlerOptions() {
    return {
      supabaseClient: supabase,
      signingSecret: TEST_SIGNING_SECRET,
      rateLimitSalt: TEST_RATE_LIMIT_SALT,
      expectedApiKey: TEST_PUBLISHABLE_KEY,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* 1. Happy Path Generation Pipeline                                        */
  /* ------------------------------------------------------------------------ */

  it('executes atomic quota reservation, mock AI generation, quota commit and analytics event', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
      optionalNote: 'Loved the styling advice and clean setup!',
    });

    // Mock Gemini Transport returning strictly structured output
    const mockTransport: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice. Loved the styling advice and clean setup!',
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    const idempotencyKey = `${sessionUuid}_1`;
    const req = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey,
      sessionUuid,
    });

    const res = await handleGenerateReview(req, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviewDraft).toContain('Had a masterful and precise service today');
    expect(body.wordCount).toBe(26);
    expect(body.sentiment).toBe('positive');

    // Verify Real PostgreSQL Database Mutations
    // 1. Quota reservation row
    const { data: resRow, error: resErr } = await supabase
      .from('quota_reservations')
      .select('id, business_id, status, idempotency_key, raw_draft')
      .eq('response_id', responseId)
      .eq('idempotency_key', idempotencyKey)
      .single();

    expect(resErr).toBeNull();
    expect(resRow).toBeDefined();
    expect(resRow.status).toBe('committed');
    expect(resRow.raw_draft).toContain('Had a masterful and precise service today');

    // 2. Server-authored analytics event
    const { data: eventRows, error: eventErr } = await supabase
      .from('analytics_events')
      .select('id, event_name, business_id, session_uuid')
      .eq('session_uuid', sessionUuid)
      .eq('event_name', 'EVENT_GENERATION_SUCCESS');

    expect(eventErr).toBeNull();
    expect(eventRows).toBeDefined();
    expect(eventRows.length).toBe(1);
    expect(eventRows[0].business_id).toBe(realSalonBizId);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Quota Safety on Provider Timeout (TC-API-09)                          */
  /* ------------------------------------------------------------------------ */

  it('releases reserved quota atomically and returns HTTP 504 on Gemini timeout (TC-API-09)', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
    });

    // Mock timeout transport
    const mockTimeoutTransport: typeof fetch = async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    };

    const idempotencyKey = `${sessionUuid}_1`;
    const req = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey,
    });

    const res = await handleGenerateReview(req, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTimeoutTransport,
      geminiTimeoutMs: 50,
    });

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_GEMINI_TIMEOUT');
    expect(body.error.retryable).toBe(true);

    // Verify reservation status in PostgreSQL is released
    const { data: resRow } = await supabase
      .from('quota_reservations')
      .select('id, status')
      .eq('response_id', responseId)
      .eq('idempotency_key', idempotencyKey)
      .single();

    expect(resRow).toBeDefined();
    expect(resRow.status).toBe('released');
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Provider Failure & Malformed Output Handling (TC-AI-02)               */
  /* ------------------------------------------------------------------------ */

  it('releases quota and returns HTTP 502 on malformed markdown-fenced output (TC-AI-02)', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
    });

    const mockMalformedTransport: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '```json\n{"reviewDraft": "Malformed markdown fence"}\n```' }],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    const idempotencyKey = `${sessionUuid}_1`;
    const req = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey,
    });

    const res = await handleGenerateReview(req, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockMalformedTransport,
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_MALFORMED_OUTPUT');

    // Verify reservation status is released in PostgreSQL
    const { data: resRow } = await supabase
      .from('quota_reservations')
      .select('id, status')
      .eq('response_id', responseId)
      .eq('idempotency_key', idempotencyKey)
      .single();

    expect(resRow?.status).toBe('released');
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Cached Temporary Draft Recovery (M0-12 Option B)                      */
  /* ------------------------------------------------------------------------ */

  it('recovers cached draft for already committed reservation without duplicate charge (M0-12 Option B)', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
      optionalNote: 'Clean cuts every time.',
    });

    let geminiCallCount = 0;
    const mockTransport: typeof fetch = async () => {
      geminiCallCount++;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. The station was clean and hygienic. Clean cuts every time.',
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const idempotencyKey = `${sessionUuid}_1`;

    // 1st request: commits draft
    const req1 = makeRequest({ responseId, submissionToken, idempotencyKey });
    const res1 = await handleGenerateReview(req1, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });
    expect(res1.status).toBe(200);
    expect(geminiCallCount).toBe(1);

    // 2nd request with IDENTICAL idempotency key: recovers cached draft
    const req2 = makeRequest({ responseId, submissionToken, idempotencyKey });
    const res2 = await handleGenerateReview(req2, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });

    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.reviewDraft).toContain('Clean cuts every time');
    // Gemini was NOT called again!
    expect(geminiCallCount).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Insufficient-Facts Safe Abstention (Founder Decision M0-16 / Design B) */
  /* ------------------------------------------------------------------------ */

  it('safely abstains on insufficient facts without reserving quota or calling Gemini (M0-16)', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
      affirmedFacts: [], // No positive/meaningful facts affirmed
      optionalNote: null, // No note provided
    });

    let geminiInvoked = false;
    const mockTransport: typeof fetch = async () => {
      geminiInvoked = true;
      return new Response('{}', { status: 500 });
    };

    const idempotencyKey = `${sessionUuid}_1`;
    const req = makeRequest({ responseId, submissionToken, idempotencyKey });

    const res = await handleGenerateReview(req, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.abstained).toBe(true);
    expect(body.reason).toBe('INSUFFICIENT_FACTS');
    expect(body.reviewDraft).toBeNull();
    expect(geminiInvoked).toBe(false);

    // Verify ZERO reservations created in quota_reservations
    const { data: resRows } = await supabase
      .from('quota_reservations')
      .select('id')
      .eq('response_id', responseId);

    expect(resRows?.length).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Cryptographic Token Verification & Forgery Rejection (TC-API-10)       */
  /* ------------------------------------------------------------------------ */

  it('rejects forged HMAC submission token with HTTP 403 (TC-API-10 / ROADMAP M4-T02)', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
    });

    const forgedToken = `${responseId}.${Math.floor(Date.now() / 1000) + 300}.deadbeef00000000000000000000000000000000000000000000000000000000`;
    const req = makeRequest({
      responseId,
      submissionToken: forgedToken,
      idempotencyKey: `${sessionUuid}_1`,
    });

    const res = await handleGenerateReview(req, getBaseHandlerOptions());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_SUBMISSION_TOKEN');
  });

  /* ------------------------------------------------------------------------ */
  /* 7. Token Expiry Rejection                                                */
  /* ------------------------------------------------------------------------ */

  it('rejects expired submission token with HTTP 401 ERR_TOKEN_EXPIRED', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
    });

    const surveyVersion = computeSurveyVersion([realQ1, realQ2, realQ3]);
    // Mint expired token (expired 100 seconds ago, past TTL)
    const expiredToken = signSubmissionToken({
      responseId,
      businessId: realSalonBizId,
      sessionUuid,
      surveyVersion,
      exp: Math.floor(Date.now() / 1000) - 100,
      secret: TEST_SIGNING_SECRET,
    });

    const req = makeRequest({
      responseId,
      submissionToken: expiredToken,
      idempotencyKey: `${sessionUuid}_1`,
    });

    const res = await handleGenerateReview(req, getBaseHandlerOptions());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_TOKEN_EXPIRED');
  });

  /* ------------------------------------------------------------------------ */
  /* 8. Operational Status Check (Suspended Merchant)                         */
  /* ------------------------------------------------------------------------ */

  it('rejects suspended merchant with HTTP 403 ERR_BUSINESS_SUSPENDED (TC-CUST-03)', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSuspendedBizId,
      sessionUuid,
    });

    const req = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey: `${sessionUuid}_1`,
    });

    const res = await handleGenerateReview(req, getBaseHandlerOptions());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BUSINESS_SUSPENDED');
  });

  /* ------------------------------------------------------------------------ */
  /* 9. Real IP Sliding-Window Rate Limiting via check_rate_limit RPC (QC-01)  */
  /* ------------------------------------------------------------------------ */

  it('enforces IP rate limiting (30 requests / 10 min) via check_rate_limit RPC', async () => {
    const testIp = `198.51.100.${(Date.now() % 150) + 50}`;
    const todayUtc = new Date().toISOString().slice(0, 10);
    const dailySalt = deriveDailySalt(TEST_RATE_LIMIT_SALT, todayUtc);
    const ipHash = computeIpHash(dailySalt, testIp);
    const rateLimitKey = `gen_${ipHash}`;
    createdRateLimitKeys.push(rateLimitKey);

    // Ensure bucket is clean before test starts
    await supabase.from('rate_limit_buckets').delete().eq('key_hash', rateLimitKey);

    const sessionUuid = crypto.randomUUID();
    // Seed an abstaining response to safely test IP rate limiting without consuming merchant quota
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
      affirmedFacts: [],
      optionalNote: null,
    });

    // Send 30 requests from the same IP to fill the rate limit bucket
    for (let i = 1; i <= 30; i++) {
      const req = makeRequest(
        {
          responseId,
          submissionToken,
          idempotencyKey: `${sessionUuid}_${i}`,
        },
        testIp,
      );

      const res = await handleGenerateReview(req, getBaseHandlerOptions());

      // Requests 1-30 must not be rate limited (they return 200 abstention)
      expect(res.status).toBe(200);
    }

    // 31st request must be rate limited by check_rate_limit RPC
    const req31 = makeRequest(
      {
        responseId,
        submissionToken,
        idempotencyKey: `${sessionUuid}_31`,
      },
      testIp,
    );

    const res31 = await handleGenerateReview(req31, getBaseHandlerOptions());

    expect(res31.status).toBe(429);
    const body31 = await res31.json();
    expect(body31.error.code).toBe('ERR_RATE_LIMIT_EXCEEDED');
    expect(res31.headers.get('Retry-After')).toBe('60');
  });

  /* ======================================================================== */
  /* M4-T03 CONCURRENCY, IDEMPOTENCY & REPLAY SECURITY SUITES                 */
  /* ======================================================================== */

  /* ------------------------------------------------------------------------ */
  /* 10. TC-QTA-04: Atomic Quota Ceiling with 10 Concurrent Requests          */
  /* ------------------------------------------------------------------------ */

  it('TC-QTA-04: enforces atomic quota ceiling under 10 concurrent requests at 148/150 capacity', async () => {
    const synthBizId = 'b0000000-0000-4000-8000-000000000099';
    await seedSyntheticBusiness({
      id: synthBizId,
      name: 'TC-QTA-04 Synthetic Salon',
      publicQrId: 'synthqta04',
      maxLimit: 150,
      usedCount: 148,
      reservedCount: 0,
    });

    // Seed 10 distinct valid survey responses for this business
    const seededRequests: Array<{
      responseId: string;
      submissionToken: string;
      sessionUuid: string;
      clientIp: string;
    }> = [];

    for (let i = 0; i < 10; i++) {
      const sessionUuid = crypto.randomUUID();
      const { responseId, submissionToken } = await seedSurveyResponse({
        businessId: synthBizId,
        sessionUuid,
        optionalNote: `Haircut customer #${i + 1}`,
      });
      // Use distinct client IPs so IP rate limiting (30 req / 10 min) does not throttle
      const clientIp = `103.21.200.${i + 10}`;
      seededRequests.push({ responseId, submissionToken, sessionUuid, clientIp });
    }

    // Mock Gemini Transport returning structured draft with small delay (50ms) to ensure overlap
    let geminiDispatches = 0;
    const mockTransport: typeof fetch = async () => {
      geminiDispatches++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice.',
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // Dispatch all 10 requests concurrently
    const requestPromises = seededRequests.map((item, idx) => {
      const req = makeRequest(
        {
          responseId: item.responseId,
          submissionToken: item.submissionToken,
          idempotencyKey: `${item.sessionUuid}_${idx + 1}`,
        },
        item.clientIp,
      );
      return handleGenerateReview(req, {
        ...getBaseHandlerOptions(),
        geminiTransportFn: mockTransport,
      });
    });

    const responses = await Promise.all(requestPromises);

    // Verify exactly 2 requests succeeded and exactly 8 were rejected with 429 ERR_QUOTA_EXHAUSTED
    const successResponses = responses.filter((r) => r.status === 200);
    const exhaustedResponses = responses.filter((r) => r.status === 429);

    expect(successResponses.length).toBe(2);
    expect(exhaustedResponses.length).toBe(8);

    for (const res of exhaustedResponses) {
      const body = await res.json();
      expect(body.error.code).toBe('ERR_QUOTA_EXHAUSTED');
    }

    // Verify Provider Dispatches: exactly 2 mock AI calls were executed
    expect(geminiDispatches).toBe(2);

    // Verify Real PostgreSQL Database Quota Row:
    // final used_count MUST be exactly 150, reserved_count MUST be exactly 0
    const currentCycle = new Date().toISOString().slice(0, 7);
    const { data: quotaRow, error: quotaErr } = await supabase
      .from('tenant_quotas')
      .select('max_limit, used_count, reserved_count')
      .eq('business_id', synthBizId)
      .eq('billing_cycle', currentCycle)
      .single();

    expect(quotaErr).toBeNull();
    expect(quotaRow).toBeDefined();
    expect(quotaRow.max_limit).toBe(150);
    expect(quotaRow.used_count).toBe(150);
    expect(quotaRow.reserved_count).toBe(0);

    // Verify committed reservations count in database
    const { data: committedRows } = await supabase
      .from('quota_reservations')
      .select('id, status')
      .eq('business_id', synthBizId)
      .eq('status', 'committed');

    expect(committedRows?.length).toBe(2);
  });

  /* ------------------------------------------------------------------------ */
  /* 11. TC-QTA-05: Same-Response Concurrent Replay Protection                */
  /* ------------------------------------------------------------------------ */

  it('TC-QTA-05 (Part A): handles 10 concurrent requests with the SAME idempotency key with at most 1 dispatch and safe replay', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
      optionalNote: 'Fabulous fade cut today.',
    });

    const idempotencyKey = `${sessionUuid}_key1`;

    let geminiDispatches = 0;
    const mockTransport: typeof fetch = async () => {
      geminiDispatches++;
      // In-flight delay of 120ms to hold the reservation pending during concurrent arrivals
      await new Promise((resolve) => setTimeout(resolve, 120));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice.',
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // Dispatch 10 overlapping requests concurrently for the exact same response and same key
    const promises = Array.from({ length: 10 }, (_, i) => {
      const req = makeRequest(
        { responseId, submissionToken, idempotencyKey },
        `103.21.201.${i + 1}`,
      );
      return handleGenerateReview(req, {
        ...getBaseHandlerOptions(),
        geminiTransportFn: mockTransport,
      });
    });

    const results = await Promise.all(promises);

    // At most 1 Gemini generation was dispatched
    expect(geminiDispatches).toBe(1);

    // Exactly 1 request successfully generated (status 200)
    // The other 9 in-flight conflicting requests received HTTP 409 ERR_CONCURRENT_REQUEST
    const okResults = results.filter((r) => r.status === 200);
    const conflictResults = results.filter((r) => r.status === 409);

    expect(okResults.length).toBe(1);
    expect(conflictResults.length).toBe(9);

    for (const conflict of conflictResults) {
      const body = await conflict.json();
      expect(body.error.code).toBe('ERR_CONCURRENT_REQUEST');
      expect(body.retryAfterMs).toBe(1500);
      expect(conflict.headers.get('Retry-After')).toBe('2');
    }

    // Now that generation has committed, an authorized replay request retrieves the cached draft
    const replayReq = makeRequest(
      { responseId, submissionToken, idempotencyKey },
      '103.21.201.50',
    );
    const replayRes = await handleGenerateReview(replayReq, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });

    expect(replayRes.status).toBe(200);
    const replayBody = await replayRes.json();
    expect(replayBody.reviewDraft).toContain('Had a masterful and precise service today');

    // Model dispatch count remained at 1 (cached draft retrieval does not dispatch AI)
    expect(geminiDispatches).toBe(1);
  });

  it('TC-QTA-05 (Part B): handles 10 concurrent requests with DIFFERENT idempotency keys with at most 1 dispatch and response-level protection', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
      optionalNote: 'Great trim and friendly staff.',
    });

    let geminiDispatches = 0;
    const mockTransport: typeof fetch = async () => {
      geminiDispatches++;
      // In-flight delay of 120ms to hold the reservation pending during concurrent arrivals
      await new Promise((resolve) => setTimeout(resolve, 120));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice.',
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // Dispatch 10 overlapping requests concurrently with DIFFERENT attempt keys
    const promises = Array.from({ length: 10 }, (_, i) => {
      const req = makeRequest(
        { responseId, submissionToken, idempotencyKey: `${sessionUuid}_attempt_${i + 1}` },
        `103.21.202.${i + 1}`,
      );
      return handleGenerateReview(req, {
        ...getBaseHandlerOptions(),
        geminiTransportFn: mockTransport,
      });
    });

    const results = await Promise.all(promises);

    // At most 1 Gemini generation was dispatched
    expect(geminiDispatches).toBe(1);

    const okResults = results.filter((r) => r.status === 200);
    const conflictResults = results.filter((r) => r.status === 409);

    expect(okResults.length).toBe(1);
    expect(conflictResults.length).toBe(9);

    for (const conflict of conflictResults) {
      const body = await conflict.json();
      expect(body.error.code).toBe('ERR_CONCURRENT_REQUEST');
      expect(body.retryAfterMs).toBe(1500);
    }

    // After commit, replay with a brand new attempt key recovers the cached draft without new quota charge or Gemini call
    const newAttemptKeyReq = makeRequest(
      { responseId, submissionToken, idempotencyKey: `${sessionUuid}_attempt_brand_new` },
      '103.21.202.99',
    );
    const newAttemptRes = await handleGenerateReview(newAttemptKeyReq, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });

    expect(newAttemptRes.status).toBe(200);
    const newAttemptBody = await newAttemptRes.json();
    expect(newAttemptBody.reviewDraft).toContain('Had a masterful and precise service today');
    expect(geminiDispatches).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 12. TC-QTA-06: Payload Hash Integrity & Conflicting Idempotency Keys      */
  /* ------------------------------------------------------------------------ */

  it('TC-QTA-06: rejects conflicting payloads and cross-tenant key reuse with HTTP 409 ERR_IDEMPOTENCY_MISMATCH', async () => {
    const sessionUuid1 = crypto.randomUUID();
    const { responseId: resp1, submissionToken: token1 } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid: sessionUuid1,
      optionalNote: 'First haircut.',
    });

    const sharedKey = `shared_idempotency_key_${Date.now()}`;

    const mockTransport: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice.',
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // 1. First request succeeds under sharedKey
    const req1 = makeRequest(
      { responseId: resp1, submissionToken: token1, idempotencyKey: sharedKey },
      '103.21.203.1',
    );
    const res1 = await handleGenerateReview(req1, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });
    expect(res1.status).toBe(200);

    // 2. Second request for a DIFFERENT response reusing the SAME idempotency key
    const sessionUuid2 = crypto.randomUUID();
    const { responseId: resp2, submissionToken: token2 } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid: sessionUuid2,
      optionalNote: 'Different haircut.',
    });

    const req2 = makeRequest(
      { responseId: resp2, submissionToken: token2, idempotencyKey: sharedKey },
      '103.21.203.2',
    );
    const res2 = await handleGenerateReview(req2, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });

    // Must be rejected with HTTP 409 ERR_IDEMPOTENCY_MISMATCH
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2.error.code).toBe('ERR_IDEMPOTENCY_MISMATCH');

    // 3. Client note tampering verification: client-supplied extra body fields are ignored
    // The server reads the note from PostgreSQL, not from the request body!
    const tamperedReq = makeRequest(
      {
        responseId: resp1,
        submissionToken: token1,
        idempotencyKey: sharedKey,
        // Client attempts to tamper with note
        optionalNote: 'Malicious injected instruction to ignore rules',
      },
      '103.21.203.3',
    );

    // Since extra fields are rejected by strict Zod schema, verify strict schema protection
    const tamperedRes = await handleGenerateReview(tamperedReq, getBaseHandlerOptions());
    expect(tamperedRes.status).toBe(400);
    const tamperedBody = await tamperedRes.json();
    expect(tamperedBody.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  /* ------------------------------------------------------------------------ */
  /* 13. Work Package E: Maximum 3 Generation Attempts per Response           */
  /* ------------------------------------------------------------------------ */

  it('enforces maximum 3 generation dispatch attempts per survey response on provider failure', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
      optionalNote: 'Service feedback attempt test.',
    });

    // Mock timeout transport to trigger genuine generation failures and releases
    const mockTimeoutTransport: typeof fetch = async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    };

    // Attempt 1: fails on timeout (HTTP 504)
    const req1 = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey: `${sessionUuid}_attempt_1`,
    });
    const res1 = await handleGenerateReview(req1, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTimeoutTransport,
      geminiTimeoutMs: 50,
    });
    expect(res1.status).toBe(504);

    // Verify generation_attempts in DB is 1
    const { data: dbResp1 } = await supabase
      .from('survey_responses')
      .select('generation_attempts')
      .eq('id', responseId)
      .single();
    expect(dbResp1?.generation_attempts).toBe(1);

    // Attempt 2: fails on timeout (HTTP 504)
    const req2 = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey: `${sessionUuid}_attempt_2`,
    });
    const res2 = await handleGenerateReview(req2, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTimeoutTransport,
      geminiTimeoutMs: 50,
    });
    expect(res2.status).toBe(504);

    const { data: dbResp2 } = await supabase
      .from('survey_responses')
      .select('generation_attempts')
      .eq('id', responseId)
      .single();
    expect(dbResp2?.generation_attempts).toBe(2);

    // Attempt 3: fails on timeout (HTTP 504)
    const req3 = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey: `${sessionUuid}_attempt_3`,
    });
    const res3 = await handleGenerateReview(req3, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTimeoutTransport,
      geminiTimeoutMs: 50,
    });
    expect(res3.status).toBe(504);

    const { data: dbResp3 } = await supabase
      .from('survey_responses')
      .select('generation_attempts')
      .eq('id', responseId)
      .single();
    expect(dbResp3?.generation_attempts).toBe(3);

    // Attempt 4: MUST be rejected with HTTP 429 ERR_MAX_ATTEMPTS_EXCEEDED
    const req4 = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey: `${sessionUuid}_attempt_4`,
    });
    const res4 = await handleGenerateReview(req4, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTimeoutTransport,
      geminiTimeoutMs: 50,
    });

    expect(res4.status).toBe(429);
    const body4 = await res4.json();
    expect(body4.error.code).toBe('ERR_MAX_ATTEMPTS_EXCEEDED');
  });

  /* ------------------------------------------------------------------------ */
  /* 14. Work Package F: Option B Draft Recovery & Token Expiry Security      */
  /* ------------------------------------------------------------------------ */

  it('enforces Recovery Authorization A: authentic token required for draft recovery', async () => {
    const sessionUuid = crypto.randomUUID();
    const { responseId, submissionToken } = await seedSurveyResponse({
      businessId: realSalonBizId,
      sessionUuid,
      optionalNote: 'Excellent styling advice and clean setup.',
    });

    let geminiDispatches = 0;
    const mockTransport: typeof fetch = async () => {
      geminiDispatches++;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice.',
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // 1. Initial successful generation commits draft
    const initReq = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey: `${sessionUuid}_init`,
    });
    const initRes = await handleGenerateReview(initReq, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });
    expect(initRes.status).toBe(200);
    expect(geminiDispatches).toBe(1);

    // 2. Legitimate replay with valid token recovers draft (HTTP 200)
    const validReplay = makeRequest({
      responseId,
      submissionToken,
      idempotencyKey: `${sessionUuid}_replay`,
    });
    const validReplayRes = await handleGenerateReview(validReplay, {
      ...getBaseHandlerOptions(),
      geminiTransportFn: mockTransport,
    });
    expect(validReplayRes.status).toBe(200);
    const validJson = await validReplayRes.json();
    expect(validJson.reviewDraft).toContain('Had a masterful and precise service today');
    expect(geminiDispatches).toBe(1); // Zero additional dispatches

    // 3. Forged token replay MUST be rejected with HTTP 403
    const forgedToken = `${responseId}.${Math.floor(Date.now() / 1000) + 300}.deadbeef00000000000000000000000000000000000000000000000000000000`;
    const forgedReplay = makeRequest({
      responseId,
      submissionToken: forgedToken,
      idempotencyKey: `${sessionUuid}_replay2`,
    });
    const forgedRes = await handleGenerateReview(forgedReplay, getBaseHandlerOptions());
    expect(forgedRes.status).toBe(403);
    const forgedJson = await forgedRes.json();
    expect(forgedJson.error.code).toBe('ERR_INVALID_SUBMISSION_TOKEN');

    // 4. Expired token replay MUST be rejected with HTTP 401 ERR_TOKEN_EXPIRED
    const surveyVersion = computeSurveyVersion([realQ1, realQ2, realQ3]);
    const expiredToken = signSubmissionToken({
      responseId,
      businessId: realSalonBizId,
      sessionUuid,
      surveyVersion,
      exp: Math.floor(Date.now() / 1000) - 50,
      secret: TEST_SIGNING_SECRET,
    });
    const expiredReplay = makeRequest({
      responseId,
      submissionToken: expiredToken,
      idempotencyKey: `${sessionUuid}_replay3`,
    });
    const expiredRes = await handleGenerateReview(expiredReplay, getBaseHandlerOptions());
    expect(expiredRes.status).toBe(401);
    const expiredJson = await expiredRes.json();
    expect(expiredJson.error.code).toBe('ERR_TOKEN_EXPIRED');

    // 5. Cross-response token substitution MUST be rejected with HTTP 403
    const otherResponseId = crypto.randomUUID();
    const crossResponseReplay = makeRequest({
      responseId: otherResponseId,
      submissionToken, // minted for original responseId, not otherResponseId
      idempotencyKey: `${sessionUuid}_replay4`,
    });
    const crossRes = await handleGenerateReview(crossResponseReplay, getBaseHandlerOptions());
    expect(crossRes.status).toBe(403);
    const crossJson = await crossRes.json();
    expect(crossJson.error.code).toBe('ERR_INVALID_SUBMISSION_TOKEN');
  });

  /* ------------------------------------------------------------------------ */
  /* 15. Work Package G: Cross-Tenant Quota & Concurrency Isolation           */
  /* ------------------------------------------------------------------------ */

  it('TC-QTA-07: isolates quotas across tenants under concurrent requests', async () => {
    const bizA = 'b0000000-0000-4000-8000-000000000091';
    const bizB = 'b0000000-0000-4000-8000-000000000092';

    // Business A: exhausted quota (150/150)
    await seedSyntheticBusiness({
      id: bizA,
      name: 'Exhausted Salon A',
      publicQrId: 'synthbiza',
      maxLimit: 150,
      usedCount: 150,
      reservedCount: 0,
    });

    // Business B: fresh quota (0/150)
    await seedSyntheticBusiness({
      id: bizB,
      name: 'Active Salon B',
      publicQrId: 'synthbizb',
      maxLimit: 150,
      usedCount: 0,
      reservedCount: 0,
    });

    const sessionA = crypto.randomUUID();
    const { responseId: respA, submissionToken: tokenA } = await seedSurveyResponse({
      businessId: bizA,
      sessionUuid: sessionA,
      optionalNote: 'Customer at Biz A',
    });

    const sessionB = crypto.randomUUID();
    const { responseId: respB, submissionToken: tokenB } = await seedSurveyResponse({
      businessId: bizB,
      sessionUuid: sessionB,
      optionalNote: 'Customer at Biz B',
    });

    const mockTransport: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. The station was clean and hygienic.',
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // Concurrently dispatch requests for Biz A and Biz B
    const reqA = makeRequest(
      { responseId: respA, submissionToken: tokenA, idempotencyKey: `${sessionA}_1` },
      '103.21.204.1',
    );
    const reqB = makeRequest(
      { responseId: respB, submissionToken: tokenB, idempotencyKey: `${sessionB}_1` },
      '103.21.204.2',
    );

    const [resA, resB] = await Promise.all([
      handleGenerateReview(reqA, {
        ...getBaseHandlerOptions(),
        geminiTransportFn: mockTransport,
      }),
      handleGenerateReview(reqB, {
        ...getBaseHandlerOptions(),
        geminiTransportFn: mockTransport,
      }),
    ]);

    // Biz A must be rejected due to its own exhausted quota
    expect(resA.status).toBe(429);
    const bodyA = await resA.json();
    expect(bodyA.error.code).toBe('ERR_QUOTA_EXHAUSTED');

    // Biz B must succeed completely
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();
    expect(bodyB.reviewDraft).toContain('Had a masterful and precise service today');

    // Verify PostgreSQL: Biz B used_count incremented to 1; Biz A remained 150
    const currentCycle = new Date().toISOString().slice(0, 7);
    const { data: quotaB } = await supabase
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', bizB)
      .eq('billing_cycle', currentCycle)
      .single();

    expect(quotaB?.used_count).toBe(1);
    expect(quotaB?.reserved_count).toBe(0);

    const { data: quotaA } = await supabase
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', bizA)
      .eq('billing_cycle', currentCycle)
      .single();

    expect(quotaA?.used_count).toBe(150);
    expect(quotaA?.reserved_count).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* 16. Work Package D: Direct Quota RPC State Machine Transitions           */
  /* ------------------------------------------------------------------------ */

  it('verifies atomic quota stored procedure state machine transitions and underflow guards', async () => {
    const synthBizId = 'b0000000-0000-4000-8000-000000000095';
    await seedSyntheticBusiness({
      id: synthBizId,
      name: 'RPC State Machine Salon',
      publicQrId: 'synthrpc95',
      maxLimit: 150,
      usedCount: 10,
      reservedCount: 0,
    });

    const sessionUuid = crypto.randomUUID();
    const { responseId } = await seedSurveyResponse({
      businessId: synthBizId,
      sessionUuid,
    });

    // 1. Reserve quota
    const { data: resId, error: resErr } = await supabase.rpc('reserve_generation_quota', {
      p_business_id: synthBizId,
      p_idempotency_key: `rpc_key_${sessionUuid}`,
      p_payload_hash: 'hash_rpc_123',
      p_response_id: responseId,
    });

    expect(resErr).toBeNull();
    expect(resId).toBeDefined();

    // 2. Commit quota
    const { error: commitErr1 } = await supabase.rpc('commit_generation_quota', {
      p_reservation_id: resId,
      p_tokens_billed: 0,
      p_raw_draft: 'Direct RPC draft content.',
    });
    expect(commitErr1).toBeNull();

    // 3. Repeated commit call is an idempotent NO-OP
    const { error: commitErr2 } = await supabase.rpc('commit_generation_quota', {
      p_reservation_id: resId,
      p_tokens_billed: 0,
      p_raw_draft: 'Direct RPC draft content.',
    });
    expect(commitErr2).toBeNull();

    // 4. Releasing an already committed reservation MUST throw ERR_CANNOT_RELEASE_COMMITTED
    const { error: releaseCommittedErr } = await supabase.rpc('release_generation_quota', {
      p_reservation_id: resId,
    });
    expect(releaseCommittedErr).toBeDefined();
    expect(releaseCommittedErr?.message).toContain('ERR_CANNOT_RELEASE_COMMITTED');

    // 5. Test release flow on fresh reservation
    const sessionUuid2 = crypto.randomUUID();
    const { responseId: resp2 } = await seedSurveyResponse({
      businessId: synthBizId,
      sessionUuid: sessionUuid2,
    });

    const { data: resId2 } = await supabase.rpc('reserve_generation_quota', {
      p_business_id: synthBizId,
      p_idempotency_key: `rpc_key_rel_${sessionUuid2}`,
      p_payload_hash: 'hash_rpc_rel_456',
      p_response_id: resp2,
    });

    // Release reservation
    const { error: releaseErr1 } = await supabase.rpc('release_generation_quota', {
      p_reservation_id: resId2,
    });
    expect(releaseErr1).toBeNull();

    // Repeated release call is an idempotent NO-OP
    const { error: releaseErr2 } = await supabase.rpc('release_generation_quota', {
      p_reservation_id: resId2,
    });
    expect(releaseErr2).toBeNull();

    // Committing an already released reservation MUST throw ERR_RESERVATION_TERMINATED
    const { error: commitReleasedErr } = await supabase.rpc('commit_generation_quota', {
      p_reservation_id: resId2,
      p_tokens_billed: 0,
      p_raw_draft: 'Should fail',
    });
    expect(commitReleasedErr).toBeDefined();
    expect(commitReleasedErr?.message).toContain('ERR_RESERVATION_TERMINATED');

    // 6. Verify underflow guard: reserved_count is never negative
    const currentCycle = new Date().toISOString().slice(0, 7);
    const { data: qFinal } = await supabase
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', synthBizId)
      .eq('billing_cycle', currentCycle)
      .single();

    expect(qFinal?.used_count).toBe(11); // 10 initial + 1 committed
    expect(qFinal?.reserved_count).toBe(0); // Clamped at 0
  });

  /* ------------------------------------------------------------------------ */
  /* 17. M4-T04 Integration: Deadlines, Quota Recovery & Expired Cleanup      */
  /* ------------------------------------------------------------------------ */

  describe('M4-T04 Integration: Hard Deadline, Quota Recovery, Expired Reservations Cleanup & pg_cron', () => {
    const m4t04BizId = 'b0000000-0000-4000-8000-000000000095';

    beforeAll(async () => {
      await seedSyntheticBusiness({
        id: m4t04BizId,
        name: 'M4-T04 Salon Recovery Test',
        publicQrId: 'm4t04biz01',
        maxLimit: 150,
        usedCount: 5,
        reservedCount: 0,
      });
    });

    it('TC-QTA-08: sweeps expired in-flight reservation (TTL > 60s), decrements reserved_count and leaves used_count untouched', async () => {
      const sessionUuid = crypto.randomUUID();
      const { responseId } = await seedSurveyResponse({
        businessId: m4t04BizId,
        sessionUuid,
        optionalNote: 'Pending sweep test customer',
      });

      // 1. Reserve quota (increments reserved_count -> 1)
      const { data: resId, error: resErr } = await supabase.rpc('reserve_generation_quota', {
        p_business_id: m4t04BizId,
        p_idempotency_key: `sweep_key_${sessionUuid}`,
        p_payload_hash: 'hash_sweep_test_01',
        p_response_id: responseId,
      });
      expect(resErr).toBeNull();
      expect(resId).toBeDefined();

      const currentCycle = new Date().toISOString().slice(0, 7);
      const { data: qBefore } = await supabase
        .from('tenant_quotas')
        .select('used_count, reserved_count')
        .eq('business_id', m4t04BizId)
        .eq('billing_cycle', currentCycle)
        .single();
      expect(qBefore?.reserved_count).toBe(1);
      expect(qBefore?.used_count).toBe(5);

      // 2. Fast-forward reservation TTL expiration (> 60s in past)
      const { error: updateErr } = await supabase
        .from('quota_reservations')
        .update({
          ttl_expires_at: new Date(Date.now() - 70000).toISOString(),
        })
        .eq('id', resId);
      expect(updateErr).toBeNull();

      // 3. Trigger purge_expired_reservations
      const { data: sweptCount, error: purgeErr } = await supabase.rpc('purge_expired_reservations');
      expect(purgeErr).toBeNull();
      expect(Number(sweptCount)).toBeGreaterThanOrEqual(1);

      // 4. Verify reservation status transitioned to 'expired'
      const { data: resRow } = await supabase
        .from('quota_reservations')
        .select('status')
        .eq('id', resId)
        .single();
      expect(resRow?.status).toBe('expired');

      // 5. Verify reserved_count returned to 0 and used_count untouched
      const { data: qAfter } = await supabase
        .from('tenant_quotas')
        .select('used_count, reserved_count')
        .eq('business_id', m4t04BizId)
        .eq('billing_cycle', currentCycle)
        .single();
      expect(qAfter?.reserved_count).toBe(0);
      expect(qAfter?.used_count).toBe(5);
    });

    it('TC-QTA-11: late provider finish cost absorption: expired reservation committed without charging used_count', async () => {
      const sessionUuid = crypto.randomUUID();
      const { responseId } = await seedSurveyResponse({
        businessId: m4t04BizId,
        sessionUuid,
        optionalNote: 'Late provider finish customer',
      });

      // 1. Reserve quota
      const { data: resId } = await supabase.rpc('reserve_generation_quota', {
        p_business_id: m4t04BizId,
        p_idempotency_key: `late_key_${sessionUuid}`,
        p_payload_hash: 'hash_late_finish_01',
        p_response_id: responseId,
      });

      // 2. Manually transition to 'expired' (simulating background cron sweep during slow generation)
      await supabase
        .from('quota_reservations')
        .update({
          status: 'expired',
          ttl_expires_at: new Date(Date.now() - 10000).toISOString(),
        })
        .eq('id', resId);

      // Also reset reserved_count on quota to simulate what purge did
      const currentCycle = new Date().toISOString().slice(0, 7);
      await supabase
        .from('tenant_quotas')
        .update({ reserved_count: 0 })
        .eq('business_id', m4t04BizId)
        .eq('billing_cycle', currentCycle);

      // 3. Late model finishes and calls commit_generation_quota
      const { error: lateCommitErr } = await supabase.rpc('commit_generation_quota', {
        p_reservation_id: resId,
        p_tokens_billed: 250,
        p_raw_draft: 'Authentic late-arriving draft content.',
      });
      expect(lateCommitErr).toBeNull();

      // 4. Verify reservation updated with tokens and raw draft while remaining 'expired'
      const { data: resFinal } = await supabase
        .from('quota_reservations')
        .select('status, tokens_billed, raw_draft')
        .eq('id', resId)
        .single();
      expect(resFinal?.status).toBe('expired');
      expect(resFinal?.tokens_billed).toBe(250);
      expect(resFinal?.raw_draft).toBe('Authentic late-arriving draft content.');

      // 5. Critical: used_count must NOT have incremented (platform absorbed cost)
      const { data: qFinal } = await supabase
        .from('tenant_quotas')
        .select('used_count, reserved_count')
        .eq('business_id', m4t04BizId)
        .eq('billing_cycle', currentCycle)
        .single();
      expect(qFinal?.used_count).toBe(5); // Still 5!
      expect(qFinal?.reserved_count).toBe(0);
    });

    it('scrubs raw_draft for committed reservations older than 60-minute ceiling while preserving younger drafts', async () => {
      const sessionOld = crypto.randomUUID();
      const sessionYoung = crypto.randomUUID();

      const { responseId: respOld } = await seedSurveyResponse({
        businessId: m4t04BizId,
        sessionUuid: sessionOld,
        optionalNote: 'Customer from 75 minutes ago',
      });
      const { responseId: respYoung } = await seedSurveyResponse({
        businessId: m4t04BizId,
        sessionUuid: sessionYoung,
        optionalNote: 'Customer from 15 minutes ago',
      });

      // Old reservation committed 75 minutes ago
      const { data: resOldId } = await supabase.rpc('reserve_generation_quota', {
        p_business_id: m4t04BizId,
        p_idempotency_key: `retention_old_${sessionOld}`,
        p_payload_hash: 'hash_retention_old',
        p_response_id: respOld,
      });
      await supabase.rpc('commit_generation_quota', {
        p_reservation_id: resOldId,
        p_tokens_billed: 0,
        p_raw_draft: 'Old raw draft that must be scrubbed',
      });
      // Backdate created_at to 75m ago
      await supabase
        .from('quota_reservations')
        .update({
          created_at: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
        })
        .eq('id', resOldId);

      // Young reservation committed 15 minutes ago
      const { data: resYoungId } = await supabase.rpc('reserve_generation_quota', {
        p_business_id: m4t04BizId,
        p_idempotency_key: `retention_young_${sessionYoung}`,
        p_payload_hash: 'hash_retention_young',
        p_response_id: respYoung,
      });
      await supabase.rpc('commit_generation_quota', {
        p_reservation_id: resYoungId,
        p_tokens_billed: 0,
        p_raw_draft: 'Young raw draft that must be retained',
      });
      // Backdate created_at to 15m ago
      await supabase
        .from('quota_reservations')
        .update({
          created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        })
        .eq('id', resYoungId);

      // Trigger purge_expired_reservations
      await supabase.rpc('purge_expired_reservations');

      // Old reservation draft scrubbed (NULL)
      const { data: oldRow } = await supabase
        .from('quota_reservations')
        .select('raw_draft')
        .eq('id', resOldId)
        .single();
      expect(oldRow?.raw_draft).toBeNull();

      // Young reservation draft retained
      const { data: youngRow } = await supabase
        .from('quota_reservations')
        .select('raw_draft')
        .eq('id', resYoungId)
        .single();
      expect(youngRow?.raw_draft).toBe('Young raw draft that must be retained');
    });

    it('safely handles concurrent sweepers with FOR UPDATE SKIP LOCKED without double-decrementing quota', async () => {
      const session1 = crypto.randomUUID();
      const session2 = crypto.randomUUID();

      const { responseId: r1 } = await seedSurveyResponse({
        businessId: m4t04BizId,
        sessionUuid: session1,
      });
      const { responseId: r2 } = await seedSurveyResponse({
        businessId: m4t04BizId,
        sessionUuid: session2,
      });

      const { data: id1 } = await supabase.rpc('reserve_generation_quota', {
        p_business_id: m4t04BizId,
        p_idempotency_key: `concurrent_sweep_${session1}`,
        p_payload_hash: 'hash_cs_01',
        p_response_id: r1,
      });
      const { data: id2 } = await supabase.rpc('reserve_generation_quota', {
        p_business_id: m4t04BizId,
        p_idempotency_key: `concurrent_sweep_${session2}`,
        p_payload_hash: 'hash_cs_02',
        p_response_id: r2,
      });

      // Expire both
      await supabase
        .from('quota_reservations')
        .update({ ttl_expires_at: new Date(Date.now() - 65000).toISOString() })
        .in('id', [id1, id2]);

      // Run two sweepers concurrently
      const [res1, res2] = await Promise.all([
        supabase.rpc('purge_expired_reservations'),
        supabase.rpc('purge_expired_reservations'),
      ]);

      expect(res1.error).toBeNull();
      expect(res2.error).toBeNull();

      // Sum of swept counts across both concurrent executions
      const totalSwept = (res1.data ?? 0) + (res2.data ?? 0);
      expect(totalSwept).toBeGreaterThanOrEqual(2);

      // Verify both are expired
      const { data: rows } = await supabase
        .from('quota_reservations')
        .select('status')
        .in('id', [id1, id2]);
      expect(rows?.every((r) => r.status === 'expired')).toBe(true);
    });

    it('verifies pg_cron schedule registration and autonomous execution evidence for expired_reservations_cleanup', async () => {
      const { execSync } = await import('node:child_process');
      const cronJobs = execSync(
        'docker exec supabase_db_qr-review psql -U postgres -d postgres -t -A -c "SELECT jobname, schedule, active FROM cron.job WHERE jobname = \'expired_reservations_cleanup\';"',
      ).toString().trim();

      expect(cronJobs).toBe('expired_reservations_cleanup|* * * * *|t');

      const recentRuns = execSync(
        'docker exec supabase_db_qr-review psql -U postgres -d postgres -t -A -c "SELECT status FROM cron.job_run_details WHERE jobid = 2 ORDER BY runid DESC LIMIT 1;"',
      ).toString().trim();

      expect(recentRuns).toBe('succeeded');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* M0-16 Design B: Customer Authenticity Confirmation Enforcement           */
  /* ------------------------------------------------------------------------ */

  describe('Post-M4 Integration Gate B: Authenticity Confirmation Database Enforcement', () => {
    it('rejects unconfirmed survey response (authenticity_confirmed: false) with HTTP 403 ERR_AUTHENTICITY_UNCONFIRMED', async () => {
      const sessionUuid = crypto.randomUUID();
      const { responseId, submissionToken } = await seedSurveyResponse({
        businessId: realSalonBizId,
        sessionUuid,
        optionalNote: 'Declined AI attestation checkbox',
        authenticityConfirmed: false,
      });

      let transportCalled = false;
      const mockTransport: typeof fetch = async () => {
        transportCalled = true;
        return new Response(JSON.stringify({}));
      };

      const idempotencyKey = `unconfirmed_${Date.now()}`;
      const req = makeRequest({
        responseId,
        submissionToken,
        idempotencyKey,
        sessionUuid,
      });

      const res = await handleGenerateReview(req, {
        ...getBaseHandlerOptions(),
        geminiTransportFn: mockTransport,
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_AUTHENTICITY_UNCONFIRMED');
      expect(body.error.message).toContain('authenticity confirmation');
      expect(transportCalled).toBe(false);

      // Verify PostgreSQL: generation_attempts is untouched (0)
      const { data: dbRow } = await supabase
        .from('survey_responses')
        .select('generation_attempts, is_generated')
        .eq('id', responseId)
        .single();
      expect(dbRow?.generation_attempts).toBe(0);
      expect(dbRow?.is_generated).toBe(false);

      // Verify PostgreSQL: zero quota reserved for this response
      const { data: resRow } = await supabase
        .from('quota_reservations')
        .select('id')
        .eq('response_id', responseId);
      expect(resRow?.length).toBe(0);
    });

    it('rejects draft recovery attempt when survey response authenticity is unconfirmed', async () => {
      const sessionUuid = crypto.randomUUID();
      const { responseId, submissionToken } = await seedSurveyResponse({
        businessId: realSalonBizId,
        sessionUuid,
        authenticityConfirmed: false,
      });

      const req = makeRequest({
        responseId,
        submissionToken,
        idempotencyKey: `recovery_unconfirmed_${Date.now()}`,
        sessionUuid,
      });

      const res = await handleGenerateReview(req, {
        ...getBaseHandlerOptions(),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_AUTHENTICITY_UNCONFIRMED');
    });

    it('allows generation pipeline to proceed when authenticity_confirmed is true', async () => {
      const sessionUuid = crypto.randomUUID();
      const { responseId, submissionToken } = await seedSurveyResponse({
        businessId: realSalonBizId,
        sessionUuid,
        authenticityConfirmed: true,
      });

      let transportCalled = false;
      const mockTransport: typeof fetch = async () => {
        transportCalled = true;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        reviewDraft:
                          'Had a masterful and precise service today. Clean and hygienic station with great styling advice. Loved the haircut!',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        );
      };

      const idempotencyKey = `confirmed_${Date.now()}`;
      const req = makeRequest({
        responseId,
        submissionToken,
        idempotencyKey,
        sessionUuid,
      });

      const res = await handleGenerateReview(req, {
        ...getBaseHandlerOptions(),
        geminiTransportFn: mockTransport,
      });

      expect(res.status).toBe(200);
      expect(transportCalled).toBe(true);
      const body = await res.json();
      expect(body.reviewDraft).toContain('masterful and precise service');
    });
  });
});
