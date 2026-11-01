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
