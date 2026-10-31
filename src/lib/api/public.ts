/**
 * Public Customer API Client (API-PUB-01)
 *
 * Source: docs/API_SPEC.md (v1.2) §7.1, docs/ARCHITECTURE.md (v1.1) §9.2
 *
 * Client-side interface to call the get-public-business Edge Function.
 * Resolves public business projections for anonymous patrons scanning QR codes.
 */

import { getSupabaseAnonKey, getSupabaseUrl } from '../supabase';
import { toPublicBusinessProjection } from '../adapters/business';
import type { PublicBusinessProjection } from '../../types/domain';

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly correlationId?: string;
  public readonly retryable: boolean;
  public readonly isSuspended?: boolean;

  constructor(
    message: string,
    status: number,
    code: string,
    correlationId?: string,
    retryable = false,
    isSuspended?: boolean,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.retryable = retryable;
    this.isSuspended = isSuspended;
  }
}

export interface FetchPublicBusinessOptions {
  baseUrl?: string;
  anonKey?: string;
  fetchFn?: typeof fetch;
}

export interface RawPublicBusinessResponse {
  publicQrId: string;
  name: string;
  logoUrl: string | null;
  categoryId: string;
  googleReviewUrl: string | null;
  whatsappNumber: string | null;
  isActive: boolean;
  accountStatus: string;
  subscriptionStatus: string;
  isDirectGoogleOnly?: boolean;
  isSuspended?: boolean;
}

/**
 * Resolves public business metadata by QR token or vanity slug (API-PUB-01).
 *
 * Enforces:
 * - 0-second freshness (Cache-Control: no-cache, no-store)
 * - Safe error mapping for suspended accounts (403), missing tokens (404), and rate limits (429)
 * - Conversion into camelCase PublicBusinessProjection domain model
 */
export async function fetchPublicBusiness(
  qrId: string,
  options?: FetchPublicBusinessOptions,
): Promise<PublicBusinessProjection> {
  const trimmedQrId = qrId.trim();
  if (!trimmedQrId) {
    throw new ApiClientError('Missing QR token parameter', 400, 'ERR_INVALID_PAYLOAD');
  }

  const baseUrl = options?.baseUrl ?? getSupabaseUrl() ?? '';
  const anonKey = options?.anonKey ?? getSupabaseAnonKey() ?? '';
  const performFetch = options?.fetchFn ?? fetch;

  const endpoint = `${baseUrl ? baseUrl.replace(/\/+$/, '') : ''}/functions/v1/get-public-business?qrId=${encodeURIComponent(trimmedQrId)}`;

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
        : 'Network connection error while resolving QR code.',
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
      isSuspended?: boolean;
    } | null = null;

    try {
      errorData = await response.json();
    } catch {
      // Body may not be valid JSON
    }

    const status = response.status;
    const code =
      errorData?.error?.code ??
      (status === 404
        ? 'ERR_QR_NOT_FOUND'
        : status === 403
          ? 'ERR_BUSINESS_SUSPENDED'
          : status === 429
            ? 'ERR_RATE_LIMITED'
            : `ERR_HTTP_${status}`);

    const message =
      errorData?.error?.message ??
      (status === 404
        ? 'The requested QR code or business was not found.'
        : status === 403
          ? 'This business account is currently suspended.'
          : status === 429
            ? 'Too many requests. Please wait before scanning or refreshing again.'
            : `Request failed with HTTP ${status}`);

    const correlationId = errorData?.error?.correlationId;
    const retryable = errorData?.error?.retryable ?? (status === 429 || status >= 500);
    const isSuspended = errorData?.isSuspended ?? status === 403;

    throw new ApiClientError(message, status, code, correlationId, retryable, isSuspended);
  }

  const data: RawPublicBusinessResponse = await response.json();

  return toPublicBusinessProjection({
    public_qr_id: data.publicQrId,
    name: data.name,
    logo_url: data.logoUrl,
    category_id: data.categoryId,
    google_review_url: data.googleReviewUrl,
    whatsapp_number: data.whatsappNumber,
    account_status: data.accountStatus,
    is_active: data.isActive,
    subscription_status: data.subscriptionStatus,
    is_direct_google_only: data.isDirectGoogleOnly,
    is_suspended: data.isSuspended,
  });
}
