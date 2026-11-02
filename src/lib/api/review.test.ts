import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReview, ApiClientError } from './review';

describe('generateReview (API-PUB-03 Client)', () => {
  const validPayload = {
    responseId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
    submissionToken: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c.1729350600.abcdef1234567890',
    idempotencyKey: 'session-uuid-1234_1',
    publicQrId: 'k9x2m4p7qz',
    sessionUuid: '11111111-2222-3333-4444-555555555555',
  };

  const defaultOptions = {
    baseUrl: 'https://test-project.supabase.co',
    anonKey: 'anon-test-key-12345',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Payload Validation', () => {
    it('throws ApiClientError when responseId is missing or empty', async () => {
      await expect(
        generateReview(
          { ...validPayload, responseId: '' },
          defaultOptions,
        ),
      ).rejects.toThrow('responseId is required');

      await expect(
        generateReview(
          { ...validPayload, responseId: '   ' },
          defaultOptions,
        ),
      ).rejects.toThrow('responseId is required');
    });

    it('throws ApiClientError when submissionToken is missing or empty', async () => {
      await expect(
        generateReview(
          { ...validPayload, submissionToken: '' },
          defaultOptions,
        ),
      ).rejects.toThrow('submissionToken is required');
    });

    it('throws ApiClientError when idempotencyKey is missing or empty', async () => {
      await expect(
        generateReview(
          { ...validPayload, idempotencyKey: '' },
          defaultOptions,
        ),
      ).rejects.toThrow('idempotencyKey is required');
    });
  });

  describe('Successful Review Generation', () => {
    it('sends correct headers, body, and returns structured draft on HTTP 200', async () => {
      const mockSuccessResponse = {
        reviewDraft: 'Masterful haircut with great attention to detail. Clean salon and welcoming team.',
        wordCount: 13,
        sentiment: 'positive',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSuccessResponse,
      });

      const result = await generateReview(validPayload, {
        ...defaultOptions,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://test-project.supabase.co/functions/v1/generate-review');
      expect(requestInit.method).toBe('POST');
      expect(requestInit.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        apikey: 'anon-test-key-12345',
        Authorization: 'Bearer anon-test-key-12345',
      });

      const parsedBody = JSON.parse(requestInit.body as string);
      expect(parsedBody).toEqual({
        responseId: validPayload.responseId,
        submissionToken: validPayload.submissionToken,
        idempotencyKey: validPayload.idempotencyKey,
        publicQrId: validPayload.publicQrId,
        sessionUuid: validPayload.sessionUuid,
      });

      expect(result).toEqual(mockSuccessResponse);
    });

    it('parses abstention response correctly on HTTP 200 (M0-16 Insufficient Facts)', async () => {
      const mockAbstentionResponse = {
        reviewDraft: null,
        wordCount: 0,
        sentiment: 'neutral',
        abstained: true,
        reason: 'INSUFFICIENT_FACTS',
        message: 'Could not generate authentic review from neutral selections without personal notes.',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAbstentionResponse,
      });

      const result = await generateReview(validPayload, {
        ...defaultOptions,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      expect(result.abstained).toBe(true);
      expect(result.reviewDraft).toBeNull();
      expect(result.reason).toBe('INSUFFICIENT_FACTS');
    });
  });

  describe('Error Handling and Status Code Mapping', () => {
    it('maps HTTP 401 token expiration into ApiClientError with ERR_TOKEN_EXPIRED', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 'ERR_TOKEN_EXPIRED',
            message: 'Survey submission token has expired.',
            correlationId: 'corr_test_401',
            retryable: false,
          },
        }),
      });

      try {
        await generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.code).toBe('ERR_TOKEN_EXPIRED');
        expect(apiErr.correlationId).toBe('corr_test_401');
        expect(apiErr.retryable).toBe(false);
      }
    });

    it('maps HTTP 403 authenticity unconfirmed into ApiClientError with ERR_AUTHENTICITY_UNCONFIRMED', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            code: 'ERR_AUTHENTICITY_UNCONFIRMED',
            message: 'Feedback authenticity must be confirmed before AI review generation.',
            correlationId: 'corr_test_403',
            retryable: false,
          },
        }),
      });

      try {
        await generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(403);
        expect(apiErr.code).toBe('ERR_AUTHENTICITY_UNCONFIRMED');
      }
    });

    it('maps HTTP 409 concurrency conflict into ApiClientError with ERR_CONCURRENT_REQUEST', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'ERR_CONCURRENT_REQUEST',
            message: 'A generation request is currently active for this key.',
            correlationId: 'corr_test_409',
            retryable: true,
          },
        }),
      });

      try {
        await generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(409);
        expect(apiErr.code).toBe('ERR_CONCURRENT_REQUEST');
      }
    });

    it('maps HTTP 429 quota exhaustion into ApiClientError with ERR_QUOTA_EXHAUSTED', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            code: 'ERR_QUOTA_EXHAUSTED',
            message: 'Monthly review drafting quota exhausted for this business.',
            correlationId: 'corr_test_quota',
            retryable: false,
          },
        }),
      });

      try {
        await generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(429);
        expect(apiErr.code).toBe('ERR_QUOTA_EXHAUSTED');
        expect(apiErr.retryable).toBe(false);
      }
    });

    it('maps HTTP 429 IP/session rate limit into ApiClientError with ERR_RATE_LIMITED', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            code: 'ERR_RATE_LIMITED',
            message: 'Too many requests. Please wait before generating another draft.',
            correlationId: 'corr_test_ratelimit',
            retryable: true,
          },
        }),
      });

      try {
        await generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(429);
        expect(apiErr.code).toBe('ERR_RATE_LIMITED');
      }
    });

    it('maps HTTP 504 Gemini timeout into ApiClientError with ERR_GEMINI_TIMEOUT', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 504,
        json: async () => ({
          error: {
            code: 'ERR_GEMINI_TIMEOUT',
            message: 'Gemini AI generation exceeded the maximum deadline.',
            correlationId: 'corr_test_504',
            retryable: true,
          },
        }),
      });

      try {
        await generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(504);
        expect(apiErr.code).toBe('ERR_GEMINI_TIMEOUT');
        expect(apiErr.retryable).toBe(true);
      }
    });

    it('handles non-JSON error body safely without crashing', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      try {
        await generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(502);
        expect(apiErr.code).toBe('ERR_HTTP_502');
      }
    });

    it('maps network failures to ERR_NETWORK_ERROR', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

      try {
        await generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.code).toBe('ERR_NETWORK_ERROR');
        expect(apiErr.retryable).toBe(true);
      }
    });

    it('rethrows DOMException AbortError when request is aborted via signal', async () => {
      const abortError = new DOMException('The user aborted a request.', 'AbortError');
      const fetchMock = vi.fn().mockRejectedValue(abortError);

      await expect(
        generateReview(validPayload, {
          ...defaultOptions,
          fetchFn: fetchMock as unknown as typeof fetch,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(abortError);
    });
  });
});

