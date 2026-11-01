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
import { handleGenerateReview } from './index';
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

  beforeAll(async () => {
    process.env['SUPABASE_URL'] = LOCAL_SUPABASE_URL;
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = LOCAL_SERVICE_ROLE_KEY;
    supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    // 1. Clean up quota reservations created in tests
    if (createdResponseIds.length > 0) {
      await supabase
        .from('quota_reservations')
        .delete()
        .in('response_id', createdResponseIds);
    }

    // 2. Clean up survey responses
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
        .in('bucket_key', createdRateLimitKeys);
    }
  });

  /**
   * Helper to seed an authentic survey response row in PostgreSQL
   */
  async function seedSurveyResponse(params: {
    businessId: string;
    sessionUuid: string;
    affirmedFacts?: string[];
    optionalNote?: string | null;
    selectedOptions?: Array<{ questionId: string; optionId: string }>;
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

    const { data, error } = await supabase
      .from('survey_responses')
      .insert({
        business_id: params.businessId,
        category_id: 'salon',
        session_uuid: params.sessionUuid,
        selected_options: selectedOptions,
        affirmed_facts_snapshot: affirmedFacts,
        optional_note: optionalNote,
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
    const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
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

    // Track for cleanup
    createdRateLimitKeys.push(`gen_${testIp}`);
  });
});
