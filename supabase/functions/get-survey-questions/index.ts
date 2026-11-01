/**
 * Edge Function: get-survey-questions (API-PUB-02)
 *
 * Task: M3-T02 — Category Survey Questions Resolver
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M3-T02
 *   - docs/API_SPEC.md (v1.2) §5.2, §5.3, §7.2, §16.1
 *   - docs/ARCHITECTURE.md (v1.1) §9.2
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.3 (survey_questions), §5.4 (survey_options), §15
 *   - docs/SECURITY.md (v1.1) §7, Gate M0-07 (Question Replacement), Gate M0-08 (Option Semantics)
 *   - docs/TEST_PLAN.md (v1.1) TC-API-05, TC-CUST-06, TC-CUST-07
 *
 * Capabilities:
 *   - Public category survey questions resolver (verify_jwt = false)
 *   - Validates required categoryId: strictly 'salon' or 'cafe'
 *   - Validates optional v query parameter: safe alphanumeric cache-busting token
 *   - Cryptographically validates authentic configured project API keys (rejects forged/foreign keys and service_role keys)
 *   - Verifies questionnaire integrity: exactly 3 active questions ordered 1, 2, 3
 *   - Verifies option integrity: deterministic order, active choices only, exactly 1 mandatory neutral N/A option per question
 *   - Excludes all internal/private metadata (no created_at, no owner_id, no scoring weights)
 *   - Applies audited public cache headers: 24h CDN (s-maxage=86400), 1h browser (max-age=3600), stale-while-revalidate=604800
 *   - Enforces no-store cache headers on errors
 */

import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { computeSurveyVersion } from '../_shared/crypto.ts';

// ============================================================================
// Response Headers & Constants
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'apikey, content-type, authorization, x-client-info, x-request-id',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/**
 * Authoritative caching policy from docs/API_SPEC.md (v1.2) §5.2 & §7.2:
 * 24 Hours shared CDN cache (s-maxage=86400), 1 Hour browser cache (max-age=3600),
 * 7 Days background revalidation (stale-while-revalidate=604800).
 */
export const SUCCESS_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export const ERROR_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';

// ============================================================================
// Types & DTO Schemas
// ============================================================================

export interface HandlerOptions {
  supabaseClient?: SupabaseClient;
  expectedApiKey?: string;
  jwtSecret?: string;
  bypassAuth?: boolean;
  correlationId?: string;
}

export type SentimentType = 'positive' | 'neutral' | 'negative';

export interface PublicSurveyOptionDto {
  id: string;
  optionText: string;
  emojiAnchor: string;
  sentiment: SentimentType;
  sentimentLabel: SentimentType;
  isNeutralNa: boolean;
}

export interface PublicSurveyQuestionDto {
  id: string;
  displayOrder: number;
  questionText: string;
  options: PublicSurveyOptionDto[];
}

export interface SurveyQuestionsSuccessResponse {
  categoryId: 'salon' | 'cafe';
  surveyVersion: string;
  questions: PublicSurveyQuestionDto[];
}

export interface CanonicalErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string;
    retryable: boolean;
  };
}

// Zod Schema for URL Query Parameters
export const QueryParamsSchema = z.object({
  categoryId: z.enum(['salon', 'cafe'], {
    errorMap: () => ({
      message: 'Invalid or missing categoryId. Supported categories are "salon" and "cafe".',
    }),
  }),
  v: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]{1,32}$/,
      'Version parameter must be a safe alphanumeric string between 1 and 32 characters.',
    )
    .optional(),
});

// Database row projection types
export interface RawSurveyOptionRow {
  id: string;
  question_id?: string;
  option_text: string;
  emoji_anchor: string;
  sentiment_label: string;
  is_neutral_na: boolean;
  is_active: boolean;
  display_order: number;
}

export interface RawSurveyQuestionRow {
  id: string;
  category_id?: string;
  question_text: string;
  display_order: number;
  is_active: boolean;
  survey_options?: RawSurveyOptionRow[];
}

// ============================================================================
// Environment & Cryptographic Authentication Helpers
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
 * Retrieves the set of genuine configured publishable and anon keys for this project.
 */
