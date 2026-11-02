import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleFeedbackSubmission,
  calculateSentiment,
} from './index';
import { verifySubmissionToken, computeSurveyVersion } from '../_shared/crypto';

// ============================================================================
// Mock Test Fixtures
// ============================================================================

// 32 bytes (256 bits) encoded as 64 hexadecimal characters
const mockSigningSecret =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const mockBizId = '4a6b8c0d-1234-4000-8000-000000000001';
const mockPublicQrId = 'abc123xyz0';
const mockCategoryId = 'salon';
const mockSessionUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

const mockQ1 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c';
const mockQ2 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d';
const mockQ3 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e';

const mockOpt1 = '1a2b3c4d-0001-4000-8000-000000000001';
const mockOpt2 = '1a2b3c4d-0002-4000-8000-000000000002';
const mockOpt3 = '1a2b3c4d-0003-4000-8000-000000000003';
const mockOptNa = '1a2b3c4d-0001-4000-8000-000000000004'; // Neutral N/A

const validQuestions = [
  { id: mockQ1, display_order: 1, category_id: mockCategoryId, is_active: true },
  { id: mockQ2, display_order: 2, category_id: mockCategoryId, is_active: true },
  { id: mockQ3, display_order: 3, category_id: mockCategoryId, is_active: true },
];

const validOptions = [
  {
    id: mockOpt1,
    question_id: mockQ1,
    option_text: 'Masterful & Precise',
    sentiment_label: 'positive',
    is_neutral_na: false,
    is_active: true,
    display_order: 1,
  },
  {
    id: mockOpt2,
    question_id: mockQ2,
    option_text: 'Clean & hygienic station',
    sentiment_label: 'positive',
    is_neutral_na: false,
    is_active: true,
    display_order: 2,
  },
  {
    id: mockOpt3,
    question_id: mockQ3,
    option_text: 'Service took too long',
    sentiment_label: 'negative',
    is_neutral_na: false,
    is_active: true,
    display_order: 3,
  },
  {
    id: mockOptNa,
    question_id: mockQ1,
    option_text: 'Not applicable / Not sure',
    sentiment_label: 'neutral',
    is_neutral_na: true,
    is_active: true,
    display_order: 4,
  },
];

// ============================================================================
// Mock Supabase Client Factory
// ============================================================================

interface MockDbConfig {
  business?: {
    id: string;
    category_id: string;
    account_status: string;
    is_active: boolean;
  } | null;
  questions?: typeof validQuestions | null;
  options?: typeof validOptions | null;
  existingResponse?: {
    id: string;
    selected_options: Array<{ questionId: string; optionId: string }>;
    optional_note: string | null;
    authenticity_confirmed?: boolean;
    created_at: string;
  } | null;
  insertError?: { code: string; message: string } | null;
  onInsert?: (payload: unknown) => void;
}

function createMockSupabaseClient(config: MockDbConfig = {}) {
  const business = config.business !== undefined
    ? config.business
    : {
        id: mockBizId,
        category_id: mockCategoryId,
        account_status: 'active',
        is_active: true,
      };

  const questions = config.questions !== undefined ? config.questions : validQuestions;
  const options = config.options !== undefined ? config.options : validOptions;
  const existingResponse = config.existingResponse ?? null;

  const insertedRecordId = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a';
  const insertedCreatedAt = new Date().toISOString();

  return {
    from: vi.fn((table: string) => {
      if (table === 'businesses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: business,
                error: null,
              })),
            })),
          })),
        };
      }

      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(async () => ({
                  data: questions,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }

      if (table === 'survey_options') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async (...args: unknown[]) => {
              const values = args[1] as string[];
              return {
                data: options
                  ? options.filter((o) => values.includes(o.id))
                  : null,
                error: null,
              };
            }),
          })),
        };
      }

      if (table === 'survey_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: existingResponse,
                  error: null,
                })),
                single: vi.fn(async () => ({
                  data: existingResponse,
                  error: null,
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: unknown) => {
            config.onInsert?.(payload);
            if (config.insertError) {
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: null,
                    error: config.insertError,
                  })),
                })),
              };
            }
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: {
                    id: insertedRecordId,
                    created_at: insertedCreatedAt,
                  },
                  error: null,
                })),
              })),
            };
          }),
        };
      }

      if (table === 'analytics_events') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { id: 'evt-123' },
                error: null,
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
}

