/**
 * Edge Function: get-public-business (API-PUB-01)
 *
 * Task: M3-T01 — Public Business QR Token Resolver
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M3-T01
 *   - docs/API_SPEC.md (v1.2) §5.1, §7.1 (API-PUB-01), §12 (RPC-INT-01)
 *   - docs/ARCHITECTURE.md (v1.1) §9.2
 *   - docs/DATABASE_SCHEMA.md (v1.1) §7.2
 *   - docs/SECURITY.md (v1.1) §7, §8
 *   - Founder Decisions:
 *     - DEC-M3-01: Exact rolling-window rate limiting (60 req / 600s per pseudonymized IP)
 *     - DEC-M3-02: Restricted database projection RPC get_public_business_by_qr
 *     - DEC-M3-03: Immutable 10-char lowercase alphanumeric public_qr_id (^[a-z0-9]{10}$)
 *     - DEC-M3-04: Preserve existing CustomerPageShell component structure
 *     - DEC-M3-05: Strict destination URL suppression for suspended merchants (HTTP 403)
 *
 * Runtime: Dual-compatible with Deno 1.35+/2.x and Node.js 20+ via node:crypto.
 */

import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PublicBusinessDto {
  publicQrId: string;
  name: string;
  logoUrl: string | null;
  categoryId: string;
  googleReviewUrl: string | null;
  whatsappNumber: string | null;
  isActive: boolean;
  accountStatus: string;
  subscriptionStatus: string;
  isDirectGoogleOnly: boolean;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    correlationId: string;
    retryable: boolean;
  };
  isSuspended?: boolean;
}

export interface HandlerOptions {
  supabaseClient?: SupabaseClient;
  skipRateLimit?: boolean;
  rateLimitSalt?: string;
  currentTime?: Date;
  bypassAuth?: boolean;
  expectedApiKey?: string;
}

// Database projection return row shape from get_public_business_by_qr
export interface PublicBusinessRow {
  public_qr_id: string;
  name: string;
  logo_url: string | null;
  category_id: string;
  google_review_url: string | null;
  whatsapp_number: string | null;
  is_active: boolean;
  account_status: string;
  subscription_status: string;
  is_direct_google_only: boolean;
  is_suspended: boolean;
}

// ============================================================================
// Input Validation Schema (Zod) — DEC-M3-03
// ============================================================================

// Strict 10-character lowercase alphanumeric public QR identifier (e.g. luxe000001, daily00001)
const QrIdQuerySchema = z
  .string({
    required_error: 'Missing qrId query parameter',
    invalid_type_error: 'qrId must be a string',
  })
  .trim()
  .regex(
    /^[a-z0-9]{10}$/,
    'qrId must be an exact 10-character lowercase alphanumeric identifier',
  );

// ============================================================================
// Cryptographic & IP Normalization Utilities (Work Package E & F)
// ============================================================================

function loadLocalEnv(): Record<string, string> {
  try {
    // @ts-expect-error Deno global
    if (typeof Deno !== 'undefined' && typeof Deno.readTextFileSync === 'function') {
      // @ts-expect-error Deno global
      const content = Deno.readTextFileSync('supabase/functions/.env');
      const map: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim();
          map[k] = v;
        }
      }
      return map;
    }
  } catch {
    // Ignored if file does not exist
  }
  return {};
}

const localEnvMap = loadLocalEnv();

export function getEnv(key: string): string | undefined {
  if (typeof Deno !== 'undefined' && typeof Deno.env?.get === 'function') {
    const val = Deno.env.get(key);
    if (val) return val;
  }
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  const procVal = g.process?.env?.[key];
  if (procVal) return procVal;

  return localEnvMap[key];
}

/**
 * Validates and retrieves the 32-byte (64 hex characters) rate limiting salt.
 */
