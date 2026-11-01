/**
 * Google Gemini Flash AI Client Interface
 *
 * Task: M4-T01 — Grounded Gemini Flash Client with XML Tag Escaping
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M4-T01, Task M4-T02
 *   - docs/API_SPEC.md (v1.2) §9.1, §9.2, §9.3
 *   - docs/SECURITY.md (v1.1) §7, Gate M0-04, Gate M0-16
 *   - docs/TEST_PLAN.md (v1.1) TC-AI-01, TC-AI-02, TC-AI-04, TC-AI-05
 *
 * Capabilities:
 *   - Native fetch implementation against Google Gemini REST generateContent API
 *   - Enforces approved models (gemini-3.5-flash-lite default, gemini-3.1-flash-lite backup)
 *   - Configures temperature = 0.3, thinkingLevel = "minimal", and structured JSON schema
 *   - Hard 8000ms timeout target with caller AbortSignal support
 *   - Injectable transportFn for 100% offline unit/contract testing with zero external calls
 *   - Strict word-count ceiling verification (< 50 words)
 *   - Comprehensive typed error taxonomy with zero API key leakage
 */

import { countWords } from './promptBuilder.ts';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const BACKUP_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export const APPROVED_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
] as const;

export type ApprovedGeminiModel = (typeof APPROVED_GEMINI_MODELS)[number];

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
export const DEFAULT_GEMINI_TIMEOUT_MS = 8000;
export const DEFAULT_GEMINI_TEMPERATURE = 0.3;
export const MAX_ALLOWED_WORD_COUNT = 49; // Strictly fewer than 50 words (<50w)

export type GeminiErrorCode =
  | 'ERR_MISSING_API_KEY'
  | 'ERR_INVALID_MODEL'
  | 'ERR_PROVIDER_UNAUTHORIZED'
  | 'ERR_PROVIDER_RATE_LIMITED'
  | 'ERR_PROVIDER_SERVER_ERROR'
  | 'ERR_TIMEOUT'
  | 'ERR_ABORTED'
  | 'ERR_NETWORK_ERROR'
  | 'ERR_EMPTY_RESPONSE'
  | 'ERR_MALFORMED_OUTPUT'
  | 'ERR_OUTPUT_TOO_LONG'
  | 'ERR_SAFETY_BLOCKED';