function buildTestRequest(body: unknown, method = 'POST'): Request {
  return new Request('https://edge.example.com/functions/v1/submit-feedback', {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: 'test-publishable-key',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ============================================================================
// Test Suite: submit-feedback (API-PUB-04 / M3-T03)
// ============================================================================

describe('submit-feedback Edge Function (API-PUB-04 / M3-T03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validPayload = {
    publicQrId: mockPublicQrId,
    sessionUuid: mockSessionUuid,
    responses: [
      { questionId: mockQ1, optionId: mockOpt1 },
      { questionId: mockQ2, optionId: mockOpt2 },
      { questionId: mockQ3, optionId: mockOpt3 },
    ],
    optionalNote: 'Loved the trimmer fade!',
  };

  /* ------------------------------------------------------------------------ */
  /* 1. HTTP Method & Preflight Handling                                      */
  /* ------------------------------------------------------------------------ */

  it('handles OPTIONS preflight with HTTP 204 and CORS headers', async () => {
    const req = new Request('https://edge.example.com/functions/v1/submit-feedback', {
      method: 'OPTIONS',
    });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects unsupported HTTP methods (e.g. GET) with HTTP 405', async () => {
    const req = new Request('https://edge.example.com/functions/v1/submit-feedback', {
      method: 'GET',
    });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Payload Validation & 150-Character Note Limit                         */
  /* ------------------------------------------------------------------------ */

  it('rejects malformed JSON body with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const req = new Request('https://edge.example.com/functions/v1/submit-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('rejects invalid publicQrId format (uppercase or wrong length)', async () => {
    const req = buildTestRequest({ ...validPayload, publicQrId: 'INVALID_QR!' });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('rejects invalid sessionUuid format', async () => {
    const req = buildTestRequest({ ...validPayload, sessionUuid: 'not-a-uuid' });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('rejects submissions with fewer than 3 answers', async () => {
    const req = buildTestRequest({
      ...validPayload,
      responses: [
        { questionId: mockQ1, optionId: mockOpt1 },
        { questionId: mockQ2, optionId: mockOpt2 },
      ],
    });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('rejects submissions with duplicate question answers', async () => {
    const req = buildTestRequest({
      ...validPayload,
      responses: [
        { questionId: mockQ1, optionId: mockOpt1 },
        { questionId: mockQ1, optionId: mockOpt1 },
        { questionId: mockQ3, optionId: mockOpt3 },
      ],
    });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('accepts optional note with exactly 150 characters', async () => {
    const exactly150Note = 'a'.repeat(150);
    const req = buildTestRequest({ ...validPayload, optionalNote: exactly150Note });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(201);
  });

  it('rejects optional note exceeding 150 characters with HTTP 422 ERR_NOTE_TOO_LONG', async () => {
    const note151 = 'a'.repeat(151);
    const req = buildTestRequest({ ...validPayload, optionalNote: note151 });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_NOTE_TOO_LONG');
  });

  it('accepts Unicode and emoji in notes within character limit', async () => {
    const emojiNote = '✂️ Loved the precise hair cut & clean station! ✨ Highly satisfied 😊';
    const req = buildTestRequest({ ...validPayload, optionalNote: emojiNote });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(201);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Business Resolution & Eligibility Controls                            */
  /* ------------------------------------------------------------------------ */

  it('returns HTTP 404 ERR_QR_NOT_FOUND when publicQrId does not exist', async () => {
    const client = createMockSupabaseClient({ business: null });
    const req = buildTestRequest(validPayload);
    const res = await handleFeedbackSubmission(req, client, mockSigningSecret);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_QR_NOT_FOUND');
  });

  it('returns HTTP 403 ERR_BUSINESS_SUSPENDED when merchant is suspended', async () => {
    const client = createMockSupabaseClient({
      business: {
        id: mockBizId,
        category_id: mockCategoryId,
        account_status: 'suspended',
        is_active: true,
      },
    });
    const req = buildTestRequest(validPayload);
    const res = await handleFeedbackSubmission(req, client, mockSigningSecret);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BUSINESS_SUSPENDED');
  });

  it('returns HTTP 403 ERR_BUSINESS_SUSPENDED when merchant is_active is false', async () => {
    const client = createMockSupabaseClient({
      business: {
        id: mockBizId,
        category_id: mockCategoryId,
        account_status: 'active',
        is_active: false,
      },
    });
    const req = buildTestRequest(validPayload);
    const res = await handleFeedbackSubmission(req, client, mockSigningSecret);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BUSINESS_SUSPENDED');
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Survey Question & Option Validation (TC-API-11)                       */
  /* ------------------------------------------------------------------------ */

  it('TC-API-11: rejects option belonging to a different category / question', async () => {
    const foreignQuestionId = '00000000-0000-4000-8000-000000000099';
    const req = buildTestRequest({
      ...validPayload,
      responses: [
        { questionId: foreignQuestionId, optionId: mockOpt1 },
        { questionId: mockQ2, optionId: mockOpt2 },
        { questionId: mockQ3, optionId: mockOpt3 },
      ],
    });
    const res = await handleFeedbackSubmission(req, createMockSupabaseClient(), mockSigningSecret);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('rejects option that is marked is_active = false (soft-retired choice)', async () => {
    const retiredOptions = validOptions.map((o) =>
      o.id === mockOpt1 ? { ...o, is_active: false } : o,
    );
    const client = createMockSupabaseClient({ options: retiredOptions });
    const req = buildTestRequest(validPayload);
    const res = await handleFeedbackSubmission(req, client, mockSigningSecret);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Atomic Persistence & Idempotent Retries (TC-API-12)                   */
  /* ------------------------------------------------------------------------ */

  it('TC-API-12: returns existing responseId and valid token on identical retry', async () => {
    const existingCreatedAt = new Date().toISOString();
    const client = createMockSupabaseClient({
      existingResponse: {
        id: 'existing-resp-uuid-1234',
        selected_options: validPayload.responses,
        optional_note: 'Loved the trimmer fade!',
        created_at: existingCreatedAt,
      },
    });

    const req = buildTestRequest(validPayload);
    const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('recorded');
    expect(body.responseId).toBe('existing-resp-uuid-1234');
    expect(typeof body.submissionToken).toBe('string');
  });

  it('rejects retry with conflicting payload (different options) with HTTP 409', async () => {
    const client = createMockSupabaseClient({
      existingResponse: {
        id: 'existing-resp-uuid-1234',
        selected_options: [
          { questionId: mockQ1, optionId: mockOpt1 },
          { questionId: mockQ2, optionId: mockOpt2 },
          { questionId: mockQ3, optionId: '1a2b3c4d-different-opt' },
        ],
        optional_note: 'Loved the trimmer fade!',
        created_at: new Date().toISOString(),
      },
    });

    const req = buildTestRequest(validPayload);
    const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_IDEMPOTENCY_CONFLICT');
  });

  it('rejects retry after the 10-minute token authorization window has expired (HTTP 410)', async () => {
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const client = createMockSupabaseClient({
      existingResponse: {
        id: 'existing-resp-uuid-1234',
        selected_options: validPayload.responses,
        optional_note: 'Loved the trimmer fade!',
        created_at: elevenMinutesAgo,
      },
    });

    const req = buildTestRequest(validPayload);
    const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_SUBMISSION_EXPIRED');
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Sentiment Calculation Semantics                                       */
  /* ------------------------------------------------------------------------ */

  describe('calculateSentiment helper function', () => {
    it('calculates average score for positive and negative selections', () => {
      const opts = [
        { sentiment_label: 'positive', is_neutral_na: false },
        { sentiment_label: 'positive', is_neutral_na: false },
        { sentiment_label: 'negative', is_neutral_na: false },
      ];
      const result = calculateSentiment(opts);
      expect(result.averageScore).toBe(0.33);
      expect(result.positiveCount).toBe(2);
      expect(result.negativeCount).toBe(1);
      expect(result.naCount).toBe(0);
      expect(result.applicableCount).toBe(3);
    });

    it('excludes neutral N/A selections from denominator', () => {
      const opts = [
        { sentiment_label: 'positive', is_neutral_na: false },
        { sentiment_label: 'neutral', is_neutral_na: true },
        { sentiment_label: 'neutral', is_neutral_na: true },
      ];
      const result = calculateSentiment(opts);
      expect(result.averageScore).toBe(1.0);
      expect(result.positiveCount).toBe(1);
      expect(result.naCount).toBe(2);
      expect(result.applicableCount).toBe(1);
    });

    it('returns null averageScore when all selections are N/A (M0-16 abstention flag)', () => {
      const opts = [
        { sentiment_label: 'neutral', is_neutral_na: true },
        { sentiment_label: 'neutral', is_neutral_na: true },
        { sentiment_label: 'neutral', is_neutral_na: true },
      ];
      const result = calculateSentiment(opts);
      expect(result.averageScore).toBeNull();
      expect(result.naCount).toBe(3);
      expect(result.applicableCount).toBe(0);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 7. End-to-End Successful Submission & Token Verification                 */
  /* ------------------------------------------------------------------------ */

  it('successfully persists submission and returns verified HMAC token', async () => {
    const client = createMockSupabaseClient();
    const req = buildTestRequest(validPayload);
    const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.status).toBe('recorded');
    expect(body.responseId).toBeDefined();
    expect(body.submissionToken).toBeDefined();

    // Verify token cryptographic binding
    const expectedVersion = computeSurveyVersion([mockQ1, mockQ2, mockQ3]);
    const verification = verifySubmissionToken(
      body.submissionToken,
      mockBizId,
      mockSessionUuid,
      expectedVersion,
      mockSigningSecret,
    );

    expect(verification.valid).toBe(true);
    expect(verification.responseId).toBe(body.responseId);
  });

  /* ------------------------------------------------------------------------ */
  /* 8. Customer Authenticity Confirmation (Founder Decision M0-16 / Gate B) */
  /* ------------------------------------------------------------------------ */

  describe('Customer Authenticity Confirmation (M0-16 Design B)', () => {
    it('persists authenticity_confirmed: true when submitted with affirmative attestation', async () => {
      let capturedPayload: Record<string, unknown> | null = null;
      const client = createMockSupabaseClient({
        onInsert: (payload) => {
          capturedPayload = payload as Record<string, unknown>;
        },
      });

      const req = buildTestRequest({
        ...validPayload,
        authenticityConfirmed: true,
      });
      const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

      expect(res.status).toBe(201);
      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload?.['authenticity_confirmed']).toBe(true);
    });

    it('persists authenticity_confirmed: false when submitted with false', async () => {
      let capturedPayload: Record<string, unknown> | null = null;
      const client = createMockSupabaseClient({
        onInsert: (payload) => {
          capturedPayload = payload as Record<string, unknown>;
        },
      });

      const req = buildTestRequest({
        ...validPayload,
        authenticityConfirmed: false,
      });
      const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

      expect(res.status).toBe(201);
      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload?.['authenticity_confirmed']).toBe(false);
    });

    it('defaults authenticity_confirmed to false when omitted (backward compatibility)', async () => {
      let capturedPayload: Record<string, unknown> | null = null;
      const client = createMockSupabaseClient({
        onInsert: (payload) => {
          capturedPayload = payload as Record<string, unknown>;
        },
      });

      const req = buildTestRequest(validPayload);
      const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

      expect(res.status).toBe(201);
      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload?.['authenticity_confirmed']).toBe(false);
    });

    it('rejects loose string coercion ("true") with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
      const client = createMockSupabaseClient();
      const req = buildTestRequest({
        ...validPayload,
        authenticityConfirmed: 'true',
      });
      const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
      expect(body.error.message).toContain('authenticityConfirmed');
    });

    it('rejects loose string coercion ("false") with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
      const client = createMockSupabaseClient();
      const req = buildTestRequest({
        ...validPayload,
        authenticityConfirmed: 'false',
      });
      const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
      expect(body.error.message).toContain('authenticityConfirmed');
    });

    it('rejects replay attempting to upgrade authenticity from false to true with HTTP 409', async () => {
      const client = createMockSupabaseClient({
        existingResponse: {
          id: 'existing-resp-uuid-1234',
          selected_options: validPayload.responses,
          optional_note: 'Loved the trimmer fade!',
          authenticity_confirmed: false,
          created_at: new Date().toISOString(),
        },
      });

      const req = buildTestRequest({
        ...validPayload,
        authenticityConfirmed: true,
      });
      const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_IDEMPOTENCY_CONFLICT');
    });

    it('rejects replay attempting to downgrade authenticity from true to false with HTTP 409', async () => {
      const client = createMockSupabaseClient({
        existingResponse: {
          id: 'existing-resp-uuid-1234',
          selected_options: validPayload.responses,
          optional_note: 'Loved the trimmer fade!',
          authenticity_confirmed: true,
          created_at: new Date().toISOString(),
        },
      });

      const req = buildTestRequest({
        ...validPayload,
        authenticityConfirmed: false,
      });
      const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_IDEMPOTENCY_CONFLICT');
    });

    it('allows identical replay with matching authenticity confirmation', async () => {
      const client = createMockSupabaseClient({
        existingResponse: {
          id: 'existing-resp-uuid-1234',
          selected_options: validPayload.responses,
          optional_note: 'Loved the trimmer fade!',
          authenticity_confirmed: true,
          created_at: new Date().toISOString(),
        },
      });

      const req = buildTestRequest({
        ...validPayload,
        authenticityConfirmed: true,
      });
      const res = await handleFeedbackSubmission(req, client, mockSigningSecret);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('recorded');
      expect(body.responseId).toBe('existing-resp-uuid-1234');
    });
  });
});

