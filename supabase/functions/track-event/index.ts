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
 *   - Resolves trusted server-side business identity from publicQrId via atomic database RPC
 *   - Rejects unknown QR IDs with HTTP 404 ERR_QR_NOT_FOUND
 *   - Atomic transaction-scoped advisory locking: eliminates check-then-act races across calendar-minute boundaries
 *   - Exact rolling 60-second duplicate window + secondary database unique constraint collision handling
 *   - IP abuse rate limiting: 60 events / 600 seconds window using salted HMAC-SHA256 IP hashes
 *   - Idempotent HTTP 202 Accepted {"status": "accepted"} for initial inserts and {"status": "accepted", "deduplicated": true} for duplicates
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
// Environment & Configuration Helpers
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
  // @ts-expect-error Deno global
  if (typeof Deno !== 'undefined' && typeof Deno.env?.get === 'function') {
    // @ts-expect-error Deno global
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
// IP Extraction & Abuse Rate Limiting Helpers
// ============================================================================

export function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = Number(part);
    if (num < 0 || num > 255) return false;
  }
  return true;
}

export function isValidIpv6(ip: string): boolean {
  if (!ip.includes(':')) return false;
  if (ip.includes(':::')) return false;
  if ((ip.match(/::/g) || []).length > 1) return false;

  const parts = ip.split(':');
  if (parts.length < 3 || parts.length > 8) return false;

  for (const part of parts) {
    if (part === '') continue;
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return false;
  }
  return true;
}

export const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

export function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split('/');
  if (!net || !bitsStr) return false;
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipParts = ip.split('.').map(Number);
  const netParts = net.split('.').map(Number);
  if (ipParts.length !== 4 || netParts.length !== 4) return false;

  const ipInt =
    (((ipParts[0] ?? 0) << 24) |
      ((ipParts[1] ?? 0) << 16) |
      ((ipParts[2] ?? 0) << 8) |
      (ipParts[3] ?? 0)) >>>
    0;
  const netInt =
    (((netParts[0] ?? 0) << 24) |
      ((netParts[1] ?? 0) << 16) |
      ((netParts[2] ?? 0) << 8) |
      (netParts[3] ?? 0)) >>>
    0;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

export function isCloudflareProxyIp(ip: string): boolean {
  if (isValidIpv4(ip)) {
    return CLOUDFLARE_IPV4_CIDRS.some((cidr) => isIpv4InCidr(ip, cidr));
  }
  if (isValidIpv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower.startsWith('2400:cb00:') ||
      lower.startsWith('2606:4700:') ||
      lower.startsWith('2803:f800:') ||
      lower.startsWith('2405:b500:') ||
      lower.startsWith('2405:8100:') ||
      lower.startsWith('2a06:98c0:') ||
      lower.startsWith('2c0f:f248:')
    );
  }
  return false;
}

export function cleanAndNormalizeIp(raw: string): string | null {
  let cleaned = raw.trim();
  if (!cleaned) return null;

  if (cleaned.includes('.') && cleaned.includes(':') && !cleaned.toLowerCase().includes('::ffff:')) {
    const colonIdx = cleaned.lastIndexOf(':');
    const portPart = cleaned.slice(colonIdx + 1);
    if (/^\d+$/.test(portPart)) {
      cleaned = cleaned.slice(0, colonIdx);
    }
  }

  cleaned = cleaned.replace(/^\[|\]$/g, '');

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

export function extractClientIp(req: Request): string | null {
  const hasIpHeaders =
    req.headers.has('x-real-ip') ||
    req.headers.has('x-forwarded-for') ||
    req.headers.has('cf-connecting-ip');

  const rawRealIp = req.headers.get('x-real-ip');
  let directConnectingIp: string | null = null;
  if (rawRealIp) {
    directConnectingIp = cleanAndNormalizeIp(rawRealIp);
    if (!directConnectingIp) {
      return null;
    }
  }

  const trustCf = getEnv('TRUST_CLOUDFLARE_PROXY') === 'true';
  const rawCfIp = req.headers.get('cf-connecting-ip');
  if (trustCf && rawCfIp && directConnectingIp) {
    if (isCloudflareProxyIp(directConnectingIp)) {
      const normalizedCf = cleanAndNormalizeIp(rawCfIp);
      if (normalizedCf) return normalizedCf;
      return null;
    }
  }

  if (directConnectingIp) {
    return directConnectingIp;
  }

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
    return null;
  }

  if (hasIpHeaders) {
    return null;
  }

  return '127.0.0.1';
}

