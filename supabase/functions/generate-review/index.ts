/**
 * Edge Function: generate-review (API-PUB-03)
 *
 * Task: M4-T02 — Implement Complete AI Review Generation Edge Function Pipeline
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M4-T02, Task M4-T01
 *   - docs/API_SPEC.md (v1.2) §7.4, §8.1, §8.2, §9, §10, §12 (RPC-INT-02, RPC-INT-03, RPC-INT-04)
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.5, §5.8, §5.9, §12, §13
 *   - docs/SECURITY.md (v1.1) §7, §8, Gate M0-11, Gate M0-12, Gate M0-16
 *   - docs/TEST_PLAN.md (v1.1) TC-API-06, TC-API-07, TC-API-08, TC-API-09, TC-API-10
 *
 * Capabilities:
 *   - Public anonymous AI review generation gateway (verify_jwt = false at Kong; app-level auth enforced)
 *   - Project publishable key validation (rejects missing, forged, wrong project, and privileged keys)
 *   - Constant-time HMAC submission token verification bound to responseId, businessId, and surveyVersion
 *   - Enforces 10-minute (600s) token lifetime (rejects expired tokens with HTTP 401, forged with HTTP 403)
 *   - Authoritative retrieval of persisted feedback and affirmed facts from public.survey_responses
 *   - Merchant operational status check (rejects inactive/suspended merchants with HTTP 403)
 *   - Subscription verification (rejects past-due subscriptions with HTTP 402)
 *   - Weighted sliding-window IP rate limiting: 30 requests / 10 minutes per hashed IP bucket
 *   - Insufficient-facts abstention: halts before quota reservation if no affirmative facts/notes exist
 *   - Two-phase quota reservation (reserve_generation_quota) with FOR UPDATE row locks and 60s TTL
 *   - Grounded prompt construction with deterministic XML entity escaping via M4-T01 promptBuilder
 *   - Decoupled Gemini client dispatch with local mock transport support via M4-T01 gemini
 *   - Strict structured JSON draft validation (< 50 words, non-empty, single-key schema)
 *   - Two-phase quota commitment (commit_generation_quota) and temporary draft caching
 *   - Immediate safe quota cleanup (release_generation_quota) on provider timeout or failure
 *   - Ingestion of server-owned EVENT_GENERATION_SUCCESS into public.analytics_events
 *   - Canonical error responses with zero token, secret, or provider detail leakage
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  computeSurveyVersion,
  getSigningSecret as getCryptoSigningSecret,
  verifySubmissionToken,
  constantTimeHexEqual,
} from '../_shared/crypto.ts';
import {
  buildGroundedPrompt,
  countWords,
  type BuildPromptResult,
} from '../_shared/promptBuilder.ts';
import {
  generateReviewDraft,
  GeminiClientError,
  type GenerateReviewDraftResult,
} from '../_shared/gemini.ts';

// ============================================================================
// Response Headers & Constants
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'apikey, authorization, content-type, x-client-info, x-request-id',
  'Access-Control-Max-Age': '86400',
};

export const NO_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests
export const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes (600s)

// ============================================================================
// Canonical Error Response Interface (API_SPEC §17)
// ============================================================================

export interface CanonicalErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string;
    retryable: boolean;
  };
}

export function buildErrorResponse(
  status: number,
  code: string,
  message: string,
  correlationId?: string,
  retryable = false,
  extraPayload?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  const corrId =
    correlationId ??
    `corr_${createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 16)}`;

  const body = {
    error: {
      code,
      message,
      correlationId: corrId,
      retryable,
    },
    ...extraPayload,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': corrId,
      ...extraHeaders,
    },
  });
}

// ============================================================================
// Request Validation Schemas (Zod)
// ============================================================================

export const GenerateReviewRequestSchema = z
  .object({
    responseId: z
      .string({ required_error: 'responseId is required' })
      .uuid({ message: 'responseId must be a valid UUID' }),
    submissionToken: z
      .string({ required_error: 'submissionToken is required' })
      .trim()
      .min(1, { message: 'submissionToken cannot be empty' }),
    idempotencyKey: z
      .string({ required_error: 'idempotencyKey is required' })
      .trim()
      .min(1, { message: 'idempotencyKey cannot be empty' }),
    publicQrId: z
      .string()
      .trim()
      .regex(/^[a-z0-9]{8,12}$/, 'publicQrId must be an 8-12 character alphanumeric string')
      .optional(),
    sessionUuid: z.string().uuid({ message: 'sessionUuid must be a valid UUID' }).optional(),
  })
  .strict();

export type GenerateReviewRequest = z.infer<typeof GenerateReviewRequestSchema>;

export interface GenerateReviewSuccessResponse {
  reviewDraft: string | null;
  wordCount: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  abstained?: boolean;
  reason?: string;
  message?: string;
}

// ============================================================================
// Environment Configuration Utilities
// ============================================================================

function loadLocalEnv(): Record<string, string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.Deno !== 'undefined' && typeof g.Deno.readTextFileSync === 'function') {
      const content = g.Deno.readTextFileSync('.env');
      const lines = content.split('\n');
      const map: Record<string, string> = {};
      for (const line of lines) {
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
    // File may not exist in container
  }
  return {};
}

const localEnvMap = loadLocalEnv();

export function getEnv(key: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.Deno !== 'undefined' && typeof g.Deno.env?.get === 'function') {
    const val = g.Deno.env.get(key);
    if (val) return val;
  }
  const procVal = g.process?.env?.[key];
  if (procVal) return procVal;

  return localEnvMap[key];
}

export function getSigningSecret(customSecret?: string): string {
  return getCryptoSigningSecret(customSecret ?? getEnv('SUBMISSION_SIGNING_SECRET'));
}

export function getRateLimitSalt(customSecret?: string): string {
  let secret = customSecret ?? getEnv('RATE_LIMIT_SALT');
  if (!secret) {
    const supabaseUrl = getEnv('SUPABASE_URL');
    if (
      supabaseUrl &&
      (supabaseUrl.includes('localhost') ||
        supabaseUrl.includes('127.0.0.1') ||
        supabaseUrl.includes('kong:8000'))
    ) {
      secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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

  const envSecret = getEnv('SUPABASE_INTERNAL_JWT_SECRET') ?? getEnv('JWT_SECRET');
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

export function extractApiKey(req: Request): string | null {
  const headerKey = req.headers.get('apikey');
  if (headerKey) return headerKey.trim();

  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

export function validateProjectApiKey(
  apiKey: string | null,
  validKeys: Set<string>,
  jwtSecret: string,
): { valid: boolean; isPrivileged: boolean; error?: string } {
  if (!apiKey) {
    return { valid: false, isPrivileged: false, error: 'Missing API key' };
  }

  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceRoleKey && apiKey === serviceRoleKey.trim()) {
    return {
      valid: false,
      isPrivileged: true,
      error: 'Privileged service-role key is forbidden on public endpoints',
    };
  }

  if (validKeys.has(apiKey)) {
    return { valid: true, isPrivileged: false };
  }

  if (verifyJwtSignature(apiKey, jwtSecret)) {
    try {
      const parts = apiKey.split('.');
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
      if (payload.role === 'service_role') {
        return {
          valid: false,
          isPrivileged: true,
          error: 'Privileged service-role JWT is forbidden on public endpoints',
        };
      }
      return { valid: true, isPrivileged: false };
    } catch {
      return { valid: false, isPrivileged: false, error: 'Malformed JWT payload' };
    }
  }

  return { valid: false, isPrivileged: false, error: 'Invalid or unknown API key' };
}

// ============================================================================
// Client IP Extraction & Ingress Provenance Verification
// ============================================================================

export const CLOUDFLARE_IPV4_CIDRS: readonly string[] = [
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

export function extractClientIp(
  req: Request,
  options?: { trustCloudflareProxy?: boolean },
): string | null {
  const rawRealIp = req.headers.get('x-real-ip');
  const rawCfIp = req.headers.get('cf-connecting-ip');
  const rawForwardedFor = req.headers.get('x-forwarded-for');

  const hasIpHeaders =
    rawRealIp !== null ||
    rawForwardedFor !== null ||
    rawCfIp !== null;

  // 1. Direct connection IP from ingress gateway (Kong overwrites X-Real-IP with $remote_addr)
  let directConnectingIp: string | null = null;
  if (rawRealIp) {
    directConnectingIp = cleanAndNormalizeIp(rawRealIp);
    if (!directConnectingIp) {
      // Malformed X-Real-IP -> fail closed
      return null;
    }
  }

  // 2. Cloudflare Ingress Verification
  const trustCf = options?.trustCloudflareProxy ?? (getEnv('TRUST_CLOUDFLARE_PROXY') === 'true');
  if (trustCf && rawCfIp && directConnectingIp) {
    if (isCloudflareProxyIp(directConnectingIp)) {
      const normalizedCf = cleanAndNormalizeIp(rawCfIp);
      if (normalizedCf) return normalizedCf;
      return null;
    }
    // Direct connecting peer is not in Cloudflare CIDRs -> discard untrusted CF header
  }

  // 3. Return verified direct connection IP from ingress gateway
  if (directConnectingIp) {
    return directConnectingIp;
  }

  // 4. Secondary: X-Forwarded-For (evaluate rightmost IP added by immediate proxy)
  if (rawForwardedFor) {
    const parts = rawForwardedFor.split(',').map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i];
      if (candidate) {
        const normalized = cleanAndNormalizeIp(candidate);
        if (normalized) return normalized;
      }
    }
    return null;
  }

  // If headers were present but none were valid, fail closed
  if (hasIpHeaders) {
    return null;
  }

  // In local development / test environments with no ingress headers, fallback to loopback
  return '127.0.0.1';
}

export function deriveDailySalt(masterSecret: string, dateStr: string): string {
  return createHmac('sha256', Buffer.from(masterSecret, 'hex'))
    .update(`qr_rate_limit_salt:${dateStr}`)
    .digest('hex');
}

export function computeIpHash(dailySalt: string, normalizedIp: string): string {
  return createHmac('sha256', Buffer.from(dailySalt, 'hex'))
    .update(`qr_gen_ip:${normalizedIp}`)
    .digest('hex');
}

// ============================================================================
// Sentiment Derivation Utility
// ============================================================================

export function deriveSentimentFromOptions(
  options: Array<{ sentiment_label?: string; is_neutral_na?: boolean }>,
): 'positive' | 'neutral' | 'negative' {
  let scoreSum = 0;
  let applicableCount = 0;

  for (const opt of options) {
    if (opt.is_neutral_na) continue;
    applicableCount++;
    if (opt.sentiment_label === 'positive') scoreSum += 1.0;
    else if (opt.sentiment_label === 'negative') scoreSum -= 1.0;
  }

  if (applicableCount === 0) return 'neutral';
  const average = scoreSum / applicableCount;
  if (average > 0.2) return 'positive';
  if (average < -0.2) return 'negative';
  return 'neutral';
}

export async function resolveSurveySentiment(
  supabase: SupabaseClient,
  selectedOptions: Array<{
    optionId?: string;
    option_id?: string;
    sentiment_label?: string;
    is_neutral_na?: boolean;
  }>,
): Promise<'positive' | 'neutral' | 'negative'> {
  const hasEmbedded = selectedOptions.some((o) => o.sentiment_label !== undefined);
  if (hasEmbedded) {
    return deriveSentimentFromOptions(selectedOptions);
  }

  const optionIds = selectedOptions
    .map((o) => o.optionId ?? o.option_id)
    .filter((id): id is string => Boolean(id));

  if (optionIds.length > 0) {
    try {
      const { data: optionRecords } = await supabase
        .from('survey_options')
        .select('sentiment_label, is_neutral_na')
        .in('id', optionIds);

      if (optionRecords && optionRecords.length > 0) {
        return deriveSentimentFromOptions(
          optionRecords as Array<{ sentiment_label?: string; is_neutral_na?: boolean }>,
        );
      }
    } catch {
      // Graceful fallback on lookup issue
    }
  }

  return 'neutral';
}

// ============================================================================
// Service-Role Supabase Client Initializer
// ============================================================================

export function getServiceRoleClient(injectedClient?: SupabaseClient): SupabaseClient {
  if (injectedClient) return injectedClient;

  const supabaseUrl = getEnv('SUPABASE_URL') || 'http://127.0.0.1:54321';
  const serviceRoleKey =
    getEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ============================================================================
// Main Execution Pipeline (handleGenerateReview)
// ============================================================================

export interface GenerateReviewHandlerOptions {
  supabaseClient?: SupabaseClient;
  geminiTransportFn?: typeof fetch;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiTimeoutMs?: number;
  signingSecret?: string;
  rateLimitSalt?: string;
  jwtSecret?: string;
  expectedApiKey?: string;
  trustCloudflareProxy?: boolean;
}

export async function handleGenerateReview(
  req: Request,
  options?: GenerateReviewHandlerOptions,
): Promise<Response> {
  const correlationId =
    req.headers.get('x-request-id') ??
    `corr_${createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 16)}`;

  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. HTTP Method Guard
  if (req.method !== 'POST') {
    return buildErrorResponse(
      405,
      'ERR_METHOD_NOT_ALLOWED',
      `HTTP method ${req.method} is not supported. Use POST.`,
      correlationId,
    );
  }

  // 3. Project Publishable API Key Validation
  const rawApiKey = extractApiKey(req);
  const validKeys = getValidProjectApiKeys(options?.expectedApiKey);
  const jwtSecret = getJwtSecret(options?.jwtSecret);
  const authResult = validateProjectApiKey(rawApiKey, validKeys, jwtSecret);

  if (!authResult.valid) {
    if (authResult.isPrivileged) {
      return buildErrorResponse(
        403,
        'ERR_PRIVILEGED_KEY_FORBIDDEN',
        'Privileged service-role keys cannot be used to invoke public generation endpoints.',
        correlationId,
      );
    }
    return buildErrorResponse(
      401,
      'ERR_UNAUTHORIZED',
      authResult.error ?? 'Missing or invalid project API key.',
      correlationId,
    );
  }

  // 4. Parse & Validate Request Body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return buildErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      'Malformed JSON request body.',
      correlationId,
    );
  }

  const parseResult = GenerateReviewRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    const message = firstIssue?.message ?? 'Request validation failed';
    return buildErrorResponse(400, 'ERR_INVALID_PAYLOAD', message, correlationId);
  }

  const { responseId, submissionToken, idempotencyKey, sessionUuid: clientSessionUuid } =
    parseResult.data;

  // 5. Pre-Lookup Cryptographic Submission Token Structure & Expiry Verification
  // Rejects malformed, mismatched responseId, and expired tokens before any database read!
  const tokenParts = submissionToken.trim().split('.');
  if (tokenParts.length !== 3) {
    return buildErrorResponse(
      403,
      'ERR_INVALID_SUBMISSION_TOKEN',
      'Cryptographic signature mismatch or malformed submission token.',
      correlationId,
      false,
    );
  }

  const [tokenResponseId, tokenExpStr, tokenSigHex] = tokenParts as [string, string, string];
  if (!tokenResponseId || !tokenExpStr || !tokenSigHex) {
    return buildErrorResponse(
      403,
      'ERR_INVALID_SUBMISSION_TOKEN',
      'Cryptographic signature mismatch or empty token segments.',
      correlationId,
      false,
    );
  }

  // Token responseId must strictly match request body responseId
  if (tokenResponseId !== responseId) {
    return buildErrorResponse(
      403,
      'ERR_INVALID_SUBMISSION_TOKEN',
      'Submission token was minted for a different survey response.',
      correlationId,
      false,
    );
  }

  const tokenExp = parseInt(tokenExpStr, 10);
  if (Number.isNaN(tokenExp) || !Number.isFinite(tokenExp)) {
    return buildErrorResponse(
      403,
      'ERR_INVALID_SUBMISSION_TOKEN',
      'Submission token expiry is invalid.',
      correlationId,
      false,
    );
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  // Strictly rejects expired tokens without touching PostgreSQL!
  if (tokenExp <= nowEpoch) {
    return buildErrorResponse(
      401,
      'ERR_TOKEN_EXPIRED',
      'The survey submission token has expired.',
      correlationId,
      false,
    );
  }

  // Sanity check future expiry (max TTL 600s + 30s clock skew)
  if (tokenExp > nowEpoch + 630) {
    return buildErrorResponse(
      403,
      'ERR_INVALID_SUBMISSION_TOKEN',
      'Submission token expiry exceeds permitted lifetime.',
      correlationId,
      false,
    );
  }

  // Signature format check (64 hex characters)
  if (!/^[0-9a-fA-F]{64}$/.test(tokenSigHex)) {
    return buildErrorResponse(
      403,
      'ERR_INVALID_SUBMISSION_TOKEN',
      'Submission token signature format is invalid.',
      correlationId,
      false,
    );
  }

  // Initialize service-role database client
  const supabase = getServiceRoleClient(options?.supabaseClient);

  // 6. Authoritative Feedback Retrieval from PostgreSQL
  const { data: responseData, error: responseErr } = await supabase
    .from('survey_responses')
    .select(
      'id, business_id, category_id, session_uuid, selected_options, affirmed_facts_snapshot, optional_note, generation_attempts, is_generated, created_at',
    )
    .eq('id', responseId)
    .maybeSingle();

  if (responseErr) {
    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      'Failed to load survey response data.',
      correlationId,
      true,
    );
  }

  // Anti-Enumeration Defense:
  // If response row does not exist, execute a constant-time dummy HMAC and return HTTP 403
  // identical to an invalid signature against an existing row!
  if (!responseData) {
    let dummySigningSecret = '00'.repeat(32);
    try {
      dummySigningSecret = getSigningSecret(options?.signingSecret);
    } catch {
      // Use fallback dummy
    }
    const dummyHmac = createHmac('sha256', Buffer.from(dummySigningSecret, 'hex'))
      .update(`dummy:${responseId}:${nowEpoch}`)
      .digest('hex');
    constantTimeHexEqual(tokenSigHex, dummyHmac);

    return buildErrorResponse(
      403,
      'ERR_INVALID_SUBMISSION_TOKEN',
      'Cryptographic signature mismatch or forged submission token.',
      correlationId,
      false,
    );
  }

  // Session UUID cross-check if provided
  if (clientSessionUuid && clientSessionUuid !== responseData.session_uuid) {
    return buildErrorResponse(
      403,
      'ERR_SESSION_MISMATCH',
      'Session identifier does not match survey response record.',
      correlationId,
    );
  }

  const businessId = responseData.business_id;
  const sessionUuid = responseData.session_uuid;

  // 7. Cryptographic Submission Token Verification
  // Derive canonical survey version from persisted selected options
  const selectedOptions = (responseData.selected_options ?? []) as Array<{
    questionId?: string;
    question_id?: string;
    optionId?: string;
    option_id?: string;
  }>;

  const questionIds = selectedOptions
    .map((o) => o.questionId ?? o.question_id)
    .filter((id): id is string => Boolean(id));

  let surveyVersion = 'sv_default';
  if (questionIds.length > 0) {
    try {
      surveyVersion = computeSurveyVersion(questionIds);
    } catch {
      // Use fallback if questionIds empty
    }
  }

  let signingSecret: string;
  try {
    signingSecret = getSigningSecret(options?.signingSecret);
  } catch {
    return buildErrorResponse(
      500,
      'ERR_INTERNAL_ERROR',
      'Cryptographic service is misconfigured.',
      correlationId,
      false,
    );
  }

  const tokenVerification = verifySubmissionToken(
    submissionToken,
    businessId,
    sessionUuid,
    surveyVersion,
    signingSecret,
  );

  if (!tokenVerification.valid) {
    if (tokenVerification.error?.includes('ERR_TOKEN_EXPIRED')) {
      return buildErrorResponse(
        401,
        'ERR_TOKEN_EXPIRED',
        'The survey submission token has expired.',
        correlationId,
        false,
      );
    }

    // Forged HMAC or invalid signature strictly returns HTTP 403 per ROADMAP M4-T02
    return buildErrorResponse(
      403,
      'ERR_INVALID_SUBMISSION_TOKEN',
      'Cryptographic signature mismatch or forged submission token.',
      correlationId,
      false,
    );
  }

  if (tokenVerification.responseId && tokenVerification.responseId !== responseId) {
    return buildErrorResponse(
      403,
      'ERR_RESPONSE_MISMATCH',
      'Submission token was minted for a different survey response.',
      correlationId,
      false,
    );
  }

  // 7. Merchant Eligibility & Operational Status Check
  const { data: businessData, error: bizErr } = await supabase
    .from('businesses')
    .select('id, name, category_id, is_active, account_status')
    .eq('id', businessId)
    .maybeSingle();

  if (bizErr) {
    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      'Failed to verify business eligibility.',
      correlationId,
      true,
    );
  }

  if (!businessData) {
    return buildErrorResponse(
      404,
      'ERR_BUSINESS_NOT_FOUND',
      'Associated merchant business record was not found.',
      correlationId,
    );
  }

  if (!businessData.is_active || businessData.account_status === 'suspended') {
    return buildErrorResponse(
      403,
      'ERR_BUSINESS_SUSPENDED',
      'Feedback collection and AI review generation for this business is currently unavailable.',
      correlationId,
    );
  }

  // 8. Subscription Status Check
  const { data: subscriptionData } = await supabase
    .from('subscriptions')
    .select('subscription_status')
    .eq('business_id', businessId)
    .maybeSingle();

  if (subscriptionData?.subscription_status === 'past_due') {
    return buildErrorResponse(
      402,
      'ERR_SUBSCRIPTION_LAPSED',
      'Merchant subscription is past due. AI review generation is unavailable.',
      correlationId,
    );
  }

  // 9. IP Rate Limiting (30 requests / 10 minutes)
  const clientIp = extractClientIp(req, {
    trustCloudflareProxy: options?.trustCloudflareProxy,
  });
  if (!clientIp) {
    return buildErrorResponse(
      400,
      'ERR_INVALID_IP_HEADER',
      'Client network address could not be validated.',
      correlationId,
    );
  }

  let rateLimitSalt: string;
  try {
    rateLimitSalt = getRateLimitSalt(options?.rateLimitSalt);
  } catch {
    return buildErrorResponse(
      500,
      'ERR_INTERNAL_ERROR',
      'Rate limit security salt is unconfigured.',
      correlationId,
      false,
    );
  }

  const todayUtc = new Date().toISOString().slice(0, 10);
  const dailySalt = deriveDailySalt(rateLimitSalt, todayUtc);
  const ipHash = computeIpHash(dailySalt, clientIp);
  const rateLimitKey = `gen_${ipHash}`;

  const { data: isAllowed, error: rateLimitErr } = await supabase.rpc('check_rate_limit', {
    p_key_hash: rateLimitKey,
    p_max_requests: RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });

  if (rateLimitErr) {
    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      'Rate limit inspection failed.',
      correlationId,
      true,
    );
  }

  let allowed = isAllowed;
  if (allowed === null) {
    // Fallback if check_rate_limit returned null due to missing previous window row
    const { data: bucketRow } = await supabase
      .from('rate_limit_buckets')
      .select('request_count')
      .eq('key_hash', rateLimitKey)
      .maybeSingle();

    if (bucketRow && typeof bucketRow.request_count === 'number') {
      allowed = bucketRow.request_count <= RATE_LIMIT_MAX_REQUESTS;
    }
  }

  if (allowed === false) {
    return buildErrorResponse(
      429,
      'ERR_RATE_LIMIT_EXCEEDED',
      'Too many review generation requests. Please try again later.',
      correlationId,
      true,
      undefined,
      { 'Retry-After': '60' },
    );
  }

  // 10. Authoritative Facts & Insufficient-Facts Abstention Check
  // Extract affirmed options from snapshot
  const rawFactsSnapshot = responseData.affirmed_facts_snapshot;
  const affirmedFacts: string[] = Array.isArray(rawFactsSnapshot)
    ? rawFactsSnapshot.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : [];

  const rawNote = responseData.optional_note;

  // Build grounded prompt using M4-T01 prompt builder
  const promptResult: BuildPromptResult = buildGroundedPrompt({
    businessName: businessData.name || 'Local Business',
    categoryId: businessData.category_id || responseData.category_id || 'local business',
    facts: affirmedFacts,
    optionalNote: rawNote,
  });

  // Insufficient-Facts Abstention (Founder Decision M0-16 / Design B):
  // If all options are N/A and no note was provided, abstain safely before quota or Gemini dispatch!
  if (promptResult.status === 'insufficient_facts') {
    const abstentionResponse: GenerateReviewSuccessResponse = {
      reviewDraft: null,
      wordCount: 0,
      sentiment: 'neutral',
      abstained: true,
      reason: 'INSUFFICIENT_FACTS',
      message: 'We cannot generate a reliable draft from the provided information.',
    };

    return new Response(JSON.stringify(abstentionResponse), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        ...NO_CACHE_HEADERS,
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Request-Id': correlationId,
      },
    });
  }

  // 11. Two-Phase Quota Reservation (reserve_generation_quota)
  // Compute deterministic payload fingerprint
  const payloadHash = createHash('sha256')
    .update(`${responseId}:${affirmedFacts.join(',')}:${rawNote ?? ''}`)
    .digest('hex');

  const { data: reservationId, error: reserveErr } = await supabase.rpc(
    'reserve_generation_quota',
    {
      p_business_id: businessId,
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash,
      p_response_id: responseId,
    },
  );

  if (reserveErr) {
    const errMsg = reserveErr.message || '';

    if (errMsg.includes('ERR_QUOTA_EXHAUSTED')) {
      return buildErrorResponse(
        429,
        'ERR_QUOTA_EXHAUSTED',
        'Monthly AI review generation quota has been exhausted. Please consult the business owner.',
        correlationId,
      );
    }

    if (errMsg.includes('ERR_MAX_ATTEMPTS_EXCEEDED')) {
      return buildErrorResponse(
        429,
        'ERR_MAX_ATTEMPTS_EXCEEDED',
        'Maximum generation attempts (3) for this feedback submission have been reached.',
        correlationId,
      );
    }

    if (errMsg.includes('ERR_CONCURRENT_REQUEST')) {
      return buildErrorResponse(
        409,
        'ERR_CONCURRENT_REQUEST',
        'An in-flight generation request is already running. Please wait.',
        correlationId,
        true,
        { retryAfterMs: 1500 },
        { 'Retry-After': '2' },
      );
    }

    if (errMsg.includes('ERR_IDEMPOTENCY_MISMATCH') || errMsg.includes('ERR_IDEMPOTENCY_CONFLICT')) {
      return buildErrorResponse(
        409,
        'ERR_IDEMPOTENCY_MISMATCH',
        'Idempotency key was reused with conflicting payload data.',
        correlationId,
      );
    }

    if (errMsg.includes('ERR_ALREADY_COMMITTED')) {
      return buildErrorResponse(
        409,
        'ERR_ALREADY_COMMITTED',
        'Draft already generated for this attempt sequence. Use a new attempt key to retry.',
        correlationId,
      );
    }

    if (errMsg.includes('ERR_BUSINESS_SUSPENDED')) {
      return buildErrorResponse(
        403,
        'ERR_BUSINESS_SUSPENDED',
        'Feedback collection for this business is currently unavailable.',
        correlationId,
      );
    }

    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      `Quota reservation failed: ${errMsg}`,
      correlationId,
      true,
    );
  }

  // 12. Check for Cached Temporary Draft Recovery (M0-12 Option B)
  // If the reservation returned is already committed with a cached draft, recover it safely
  const { data: cachedReservation } = await supabase
    .from('quota_reservations')
    .select('id, status, raw_draft')
    .eq('id', reservationId)
    .maybeSingle();

  if (cachedReservation?.status === 'committed' && cachedReservation.raw_draft) {
    const cachedDraft = cachedReservation.raw_draft.trim();
    const wordCount = countWords(cachedDraft);

    // Derive sentiment
    const sentiment = await resolveSurveySentiment(supabase, selectedOptions);

    const successResponse: GenerateReviewSuccessResponse = {
      reviewDraft: cachedDraft,
      wordCount,
      sentiment,
    };

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        ...NO_CACHE_HEADERS,
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Request-Id': correlationId,
      },
    });
  }

  // 13. Dispatch Grounded Gemini Generation (Strictly Mocked Transport in Local Mode)
  let geminiResult: GenerateReviewDraftResult;
  try {
    geminiResult = await generateReviewDraft({
      apiKey: options?.geminiApiKey ?? getEnv('GEMINI_API_KEY') ?? 'local-mock-gemini-key',
      baseUrl: options?.geminiBaseUrl ?? getEnv('GEMINI_BASE_URL'),
      timeoutMs: options?.geminiTimeoutMs,
      systemInstruction: promptResult.systemInstruction,
      userPrompt: promptResult.userPrompt,
      transportFn: options?.geminiTransportFn,
    });
  } catch (err: unknown) {
    // 14. Minimum Safe Quota Cleanup on Failure
    try {
      await supabase.rpc('release_generation_quota', {
        p_reservation_id: reservationId,
      });
    } catch {
      // Safe logging of cleanup exception without interrupting error return
    }

    if (err instanceof GeminiClientError) {
      if (err.code === 'ERR_TIMEOUT') {
        return buildErrorResponse(
          504,
          'ERR_GEMINI_TIMEOUT',
          'AI review generation timed out. Your quota was not charged.',
          correlationId,
          true,
        );
      }

      if (err.code === 'ERR_MALFORMED_OUTPUT' || err.code === 'ERR_OUTPUT_TOO_LONG') {
        return buildErrorResponse(
          502,
          'ERR_MALFORMED_OUTPUT',
          'AI model output was malformed. Your quota was not charged.',
          correlationId,
          false,
        );
      }

      if (err.code === 'ERR_SAFETY_BLOCKED') {
        return buildErrorResponse(
          422,
          'ERR_SAFETY_BLOCKED',
          'Feedback content triggered AI safety boundaries. Your quota was not charged.',
          correlationId,
          false,
        );
      }

      if (err.code === 'ERR_PROVIDER_RATE_LIMITED') {
        return buildErrorResponse(
          429,
          'ERR_PROVIDER_RATE_LIMITED',
          'AI provider is temporarily rate limited. Please retry shortly.',
          correlationId,
          true,
        );
      }

      if (err.code === 'ERR_PROVIDER_SERVER_ERROR' || err.code === 'ERR_NETWORK_ERROR') {
        return buildErrorResponse(
          502,
          'ERR_PROVIDER_ERROR',
          'AI provider encountered a temporary error. Your quota was not charged.',
          correlationId,
          true,
        );
      }
    }

    return buildErrorResponse(
      500,
      'ERR_GENERATION_FAILED',
      'AI review generation failed. Your quota was not charged.',
      correlationId,
      true,
    );
  }

  // 15. Commit Generation Quota
  const { error: commitErr } = await supabase.rpc('commit_generation_quota', {
    p_reservation_id: reservationId,
    p_tokens_billed: 0, // Mock usage recorded as 0 live provider tokens
    p_raw_draft: geminiResult.reviewDraft,
  });

  if (commitErr) {
    return buildErrorResponse(
      500,
      'ERR_COMMIT_FAILED',
      'Failed to record completed generation quota.',
      correlationId,
      false,
    );
  }

  // 16. Ingest Server-Authored Analytics Event (EVENT_GENERATION_SUCCESS)
  try {
    const dedupKey = createHash('sha256')
      .update(`${businessId}:EVENT_GENERATION_SUCCESS:${sessionUuid}:${reservationId}`)
      .digest('hex');

    const { error: analyticsErr } = await supabase.from('analytics_events').insert({
      business_id: businessId,
      event_name: 'EVENT_GENERATION_SUCCESS',
      session_uuid: sessionUuid,
      user_agent_category: 'mobile',
      deduplication_key: dedupKey,
    });

    if (analyticsErr) {
      console.error(
        `[generate-review] Non-blocking analytics insertion error for ${correlationId}:`,
        analyticsErr.message,
      );
    }
  } catch (telemetryErr) {
    console.error(
      `[generate-review] Non-blocking analytics telemetry exception for ${correlationId}:`,
      telemetryErr,
    );
  }

  // 17. Derive Sentiment from Survey Selections & Return Sanitized Response
  const sentiment = await resolveSurveySentiment(supabase, selectedOptions);

  const successPayload: GenerateReviewSuccessResponse = {
    reviewDraft: geminiResult.reviewDraft,
    wordCount: geminiResult.wordCount,
    sentiment,
  };

  return new Response(JSON.stringify(successPayload), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': correlationId,
    },
  });
}

// ============================================================================
// Deno Global Server Bootstrap
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalDeno = (globalThis as any).Deno;
if (typeof globalDeno !== 'undefined' && typeof globalDeno.serve === 'function') {
  globalDeno.serve((req: Request) => handleGenerateReview(req));
}
