/**
 * Edge Function: track-event (API-PUB-05)
 *
 * Task: M3-T04 — Analytics Ingestion Edge Function with Server Deduplication
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M3-T04
 *   - docs/API_SPEC.md (v1.2) §4.1, §6, §7.5, §18 (TC-API-13)
 *   - docs/ARCHITECTURE.md (v1.1) §11.1, §11.2, §11.3
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.6 (analytics_events)
 *   - docs/SECURITY.md (v1.1) §7 (TH-13), §13 (GC-02), §16 (TC-ANA-01..06)
 *   - docs/TEST_PLAN.md (v1.1) TC-ANA-01..06, TC-API-13
 *
 * Capabilities:
 *   - Public anonymous telemetry ingestion gateway (verify_jwt = false)
 *   - Validates publicQrId, sessionUuid, eventName, and userAgentCategory
 *   - Permits exactly 6 client-reported events
 *   - Strictly rejects 2 server-owned events (EVENT_SURVEY_COMPLETED, EVENT_GENERATION_SUCCESS) with HTTP 403 ERR_FORBIDDEN_EVENT
 *   - Resolves trusted server-side business identity from publicQrId
 *   - Rejects unknown QR IDs with HTTP 404 ERR_QR_NOT_FOUND
 *   - Prevents cross-tenant event attribution (business_id is authoritative DB UUID)
 *   - Computes composite SHA-256 deduplication key from (business_id, event_name, session_uuid, time_window)
 *   - Atomic deduplication: rolling 60-second duplicate window + database unique constraint collision handling
 *   - Idempotent HTTP 202 Accepted {"status": "accepted"} for both initial and deduplicated requests
 *   - Privacy-safe: zero raw IP addresses, zero customer notes, zero PII persisted
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

// ============================================================================
// Response Headers & Constants
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'apikey, authorization, content-type, x-client-info, x-correlation-id',
  'Access-Control-Max-Age': '86400',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export const PERMITTED_CLIENT_EVENTS = [
  'EVENT_QR_PAGE_VIEW',
  'EVENT_GENERATION_REQUESTED',
  'EVENT_COPY_ATTEMPTED',
  'EVENT_COPY_SUCCESS',
  'EVENT_GOOGLE_REDIRECT_CLICK',
  'EVENT_GOOGLE_BYPASS_CLICK',
] as const;

export const SERVER_OWNED_EVENTS = [
  'EVENT_SURVEY_COMPLETED',
  'EVENT_GENERATION_SUCCESS',
] as const;

export type PermittedClientEvent = (typeof PERMITTED_CLIENT_EVENTS)[number];
export type ServerOwnedEvent = (typeof SERVER_OWNED_EVENTS)[number];

export const USER_AGENT_CATEGORIES = ['mobile', 'desktop', 'tablet'] as const;
export type UserAgentCategory = (typeof USER_AGENT_CATEGORIES)[number];

// Max allowed JSON request size: 16 KB
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

// ============================================================================
// Canonical Error & Success Interfaces (API_SPEC §17)
// ============================================================================

export interface CanonicalErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string;
    retryable: boolean;
  };
}

export interface TrackEventSuccessResponse {
  status: 'accepted';
  deduplicated?: boolean;
}

// ============================================================================
// Request Schemas (Zod)
// ============================================================================

export const TrackEventRequestSchema = z.object({
  publicQrId: z
    .string({ required_error: 'publicQrId is required' })
    .trim()
    .regex(/^[a-z0-9]{8,12}$/, 'publicQrId must be an 8-12 character lowercase alphanumeric identifier'),
  eventName: z
    .string({ required_error: 'eventName is required' })
    .trim()
    .refine(
      (val): val is PermittedClientEvent => (PERMITTED_CLIENT_EVENTS as readonly string[]).includes(val),
      { message: 'Invalid eventName. Must be one of the permitted public analytics events.' },
    ),
  sessionUuid: z
    .string({ required_error: 'sessionUuid is required' })
    .trim()
    .uuid('sessionUuid must be a valid UUID string'),
  userAgentCategory: z
    .string()
    .optional()
    .default('mobile')
    .refine(
      (val): val is UserAgentCategory => (USER_AGENT_CATEGORIES as readonly string[]).includes(val),
      { message: 'Invalid userAgentCategory. Must be mobile, desktop, or tablet.' },
    ),
});

export type TrackEventRequestInput = z.infer<typeof TrackEventRequestSchema>;

// ============================================================================
// Helper Utilities
// ============================================================================

function getEnv(key: string): string | undefined {
  try {
    if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
      return Deno.env.get(key);
    }
  } catch {
    // Fall back to process.env
  }
  return typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
}

export function generateCorrelationId(req?: Request): string {
  const headerId = req?.headers.get('x-correlation-id')?.trim();
  if (headerId && /^[a-zA-Z0-9_\-.]{8,64}$/.test(headerId)) {
    return headerId;
  }
  return `corr_${crypto.randomUUID()}`;
}

export function createErrorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  retryable = false,
  extraHeaders: Record<string, string> = {},
): Response {
  const body: CanonicalErrorResponse = {
    error: {
      code,
      message,
      correlationId,
      retryable,
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': correlationId,
      ...extraHeaders,
    },
  });
}

export function createSuccessResponse(
  correlationId: string,
  deduplicated = false,
): Response {
  const body: TrackEventSuccessResponse = {
    status: 'accepted',
    ...(deduplicated ? { deduplicated: true } : {}),
  };

  return new Response(JSON.stringify(body), {
    status: 202,
    headers: {
      ...CORS_HEADERS,
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': correlationId,
    },
  });
}

// ============================================================================
// Authentication & Credential Verification
// ============================================================================

export function getValidProjectApiKeys(expectedApiKey?: string): Set<string> {
  const keys = new Set<string>();

  if (expectedApiKey) keys.add(expectedApiKey.trim());

  const internalPub = getEnv('SUPABASE_INTERNAL_PUBLISHABLE_KEY');
  if (internalPub) keys.add(internalPub.trim());

  const pubKey = getEnv('SUPABASE_PUBLISHABLE_KEY');
  if (pubKey) keys.add(pubKey.trim());

  const anonKey = getEnv('SUPABASE_ANON_KEY');
  if (anonKey) keys.add(anonKey.trim());

  const supabaseUrl = getEnv('SUPABASE_URL');
  const isLocalOrTest =
    (supabaseUrl &&
      (supabaseUrl.includes('localhost') ||
        supabaseUrl.includes('127.0.0.1') ||
        supabaseUrl.includes('kong:8000'))) ||
    getEnv('NODE_ENV') === 'test';

  if (isLocalOrTest) {
    keys.add('sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH');
    keys.add(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    );
  }

  return keys;
}

export function getJwtSecret(customSecret?: string): string {
  if (customSecret) return customSecret.trim();

  const envSecret =
    getEnv('SUPABASE_INTERNAL_JWT_SECRET') ?? getEnv('JWT_SECRET');

  if (envSecret) return envSecret.trim();

  const supabaseUrl = getEnv('SUPABASE_URL');
  const isLocalOrTest =
    (supabaseUrl &&
      (supabaseUrl.includes('localhost') ||
        supabaseUrl.includes('127.0.0.1') ||
        supabaseUrl.includes('kong:8000'))) ||
    getEnv('NODE_ENV') === 'test';

  if (isLocalOrTest) {
    return 'super-secret-jwt-token-with-at-least-32-characters-long';
  }

  return '';
}

export function verifyJwtSignature(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const headerJson = Buffer.from(parts[0]!, 'base64url').toString('utf8');
    const header = JSON.parse(headerJson);
    if (!header || header.alg !== 'HS256') {
      return false;
    }

    const payloadJson = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    if (payload.exp && typeof payload.exp === 'number') {
      const nowEpoch = Math.floor(Date.now() / 1000);
      if (nowEpoch > payload.exp) {
        return false;
      }
    }

    const expectedSig = createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(parts[2]!);

    if (expectedBuf.byteLength !== actualBuf.byteLength) {
      return false;
    }

    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

// ============================================================================
// Deduplication Key Generator
// ============================================================================

/**
 * Computes deterministic composite SHA-256 deduplication key.
 * Formula: SHA-256(business_id + ":" + event_name + ":" + session_uuid + ":" + minute_window)
 * Reference: docs/API_SPEC.md §7.5 & docs/DATABASE_SCHEMA.md §5.6
 */