export function getValidProjectApiKeys(expectedApiKey?: string): Set<string> {
  const keys = new Set<string>();

  if (expectedApiKey) keys.add(expectedApiKey.trim());

  const internalPub = getEnv('SUPABASE_INTERNAL_PUBLISHABLE_KEY');
  if (internalPub) keys.add(internalPub.trim());

  const pubKey = getEnv('SUPABASE_PUBLISHABLE_KEY');
  if (pubKey) keys.add(pubKey.trim());

  const anonKey = getEnv('SUPABASE_ANON_KEY');
  if (anonKey) keys.add(anonKey.trim());

  // Graceful local development fallback when running against local Supabase instance
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

  // Local development fallback when running in local Supabase container
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

/**
 * Cryptographically verifies an HS256 JWT signature using constant-time comparison.
 */
export function verifyJwtSignature(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    // Header decoding & alg check
    const headerJson = Buffer.from(parts[0]!, 'base64url').toString('utf8');
    const header = JSON.parse(headerJson);
    if (!header || header.alg !== 'HS256') {
      return false;
    }

    // Payload decoding and expiration check
    const payloadJson = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    if (payload.exp && typeof payload.exp === 'number') {
      const nowEpoch = Math.floor(Date.now() / 1000);
      if (nowEpoch > payload.exp) {
        return false; // Token expired
      }
    }

    // Compute expected HMAC-SHA256 signature
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
// Response Factories
// ============================================================================

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
      'Cache-Control': ERROR_CACHE_CONTROL,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': correlationId,
      ...extraHeaders,
    },
  });
}

export function createSuccessResponse(
  data: SurveyQuestionsSuccessResponse,
  correlationId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      ...SECURITY_HEADERS,
      'Cache-Control': SUCCESS_CACHE_CONTROL,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': correlationId,
      ...extraHeaders,
    },
  });
}

// ============================================================================
// Core Questionnaire Validation & Projection
// ============================================================================

