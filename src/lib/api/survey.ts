/**
 * Public Customer Survey Questions API Client (API-PUB-02)
 *
 * Task: M3-T02 — Category Survey Questions Resolver
 * Source: docs/API_SPEC.md (v1.2) §5.2, §7.2; docs/ARCHITECTURE.md (v1.1) §9.2
 *
 * Client-side interface to call the get-survey-questions Edge Function.
 * Resolves the approved 3-MCQ category survey questions for anonymous patrons.
 */

import { getSupabaseAnonKey, getSupabaseUrl } from '../supabase';
import { ApiClientError } from './public';

export { ApiClientError };

export type SurveyCategory = 'salon' | 'cafe';
export type SurveyOptionSentiment = 'positive' | 'neutral' | 'negative';

export interface SurveyOptionDto {
  id: string;
  optionText: string;
  emojiAnchor: string;
  sentiment: SurveyOptionSentiment;
  sentimentLabel?: SurveyOptionSentiment;
  isNeutralNa: boolean;
}

export interface SurveyQuestionDto {
  id: string;
  displayOrder: number;
  questionText: string;
  options: SurveyOptionDto[];
}

export interface SurveyQuestionsDto {
  categoryId: SurveyCategory;
  surveyVersion: string;
  questions: SurveyQuestionDto[];
}

export interface FetchSurveyQuestionsOptions {
  version?: string;
  baseUrl?: string;
  anonKey?: string;
  fetchFn?: typeof fetch;
}

/**
 * Retrieves the active 3-MCQ survey questions for a specified business category (API-PUB-02).
 *
 * Features:
 * - Validates category parameter ('salon' | 'cafe')
 * - Supports optional version parameter for cache-busting
 * - Maps response into typed SurveyQuestionsDto
 * - Handles API canonical error envelope into ApiClientError
 */
export async function fetchSurveyQuestions(
  categoryId: SurveyCategory | string,
  options?: FetchSurveyQuestionsOptions,
): Promise<SurveyQuestionsDto> {
  const trimmedCategory = (categoryId || '').trim().toLowerCase();
  if (trimmedCategory !== 'salon' && trimmedCategory !== 'cafe') {
    throw new ApiClientError(
      'Invalid category. Only "salon" and "cafe" are supported.',
      400,
      'ERR_INVALID_PAYLOAD',
    );
  }

  const baseUrl = options?.baseUrl ?? getSupabaseUrl() ?? '';
  const anonKey = options?.anonKey ?? getSupabaseAnonKey() ?? '';
  const performFetch = options?.fetchFn ?? fetch;

  const urlParams = new URLSearchParams({ categoryId: trimmedCategory });
  if (options?.version && options.version.trim()) {
    urlParams.set('v', options.version.trim());
  }

  const cleanBase = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const endpoint = `${cleanBase}/functions/v1/get-survey-questions?${urlParams.toString()}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (anonKey) {
    headers['apikey'] = anonKey;
    headers['Authorization'] = `Bearer ${anonKey}`;
  }

  let response: Response;
  try {
    response = await performFetch(endpoint, {
      method: 'GET',
      headers,
    });
  } catch (networkError) {
    throw new ApiClientError(
      networkError instanceof Error
        ? networkError.message
        : 'Network error while fetching survey questions.',
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
          ? 'ERR_UNAUTHORIZED'
          : status === 404
            ? 'ERR_NOT_FOUND'
            : status === 405
              ? 'ERR_METHOD_NOT_ALLOWED'
              : `ERR_HTTP_${status}`);

    const message =
      errorData?.error?.message ??
      (status === 400
        ? 'Invalid category or version parameter.'
        : status === 401
          ? 'Unauthorized access to survey questions.'
          : status === 405
            ? 'Method not allowed.'
            : `Request failed with HTTP ${status}`);

    const correlationId = errorData?.error?.correlationId;
    const retryable = errorData?.error?.retryable ?? (status >= 500);

    throw new ApiClientError(message, status, code, correlationId, retryable);
  }

  const data = (await response.json()) as SurveyQuestionsDto;
  return data;
}

// ============================================================================
// API-PUB-04: Survey Feedback Submission
// ============================================================================

export interface FeedbackAnswerItem {
  questionId: string;
  optionId: string;
}

export interface SubmitFeedbackPayload {
  publicQrId: string;
  sessionUuid: string;
  responses: FeedbackAnswerItem[];
  optionalNote?: string | null;
  authenticityConfirmed?: boolean;
}

export interface SubmitFeedbackSuccessResponse {
  status: 'recorded';
  responseId: string;
  submissionToken: string;
}

export interface SubmitFeedbackOptions {
  baseUrl?: string;
  anonKey?: string;
  fetchFn?: typeof fetch;
}

/**
 * Submits the patron's 3-MCQ answers and optional note to API-PUB-04 (submit-feedback).
 *
 * Enforces:
 * - Validates publicQrId, sessionUuid, exactly 3 responses, and optional note (<= 150 chars)
 * - Returns authentic responseId and HMAC-SHA256 submissionToken on HTTP 201
 * - Maps canonical error envelopes into ApiClientError (e.g. ERR_IDEMPOTENCY_CONFLICT, ERR_NOTE_TOO_LONG)
 */
export async function submitFeedback(
  payload: SubmitFeedbackPayload,
  options?: SubmitFeedbackOptions,
): Promise<SubmitFeedbackSuccessResponse> {
  const baseUrl = options?.baseUrl ?? getSupabaseUrl() ?? '';
  const anonKey = options?.anonKey ?? getSupabaseAnonKey() ?? '';
  const performFetch = options?.fetchFn ?? fetch;

  const cleanBase = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const endpoint = `${cleanBase}/functions/v1/submit-feedback`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (anonKey) {
    headers['apikey'] = anonKey;
    headers['Authorization'] = `Bearer ${anonKey}`;
  }

  let response: Response;
  try {
    response = await performFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    throw new ApiClientError(
      networkError instanceof Error
        ? networkError.message
        : 'Network error while submitting feedback.',
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
        : status === 403
          ? 'ERR_BUSINESS_SUSPENDED'
          : status === 404
            ? 'ERR_QR_NOT_FOUND'
            : status === 409
              ? 'ERR_IDEMPOTENCY_CONFLICT'
              : status === 410
                ? 'ERR_SUBMISSION_EXPIRED'
                : status === 422
                  ? 'ERR_NOTE_TOO_LONG'
                  : status === 429
                    ? 'ERR_RATE_LIMITED'
                    : `ERR_HTTP_${status}`);

    const message =
      errorData?.error?.message ??
      (status === 409
        ? 'A survey submission already exists for this session with different responses or note.'
        : status === 422
          ? 'Optional note length exceeds maximum limit of 150 characters.'
          : status === 429
            ? 'Too many requests. Please wait before submitting again.'
            : `Request failed with HTTP ${status}`);

    const correlationId = errorData?.error?.correlationId;
    const retryable = errorData?.error?.retryable ?? (status >= 500 || status === 429);

    throw new ApiClientError(message, status, code, correlationId, retryable);
  }

  const data = (await response.json()) as SubmitFeedbackSuccessResponse;
  return data;
}