export function getRateLimitSalt(customSecret?: string): string {
  let secret = customSecret ?? getEnv('RATE_LIMIT_SALT');

  // Graceful local development fallback when running in local Supabase container without linked cloud secrets
  if (!secret) {
    const supabaseUrl = getEnv('SUPABASE_URL');
    if (
      supabaseUrl &&
      (supabaseUrl.includes('localhost') ||
        supabaseUrl.includes('127.0.0.1') ||
        supabaseUrl.includes('kong:8000'))
    ) {
      secret =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    }
  }

  if (!secret || typeof secret !== 'string') {
    throw new Error(
      'ERR_CRYPTO_CONFIG: RATE_LIMIT_SALT is required and must be configured in server environment',
    );
  }

  const trimmed = secret.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    throw new Error(
      'ERR_CRYPTO_CONFIG: RATE_LIMIT_SALT must be a 64-character hexadecimal string (32-byte key)',
    );
  }

  return trimmed.toLowerCase();
}

/**
 * Validates IPv4 address with strict octet range check (0-255) and no leading zeros.
 */
export function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    // Reject leading zeros like "01" or "001" (except standalone "0")
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = Number(part);
    if (num < 0 || num > 255) return false;
  }
  return true;
}

/**
 * Validates IPv6 address per RFC 4291 syntax.
 */
export function isValidIpv6(ip: string): boolean {
  if (!ip.includes(':')) return false;
  if (ip.includes(':::')) return false;
  // Check for dual double-colons
  if ((ip.match(/::/g) || []).length > 1) return false;

  const parts = ip.split(':');
  if (parts.length < 3 || parts.length > 8) return false;

  for (const part of parts) {
    if (part === '') continue; // empty part from :: is valid
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return false;
  }
  return true;
}

/**
 * Cleans and normalizes an IP candidate string:
 * - Strips leading/trailing whitespace
 * - Strips IPv6 brackets (e.g. [::1])
 * - Strips port suffix from IPv4 (e.g. 192.0.2.1:443)
 * - Normalizes IPv4-mapped IPv6 (::ffff:192.0.2.1) to standard IPv4
 * - Validates strict IPv4 and IPv6 format
 * Returns normalized string or null if invalid.
 */
export function cleanAndNormalizeIp(raw: string): string | null {
  let cleaned = raw.trim();
  if (!cleaned) return null;

  // Handle port suffix on IPv4 (e.g. 192.0.2.1:443)
  if (cleaned.includes('.') && cleaned.includes(':') && !cleaned.toLowerCase().includes('::ffff:')) {
    const colonIdx = cleaned.lastIndexOf(':');
    const portPart = cleaned.slice(colonIdx + 1);
    if (/^\d+$/.test(portPart)) {
      cleaned = cleaned.slice(0, colonIdx);
    }
  }

  // Handle IPv6 brackets (e.g. [::1] or [::ffff:192.0.2.1])
  cleaned = cleaned.replace(/^\[|\]$/g, '');

  // Handle IPv4-mapped IPv6 addresses (e.g., ::ffff:192.0.2.1)
  const mappedPrefix = '::ffff:';
  if (cleaned.toLowerCase().startsWith(mappedPrefix)) {
    const ipv4Candidate = cleaned.slice(mappedPrefix.length);
    if (isValidIpv4(ipv4Candidate)) {
      return ipv4Candidate;
    }
  }

  if (isValidIpv4(cleaned)) {
    return cleaned;
  }

  if (isValidIpv6(cleaned)) {
    return cleaned.toLowerCase();
  }

  return null;
}

/**
 * Extracts, validates, and normalizes client IP address from ingress headers.
 *
 * Trust Strategy:
 * 1. Primary: X-Real-IP is strictly overwritten and enforced by the Supabase Kong gateway
 *    with the client connection address ($remote_addr). Client-supplied X-Real-IP is discarded by Kong.
 * 2. Secondary: X-Forwarded-For. Trusted proxies append each hop to the right. To prevent
 *    attacker-injected leftmost spoofing ("1.2.3.4, real_ip"), we evaluate from right to left.
 * 3. Cloudflare: cf-connecting-ip is accepted ONLY if TRUST_CLOUDFLARE_PROXY === 'true' in server environment.
 *    In direct gateway connections, client-supplied cf-connecting-ip is untrusted and ignored.
 * 4. Fail Closed: If ingress headers are provided but malformed, returns null (triggering HTTP 400).
 *    Fallback to loopback ('127.0.0.1') occurs ONLY when no IP headers were present at all (e.g. direct unit tests).
 */
