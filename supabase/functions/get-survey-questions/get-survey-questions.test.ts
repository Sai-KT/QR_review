import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleGetSurveyQuestions,
  validateAndProjectQuestionnaire,
  SUCCESS_CACHE_CONTROL,
  ERROR_CACHE_CONTROL,
  type RawSurveyQuestionRow,
  type RawSurveyOptionRow,
} from './index';
import { fetchSurveyQuestions, ApiClientError } from '../../../src/lib/api/survey';

// ============================================================================
// Test Mock Fixtures
// ============================================================================

const TEST_JWT_SECRET = 'test-jwt-secret-for-signing-unit-tests-12345';
const VALID_CONFIGURED_KEY = 'sb_publishable_my_project_valid_key_001';

function makeTestJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function makeMockOptions(questionId: string): RawSurveyOptionRow[] {
  return [
    {
      id: `${questionId}-opt1`,
      question_id: questionId,
      option_text: 'Excellent service',
      emoji_anchor: '✨',
      sentiment_label: 'positive',
      is_neutral_na: false,
      is_active: true,
      display_order: 1,
    },
    {
      id: `${questionId}-opt2`,
      question_id: questionId,
      option_text: 'Good / Satisfactory',
      emoji_anchor: '👍',
      sentiment_label: 'positive',
      is_neutral_na: false,
      is_active: true,
      display_order: 2,
    },
    {
      id: `${questionId}-opt3`,
      question_id: questionId,
      option_text: 'Could be improved',
      emoji_anchor: '⏳',
      sentiment_label: 'negative',
      is_neutral_na: false,
      is_active: true,
      display_order: 3,
    },
    {
      id: `${questionId}-opt4-na`,
      question_id: questionId,
      option_text: 'Not applicable / Not sure',
      emoji_anchor: '🤷',
      sentiment_label: 'neutral',
      is_neutral_na: true,
      is_active: true,
      display_order: 4,
    },
  ];
}

function makeMockQuestions(categoryId: 'salon' | 'cafe'): RawSurveyQuestionRow[] {
  return [
    {
      id: `${categoryId}-q1`,
      category_id: categoryId,
      question_text: `How was your ${categoryId} experience?`,
      display_order: 1,
      is_active: true,
      survey_options: makeMockOptions(`${categoryId}-q1`),
    },
    {
      id: `${categoryId}-q2`,
      category_id: categoryId,
      question_text: 'How was staff hospitality?',
      display_order: 2,
      is_active: true,
      survey_options: makeMockOptions(`${categoryId}-q2`),
    },
    {
      id: `${categoryId}-q3`,
      category_id: categoryId,
      question_text: 'What stood out most?',
      display_order: 3,
      is_active: true,
      survey_options: makeMockOptions(`${categoryId}-q3`),
    },
  ];
}

function createMockSupabase(options?: {
  questionsData?: RawSurveyQuestionRow[] | null;
  dbError?: { message: string } | null;
}): SupabaseClient {
  const queryResult = {
    data: options?.questionsData !== undefined ? options.questionsData : makeMockQuestions('salon'),
    error: options?.dbError ?? null,
  };

  const chain: unknown = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve(queryResult),
  };

  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}