export interface ValidatedQuestionnaireResult {
  valid: boolean;
  data?: SurveyQuestionsSuccessResponse;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Validates the database questionnaire rows against foundational product invariants:
 * 1. Exactly 3 questions per category.
 * 2. Questions ordered strictly 1, 2, 3 without duplicate or skipped display_orders.
 * 3. Every question contains only active options.
 * 4. Every question contains at least 3 active choices.
 * 5. Every question contains exactly ONE mandatory neutral N/A option (is_neutral_na = true).
 * 6. Options are sorted deterministically by display_order.
 */
export function validateAndProjectQuestionnaire(
  categoryId: 'salon' | 'cafe',
  rawQuestions: RawSurveyQuestionRow[],
): ValidatedQuestionnaireResult {
  if (!rawQuestions || !Array.isArray(rawQuestions)) {
    return {
      valid: false,
      errorCode: 'ERR_INVALID_QUESTIONNAIRE_CONFIG',
      errorMessage: 'Questionnaire configuration is empty or malformed in database.',
    };
  }

  // Filter to active questions
  const activeQuestions = rawQuestions.filter((q) => q.is_active);

  if (activeQuestions.length !== 3) {
    return {
      valid: false,
      errorCode: 'ERR_INVALID_QUESTIONNAIRE_CONFIG',
      errorMessage: `Questionnaire configuration error: expected exactly 3 active questions for category "${categoryId}", found ${activeQuestions.length}.`,
    };
  }

  // Sort questions deterministically by display_order
  const sortedQuestions = [...activeQuestions].sort(
    (a, b) => a.display_order - b.display_order,
  );

  // Validate display order sequence: [1, 2, 3]
  for (let i = 0; i < sortedQuestions.length; i++) {
    const q = sortedQuestions[i]!;
    const expectedOrder = i + 1;
    if (q.display_order !== expectedOrder) {
      return {
        valid: false,
        errorCode: 'ERR_INVALID_QUESTIONNAIRE_CONFIG',
        errorMessage: `Questionnaire configuration error: non-sequential display_order in questions (expected ${expectedOrder}, got ${q.display_order}).`,
      };
    }
  }

  const projectedQuestions: PublicSurveyQuestionDto[] = [];

  for (const q of sortedQuestions) {
    const rawOptions = q.survey_options ?? [];
    // Only active options are eligible for public response
    const activeOptions = rawOptions.filter((o) => o.is_active);

    if (activeOptions.length < 3) {
      return {
        valid: false,
        errorCode: 'ERR_INVALID_QUESTIONNAIRE_CONFIG',
        errorMessage: `Questionnaire configuration error: question "${q.id}" has insufficient active options (${activeOptions.length}).`,
      };
    }

    // Neutral N/A choice validation: must have exactly 1
    const naOptions = activeOptions.filter((o) => o.is_neutral_na);
    if (naOptions.length !== 1) {
      return {
        valid: false,
        errorCode: 'ERR_INVALID_QUESTIONNAIRE_CONFIG',
        errorMessage: `Questionnaire configuration error: question "${q.id}" must have exactly 1 neutral N/A option, found ${naOptions.length}.`,
      };
    }

    // Sort options deterministically by display_order
    const sortedOptions = [...activeOptions].sort(
      (a, b) => a.display_order - b.display_order,
    );

    // Project into public DTO (stripping all internal/private metadata)
    const projectedOptions: PublicSurveyOptionDto[] = sortedOptions.map((o) => {
      const sentiment = (
        ['positive', 'neutral', 'negative'].includes(o.sentiment_label)
          ? o.sentiment_label
          : 'neutral'
      ) as SentimentType;

      return {
        id: o.id,
        optionText: o.option_text,
        emojiAnchor: o.emoji_anchor,
        sentiment,
        sentimentLabel: sentiment,
        isNeutralNa: o.is_neutral_na,
      };
    });

    projectedQuestions.push({
      id: q.id,
      displayOrder: q.display_order,
      questionText: q.question_text,
      options: projectedOptions,
    });
  }

  const questionIds = projectedQuestions.map((q) => q.id);
  const surveyVersion = computeSurveyVersion(questionIds);

  return {
    valid: true,
    data: {
      categoryId,
      surveyVersion,
      questions: projectedQuestions,
    },
  };
}

// ============================================================================
// Main HTTP Handler
// ============================================================================

export async function handleGetSurveyQuestions(
  req: Request,
  options?: HandlerOptions,
): Promise<Response> {
  const correlationId =
    options?.correlationId ??
    req.headers.get('x-request-id') ??
    `corr_${crypto.randomUUID()}`;

  // 1. HTTP Method Handling & CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        ...SECURITY_HEADERS,
        'Cache-Control': SUCCESS_CACHE_CONTROL,
        'X-Request-Id': correlationId,
      },
    });
  }

  if (req.method !== 'GET') {
    return createErrorResponse(
      405,
      'ERR_METHOD_NOT_ALLOWED',
      `HTTP method ${req.method} is not allowed. Only GET and OPTIONS are supported.`,
      correlationId,
      false,
      { Allow: 'GET, OPTIONS' },
    );
  }

  // 2. Public API Authentication (Cryptographic project key verification)
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

    // Elevated service_role key is strictly prohibited on public endpoints
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
      // 1. Match configured project key
      if (validConfiguredKeys.has(cred)) return true;
      // 2. Verify HS256 JWT signature against project secret
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

  // 3. Query Parameter Validation
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return createErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      'Malformed request URL.',
      correlationId,
      false,
    );
  }

  const rawCategoryId = url.searchParams.get('categoryId');
  const rawVersion = url.searchParams.get('v');

  // Specific check for version format error
  if (rawVersion !== null && rawVersion !== undefined) {
    const versionResult = z
      .string()
      .regex(
        /^[a-zA-Z0-9_-]{1,32}$/,
        'Version parameter must be a safe alphanumeric string between 1 and 32 characters.',
      )
      .safeParse(rawVersion);

    if (!versionResult.success) {
      const issue = versionResult.error.issues?.[0];
      return createErrorResponse(
        400,
        'ERR_INVALID_VERSION',
        issue?.message ?? 'Invalid version parameter format.',
        correlationId,
        false,
      );
    }
  }

  const queryParseResult = QueryParamsSchema.safeParse({
    categoryId: rawCategoryId,
    v: rawVersion ?? undefined,
  });

  if (!queryParseResult.success) {
    const firstErr = queryParseResult.error.issues?.[0];
    return createErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      firstErr?.message ?? 'Invalid query parameters.',
      correlationId,
      false,
    );
  }

  const { categoryId } = queryParseResult.data;

  // 4. Initialize Database Client
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

  // 5. Query Active Questionnaire from PostgreSQL
  try {
    const { data: rawQuestions, error: dbError } = await supabase
      .from('survey_questions')
      .select(`
        id,
        category_id,
        question_text,
        display_order,
        is_active,
        survey_options (
          id,
          question_id,
          option_text,
          emoji_anchor,
          sentiment_label,
          is_neutral_na,
          display_order,
          is_active
        )
      `)
      .eq('category_id', categoryId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (dbError) {
      return createErrorResponse(
        500,
        'ERR_INTERNAL',
        'Database query failed while retrieving survey questions.',
        correlationId,
        true,
      );
    }

    // 6. Questionnaire Validation and Data Minimization Projection
    const validationResult = validateAndProjectQuestionnaire(
      categoryId,
      (rawQuestions as unknown as RawSurveyQuestionRow[]) ?? [],
    );

    if (!validationResult.valid || !validationResult.data) {
      return createErrorResponse(
        500,
        validationResult.errorCode ?? 'ERR_INVALID_QUESTIONNAIRE_CONFIG',
        validationResult.errorMessage ??
          'Questionnaire configuration failed integrity validation.',
        correlationId,
        false,
      );
    }

    // 7. Emit Success Response with Audited 24-Hour Cache-Control Header
    return createSuccessResponse(validationResult.data, correlationId);
  } catch (unexpectedError) {
    return createErrorResponse(
      500,
      'ERR_INTERNAL',
      unexpectedError instanceof Error
        ? unexpectedError.message
        : 'Unexpected server error occurred.',
      correlationId,
      true,
    );
  }
}

// ============================================================================
// Deno Edge Runtime Entry Point
// ============================================================================

// @ts-expect-error Deno global
if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  // @ts-expect-error Deno global
  Deno.serve(async (req: Request) => {
    return handleGetSurveyQuestions(req);
  });
}