export function extractClientIp(req: Request): string | null {
  const hasIpHeaders =
    req.headers.has('x-real-ip') ||
    req.headers.has('x-forwarded-for') ||
    req.headers.has('cf-connecting-ip');

  // 1. Primary: X-Real-IP (strictly overwritten by Supabase Kong gateway)
  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp) {
    const normalized = cleanAndNormalizeIp(xRealIp);
    if (normalized) return normalized;
    // Malformed X-Real-IP -> fail closed
    return null;
  }

  // 2. Secondary: X-Forwarded-For (evaluate rightmost IP added by immediate proxy)
  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const parts = xForwardedFor.split(',').map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i];
      if (candidate) {
        const normalized = cleanAndNormalizeIp(candidate);
        if (normalized) return normalized;
      }
    }
    // Present but all parts malformed -> fail closed
    return null;
  }

  // 3. Cloudflare: only if explicitly trusted
  const trustCf = getEnv('TRUST_CLOUDFLARE_PROXY') === 'true';
  if (trustCf) {
    const cfConnectingIp = req.headers.get('cf-connecting-ip');
    if (cfConnectingIp) {
      const normalized = cleanAndNormalizeIp(cfConnectingIp);
      if (normalized) return normalized;
      return null;
    }
  }

  // If headers were present but none were accepted, fail closed
  if (hasIpHeaders) {
    return null;
  }

  // In local development / test environments with no ingress headers, fallback to loopback
  return '127.0.0.1';
}

/**
 * Derives a privacy-safe daily salt from the master secret and UTC date.
 */
export function deriveDailySalt(masterSecret: string, dateStr: string): string {
  return createHmac('sha256', Buffer.from(masterSecret, 'hex'))
    .update(`qr_rate_limit_salt:${dateStr}`)
    .digest('hex');
}

/**
 * Computes a pseudonymized IP hash using HMAC-SHA256 with the derived daily salt.
 */
export function computeIpHash(dailySalt: string, normalizedIp: string): string {
  return createHmac('sha256', Buffer.from(dailySalt, 'hex'))
    .update(`qr_ip:${normalizedIp}`)
    .digest('hex');
}

/**
 * Checks if the current UTC time falls within the midnight overlap window.
 * The overlap window covers the first 630 seconds (10 min + 30s clock skew) of the UTC day.
 */
export function isUtcMidnightOverlap(date: Date = new Date()): boolean {
  const secondsIntoDay =
    date.getUTCHours() * 3600 +
    date.getUTCMinutes() * 60 +
    date.getUTCSeconds();
  return secondsIntoDay < 630;
}

// ============================================================================
// Response & Header Construction
// ============================================================================

export function buildHeaders(
  correlationId: string,
  extraHeaders?: Record<string, string>,
): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Request-Id': correlationId,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers':
      'apikey, content-type, authorization, x-client-info, x-request-id',
  });

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }

  return headers;
}

export function createErrorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  retryable = false,
  extraPayload?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  const body: ApiErrorEnvelope = {
    error: {
      code,
      message,
      correlationId,
      retryable,
    },
    ...extraPayload,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: buildHeaders(correlationId, extraHeaders),
  });
}

// ============================================================================
// Core Request Handler (Exported for Unit & Integration Testing)
// ============================================================================

