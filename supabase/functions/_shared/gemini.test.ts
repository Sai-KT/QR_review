import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateReviewDraft,
  resolveGeminiModel,
  resolveGeminiApiKey,
  stripMarkdownFences,
  GeminiClientError,
  DEFAULT_GEMINI_MODEL,
  BACKUP_GEMINI_MODEL,
  MAX_ALLOWED_WORD_COUNT,
  type GenerateReviewDraftOptions,
} from './gemini';

describe('Google Gemini Flash AI Client Interface (M4-T01)', () => {
  const mockApiKey = 'test-gemini-api-key-12345';
  const originalEnvKey = process.env['GEMINI_API_KEY'];
  const originalEnvModel = process.env['GEMINI_MODEL'];
  const originalEnvBaseUrl = process.env['GEMINI_BASE_URL'];

  beforeEach(() => {
    process.env['GEMINI_API_KEY'] = mockApiKey;
    delete process.env['GEMINI_MODEL'];
    delete process.env['GEMINI_BASE_URL'];
  });

  afterEach(() => {
    if (originalEnvKey !== undefined) {
      process.env['GEMINI_API_KEY'] = originalEnvKey;
    } else {
      delete process.env['GEMINI_API_KEY'];
    }

    if (originalEnvModel !== undefined) {
      process.env['GEMINI_MODEL'] = originalEnvModel;
    } else {
      delete process.env['GEMINI_MODEL'];
    }

    if (originalEnvBaseUrl !== undefined) {
      process.env['GEMINI_BASE_URL'] = originalEnvBaseUrl;
    } else {
      delete process.env['GEMINI_BASE_URL'];
    }
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Model Resolution & Configuration Guards                              */
  /* ------------------------------------------------------------------------ */

  describe('resolveGeminiModel', () => {
    it('defaults to gemini-3.5-flash-lite when no model specified', () => {
      expect(resolveGeminiModel()).toBe(DEFAULT_GEMINI_MODEL);
    });

    it('allows backup model gemini-3.1-flash-lite', () => {
      expect(resolveGeminiModel(BACKUP_GEMINI_MODEL)).toBe(BACKUP_GEMINI_MODEL);
    });

    it('resolves model from GEMINI_MODEL environment variable', () => {
      process.env['GEMINI_MODEL'] = BACKUP_GEMINI_MODEL;
      expect(resolveGeminiModel()).toBe(BACKUP_GEMINI_MODEL);
    });

    it('rejects unapproved models (e.g. gemini-pro, gpt-4) with ERR_INVALID_MODEL', () => {
      expect(() => resolveGeminiModel('gemini-pro')).toThrow(GeminiClientError);
      try {
        resolveGeminiModel('gpt-4');
      } catch (err) {
        expect(err).toBeInstanceOf(GeminiClientError);
        expect((err as GeminiClientError).code).toBe('ERR_INVALID_MODEL');
      }
    });
  });

  describe('resolveGeminiApiKey', () => {
    it('resolves key from parameter', () => {
      expect(resolveGeminiApiKey('custom-key')).toBe('custom-key');
    });

    it('resolves key from environment variable when parameter is omitted', () => {
      expect(resolveGeminiApiKey()).toBe(mockApiKey);
    });

    it('throws ERR_MISSING_API_KEY when key is missing or blank', () => {
      delete process.env['GEMINI_API_KEY'];
      expect(() => resolveGeminiApiKey()).toThrow(GeminiClientError);
      try {
        resolveGeminiApiKey('   ');
      } catch (err) {
        expect(err).toBeInstanceOf(GeminiClientError);
        expect((err as GeminiClientError).code).toBe('ERR_MISSING_API_KEY');
      }
    });
  });

  describe('stripMarkdownFences', () => {
    it('removes ```json ... ``` markdown code fences', () => {
      const input = '```json\n{"reviewDraft": "Great haircut today."}\n```';
      expect(stripMarkdownFences(input)).toBe('{"reviewDraft": "Great haircut today."}');
    });

    it('removes ``` ... ``` code fences without language specifier', () => {
      const input = '```\n{"reviewDraft": "Fresh coffee and calm vibes."}\n```';
      expect(stripMarkdownFences(input)).toBe('{"reviewDraft": "Fresh coffee and calm vibes."}');
    });

    it('returns unfenced plain text unchanged', () => {
      const input = '{"reviewDraft": "Spotless and fast service."}';
      expect(stripMarkdownFences(input)).toBe(input);
    });

    it('handles empty strings', () => {
      expect(stripMarkdownFences('')).toBe('');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Offline Mock Transport Tests (Zero External Calls / Zero Paid Spend)  */
  /* ------------------------------------------------------------------------ */

  describe('generateReviewDraft - Offline Injected Mock Transport', () => {
    const baseOptions: GenerateReviewDraftOptions = {
      systemInstruction: 'You are a review drafting assistant.',
      userPrompt: '<USER_INPUT>Business: "Green Salon"</USER_INPUT>',
    };

    it('constructs correct REST URL, headers, and payload structure', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockTransport: typeof fetch = async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;

        const responsePayload = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reviewDraft:
                        'Had a masterful and precise service today. Clean and hygienic station with great styling advice.',
                    }),
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await generateReviewDraft({
        ...baseOptions,
        transportFn: mockTransport,
      });

      // Verify URL & Headers
      expect(capturedUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      );
      expect(capturedInit?.method).toBe('POST');
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-goog-api-key']).toBe(mockApiKey);

      // Verify Body Structure
      const body = JSON.parse(String(capturedInit?.body));
      expect(body.contents[0].parts[0].text).toBe(baseOptions.userPrompt);
      expect(body.systemInstruction.parts[0].text).toBe(baseOptions.systemInstruction);
      expect(body.generationConfig.temperature).toBe(0.3);
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.responseSchema).toBeDefined();

      // Verify Output
      expect(result.reviewDraft).toBe(
        'Had a masterful and precise service today. Clean and hygienic station with great styling advice.',
      );
      expect(result.wordCount).toBe(15);
      expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
    });

    it('parses output when wrapped in markdown code fences', async () => {
      const mockTransport: typeof fetch = async () => {
        const rawFenced =
          '```json\n{\n  "reviewDraft": "Masterful haircut and clean station. Loved the trimmer fade."\n}\n```';

        const responsePayload = {
          candidates: [
            {
              content: {
                parts: [{ text: rawFenced }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await generateReviewDraft({
        ...baseOptions,
        transportFn: mockTransport,
      });

      expect(result.reviewDraft).toBe(
        'Masterful haircut and clean station. Loved the trimmer fade.',
      );
      expect(result.wordCount).toBe(9);
    });

    it('supports direct reviewDraft JSON responses (mock direct mode)', async () => {
      const mockTransport: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            reviewDraft: 'Quick and courteous coffee service. Loved the artisanal pour-over.',
            wordCount: 10,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      };

      const result = await generateReviewDraft({
        ...baseOptions,
        transportFn: mockTransport,
      });

      expect(result.reviewDraft).toBe(
        'Quick and courteous coffee service. Loved the artisanal pour-over.',
      );
      expect(result.wordCount).toBe(9);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Output Length Constraint (< 50 words ceiling)                        */
  /* ------------------------------------------------------------------------ */

  describe('generateReviewDraft - Word Count Ceiling Verification', () => {
    it('defines maximum allowed word count as 49 (< 50w ceiling)', () => {
      expect(MAX_ALLOWED_WORD_COUNT).toBe(49);
    });

    it('accepts review draft with exactly 49 words (< 50w)', async () => {
      const exactly49Words = Array.from({ length: 49 }, (_, i) => `word${i + 1}`).join(' ');

      const mockTransport: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: JSON.stringify({ reviewDraft: exactly49Words }) }] },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const result = await generateReviewDraft({
        systemInstruction: 'sys',
        userPrompt: 'prompt',
        transportFn: mockTransport,
      });

      expect(result.wordCount).toBe(49);
      expect(result.wordCount).toBeLessThan(50);
    });

    it('rejects review draft with 50 words or more with ERR_OUTPUT_TOO_LONG', async () => {
      const exactly50Words = Array.from({ length: 50 }, (_, i) => `word${i + 1}`).join(' ');

      const mockTransport: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: JSON.stringify({ reviewDraft: exactly50Words }) }] },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toThrow(GeminiClientError);

      try {
        await generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(GeminiClientError);
        const geminiErr = err as GeminiClientError;
        expect(geminiErr.code).toBe('ERR_OUTPUT_TOO_LONG');
        expect(geminiErr.message).toContain('50 words');
      }
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Error Handling, Safety Filters & HTTP Status Mapping                 */
  /* ------------------------------------------------------------------------ */

  describe('generateReviewDraft - Error & Safety Handling', () => {
    it('throws ERR_SAFETY_BLOCKED when candidate finishReason is SAFETY', async () => {
      const mockTransport: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: '' }] },
                finishReason: 'SAFETY',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_SAFETY_BLOCKED',
      });
    });

    it('throws ERR_SAFETY_BLOCKED when promptFeedback has blockReason', async () => {
      const mockTransport: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            promptFeedback: {
              blockReason: 'SAFETY',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_SAFETY_BLOCKED',
      });
    });

    it('throws ERR_PROVIDER_UNAUTHORIZED on HTTP 401 / 403', async () => {
      const mockTransport: typeof fetch = async () => {
        return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_PROVIDER_UNAUTHORIZED',
        retryable: false,
      });
    });

    it('throws ERR_PROVIDER_RATE_LIMITED on HTTP 429', async () => {
      const mockTransport: typeof fetch = async () => {
        return new Response(JSON.stringify({ error: { message: 'Resource exhausted' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_PROVIDER_RATE_LIMITED',
        retryable: true,
      });
    });

    it('throws ERR_PROVIDER_SERVER_ERROR on HTTP 500 / 503', async () => {
      const mockTransport: typeof fetch = async () => {
        return new Response(JSON.stringify({ error: { message: 'Internal error' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_PROVIDER_SERVER_ERROR',
        retryable: true,
      });
    });

    it('never leaks API key in error messages even if present in provider response', async () => {
      const leakedResponse = `Error with key ${mockApiKey} on account.`;
      const mockTransport: typeof fetch = async () => {
        return new Response(JSON.stringify({ error: { message: leakedResponse } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      try {
        await generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(GeminiClientError);
        const msg = (err as GeminiClientError).message;
        expect(msg).not.toContain(mockApiKey);
        expect(msg).toContain('[REDACTED]');
      }
    });

    it('throws ERR_EMPTY_RESPONSE when candidates array is empty or text is missing', async () => {
      const mockTransport: typeof fetch = async () => {
        return new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_EMPTY_RESPONSE',
      });
    });

    it('throws ERR_MALFORMED_OUTPUT when model returns non-JSON text', async () => {
      const mockTransport: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: '{ unclosed json ' }] },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_MALFORMED_OUTPUT',
      });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Timeout & Abort Handling Tests                                       */
  /* ------------------------------------------------------------------------ */

  describe('generateReviewDraft - Timeout & Abort Controls', () => {
    it('aborts and throws ERR_TIMEOUT when request exceeds timeoutMs', async () => {
      const mockTransport: typeof fetch = async (_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          timeoutMs: 50, // 50ms short timeout
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_TIMEOUT',
        status: 504,
        retryable: true,
      });
    });

    it('throws ERR_ABORTED when caller signal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const mockTransport: typeof fetch = vi.fn();

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          signal: controller.signal,
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_ABORTED',
        retryable: false,
      });

      expect(mockTransport).not.toHaveBeenCalled();
    });

    it('throws ERR_NETWORK_ERROR when fetch encounters network failure', async () => {
      const mockTransport: typeof fetch = async () => {
        throw new TypeError('Failed to fetch: Connection refused');
      };

      await expect(
        generateReviewDraft({
          systemInstruction: 'sys',
          userPrompt: 'prompt',
          transportFn: mockTransport,
        }),
      ).rejects.toMatchObject({
        code: 'ERR_NETWORK_ERROR',
        status: 502,
        retryable: true,
      });
    });
  });
});