function makeGetRequest(
  url = 'https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon',
  customHeaders: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: 'GET',
    headers: {
      apikey: VALID_CONFIGURED_KEY,
      ...customHeaders,
    },
  });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('M3-T02: Edge Function get-survey-questions (API-PUB-02)', () => {
  const originalUrlEnv = process.env['SUPABASE_URL'];
  const originalServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  beforeEach(() => {
    process.env['SUPABASE_URL'] = 'http://127.0.0.1:54321';
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key-never-accept-on-public';
  });

  afterEach(() => {
    if (originalUrlEnv !== undefined) {
      process.env['SUPABASE_URL'] = originalUrlEnv;
    } else {
      delete process.env['SUPABASE_URL'];
    }
    if (originalServiceKey !== undefined) {
      process.env['SUPABASE_SERVICE_ROLE_KEY'] = originalServiceKey;
    } else {
      delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    }
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Core Contract & Happy Paths                                           */
  /* ------------------------------------------------------------------------ */

  it('1. returns HTTP 200 and exactly 3 ordered questions for valid salon category', async () => {
    const mockClient = createMockSupabase({ questionsData: makeMockQuestions('salon') });
    const req = makeGetRequest('https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon');

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const body = await res.json();
    expect(body.categoryId).toBe('salon');
    expect(body.surveyVersion).toBeDefined();
    expect(body.surveyVersion).toMatch(/^sv_[a-f0-9]{16}$/);
    expect(body.questions).toHaveLength(3);

    // Verify ordering
    expect(body.questions[0].displayOrder).toBe(1);
    expect(body.questions[1].displayOrder).toBe(2);
    expect(body.questions[2].displayOrder).toBe(3);

    // Verify options
    for (const q of body.questions) {
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      const naOptions = q.options.filter((o: { isNeutralNa: boolean }) => o.isNeutralNa);
      expect(naOptions).toHaveLength(1);
      expect(naOptions[0].sentiment).toBe('neutral');
    }
  });

  it('2. returns HTTP 200 and exactly 3 ordered questions for valid cafe category', async () => {
    const mockClient = createMockSupabase({ questionsData: makeMockQuestions('cafe') });
    const req = makeGetRequest('https://edge.example.com/functions/v1/get-survey-questions?categoryId=cafe');

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categoryId).toBe('cafe');
    expect(body.questions).toHaveLength(3);
  });

  it('3. verifies public DTO contains zero private/internal metadata', async () => {
    const mockClient = createMockSupabase({ questionsData: makeMockQuestions('salon') });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    const body = await res.json();
    const firstQ = body.questions[0];

    // Assert internal fields are NOT present
    expect(firstQ.created_at).toBeUndefined();
    expect(firstQ.createdAt).toBeUndefined();
    expect(firstQ.is_active).toBeUndefined();
    expect(firstQ.isActive).toBeUndefined();
    expect(firstQ.category_id).toBeUndefined();

    const firstOpt = firstQ.options[0];
    expect(firstOpt.created_at).toBeUndefined();
    expect(firstOpt.is_active).toBeUndefined();
    expect(firstOpt.question_id).toBeUndefined();
    expect(firstOpt.weight).toBeUndefined();

    // Assert allowed public fields
    expect(firstOpt).toHaveProperty('id');
    expect(firstOpt).toHaveProperty('optionText');
    expect(firstOpt).toHaveProperty('emojiAnchor');
    expect(firstOpt).toHaveProperty('sentiment');
    expect(firstOpt).toHaveProperty('isNeutralNa');
  });

  it('4. excludes soft-retired (is_active = false) options and questions', async () => {
    const questionsWithInactive = makeMockQuestions('salon');
    // Add inactive option
    questionsWithInactive[0]!.survey_options!.push({
      id: 'opt-inactive-retired',
      option_text: 'Old deprecated option',
      emoji_anchor: '👴',
      sentiment_label: 'neutral',
      is_neutral_na: false,
      is_active: false,
      display_order: 5,
    });

    const mockClient = createMockSupabase({ questionsData: questionsWithInactive });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    const body = await res.json();
    const q1Options = body.questions[0].options;
    const foundInactive = q1Options.find((o: { id: string }) => o.id === 'opt-inactive-retired');
    expect(foundInactive).toBeUndefined();
    expect(q1Options).toHaveLength(4);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Caching & Security Headers                                            */
  /* ------------------------------------------------------------------------ */

  it('5. returns authoritative 24-hour CDN Cache-Control header on HTTP 200', async () => {
    const mockClient = createMockSupabase();
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(SUCCESS_CACHE_CONTROL);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=86400');
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
    expect(res.headers.get('Cache-Control')).toContain('stale-while-revalidate=604800');
  });

  it('6. returns no-store Cache-Control header on error responses', async () => {
    const req = makeGetRequest('https://edge.example.com/functions/v1/get-survey-questions?categoryId=unsupported');

    const res = await handleGetSurveyQuestions(req, {
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe(ERROR_CACHE_CONTROL);
  });

  it('7. returns all required security and CORS headers', async () => {
    const mockClient = createMockSupabase();
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
      correlationId: 'corr_test_123',
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('X-Request-Id')).toBe('corr_test_123');
  });

  it('8. handles OPTIONS preflight request with HTTP 204 and CORS headers', async () => {
    const req = new Request('https://edge.example.com/functions/v1/get-survey-questions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
      },
    });

    const res = await handleGetSurveyQuestions(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('9. rejects non-GET and non-OPTIONS HTTP methods with HTTP 405 ERR_METHOD_NOT_ALLOWED', async () => {
    const req = new Request('https://edge.example.com/functions/v1/get-survey-questions', {
      method: 'POST',
      headers: { apikey: VALID_CONFIGURED_KEY },
      body: JSON.stringify({ categoryId: 'salon' }),
    });

    const res = await handleGetSurveyQuestions(req, { expectedApiKey: VALID_CONFIGURED_KEY });
    expect(res.status).toBe(405);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
    expect(res.headers.get('Allow')).toBe('GET, OPTIONS');
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Parameter Validation & Versioning                                     */
  /* ------------------------------------------------------------------------ */

  it('10. rejects missing categoryId with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const req = makeGetRequest('https://edge.example.com/functions/v1/get-survey-questions');

    const res = await handleGetSurveyQuestions(req, { expectedApiKey: VALID_CONFIGURED_KEY });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('11. rejects invalid/unsupported categoryId with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const req = makeGetRequest('https://edge.example.com/functions/v1/get-survey-questions?categoryId=restaurant');

    const res = await handleGetSurveyQuestions(req, { expectedApiKey: VALID_CONFIGURED_KEY });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('12. accepts valid cache-busting version parameter', async () => {
    const mockClient = createMockSupabase();
    const req = makeGetRequest('https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon&v=v2_20261101');

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categoryId).toBe('salon');
  });

  it('13. rejects invalid version parameter format with HTTP 400 ERR_INVALID_VERSION', async () => {
    const req = makeGetRequest('https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon&v=bad%20version!@#$');

    const res = await handleGetSurveyQuestions(req, { expectedApiKey: VALID_CONFIGURED_KEY });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_VERSION');
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Public API Authentication & Cryptographic Verification                */
  /* ------------------------------------------------------------------------ */

  it('14. rejects requests missing apikey or authorization header with HTTP 401 ERR_UNAUTHORIZED', async () => {
    const req = new Request('https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon');

    const res = await handleGetSurveyQuestions(req, { expectedApiKey: VALID_CONFIGURED_KEY });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('15. rejects arbitrary invalid apikey strings with HTTP 401 ERR_UNAUTHORIZED', async () => {
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon',
      { apikey: 'invalid-random-string' },
    );

    const res = await handleGetSurveyQuestions(req, { expectedApiKey: VALID_CONFIGURED_KEY });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('16. rejects random same-format publishable keys not belonging to this project with HTTP 401', async () => {
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon',
      { apikey: 'sb_publishable_fake_random_key_12345' },
    );

    const res = await handleGetSurveyQuestions(req, { expectedApiKey: VALID_CONFIGURED_KEY });
    expect(res.status).toBe(401);
  });

  it('17. rejects elevated service_role key with HTTP 401 ERR_UNAUTHORIZED', async () => {
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon',
      { apikey: 'test-service-role-key-never-accept-on-public' },
    );

    const res = await handleGetSurveyQuestions(req, { expectedApiKey: VALID_CONFIGURED_KEY });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
    expect(body.error.message).toContain('Service role key is forbidden');
  });

  it('18. rejects malformed JWTs that have 3 parts but invalid payload or header with HTTP 401', async () => {
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon',
      { Authorization: 'Bearer aW52YWxpZA.cGF5bG9hZA.c2ln' },
    );

    const res = await handleGetSurveyQuestions(req, {
      expectedApiKey: VALID_CONFIGURED_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(res.status).toBe(401);
  });

  it('19. rejects forged JWTs with valid format but invalid signature with HTTP 401', async () => {
    const forgedToken = makeTestJwt({ sub: 'attacker', exp: Math.floor(Date.now() / 1000) + 3600 }, 'attacker-secret');
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon',
      { Authorization: `Bearer ${forgedToken}` },
    );

    const res = await handleGetSurveyQuestions(req, {
      expectedApiKey: VALID_CONFIGURED_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(res.status).toBe(401);
  });

  it('20. accepts valid JWT cryptographically signed with project secret', async () => {
    const validToken = makeTestJwt(
      { sub: 'valid-patron', exp: Math.floor(Date.now() / 1000) + 3600 },
      TEST_JWT_SECRET,
    );
    const mockClient = createMockSupabase();
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon',
      { Authorization: `Bearer ${validToken}`, apikey: '' },
    );

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(res.status).toBe(200);
  });

  it('21. accepts valid publishable key passed via Authorization: Bearer header', async () => {
    const mockClient = createMockSupabase();
    const req = new Request(
      'https://edge.example.com/functions/v1/get-survey-questions?categoryId=salon',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${VALID_CONFIGURED_KEY}`,
        },
      },
    );

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });
    expect(res.status).toBe(200);
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Questionnaire Configuration Validation & Defensive Boundaries         */
  /* ------------------------------------------------------------------------ */

  it('22. fails with HTTP 500 when database has fewer than 3 active questions', async () => {
    const twoQuestions = makeMockQuestions('salon').slice(0, 2);
    const mockClient = createMockSupabase({ questionsData: twoQuestions });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_QUESTIONNAIRE_CONFIG');
    expect(body.error.message).toContain('expected exactly 3 active questions');
  });

  it('23. fails with HTTP 500 when database has more than 3 active questions', async () => {
    const fourQuestions = makeMockQuestions('salon');
    fourQuestions.push({
      id: 'salon-q4',
      question_text: 'Extra fourth question',
      display_order: 4,
      is_active: true,
      survey_options: makeMockOptions('salon-q4'),
    });
    const mockClient = createMockSupabase({ questionsData: fourQuestions });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_QUESTIONNAIRE_CONFIG');
  });

  it('24. fails with HTTP 500 when questions have duplicate display_order', async () => {
    const dupOrder = makeMockQuestions('salon');
    dupOrder[1]!.display_order = 1; // 1, 1, 3
    const mockClient = createMockSupabase({ questionsData: dupOrder });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_QUESTIONNAIRE_CONFIG');
  });

  it('25. fails with HTTP 500 when a question is missing the mandatory neutral N/A option', async () => {
    const noNaQuestions = makeMockQuestions('salon');
    // Remove N/A from question 1
    noNaQuestions[0]!.survey_options = noNaQuestions[0]!.survey_options!.filter((o) => !o.is_neutral_na);
    const mockClient = createMockSupabase({ questionsData: noNaQuestions });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_QUESTIONNAIRE_CONFIG');
    expect(body.error.message).toContain('must have exactly 1 neutral N/A option, found 0');
  });

  it('26. fails with HTTP 500 when a question has multiple neutral N/A options', async () => {
    const multiNaQuestions = makeMockQuestions('salon');
    // Add second N/A
    multiNaQuestions[0]!.survey_options!.push({
      id: 'opt-na-2',
      option_text: 'Second N/A option',
      emoji_anchor: '🤷',
      sentiment_label: 'neutral',
      is_neutral_na: true,
      is_active: true,
      display_order: 5,
    });
    const mockClient = createMockSupabase({ questionsData: multiNaQuestions });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_QUESTIONNAIRE_CONFIG');
    expect(body.error.message).toContain('must have exactly 1 neutral N/A option, found 2');
  });

  it('27. fails with HTTP 500 when a question has fewer than 3 active options', async () => {
    const fewOptionsQuestions = makeMockQuestions('salon');
    fewOptionsQuestions[0]!.survey_options = fewOptionsQuestions[0]!.survey_options!.slice(0, 2);
    const mockClient = createMockSupabase({ questionsData: fewOptionsQuestions });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_QUESTIONNAIRE_CONFIG');
    expect(body.error.message).toContain('insufficient active options');
  });

  it('28. fails with HTTP 500 ERR_INTERNAL when database query returns an error', async () => {
    const mockClient = createMockSupabase({
      questionsData: null,
      dbError: { message: 'connection refused' },
    });
    const req = makeGetRequest();

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: mockClient,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INTERNAL');
    expect(body.error.message).toBe('Database query failed while retrieving survey questions.');
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Frontend API Client Adapter Tests                                      */
  /* ------------------------------------------------------------------------ */

  it('29. fetchSurveyQuestions client adapter parses response into SurveyQuestionsDto', async () => {
    const mockResponsePayload = {
      categoryId: 'salon',
      surveyVersion: 'sv_test_salon_v1',
      questions: [
        {
          id: 'q-1',
          displayOrder: 1,
          questionText: 'Service quality?',
          options: [
            { id: 'opt-1', optionText: 'Great', emojiAnchor: '✂️', sentiment: 'positive', isNeutralNa: false },
            { id: 'opt-2', optionText: 'N/A', emojiAnchor: '🤷', sentiment: 'neutral', isNeutralNa: true },
          ],
        },
      ],
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(mockResponsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await fetchSurveyQuestions('salon', {
      fetchFn: mockFetch as unknown as typeof fetch,
      baseUrl: 'http://127.0.0.1:54321',
      anonKey: 'test-anon-key',
    });

    expect(result.categoryId).toBe('salon');
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].displayOrder).toBe(1);
    expect(result.questions[0].options[0].sentiment).toBe('positive');
  });

  it('30. fetchSurveyQuestions rejects unsupported category before network call', async () => {
    await expect(fetchSurveyQuestions('bakery')).rejects.toThrow(ApiClientError);
    await expect(fetchSurveyQuestions('')).rejects.toThrow('Invalid category');
  });

  it('31. fetchSurveyQuestions maps HTTP 400 error response to ApiClientError', async () => {
    const mockErrorFetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'ERR_INVALID_VERSION',
            message: 'Version format error',
            correlationId: 'corr_test_err',
            retryable: false,
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );

    try {
      await fetchSurveyQuestions('salon', {
        fetchFn: mockErrorFetch as unknown as typeof fetch,
      });
      expect.fail('Should have thrown ApiClientError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.code).toBe('ERR_INVALID_VERSION');
      expect(apiErr.correlationId).toBe('corr_test_err');
    }
  });

  it('32. validateAndProjectQuestionnaire standalone helper unit test', () => {
    const raw = makeMockQuestions('salon');
    const result = validateAndProjectQuestionnaire('salon', raw);
    expect(result.valid).toBe(true);
    expect(result.data?.categoryId).toBe('salon');
    expect(result.data?.surveyVersion).toBeDefined();
    expect(result.data?.surveyVersion).toMatch(/^sv_[a-f0-9]{16}$/);
    expect(result.data?.questions).toHaveLength(3);

    // Empty list
    const emptyResult = validateAndProjectQuestionnaire('salon', []);
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errorCode).toBe('ERR_INVALID_QUESTIONNAIRE_CONFIG');
  });
});
