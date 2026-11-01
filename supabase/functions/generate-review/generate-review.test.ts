import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleGenerateReview,
  GenerateReviewRequestSchema,
  extractApiKey,
  validateProjectApiKey,
  extractClientIp,
  cleanAndNormalizeIp,
  deriveDailySalt,
  computeIpHash,
  deriveSentimentFromOptions,
  type GenerateReviewHandlerOptions,
} from './index';
import {
  signSubmissionToken,
  computeSurveyVersion,
} from '../_shared/crypto';

describe('Edge Function: generate-review (API-PUB-03 / M4-T02 Unit Suite)', () => {
  const mockSigningSecret =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const mockRateLimitSalt =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const mockJwtSecret = 'super-secret-jwt-token-with-at-least-32-characters-long';
  const mockValidApiKey = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

  const mockBusinessId = '4a6b8c0d-1234-4000-8000-000000000001';
  const mockResponseId = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a';
  const mockSessionUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const mockQuestionIds = [
    '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
    '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d',
    '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e',
  ];
  const mockSurveyVersion = computeSurveyVersion(mockQuestionIds);

  let validSubmissionToken: string;

  beforeEach(() => {
    validSubmissionToken = signSubmissionToken({
      responseId: mockResponseId,
      businessId: mockBusinessId,
      sessionUuid: mockSessionUuid,
      surveyVersion: mockSurveyVersion,
      secret: mockSigningSecret,
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Request Schema & Header Helper Tests                                  */
  /* ------------------------------------------------------------------------ */

  describe('Request Schema & Extraction Utilities', () => {
    it('validates a strictly conforming request body', () => {
      const payload = {
        responseId: mockResponseId,
        submissionToken: validSubmissionToken,
        idempotencyKey: `${mockSessionUuid}_1`,
      };
      const result = GenerateReviewRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects unexpected extra fields (strict schema)', () => {
      const payload = {
        responseId: mockResponseId,
        submissionToken: validSubmissionToken,
        idempotencyKey: `${mockSessionUuid}_1`,
        businessId: mockBusinessId, // Forbidden client-supplied field
      };
      const result = GenerateReviewRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects invalid response UUID format', () => {
      const payload = {
        responseId: 'not-a-valid-uuid',
        submissionToken: validSubmissionToken,
        idempotencyKey: 'attempt_1',
      };
      const result = GenerateReviewRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('extracts API key from header or bearer authorization', () => {
      const reqWithHeader = new Request('http://localhost/generate-review', {
        headers: { apikey: mockValidApiKey },
      });
      expect(extractApiKey(reqWithHeader)).toBe(mockValidApiKey);

      const reqWithBearer = new Request('http://localhost/generate-review', {
        headers: { authorization: `Bearer ${mockValidApiKey}` },
      });
      expect(extractApiKey(reqWithBearer)).toBe(mockValidApiKey);
    });

    it('strictly rejects API key provided via URL query string', () => {
      const reqWithQuery = new Request(
        `http://localhost/generate-review?apikey=${mockValidApiKey}`,
      );
      expect(extractApiKey(reqWithQuery)).toBeNull();
    });

    it('validates project publishable keys and rejects privileged service-role keys', () => {
      const validSet = new Set([mockValidApiKey]);
      const validRes = validateProjectApiKey(mockValidApiKey, validSet, mockJwtSecret);
      expect(validRes.valid).toBe(true);
      expect(validRes.isPrivileged).toBe(false);

      const invalidRes = validateProjectApiKey('fake-key-12345', validSet, mockJwtSecret);
      expect(invalidRes.valid).toBe(false);

      // Null check
      const nullRes = validateProjectApiKey(null, validSet, mockJwtSecret);
      expect(nullRes.valid).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Client IP Extraction & Hashing Tests                                  */
  /* ------------------------------------------------------------------------ */

  describe('Client IP Extraction & Pseudonymization', () => {
    it('normalizes valid IPv4 addresses', () => {
      expect(cleanAndNormalizeIp('192.168.1.10')).toBe('192.168.1.10');
      expect(cleanAndNormalizeIp(' 10.0.0.1:8080 ')).toBe('10.0.0.1');
    });

    it('rejects invalid or malformed IP addresses', () => {
      expect(cleanAndNormalizeIp('999.999.999.999')).toBeNull();
      expect(cleanAndNormalizeIp('not-an-ip')).toBeNull();
    });

    it('computes deterministic HMAC-SHA256 IP hashes with daily salt', () => {
      const dailySalt = deriveDailySalt(mockRateLimitSalt, '2026-11-01');
      const hash1 = computeIpHash(dailySalt, '103.21.244.15');
      const hash2 = computeIpHash(dailySalt, '103.21.244.15');
      const hashDifferentIp = computeIpHash(dailySalt, '103.21.244.16');

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashDifferentIp);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('prioritizes direct x-real-ip over caller-supplied cf-connecting-ip and x-forwarded-for', () => {
      const req = new Request('http://localhost/generate-review', {
        headers: {
          'x-real-ip': '198.51.100.1',
          'cf-connecting-ip': '203.0.113.1',
          'x-forwarded-for': '203.0.113.2',
        },
      });
      // Direct peer is not in Cloudflare CIDRs, so caller-supplied cf-connecting-ip is ignored
      expect(extractClientIp(req)).toBe('198.51.100.1');
    });

    it('discards caller-supplied cf-connecting-ip when connecting peer is not in Cloudflare CIDRs', () => {
      const req = new Request('http://localhost/generate-review', {
        headers: {
          'x-real-ip': '198.51.100.1',
          'cf-connecting-ip': '203.0.113.1',
        },
      });
      expect(extractClientIp(req, { trustCloudflareProxy: true })).toBe('198.51.100.1');
    });

    it('accepts cf-connecting-ip when peer is in Cloudflare CIDRs and trustCloudflareProxy is true', () => {
      const req = new Request('http://localhost/generate-review', {
        headers: {
          'x-real-ip': '103.21.244.1', // Inside Cloudflare CIDR 103.21.244.0/22
          'cf-connecting-ip': '203.0.113.50',
        },
      });
      expect(extractClientIp(req, { trustCloudflareProxy: true })).toBe('203.0.113.50');
    });

    it('evaluates rightmost valid IP in multi-hop x-forwarded-for chain when direct IP is absent', () => {
      const req = new Request('http://localhost/generate-review', {
        headers: {
          'x-forwarded-for': '203.0.113.1, 198.51.100.25, 192.0.2.99',
        },
      });
      expect(extractClientIp(req)).toBe('192.0.2.99');
    });

    it('fails closed and returns null on malformed IP header values', () => {
      const malformedRealIp = new Request('http://localhost/generate-review', {
        headers: { 'x-real-ip': 'malformed-ip' },
      });
      expect(extractClientIp(malformedRealIp)).toBeNull();

      const malformedForwarded = new Request('http://localhost/generate-review', {
        headers: { 'x-forwarded-for': 'invalid1, invalid2' },
      });
      expect(extractClientIp(malformedForwarded)).toBeNull();
    });

    it('falls back to 127.0.0.1 when no IP headers are present in test context', () => {
      const req = new Request('http://localhost/generate-review');
      expect(extractClientIp(req)).toBe('127.0.0.1');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Sentiment Derivation Utility                                          */
  /* ------------------------------------------------------------------------ */

  describe('deriveSentimentFromOptions', () => {
    it('derives positive sentiment when positive options dominate', () => {
      const options = [
        { sentiment_label: 'positive', is_neutral_na: false },
        { sentiment_label: 'positive', is_neutral_na: false },
        { sentiment_label: 'neutral', is_neutral_na: false },
      ];
      expect(deriveSentimentFromOptions(options)).toBe('positive');
    });

    it('derives negative sentiment when critical options dominate', () => {
      const options = [
        { sentiment_label: 'negative', is_neutral_na: false },
        { sentiment_label: 'negative', is_neutral_na: false },
        { sentiment_label: 'neutral', is_neutral_na: false },
      ];
      expect(deriveSentimentFromOptions(options)).toBe('negative');
    });

    it('excludes neutral N/A choices from sentiment calculation', () => {
      const options = [
        { sentiment_label: 'positive', is_neutral_na: false },
        { sentiment_label: 'neutral', is_neutral_na: true },
        { sentiment_label: 'neutral', is_neutral_na: true },
      ];
      expect(deriveSentimentFromOptions(options)).toBe('positive');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Complete Mocked HTTP Handler Pipeline Tests                           */
  /* ------------------------------------------------------------------------ */

  describe('handleGenerateReview - End-to-End Mocked Pipeline', () => {
    const defaultOptions: GenerateReviewHandlerOptions = {
      signingSecret: mockSigningSecret,
      rateLimitSalt: mockRateLimitSalt,
      jwtSecret: mockJwtSecret,
      expectedApiKey: mockValidApiKey,
    };

    const createMockSupabase = (overrides?: {
      surveyResponse?: Record<string, unknown> | null;
      business?: Record<string, unknown> | null;
      subscription?: Record<string, unknown> | null;
      rateLimitAllowed?: boolean;
      reserveQuotaResult?: string;
      reserveQuotaError?: { message: string } | null;
      cachedReservation?: Record<string, unknown> | null;
    }) => {
      const mockResponseData =
        overrides?.surveyResponse !== undefined
          ? overrides.surveyResponse
          : {
              id: mockResponseId,
              business_id: mockBusinessId,
              category_id: 'salon',
              session_uuid: mockSessionUuid,
              selected_options: [
                { questionId: mockQuestionIds[0], optionId: 'opt1' },
                { questionId: mockQuestionIds[1], optionId: 'opt2' },
                { questionId: mockQuestionIds[2], optionId: 'opt3' },
              ],
              affirmed_facts_snapshot: [
                'Masterful & Precise',
                'Clean & hygienic station',
                'Great styling advice',
              ],
              optional_note: 'Loved the trimmer fade',
              generation_attempts: 0,
              is_generated: false,
              created_at: new Date().toISOString(),
            };

      const mockBusinessData =
        overrides?.business !== undefined
          ? overrides.business
          : {
              id: mockBusinessId,
              name: 'Green Salon & Spa',
              category_id: 'salon',
              is_active: true,
              account_status: 'active',
            };

      const mockSubscriptionData =
        overrides?.subscription !== undefined
          ? overrides.subscription
          : { subscription_status: 'active' };

      return {
        from: (table: string) => {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (table === 'survey_responses') {
                    return { data: mockResponseData, error: null };
                  }
                  if (table === 'businesses') {
                    return { data: mockBusinessData, error: null };
                  }
                  if (table === 'subscriptions') {
                    return { data: mockSubscriptionData, error: null };
                  }
                  if (table === 'quota_reservations') {
                    return { data: overrides?.cachedReservation ?? null, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
              in: async () => {
                if (table === 'survey_options') {
                  return {
                    data: [
                      { sentiment_label: 'positive', is_neutral_na: false },
                      { sentiment_label: 'positive', is_neutral_na: false },
                      { sentiment_label: 'positive', is_neutral_na: false },
                    ],
                    error: null,
                  };
                }
                return { data: [], error: null };
              },
            }),
            insert: async () => ({ error: null }),
          };
        },
        rpc: async (fn: string) => {
          if (fn === 'check_rate_limit') {
            return {
              data: overrides?.rateLimitAllowed !== undefined ? overrides.rateLimitAllowed : true,
              error: null,
            };
          }
          if (fn === 'reserve_generation_quota') {
            if (overrides?.reserveQuotaError) {
              return { data: null, error: overrides.reserveQuotaError };
            }
            return {
              data: overrides?.reserveQuotaResult ?? 'b1c2d3e4-5555-4000-8000-000000000001',
              error: null,
            };
          }
          if (fn === 'commit_generation_quota') {
            return { data: null, error: null };
          }
          if (fn === 'release_generation_quota') {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
      } as unknown as SupabaseClient;
    };

    const createMockGeminiTransport = (responseJson: Record<string, unknown>, status = 200) => {
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify(responseJson), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      return mockFetch;
    };

    it('returns HTTP 204 for OPTIONS preflight request', async () => {
      const req = new Request('http://localhost/generate-review', { method: 'OPTIONS' });
      const res = await handleGenerateReview(req, defaultOptions);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('rejects non-POST HTTP methods with HTTP 405', async () => {
      const req = new Request('http://localhost/generate-review', { method: 'GET' });
      const res = await handleGenerateReview(req, defaultOptions);
      expect(res.status).toBe(405);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
    });

    it('rejects missing API key with HTTP 401 ERR_UNAUTHORIZED', async () => {
      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await handleGenerateReview(req, defaultOptions);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_UNAUTHORIZED');
    });

    it('successfully processes authenticated generation and commits quota (Happy Path)', async () => {
      const mockTransport = createMockGeminiTransport({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reviewDraft:
                      'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice. Loved the trimmer fade.',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      });

      const mockSupabase = createMockSupabase();

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
        geminiTransportFn: mockTransport,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.reviewDraft).toContain('Had a masterful and precise service today');
      expect(json.wordCount).toBe(23);
      expect(json.sentiment).toBe('positive');
    });

    it('rejects forged HMAC submission token with HTTP 403 (TC-API-10 / ROADMAP M4-T02)', async () => {
      const forgedToken = `${mockResponseId}.${Math.floor(Date.now() / 1000) + 300}.forged_signature_0000000000000000`;
      const mockSupabase = createMockSupabase();

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: forgedToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_INVALID_SUBMISSION_TOKEN');
    });

    it('rejects expired submission token with HTTP 401 ERR_TOKEN_EXPIRED', async () => {
      const expiredEpoch = Math.floor(Date.now() / 1000) - 100; // 100s in past
      const expiredToken = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
        exp: expiredEpoch,
        secret: mockSigningSecret,
      });

      const mockSupabase = createMockSupabase();

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: expiredToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_TOKEN_EXPIRED');
    });

    it('rejects suspended merchant with HTTP 403 ERR_BUSINESS_SUSPENDED', async () => {
      const mockSupabase = createMockSupabase({
        business: {
          id: mockBusinessId,
          name: 'Suspended Salon',
          is_active: false,
          account_status: 'suspended',
        },
      });

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_BUSINESS_SUSPENDED');
    });

    it('rejects past-due subscription with HTTP 402 ERR_SUBSCRIPTION_LAPSED', async () => {
      const mockSupabase = createMockSupabase({
        subscription: { subscription_status: 'past_due' },
      });

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(402);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_SUBSCRIPTION_LAPSED');
    });

    it('enforces IP rate limiting and returns HTTP 429 ERR_RATE_LIMIT_EXCEEDED', async () => {
      const mockSupabase = createMockSupabase({
        rateLimitAllowed: false,
      });

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.99',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_RATE_LIMIT_EXCEEDED');
      expect(res.headers.get('Retry-After')).toBe('60');
    });

    it('safely abstains on insufficient facts without reserving quota or calling Gemini (M0-16)', async () => {
      // Mock survey response with all neutral N/A choices and null note
      const mockSupabase = createMockSupabase({
        surveyResponse: {
          id: mockResponseId,
          business_id: mockBusinessId,
          category_id: 'salon',
          session_uuid: mockSessionUuid,
          selected_options: [
            { questionId: mockQuestionIds[0], optionId: 'opt1' },
            { questionId: mockQuestionIds[1], optionId: 'opt2' },
            { questionId: mockQuestionIds[2], optionId: 'opt3' },
          ],
          affirmed_facts_snapshot: [], // All filtered out
          optional_note: null,
          generation_attempts: 0,
          is_generated: false,
          created_at: new Date().toISOString(),
        },
      });

      const mockTransport = createMockGeminiTransport({});

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
        geminiTransportFn: mockTransport,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.abstained).toBe(true);
      expect(json.reason).toBe('INSUFFICIENT_FACTS');
      expect(json.reviewDraft).toBeNull();
    });

    it('handles quota exhaustion (150 ceiling) with HTTP 429 ERR_QUOTA_EXHAUSTED (TC-API-06)', async () => {
      const mockSupabase = createMockSupabase({
        reserveQuotaError: { message: 'ERR_QUOTA_EXHAUSTED' },
      });

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_QUOTA_EXHAUSTED');
    });

    it('handles concurrent in-flight generation with HTTP 409 ERR_CONCURRENT_REQUEST', async () => {
      const mockSupabase = createMockSupabase({
        reserveQuotaError: { message: 'ERR_CONCURRENT_REQUEST' },
      });

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_CONCURRENT_REQUEST');
      expect(json.retryAfterMs).toBe(1500);
    });

    it('releases reserved quota and returns HTTP 504 on Gemini timeout (TC-API-09)', async () => {
      // Mock Gemini timing out
      const mockTimeoutTransport: typeof fetch = async (_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      };

      const mockSupabase = createMockSupabase();

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
        geminiTransportFn: mockTimeoutTransport,
        geminiTimeoutMs: 50,
      });

      expect(res.status).toBe(504);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_GEMINI_TIMEOUT');
      expect(json.error.retryable).toBe(true);
    });

    it('releases quota and returns HTTP 502 on malformed markdown-fenced output', async () => {
      const mockTransport = createMockGeminiTransport({
        candidates: [
          {
            content: {
              parts: [{ text: '```json\n{"reviewDraft": "Malformed markdown fence"}\n```' }],
            },
            finishReason: 'STOP',
          },
        ],
      });

      const mockSupabase = createMockSupabase();

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
        geminiTransportFn: mockTransport,
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_MALFORMED_OUTPUT');
    });

    it('safely recovers cached draft for already committed reservation without double charge (M0-12 Option B)', async () => {
      const mockSupabase = createMockSupabase({
        reserveQuotaResult: 'b1c2d3e4-5555-4000-8000-000000000001',
        cachedReservation: {
          id: 'b1c2d3e4-5555-4000-8000-000000000001',
          status: 'committed',
          raw_draft:
            'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice. Loved the trimmer fade.',
        },
      });

      const mockTransport = createMockGeminiTransport({}); // Should NOT be called!

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
        geminiTransportFn: mockTransport,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.reviewDraft).toContain('Had a masterful and precise service today');
      expect(json.wordCount).toBe(23);
    });

    it('rejects expired submission token at pre-lookup without performing database query', async () => {
      let dbQueryAttempted = false;
      const trackingSupabase = {
        from: () => {
          dbQueryAttempted = true;
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        },
        rpc: async () => ({ data: null, error: null }),
      } as unknown as SupabaseClient;

      const expiredEpoch = Math.floor(Date.now() / 1000) - 30; // 30s in past
      const expiredToken = `${mockResponseId}.${expiredEpoch}.${'a'.repeat(64)}`;

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: expiredToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: trackingSupabase,
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_TOKEN_EXPIRED');
      expect(dbQueryAttempted).toBe(false);
    });

    it('rejects token with mismatched responseId at pre-lookup without database query', async () => {
      let dbQueryAttempted = false;
      const trackingSupabase = {
        from: () => {
          dbQueryAttempted = true;
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        },
        rpc: async () => ({ data: null, error: null }),
      } as unknown as SupabaseClient;

      // Token responseId differs from body responseId
      const mismatchedToken = `11111111-2222-3333-4444-555555555555.${Math.floor(Date.now() / 1000) + 300}.${'b'.repeat(64)}`;

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: mismatchedToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: trackingSupabase,
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_INVALID_SUBMISSION_TOKEN');
      expect(dbQueryAttempted).toBe(false);
    });

    it('rejects nonexistent response UUID with HTTP 403 matching forged token behavior (anti-enumeration)', async () => {
      const mockSupabase = createMockSupabase({
        surveyResponse: null, // Response row does not exist in DB
      });

      const nonexistentToken = `${mockResponseId}.${Math.floor(Date.now() / 1000) + 300}.${'c'.repeat(64)}`;

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: nonexistentToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      // Must return HTTP 403, NOT 404, to prevent response-existence enumeration
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_INVALID_SUBMISSION_TOKEN');
    });

    it('rejects valid token presented with mismatched client sessionUuid with HTTP 403 ERR_SESSION_MISMATCH', async () => {
      const mockSupabase = createMockSupabase();

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
          sessionUuid: '00000000-0000-0000-0000-000000000000', // Mismatched session
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_SESSION_MISMATCH');
    });

    it('rejects valid token bound to another business ID with HTTP 403', async () => {
      // Mint a token validly signed, but for a different business ID
      const otherBusinessId = 'e9999999-9999-4000-8000-000000000009';
      const foreignBizToken = signSubmissionToken({
        responseId: mockResponseId,
        businessId: otherBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
        exp: Math.floor(Date.now() / 1000) + 300,
        secret: mockSigningSecret,
      });

      const mockSupabase = createMockSupabase(); // Has mockBusinessId, not otherBusinessId

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: foreignBizToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_INVALID_SUBMISSION_TOKEN');
    });

    it('strictly rejects query-string-only API keys with HTTP 401 ERR_UNAUTHORIZED', async () => {
      const mockSupabase = createMockSupabase();

      const req = new Request(`http://localhost/generate-review?apikey=${mockValidApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_1`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('ERR_UNAUTHORIZED');
    });

    it('safely returns HTTP 200 with draft and committed quota when noncritical analytics insertion fails', async () => {
      const mockTransport = createMockGeminiTransport({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reviewDraft: 'Had a masterful and precise service today.',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      });

      const mockSupabase = createMockSupabase();
      const originalFrom = mockSupabase.from.bind(mockSupabase);
      mockSupabase.from = (table: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queryBuilder = (originalFrom as any)(table);
        if (table === 'analytics_events') {
          return {
            ...queryBuilder,
            insert: async () => ({
              error: { message: 'Database connection timeout on analytics table' },
            }),
          };
        }
        return queryBuilder;
      };

      const req = new Request('http://localhost/generate-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: mockValidApiKey,
          'x-real-ip': '103.21.244.15',
        },
        body: JSON.stringify({
          responseId: mockResponseId,
          submissionToken: validSubmissionToken,
          idempotencyKey: `${mockSessionUuid}_attempt_telemetry_fail`,
        }),
      });

      const res = await handleGenerateReview(req, {
        ...defaultOptions,
        supabaseClient: mockSupabase,
        geminiTransportFn: mockTransport,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.reviewDraft).toBe('Had a masterful and precise service today.');
      expect(json.wordCount).toBe(7);
    });
  });
});
