/**
 * Edge Function: update-destination (API-OWN-03)
 *
 * Task: M5-T04 — Google Review Destination Gateway & Verification
 * Milestone: M5 — Merchant Owner Portal & Digital QR Sharing
 * Architecture: Option B (Transactional PostgreSQL RPC + Engine-Enforced Unique Place ID)
 *
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M5-T04
 *   - docs/API_SPEC.md (v1.2) §11.3 (API-OWN-03)
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.2, §5.12
 *   - docs/SECURITY.md (v1.1) §7.2, §8
 *   - docs/TEST_PLAN.md (v1.1) TC-DST-01..10, TC-OWN-08..10, TC-API-16..17
 *   - Founder Decisions M0-02 (Destination Verification) & M0-13 (Audit Integrity)
 *
 * Capabilities:
 *   - Authenticated merchant gateway (Authorization: Bearer <owner_jwt>)
 *   - Enforces strict tenant ownership (businesses.owner_id = auth.uid())
 *   - Validates destination URLs against approved Google domain allowlist
 *   - Validates Place ID format (20-100 alphanumeric) and prevents cross-tenant collision
 *   - Delegates atomic persistence and immutable audit recording to public.update_merchant_destination
 *   - True transaction rollback in PostgreSQL: zero orphaned destination updates or un-audited state
 *   - Sanitized canonical error envelopes (RFC 7807 problem details)
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import {
  validateDestinationUrl,
  type DestinationValidationResult,
} from '../_shared/destinationValidator.ts';

// ============================================================================
// CORS & Security Headers
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const NO_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// ============================================================================
// Canonical Error Response Builder
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
  retryable = false,
  correlationId?: string,
): Response {
  const corrId =
    correlationId ??
    `req_${createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 12)}`;

  const body: CanonicalErrorResponse = {
    error: {
      code,
      message,
      correlationId: corrId,
      retryable,
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

// ============================================================================
// Zod Request Body Schema
// ============================================================================

export const UpdateDestinationPayloadSchema = z.object({
  businessId: z.string().uuid({
    message: 'businessId must be a valid UUID',
  }),
  googleReviewUrl: z
    .string()
    .min(1, { message: 'googleReviewUrl is required' })
    .max(1000, { message: 'googleReviewUrl must not exceed 1000 characters' }),
  googlePlaceId: z
    .string()
    .max(100, { message: 'googlePlaceId must not exceed 100 characters' })
    .optional()
    .nullable(),
});

export type UpdateDestinationPayload = z.infer<typeof UpdateDestinationPayloadSchema>;

// ============================================================================
// Client IP Extraction & Hashing
// ============================================================================

export function extractClientIpHash(req: Request): string {
  const rawIp =
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1';

  return createHash('sha256').update(`audit-${rawIp}`).digest('hex').slice(0, 32);
}

// ============================================================================
// Main Request Handler
// ============================================================================

export async function handler(
  req: Request,
  customSupabaseAdmin?: SupabaseClient,
): Promise<Response> {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. Enforce POST Method
  if (req.method !== 'POST') {
    return buildErrorResponse(
      405,
      'ERR_METHOD_NOT_ALLOWED',
      'Only POST requests are allowed on this gateway.',
    );
  }

  // 3. Extract and Validate Authorization Header
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return buildErrorResponse(
      401,
      'ERR_UNAUTHORIZED',
      'Authorization bearer token is required.',
    );
  }

  const jwtToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwtToken) {
    return buildErrorResponse(
      401,
      'ERR_UNAUTHORIZED',
      'Authorization token is missing or malformed.',
    );
  }

  // 4. Initialize Supabase Admin Client
  let supabaseAdmin: SupabaseClient;
  if (customSupabaseAdmin) {
    supabaseAdmin = customSupabaseAdmin;
  } else {
    const supabaseUrl =
      typeof Deno !== 'undefined'
        ? Deno.env.get('SUPABASE_URL')
        : process.env['SUPABASE_URL'];
    const serviceRoleKey =
      typeof Deno !== 'undefined'
        ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        : process.env['SUPABASE_SERVICE_ROLE_KEY'];

    if (!supabaseUrl || !serviceRoleKey) {
      return buildErrorResponse(
        500,
        'ERR_INTERNAL_ERROR',
        'Supabase service environment is unconfigured.',
      );
    }

    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  // 5. Verify Merchant Identity via Supabase Auth
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(jwtToken);

  if (authError || !user) {
    return buildErrorResponse(
      401,
      'ERR_UNAUTHORIZED',
      'Invalid, expired, or revoked authentication session.',
    );
  }

  // 6. Parse and Validate Request JSON
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return buildErrorResponse(
      400,
      'ERR_BAD_REQUEST',
      'Request body must be valid JSON.',
    );
  }

  const parseResult = UpdateDestinationPayloadSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    return buildErrorResponse(
      422,
      'ERR_INVALID_DESTINATION_URL',
      firstIssue ? firstIssue.message : 'Invalid request parameters.',
    );
  }

  const { businessId, googleReviewUrl, googlePlaceId } = parseResult.data;

  // 7. Strict Server-Side Google Review URL Validation
  const validation: DestinationValidationResult = validateDestinationUrl(
    googleReviewUrl,
    googlePlaceId,
  );

  if (!validation.isValid) {
    return buildErrorResponse(
      422,
      validation.errorCode,
      validation.errorMessage,
    );
  }

  const sanitizedUrl = validation.sanitizedUrl;
  const targetPlaceId = validation.targetPlaceId;

  // 8. Atomic Mutation via Transactional RPC: public.update_merchant_destination
  // Executes destination update and audit log in a single transaction with row-level locking.
  // Enforces tenant ownership under lock; Place ID uniqueness is enforced by businesses_google_place_id_uq.
  const ipHash = extractClientIpHash(req);

  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
    'update_merchant_destination',
    {
      p_business_id: businessId,
      p_owner_id: user.id, // Derived strictly from verified Supabase Auth session
      p_google_review_url: sanitizedUrl,
      p_google_place_id: targetPlaceId,
      p_ip_hash: ipHash,
    },
  );

  if (rpcError) {
    const errorMsg = rpcError.message || '';

    if (errorMsg.includes('ERR_BUSINESS_NOT_FOUND')) {
      return buildErrorResponse(
        404,
        'ERR_BUSINESS_NOT_FOUND',
        'Business record not found.',
      );
    }

    if (errorMsg.includes('ERR_PERMISSION_DENIED')) {
      return buildErrorResponse(
        403,
        'ERR_PERMISSION_DENIED',
        'You do not have permission to modify this business review destination.',
      );
    }

    if (errorMsg.includes('ERR_PLACE_ID_MISMATCH')) {
      return buildErrorResponse(
        422,
        'ERR_PLACE_ID_MISMATCH',
        'This Google Place ID is already associated with another registered business.',
      );
    }

    if (errorMsg.includes('ERR_INVALID_ARGUMENT')) {
      return buildErrorResponse(
        400,
        'ERR_BAD_REQUEST',
        'Invalid arguments passed to destination update procedure.',
      );
    }

    // Generic internal error suppresses internal database details
    return buildErrorResponse(
      500,
      'ERR_INTERNAL_SERVER_ERROR',
      'Failed to update business destination in database.',
    );
  }

  // 9. Return Canonical Success Response (API-OWN-03 DTO)
  const resultObj = typeof rpcResult === 'object' && rpcResult !== null ? rpcResult : {};
  const responsePayload = {
    status: (resultObj as Record<string, unknown>)['status'] || 'updated',
    businessId,
    googleReviewUrl: sanitizedUrl,
    googlePlaceId: targetPlaceId,
  };

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

// Default export for Deno Edge Functions
if (typeof Deno !== 'undefined') {
  Deno.serve(async (req) => {
    return await handler(req);
  });
}
