import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitFeedback, fetchSurveyQuestions, ApiClientError } from './survey';

describe('Survey API Client (API-PUB-02 & API-PUB-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitFeedback()', () => {
    const validPayload = {
      publicQrId: 'luxe000001',
      sessionUuid: '123e4567-e89b-12d3-a456-426614174000',
      responses: [
        { questionId: '11111111-1111-4111-8111-111111111111', optionId: 'opt-1' },
        { questionId: '22222222-2222-4222-8222-222222222222', optionId: 'opt-2' },
        { questionId: '33333333-3333-4333-8333-333333333333', optionId: 'opt-3' },
      ],
      optionalNote: 'Great service!',
    };

    it('submits valid payload and returns responseId and submissionToken on HTTP 201', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          status: 'recorded',
          responseId: 'resp-uuid-999',
          submissionToken: 'sub_token_xyz',
        }),
      });

      const res = await submitFeedback(validPayload, {
        baseUrl: 'http://127.0.0.1:54321',
        anonKey: 'anon-key-123',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:54321/functions/v1/submit-feedback',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            apikey: 'anon-key-123',
          }),
          body: JSON.stringify(validPayload),
        }),
      );

      expect(res.status).toBe('recorded');
      expect(res.responseId).toBe('resp-uuid-999');
      expect(res.submissionToken).toBe('sub_token_xyz');
    });

    it('maps HTTP 409 idempotency conflict into ApiClientError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'ERR_IDEMPOTENCY_CONFLICT',
            message: 'A survey submission already exists for this session with different responses or note.',
          },
        }),
      });

      await expect(
        submitFeedback(validPayload, {
          fetchFn: mockFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow(ApiClientError);
    });

    it('maps HTTP 422 note too long into ApiClientError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: {
            code: 'ERR_NOTE_TOO_LONG',
            message: 'Optional note length (160 characters) exceeds maximum limit of 150 characters.',
          },
        }),
      });

      try {
        await submitFeedback(validPayload, {
          fetchFn: mockFetch as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(422);
        expect(apiErr.code).toBe('ERR_NOTE_TOO_LONG');
      }
    });

    it('maps network failures to ERR_NETWORK_ERROR with retryable flag', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      try {
        await submitFeedback(validPayload, {
          fetchFn: mockFetch as unknown as typeof fetch,
        });
        expect.unreachable('Should have thrown ApiClientError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.code).toBe('ERR_NETWORK_ERROR');
        expect(apiErr.retryable).toBe(true);
      }
    });
  });

  describe('fetchSurveyQuestions()', () => {
    it('rejects unsupported categories fail-closed', async () => {
      await expect(fetchSurveyQuestions('retail')).rejects.toThrow(
        /Only "salon" and "cafe" are supported/,
      );
    });
  });
});