export async function handleGetPublicBusiness(
  req: Request,
  options?: HandlerOptions,
): Promise<Response> {
  const correlationId = crypto.randomUUID();

  // 1. CORS Preflight Handling
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildHeaders(correlationId),
    });
  }

  // 2. HTTP Method Guard (GET only)
  if (req.method !== 'GET') {
    return createErrorResponse(
      405,
      'ERR_METHOD_NOT_ALLOWED',
      `HTTP method ${req.method} is not supported. Use GET.`,
      correlationId,
      false,
      undefined,
      { Allow: 'GET, OPTIONS' },
    );
  }

  // 3. Public API Authentication (Work Package C & Security Hardening)
  if (!options?.bypassAuth) {
    const rawApiKey =
      req.headers.get('apikey') ??
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (!rawApiKey || rawApiKey.trim() === '') {
      return createErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        'Missing or empty apikey header. Anonymous customer requests require a valid publishable key.',
        correlationId,
        false,
      );
    }

    const trimmedKey = rawApiKey.trim();
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    // Never accept elevated service role keys on public anonymous endpoints
    if (serviceRoleKey && trimmedKey === serviceRoleKey.trim()) {
      return createErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        'Service role key cannot be used for public anonymous client requests.',
        correlationId,
        false,
      );
    }

    const expectedKey = options?.expectedApiKey;
    const internalPublishable = getEnv('SUPABASE_INTERNAL_PUBLISHABLE_KEY');
    const anonKey = getEnv('SUPABASE_ANON_KEY');

    const isMatchingEnv =
      (expectedKey && trimmedKey === expectedKey.trim()) ||
      (internalPublishable && trimmedKey === internalPublishable.trim()) ||
      (anonKey && trimmedKey === anonKey.trim());

    const isPublishableFormat = /^sb_publishable_[A-Za-z0-9_-]+$/.test(trimmedKey);
    const isJwtFormat = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmedKey);

    if (!isMatchingEnv && !isPublishableFormat && !isJwtFormat) {
      return createErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        'Invalid apikey. Provided key is not recognized as a valid publishable key or session token.',
        correlationId,
        false,
      );
    }
  }

  // 4. Extract and Validate Query Parameters (DEC-M3-03)
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const lastPathSegment = pathParts[pathParts.length - 1];
  const isPathQr =
    lastPathSegment &&
    lastPathSegment !== 'get-public-business' &&
    lastPathSegment !== 'v1';
  const rawQrId =
    url.searchParams.get('qrId') ??
    url.searchParams.get('public_qr_id') ??
    (isPathQr ? lastPathSegment : null);

  const parseResult = QrIdQuerySchema.safeParse(rawQrId);
  if (!parseResult.success) {
    return createErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      parseResult.error.issues[0]?.message || 'Invalid or missing qrId parameter.',
      correlationId,
      false,
    );
  }

  const normalizedQrId = parseResult.data.toLowerCase();

  // 5. Initialize Database Client
  let supabase: SupabaseClient;
  if (options?.supabaseClient) {
    supabase = options.supabaseClient;
  } else {
    const supabaseUrl = getEnv('SUPABASE_URL') || 'http://127.0.0.1:54321';
    const serviceRoleKey =
      getEnv('SUPABASE_SERVICE_ROLE_KEY') || getEnv('SUPABASE_ANON_KEY') || '';

    if (!serviceRoleKey) {
      return createErrorResponse(
        500,
        'ERR_INTERNAL_SERVER_ERROR',
        'Database access configuration is missing in server environment.',
        correlationId,
        false,
      );
    }

    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  // 6. Client IP Extraction & Exact Rolling-Window Rate Limiting (DEC-M3-01 / Work Packages D, E, F)
  if (!options?.skipRateLimit) {
    const clientIp = extractClientIp(req);
    if (!clientIp) {
      return createErrorResponse(
        400,
        'ERR_INVALID_PAYLOAD',
        'Unable to determine a valid client IP address for rate limit evaluation.',
        correlationId,
        false,
      );
    }

    let salt: string;
    try {
      salt = getRateLimitSalt(options?.rateLimitSalt);
    } catch {
      return createErrorResponse(
        500,
        'ERR_INTERNAL_SERVER_ERROR',
        'Cryptographic service configuration is invalid or uninitialized.',
        correlationId,
        false,
      );
    }

    const now = options?.currentTime ?? new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const todaySalt = deriveDailySalt(salt, todayStr);
    const primaryHash = computeIpHash(todaySalt, clientIp);

    // Evaluate cross-midnight continuity window
    let prevHash: string | null = null;
    if (isUtcMidnightOverlap(now)) {
      const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const yesterdaySalt = deriveDailySalt(salt, yesterdayStr);
      prevHash = computeIpHash(yesterdaySalt, clientIp);
    }

    // Call PostgreSQL exact rolling-window rate limiter
    const { data: isAllowed, error: rlError } = await supabase.rpc(
      'check_exact_rate_limit',
      {
        p_key_hash: primaryHash,
        p_prev_key_hash: prevHash,
        p_max_requests: 60,
        p_window_seconds: 600,
      },
    );

    if (rlError) {
      return createErrorResponse(
        503,
        'ERR_DATABASE_UNAVAILABLE',
        'Rate limit evaluation service is temporarily unavailable.',
        correlationId,
        true,
      );
    }

    if (isAllowed === false) {
      return createErrorResponse(
        429,
        'ERR_RATE_LIMITED',
        'Too many requests. Please wait before scanning or refreshing again.',
        correlationId,
        true,
        undefined,
        { 'Retry-After': '60' },
      );
    }
  }

  // 7. Restricted Database Projection RPC (DEC-M3-02 / Work Package B)
  try {
    const { data: projectionRows, error: dbError } = await supabase.rpc(
      'get_public_business_by_qr',
      {
        p_qr_id: normalizedQrId,
      },
    );

    if (dbError) {
      return createErrorResponse(
        503,
        'ERR_DATABASE_UNAVAILABLE',
        'Unable to query merchant data from database.',
        correlationId,
        true,
      );
    }

    const rows = projectionRows as PublicBusinessRow[] | null;

    // 8. Not Found Handling (TC-API-02 / SCR-CUST-12)
    if (!rows || rows.length === 0 || !rows[0]) {
      return createErrorResponse(
        404,
        'ERR_QR_NOT_FOUND',
        'The requested QR code or business was not found.',
        correlationId,
        false,
      );
    }

    const business = rows[0];

    // 9. Suspended / Inactive Business Handling (TC-API-03 / SCR-CUST-13 / DEC-M3-05)
    if (business.is_suspended) {
      return createErrorResponse(
        403,
        'ERR_BUSINESS_SUSPENDED',
        'This business account is currently suspended.',
        correlationId,
        false,
        { isSuspended: true },
      );
    }

    // 10. Construct Public Safe DTO (Strict Zero-Data-Leak Boundary)
    const responseDto: PublicBusinessDto = {
      publicQrId: business.public_qr_id,
      name: business.name,
      logoUrl: business.logo_url,
      categoryId: business.category_id,
      googleReviewUrl: business.google_review_url,
      whatsappNumber: business.whatsapp_number,
      isActive: business.is_active,
      accountStatus: business.account_status,
      subscriptionStatus: business.subscription_status,
      isDirectGoogleOnly: business.is_direct_google_only,
    };

    return new Response(JSON.stringify(responseDto), {
      status: 200,
      headers: buildHeaders(correlationId),
    });
  } catch {
    return createErrorResponse(
      500,
      'ERR_INTERNAL_SERVER_ERROR',
      'An unexpected server error occurred while resolving public business data.',
      correlationId,
      true,
    );
  }
}

// ============================================================================
// Deno Edge Runtime Entrypoint
// ============================================================================

if (typeof Deno !== 'undefined' && 'serve' in Deno) {
  // @ts-expect-error Deno serve global in Edge Runtime
  Deno.serve(async (req: Request) => {
    return handleGetPublicBusiness(req);
  });
}