export class GeminiClientError extends Error {
  readonly code: GeminiErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: GeminiErrorCode,
    message: string,
    options?: { status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'GeminiClientError';
    this.code = code;
    this.status = options?.status;
    this.retryable = options?.retryable ?? false;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * Safely resolves an environment variable across Deno and Node runtimes.
 */
export function getEnvVariable(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    const val = process.env[name];
    if (val !== undefined && val.trim().length > 0) return val.trim();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalDeno = (globalThis as any).Deno;
  if (typeof globalDeno !== 'undefined' && typeof globalDeno.env?.get === 'function') {
    try {
      const val = globalDeno.env.get(name);
      if (val !== undefined && typeof val === 'string' && val.trim().length > 0) {
        return val.trim();
      }
    } catch {
      // Permission errors fail quietly
    }
  }
  return undefined;
}

/**
 * Resolves and validates the active Gemini Model identifier.
 * Defaults to 'gemini-3.5-flash-lite'. Throws ERR_INVALID_MODEL if not approved.
 */
export function resolveGeminiModel(customModel?: string): ApprovedGeminiModel {
  const model = customModel?.trim() || getEnvVariable('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
  if (!APPROVED_GEMINI_MODELS.includes(model as ApprovedGeminiModel)) {
    throw new GeminiClientError(
      'ERR_INVALID_MODEL',
      `Unsupported Gemini model '${model}'. Approved models: ${APPROVED_GEMINI_MODELS.join(', ')}`,
      { retryable: false },
    );
  }
  return model as ApprovedGeminiModel;
}

/**
 * Resolves the Gemini API key from explicit parameter or environment.
 */
export function resolveGeminiApiKey(customKey?: string): string {
  const key = customKey?.trim() || getEnvVariable('GEMINI_API_KEY');
  if (!key) {
    throw new GeminiClientError(
      'ERR_MISSING_API_KEY',
      'Google Gemini API key is missing or unconfigured.',
      { retryable: false },
    );
  }
  return key;
}

// Note: Markdown code fences are strictly forbidden by contract.
// The provider is instructed to return application/json.
// Markdown-fenced responses must fail closed and be rejected as malformed output.

export interface GenerateReviewDraftOptions {
  systemInstruction: string;
  userPrompt: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  transportFn?: typeof fetch;
}

export interface GenerateReviewDraftResult {
  reviewDraft: string;
  wordCount: number;
  model: ApprovedGeminiModel;
  rawResponse?: unknown;
}

/**
 * Dispatches a review generation request to Google Gemini Flash API.
 * Uses native fetch with strict timeout, response parsing, and word count enforcement.
 */
export async function generateReviewDraft(
  options: GenerateReviewDraftOptions,
): Promise<GenerateReviewDraftResult> {
  const {
    systemInstruction,
    userPrompt,
    apiKey: customApiKey,
    model: customModel,
    baseUrl: customBaseUrl,
    temperature = DEFAULT_GEMINI_TEMPERATURE,
    timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS,
    signal: callerSignal,
    transportFn = fetch,
  } = options;

  // 1. Resolve configuration
  const model = resolveGeminiModel(customModel);
  const apiKey = resolveGeminiApiKey(customApiKey);
  const baseUrl =
    customBaseUrl?.trim() || getEnvVariable('GEMINI_BASE_URL') || DEFAULT_GEMINI_BASE_URL;

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1beta/models/${model}:generateContent`;

  // 2. Prepare structured request body per Gemini API v1beta specification
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    generationConfig: {
      temperature,
      thinkingConfig: {
        thinkingLevel: 'minimal',
      },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          reviewDraft: {
            type: 'STRING',
          },
        },
        required: ['reviewDraft'],
      },
    },
  };

  // 3. Configure abort & timeout controller with supervisor race
  const abortController = new AbortController();
  let timedOut = false;

  let supervisorRejector: ((reason?: unknown) => void) | undefined;
  const supervisorPromise = new Promise<Response>((_, reject) => {
    supervisorRejector = reject;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
    supervisorRejector?.(
      new GeminiClientError(
        'ERR_TIMEOUT',
        `Gemini API request timed out after ${timeoutMs}ms.`,
        { status: 504, retryable: true },
      ),
    );
  }, timeoutMs);

  const abortListener = () => {
    abortController.abort();
    supervisorRejector?.(
      new GeminiClientError('ERR_ABORTED', 'Operation was aborted by the caller.', {
        retryable: false,
      }),
    );
  };

  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      throw new GeminiClientError('ERR_ABORTED', 'Operation was aborted by the caller.', {
        retryable: false,
      });
    }
    callerSignal.addEventListener('abort', abortListener, { once: true });
  }

  let response: Response;
  try {
    const transportPromise = transportFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    response = await Promise.race([transportPromise, supervisorPromise]);
  } catch (err: unknown) {
    if (timedOut || (err instanceof GeminiClientError && err.code === 'ERR_TIMEOUT')) {
      throw new GeminiClientError(
        'ERR_TIMEOUT',
        `Gemini API request timed out after ${timeoutMs}ms.`,
        { status: 504, retryable: true, cause: err },
      );
    }
    if (callerSignal?.aborted || (err instanceof GeminiClientError && err.code === 'ERR_ABORTED')) {
      throw new GeminiClientError('ERR_ABORTED', 'Operation was aborted by the caller.', {
        retryable: false,
        cause: err,
      });
    }
    if (err instanceof GeminiClientError) {
      throw err;
    }
    throw new GeminiClientError(
      'ERR_NETWORK_ERROR',
      `Failed to connect to Gemini API: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502, retryable: true, cause: err },
    );
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', abortListener);
    }
  }

  // 4. Handle HTTP Error Statuses
  if (!response.ok) {
    let errorDetails = '';
    try {
      const errJson = (await response.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) {
        // Sanitize error message: never leak API key
        errorDetails = errJson.error.message.replace(new RegExp(apiKey, 'g'), '[REDACTED]');
      }
    } catch {
      // Ignore body read errors
    }

    const status = response.status;
    const detailSuffix = errorDetails ? `: ${errorDetails}` : '';

    if (status === 401 || status === 403) {
      throw new GeminiClientError(
        'ERR_PROVIDER_UNAUTHORIZED',
        `Gemini API authorization failed (HTTP ${status})${detailSuffix}`,
        { status: 401, retryable: false },
      );
    }

    if (status === 429) {
      throw new GeminiClientError(
        'ERR_PROVIDER_RATE_LIMITED',
        `Gemini API rate limit exceeded (HTTP 429)${detailSuffix}`,
        { status: 429, retryable: true },
      );
    }

    if (status >= 500) {
      throw new GeminiClientError(
        'ERR_PROVIDER_SERVER_ERROR',
        `Gemini API provider error (HTTP ${status})${detailSuffix}`,
        { status: 502, retryable: true },
      );
    }

    throw new GeminiClientError(
      'ERR_PROVIDER_SERVER_ERROR',
      `Gemini API returned unexpected HTTP ${status}${detailSuffix}`,
      { status, retryable: false },
    );
  }

  // 5. Parse JSON Payload
  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err) {
    throw new GeminiClientError(
      'ERR_MALFORMED_OUTPUT',
      'Failed to parse JSON response from Gemini API.',
      { status: 502, retryable: false, cause: err },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = rawJson as any;

  // 6. Safety & Content Filter Checks
  if (payload?.promptFeedback?.blockReason) {
    throw new GeminiClientError(
      'ERR_SAFETY_BLOCKED',
      `Prompt was blocked by Gemini safety filter: ${payload.promptFeedback.blockReason}`,
      { status: 422, retryable: false },
    );
  }

  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') {
    throw new GeminiClientError(
      'ERR_SAFETY_BLOCKED',
      'Generated content was blocked by Gemini safety filter.',
      { status: 422, retryable: false },
    );
  }

  // 7. Extract Text Candidate (Zero repair of malformed structures)
  let rawText: string | undefined;

  if (candidate?.content?.parts?.[0]?.text !== undefined) {
    rawText = candidate.content.parts[0].text;
  } else if (payload && typeof payload === 'object' && 'reviewDraft' in payload) {
    // Direct response mode (e.g. mock direct mode from /v1beta)
    const directKeys = Object.keys(payload);
    if (directKeys.length !== 1 || directKeys[0] !== 'reviewDraft') {
      throw new GeminiClientError(
        'ERR_MALFORMED_OUTPUT',
        `Direct response object contains unauthorized extra fields: [${directKeys.join(', ')}]`,
        { status: 502, retryable: false },
      );
    }
    rawText = JSON.stringify(payload);
  }

  if (rawText === undefined || typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new GeminiClientError(
      'ERR_EMPTY_RESPONSE',
      'Gemini API returned an empty review draft candidate.',
      { status: 502, retryable: true },
    );
  }

  // 8. Strict Structured JSON Validation
  // Must be strict JSON object matching {"reviewDraft": string} exactly.
  // Markdown code fences, surrounding prose, non-JSON plain text, and unauthorized extra keys fail closed.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (parseErr) {
    throw new GeminiClientError(
      'ERR_MALFORMED_OUTPUT',
      `Malformed review JSON candidate: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      { status: 502, retryable: false, cause: parseErr },
    );
  }

  if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
    throw new GeminiClientError(
      'ERR_MALFORMED_OUTPUT',
      'Model output is not a JSON object.',
      { status: 502, retryable: false },
    );
  }

  const keys = Object.keys(parsedJson);
  if (keys.length !== 1 || keys[0] !== 'reviewDraft') {
    throw new GeminiClientError(
      'ERR_MALFORMED_OUTPUT',
      `Invalid response schema: expected object containing strictly and only 'reviewDraft', received keys: [${keys.join(', ')}]`,
      { status: 502, retryable: false },
    );
  }

  const draftValue = (parsedJson as { reviewDraft?: unknown }).reviewDraft;
  if (typeof draftValue !== 'string') {
    throw new GeminiClientError(
      'ERR_MALFORMED_OUTPUT',
      "Field 'reviewDraft' must be a string.",
      { status: 502, retryable: false },
    );
  }

  const reviewDraft = draftValue.trim();
  if (reviewDraft.length === 0) {
    throw new GeminiClientError(
      'ERR_EMPTY_RESPONSE',
      'Review draft string is empty after parsing.',
      { status: 502, retryable: true },
    );
  }

  // 9. Word Count Validation (< 50 words ceiling: maximum 49 words)
  const wordCount = countWords(reviewDraft);
  if (wordCount > MAX_ALLOWED_WORD_COUNT) {
    throw new GeminiClientError(
      'ERR_OUTPUT_TOO_LONG',
      `Generated review draft (${wordCount} words) exceeds maximum limit of 49 words (<50w).`,
      { status: 422, retryable: false },
    );
  }

  return {
    reviewDraft,
    wordCount,
    model,
    rawResponse: rawJson,
  };
}
