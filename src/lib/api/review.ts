/**
 * Public Customer AI Review Generation API Client (API-PUB-03)
 *
 * Task: Post-M4 Integration Gate C — Frontend State Machine Orchestration
 * Source: docs/API_SPEC.md (v1.2) §7.4, §8.1; docs/ARCHITECTURE.md (v1.1) §9.3
 *
 * Client-side interface to call the generate-review Edge Function.
 * Cryptographically binds survey feedback to Gemini Flash AI review generation.
 */

import { getSupabaseAnonKey, getSupabaseUrl } from '../supabase';
import { ApiClientError } from './public';

export { ApiClientError };

export interface GenerateReviewPayload {
  /** Survey response UUID returned from submit-feedback */
  responseId: string;
  /** HMAC-SHA256 signed submission token issued upon survey persistence */
  submissionToken: string;
  /** Client-generated idempotency key (e.g. `${sessionUuid}_${attempt}`) */
  idempotencyKey: string;
  /** Optional public QR identifier for audit/routing */
  publicQrId?: string;
  /** Optional patron session UUID for rate limiting and telemetry */
  sessionUuid?: string;
}

export interface GenerateReviewResponse {
  /** Grounded customer review draft (< 60 words) or null if abstained */
  reviewDraft: string | null;
  /** Total word count of the generated review draft */
  wordCount: number;
  /** Sentiment classification of the generated review */
  sentiment: 'positive' | 'neutral' | 'negative';
  /** Whether the generation pipeline abstained due to insufficient facts (M0-16) */
  abstained?: boolean;
  /** Optional reason for abstention (e.g. 'INSUFFICIENT_FACTS') */
  reason?: string;
  /** Informational message from backend */
  message?: string;
}

export interface GenerateReviewOptions {
  baseUrl?: string;
  anonKey?: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Dispatches an AI review generation request to the generate-review Edge Function (API-PUB-03).
 *
 * Enforces:
 * - Validates required payload fields (responseId, submissionToken, idempotencyKey)
 * - Transmits publishable key via apikey and Authorization Bearer headers
 * - Maps canonical error envelopes ({ error: { code, message, correlationId, retryable } })
 *   into ApiClientError instances
 * - Supports request cancellation via AbortSignal
 * - Never transmits credentials, service-role keys, or raw prompts from client
 */
export async function generateReview(
  payload: GenerateReviewPayload,
  options?: GenerateReviewOptions,
): Promise<GenerateReviewResponse> {
  const { responseId, submissionToken, idempotencyKey, publicQrId, sessionUuid } = payload;

  if (!responseId || !responseId.trim()) {
    throw new ApiClientError(
      'responseId is required to generate a review draft.',
      400,
      'ERR_INVALID_PAYLOAD',
    );
  }

  if (!submissionToken || !submissionToken.trim()) {
    throw new ApiClientError(
      'submissionToken is required to verify feedback authenticity.',
      400,
      'ERR_INVALID_SUBMISSION_TOKEN',
    );
  }

  if (!idempotencyKey || !idempotencyKey.trim()) {
    throw new ApiClientError(
      'idempotencyKey is required for atomic generation quota locking.',
      400,
      'ERR_INVALID_PAYLOAD',
    );
  }

  const baseUrl = options?.baseUrl ?? getSupabaseUrl() ?? '';
  const anonKey = options?.anonKey ?? getSupabaseAnonKey() ?? '';
  const performFetch = options?.fetchFn ?? fetch;

  const cleanBase = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const endpoint = `${cleanBase}/functions/v1/generate-review`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (anonKey) {
    headers['apikey'] = anonKey;
    headers['Authorization'] = `Bearer ${anonKey}`;
  }

  const requestBody: Record<string, string> = {
    responseId: responseId.trim(),
    submissionToken: submissionToken.trim(),
    idempotencyKey: idempotencyKey.trim(),
  };

  if (publicQrId && publicQrId.trim()) {
    requestBody.publicQrId = publicQrId.trim();
  }

  if (sessionUuid && sessionUuid.trim()) {
    requestBody.sessionUuid = sessionUuid.trim();
  }

  let response: Response;
  try {
    response = await performFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: options?.signal,
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === 'AbortError') {
      throw networkError;
    }

    throw new ApiClientError(
      networkError instanceof Error
        ? networkError.message
        : 'Network error while requesting review generation.',
      0,
      'ERR_NETWORK_ERROR',
      undefined,
      true,
    );
  }

  if (!response.ok) {
    let errorData: {
      error?: {
        code?: string;
        message?: string;
        correlationId?: string;
        retryable?: boolean;
      };
      [key: string]: unknown;
    } | null = null;

    try {
      errorData = await response.json();
    } catch {
      // Body may not be valid JSON
    }

    const status = response.status;
    const code =
      errorData?.error?.code ??
      (status === 400
        ? 'ERR_INVALID_PAYLOAD'
        : status === 401
          ? 'ERR_TOKEN_EXPIRED'
          : status === 403
            ? 'ERR_FORBIDDEN'
            : status === 404
              ? 'ERR_NOT_FOUND'
              : status === 409
                ? 'ERR_CONCURRENT_REQUEST'
                : status === 429
                  ? 'ERR_RATE_LIMITED'
                  : status === 504
                    ? 'ERR_GEMINI_TIMEOUT'
                    : `ERR_HTTP_${status}`);

    const message =
      errorData?.error?.message ??
      (status === 400
        ? 'Invalid review generation request.'
        : status === 401
          ? 'Survey submission token has expired or is invalid.'
          : status === 403
            ? 'Access to review generation was rejected.'
            : status === 409
              ? 'A review generation request is already in progress.'
              : status === 429
                ? 'Rate limit exceeded. Please try again shortly.'
                : status === 504
                  ? 'Review generation timed out. Please try again.'
                  : `Request failed with HTTP ${status}`);

    const correlationId = errorData?.error?.correlationId;
    const retryable =
      errorData?.error?.retryable ?? (status === 504 || status >= 500);

    throw new ApiClientError(message, status, code, correlationId, retryable);
  }

  const data = (await response.json()) as GenerateReviewResponse;
  return data;
}