export function getRateLimitSalt(customSecret?: string): string {
  let secret = customSecret ?? getEnv('RATE_LIMIT_SALT');

  if (!secret) {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const isLocalOrTest =
      !supabaseUrl ||
      supabaseUrl.includes('localhost') ||
      supabaseUrl.includes('127.0.0.1') ||
      supabaseUrl.includes('kong:8000') ||
      getEnv('NODE_ENV') === 'test';

    if (isLocalOrTest) {
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

export function deriveDailySalt(masterSecret: string, dateStr: string): string {
  return createHmac('sha256', Buffer.from(masterSecret, 'hex'))
    .update(`qr_rate_limit_salt:${dateStr}`)
    .digest('hex');
}

export function computeIpHash(dailySalt: string, normalizedIp: string): string {
  return createHmac('sha256', Buffer.from(dailySalt, 'hex'))
    .update(`qr_ip:${normalizedIp}`)
    .digest('hex');
}

export function isUtcMidnightOverlap(date: Date = new Date()): boolean {
  const secondsIntoDay =
    date.getUTCHours() * 3600 +
    date.getUTCMinutes() * 60 +
    date.getUTCSeconds();
  return secondsIntoDay < 630;
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
  skipRateLimit?: boolean;
  rateLimitSalt?: string;
  currentTime?: Date;
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
    const supabaseUrl = getEnv('SUPABASE_URL') || 'http://127.0.0.1:54321';
    const isLocalOrTest =
      (supabaseUrl &&
        (supabaseUrl.includes('localhost') ||
          supabaseUrl.includes('127.0.0.1') ||
          supabaseUrl.includes('kong:8000'))) ||
      getEnv('NODE_ENV') === 'test';

    const serviceRoleKey =
      getEnv('SUPABASE_SERVICE_ROLE_KEY') ||
      (isLocalOrTest
        ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
        : '');

    if (!supabaseUrl || !serviceRoleKey) {
      return createErrorResponse(
        500,
        'ERR_INTERNAL',
        'Database connection environment is unconfigured.',
        correlationId,
        false,
      );
    }

    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // 8. Client IP Extraction & Abuse Rate Limiting (60 req / 600s)
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
        'ERR_INTERNAL',
        'Cryptographic service configuration is invalid or uninitialized.',
        correlationId,
        false,
      );
    }

    const now = options?.currentTime ?? new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const todaySalt = deriveDailySalt(salt, todayStr);
    const primaryHash = computeIpHash(todaySalt, clientIp);

    let prevHash: string | null = null;
    if (isUtcMidnightOverlap(now)) {
      const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const yesterdaySalt = deriveDailySalt(salt, yesterdayStr);
      prevHash = computeIpHash(yesterdaySalt, clientIp);
    }

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
        'Too many telemetry requests. Please wait before retrying.',
        correlationId,
        true,
        { 'Retry-After': '60' },
      );
    }
  }

  // 9. Atomic Event Ingestion via PostgreSQL RPC
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'ingest_analytics_event_atomic',
      {
        p_public_qr_id: publicQrId,
        p_event_name: eventName,
        p_session_uuid: sessionUuid,
        p_user_agent_category: userAgentCategory,
        p_window_seconds: 60,
      },
    );

    if (rpcError) {
      return createErrorResponse(
        500,
        'ERR_INTERNAL',
        'Failed to record analytics event.',
        correlationId,
        true,
      );
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row || typeof row !== 'object' || !('status' in row)) {
      return createErrorResponse(
        500,
        'ERR_INTERNAL',
        'Unexpected database response recording analytics event.',
        correlationId,
        true,
      );
    }

    switch (row.status) {
      case 'inserted':
        return createSuccessResponse(correlationId, false);
      case 'deduplicated':
        return createSuccessResponse(correlationId, true);
      case 'qr_not_found':
        return createErrorResponse(
          404,
          'ERR_QR_NOT_FOUND',
          `Business with public QR ID '${publicQrId}' was not found.`,
          correlationId,
          false,
        );
      case 'forbidden_event':
        return createErrorResponse(
          403,
          'ERR_FORBIDDEN_EVENT',
          `Server-owned event '${eventName}' is forbidden from client submission. This event is emitted strictly by server services.`,
          correlationId,
          false,
        );
      case 'invalid_event':
      case 'invalid_payload':
        return createErrorResponse(
          400,
          'ERR_INVALID_PAYLOAD',
          'Invalid request payload or event name.',
          correlationId,
          false,
        );
      default:
        return createErrorResponse(
          500,
          'ERR_INTERNAL',
          'Failed to process analytics event.',
          correlationId,
          true,
        );
    }
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

// @ts-expect-error Deno global
if (typeof Deno !== 'undefined' && 'serve' in Deno) {
  // @ts-expect-error Deno global
  Deno.serve(async (req: Request) => {
    return handleTrackEvent(req);
  });
}
