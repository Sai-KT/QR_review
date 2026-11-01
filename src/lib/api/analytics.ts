/**
 * Public Analytics Event Tracking API Adapter (API-PUB-05)
 *
 * Task: M3-T04 — Analytics Ingestion Edge Function with Server Deduplication
 * Specifications:
 *   - docs/API_SPEC.md (v1.2) §7.5
 *   - docs/ROADMAP.md (v1.1) Task M3-T04
 *   - docs/ARCHITECTURE.md (v1.1) §11.1, §11.2, §11.3
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.6
 *
 * Client-side interface to call the track-event Edge Function.
 * Ingests customer interaction milestones with server-side deduplication.
 */

import { getSupabaseAnonKey, getSupabaseUrl } from '../supabase';
import { ApiClientError } from './public';
import type { UserAgentCategory } from '../../types/domain';

/**
 * Permitted client-reported event names (strictly 6 public events).
 * Server-owned events (EVENT_SURVEY_COMPLETED, EVENT_GENERATION_SUCCESS)
 * are excluded from this type to prevent client invocation.
 */
export type PermittedClientEventName =
  | 'EVENT_QR_PAGE_VIEW'
  | 'EVENT_GENERATION_REQUESTED'
  | 'EVENT_COPY_ATTEMPTED'
  | 'EVENT_COPY_SUCCESS'
  | 'EVENT_GOOGLE_REDIRECT_CLICK'
  | 'EVENT_GOOGLE_BYPASS_CLICK';

export interface TrackEventPayload {
  publicQrId: string;
  eventName: PermittedClientEventName;
  sessionUuid: string;
  userAgentCategory?: UserAgentCategory;
}

export interface TrackEventOptions {
  baseUrl?: string;
  anonKey?: string;
  fetchFn?: typeof fetch;
}

export interface TrackEventResponse {
  status: 'accepted';
  deduplicated?: boolean;
}

/**
 * Normalizes user-agent into approved category: 'mobile' | 'desktop' | 'tablet'.
 */
export function detectUserAgentCategory(): UserAgentCategory {
  if (typeof navigator === 'undefined') return 'mobile';
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    return 'tablet';
  }
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

/**
 * Sends a telemetry event to the track-event Edge Function (API-PUB-05).
 *
 * Enforces:
 * - Client-side validation of publicQrId, eventName, and sessionUuid
 * - Compile-time exclusion of server-owned events
 * - Proper apikey and Authorization header propagation
 * - Error mapping to canonical ApiClientError
 */
export async function trackEvent(
  payload: TrackEventPayload,
  options?: TrackEventOptions,
): Promise<TrackEventResponse> {
  const trimmedQrId = payload.publicQrId?.trim();
  if (!trimmedQrId || !/^[a-z0-9]{8,12}$/.test(trimmedQrId)) {
    throw new ApiClientError(
      'Invalid publicQrId. Must be an 8-12 character alphanumeric identifier.',
      400,
      'ERR_INVALID_PAYLOAD',
    );
  }

  const trimmedSessionUuid = payload.sessionUuid?.trim();
  if (
    !trimmedSessionUuid ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmedSessionUuid,
    )
  ) {
    throw new ApiClientError(
      'Invalid sessionUuid. Must be a valid UUID.',
      400,
      'ERR_INVALID_PAYLOAD',
    );
  }

  const userAgentCategory =
    payload.userAgentCategory ?? detectUserAgentCategory();

  const baseUrl = options?.baseUrl ?? getSupabaseUrl() ?? '';
  const anonKey = options?.anonKey ?? getSupabaseAnonKey() ?? '';
  const performFetch = options?.fetchFn ?? fetch;

  const endpoint = `${baseUrl ? baseUrl.replace(/\/+$/, '') : ''}/functions/v1/track-event`;

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
      body: JSON.stringify({
        publicQrId: trimmedQrId,
        eventName: payload.eventName,
        sessionUuid: trimmedSessionUuid,
        userAgentCategory,
      }),
    });
  } catch (networkError) {
    throw new ApiClientError(
      networkError instanceof Error
        ? networkError.message
        : 'Network connection error while sending analytics event.',
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
    const code = errorData?.error?.code ?? `ERR_HTTP_${status}`;
    const message =
      errorData?.error?.message ?? `Analytics ingestion failed with HTTP ${status}`;
    const correlationId = errorData?.error?.correlationId;
    const retryable =
      errorData?.error?.retryable ?? (status === 429 || status >= 500);

    throw new ApiClientError(message, status, code, correlationId, retryable);
  }

  const data: TrackEventResponse = await response.json();
  return data;
}