export function computeDeduplicationKey(
  businessId: string,
  eventName: string,
  sessionUuid: string,
  timestampMs = Date.now(),
): string {
  // Quantize to 60-second calendar minute window: date_trunc('minute', timestamp)
  const minuteEpoch = Math.floor(timestampMs / 60000) * 60000;
  const minuteIso = new Date(minuteEpoch).toISOString();

  return createHash('sha256')
    .update(`${businessId}:${eventName}:${sessionUuid}:${minuteIso}`)
    .digest('hex');
}

// ============================================================================
// Core Request Handler (API-PUB-05)
// ============================================================================

export interface TrackEventOptions {
  supabaseClient?: SupabaseClient;
  expectedApiKey?: string;
  jwtSecret?: string;
  bypassAuth?: boolean;
}

export async function handleTrackEvent(
  req: Request,
  options?: TrackEventOptions,
): Promise<Response> {
  const correlationId = generateCorrelationId(req);

  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. HTTP Method Gate
  if (req.method !== 'POST') {
    return createErrorResponse(
      405,
      'ERR_METHOD_NOT_ALLOWED',
      `HTTP method ${req.method} is not allowed. Only POST and OPTIONS are supported.`,
      correlationId,
      false,
      { Allow: 'POST, OPTIONS' },
    );
  }

  // 3. API Key & Authentication Gate
  if (!options?.bypassAuth) {
    const apiKeyHeader = req.headers.get('apikey')?.trim();
    const authHeader = req.headers.get('authorization')?.trim();
    const bearerToken = authHeader?.replace(/^Bearer\s+/i, '').trim();

    const rawKey = apiKeyHeader || bearerToken;
    if (!rawKey) {
      return createErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        'Missing apikey or authorization header. Valid project API key is required.',
        correlationId,
        false,
      );
    }

    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();

    // Privileged service-role key is strictly prohibited on public endpoints
    if (
      (serviceRoleKey && apiKeyHeader === serviceRoleKey) ||
      (serviceRoleKey && bearerToken === serviceRoleKey)
    ) {
      return createErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        'Service role key is forbidden on public anonymous endpoints.',
        correlationId,
        false,
      );
    }

    const validConfiguredKeys = getValidProjectApiKeys(options?.expectedApiKey);
    const jwtSecret = getJwtSecret(options?.jwtSecret);

    const validateCredential = (cred: string): boolean => {
      if (validConfiguredKeys.has(cred)) return true;
      if (jwtSecret && verifyJwtSignature(cred, jwtSecret)) return true;
      return false;
    };

    if (apiKeyHeader && !validateCredential(apiKeyHeader)) {
      return createErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        'Invalid apikey. Provided key does not match this project or is not a valid token.',
        correlationId,
        false,
      );
    }

    if (
      bearerToken &&
      bearerToken !== apiKeyHeader &&
      !validateCredential(bearerToken)
    ) {
      return createErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        'Invalid authorization header. Bearer token signature is invalid, forged, or expired.',
        correlationId,
        false,
      );
    }

    if (!apiKeyHeader && bearerToken && !validateCredential(bearerToken)) {
      return createErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        'Invalid authorization header. Provided token is not valid for this project.',
        correlationId,
        false,
      );
    }
  }

  // 4. Request Size & JSON Body Parsing Gate
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_BODY_BYTES) {
    return createErrorResponse(
      413,
      'ERR_PAYLOAD_TOO_LARGE',
      `Request body exceeds maximum allowed size of ${MAX_REQUEST_BODY_BYTES} bytes.`,
      correlationId,
      false,
    );
  }

  let rawBody: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_REQUEST_BODY_BYTES) {
      return createErrorResponse(
        413,
        'ERR_PAYLOAD_TOO_LARGE',
        `Request body exceeds maximum allowed size of ${MAX_REQUEST_BODY_BYTES} bytes.`,
        correlationId,
        false,
      );
    }
    rawBody = JSON.parse(text);
  } catch {
    return createErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      'Malformed request payload. Body must be valid JSON.',
      correlationId,
      false,
    );
  }

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return createErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      'Request body must be a valid JSON object.',
      correlationId,
      false,
    );
  }

  const rawObj = rawBody as Record<string, unknown>;

  // 5. Server-Owned Event Restriction Check (TC-ANA-02, TC-ANA-03)
  // Check raw string before Zod validation to provide exact 403 ERR_FORBIDDEN_EVENT error
  const rawEventName = typeof rawObj.eventName === 'string' ? rawObj.eventName.trim() : '';
  if (
    rawEventName === 'EVENT_SURVEY_COMPLETED' ||
    rawEventName === 'EVENT_GENERATION_SUCCESS'
  ) {
    return createErrorResponse(
      403,
      'ERR_FORBIDDEN_EVENT',
      `Server-owned event '${rawEventName}' is forbidden from client submission. This event is emitted strictly by server services.`,
      correlationId,
      false,
    );
  }

  // 6. Schema Validation with Zod
  const parseResult = TrackEventRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    return createErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      firstIssue?.message ?? 'Invalid request payload.',
      correlationId,
      false,
    );
  }

  const { publicQrId, eventName, sessionUuid, userAgentCategory } = parseResult.data;

  // 7. Supabase Database Client Initialization
  let supabase: SupabaseClient;
  if (options?.supabaseClient) {
    supabase = options.supabaseClient;
  } else {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = getEnv('SUPABASE_ANON_KEY');
    const authKey = serviceRoleKey ?? anonKey;

    if (!supabaseUrl || !authKey) {
      return createErrorResponse(
        500,
        'ERR_INTERNAL',
        'Database connection environment is unconfigured.',
        correlationId,
        false,
      );
    }

    supabase = createClient(supabaseUrl, authKey, {
      auth: { persistSession: false },
    });
  }

  // 8. Resolve Target Business by Immutable publicQrId
  let businessId: string;
  try {
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('id, name, account_status, is_active')
      .eq('public_qr_id', publicQrId)
      .maybeSingle();

    if (bizError) {
      return createErrorResponse(
        500,
        'ERR_INTERNAL',
        'Database query failed while resolving business QR.',
        correlationId,
        true,
      );
    }

    if (!business) {
      return createErrorResponse(
        404,
        'ERR_QR_NOT_FOUND',
        `Business with public QR ID '${publicQrId}' was not found.`,
        correlationId,
        false,
      );
    }

    businessId = business.id;
  } catch {
    return createErrorResponse(
      500,
      'ERR_INTERNAL',
      'Unexpected error resolving business identity.',
      correlationId,
      true,
    );
  }

  // 9. Deduplication Check & Ingestion
  try {
    const now = Date.now();
    const dedupKey = computeDeduplicationKey(businessId, eventName, sessionUuid, now);

    // 9a. Rolling 60-Second Window Check:
    // Protects against rapid double-taps that happen to straddle a calendar minute boundary
    const sixtySecondsAgo = new Date(now - 60000).toISOString();
    const { data: recentEvent, error: recentError } = await supabase
      .from('analytics_events')
      .select('id')
      .eq('business_id', businessId)
      .eq('event_name', eventName)
      .eq('session_uuid', sessionUuid)
      .gte('created_at', sixtySecondsAgo)
      .limit(1)
      .maybeSingle();

    if (!recentError && recentEvent) {
      // Event already recorded within rolling 60s window; safely acknowledge as deduplicated
      return createSuccessResponse(correlationId, true);
    }

    // 9b. Atomic Database Insertion with Deduplication Key
    const { error: insertError } = await supabase.from('analytics_events').insert({
      business_id: businessId,
      event_name: eventName,
      session_uuid: sessionUuid,
      user_agent_category: userAgentCategory,
      deduplication_key: dedupKey,
    });

    if (insertError) {
      // 23505: unique_violation on analytics_events_dedup_uq
      if (
        insertError.code === '23505' ||
        insertError.message?.includes('analytics_events_dedup_uq') ||
        insertError.details?.includes('deduplication_key')
      ) {
        // Concurrency race: another request with identical deduplication key committed first
        return createSuccessResponse(correlationId, true);
      }

      // Real database error: return 500 ERR_INTERNAL without masking
      return createErrorResponse(
        500,
        'ERR_INTERNAL',
        'Failed to record analytics event.',
        correlationId,
        true,
      );
    }

    // Successful first-time event ingestion
    return createSuccessResponse(correlationId, false);
  } catch {
    return createErrorResponse(
      500,
      'ERR_INTERNAL',
      'Unexpected database error recording analytics event.',
      correlationId,
      true,
    );
  }
}

// ============================================================================
// Deno Edge Runtime Entrypoint
// ============================================================================

if (typeof Deno !== 'undefined' && 'serve' in Deno) {
  Deno.serve(async (req: Request) => {
    return handleTrackEvent(req);
  });
}
