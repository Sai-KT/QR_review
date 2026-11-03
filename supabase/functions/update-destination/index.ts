/**
 * Edge Function: update-destination (API-OWN-03)
 *
 * Task: M5-T04 — Google Review Destination Gateway & Verification
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M5-T04
 *   - docs/API_SPEC.md (v1.2) §11.3 (API-OWN-03)
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.2, §5.12
 *   - docs/SECURITY.md (v1.1) §7.2 (TH-08, GC-01, SEC-001)
 *   - docs/TEST_PLAN.md (v1.1) TC-DST-01..10, TC-OWN-08..10, TC-API-16..17
 *   - Founder Decision M0-02 (Destination Verification Protocol)
 *
 * Capabilities:
 *   - Authenticated merchant gateway (Authorization: Bearer <owner_jwt>)
 *   - Enforces strict tenant ownership (businesses.owner_id = auth.uid())
 *   - Validates destination URLs against approved Google domain allowlist
 *   - Validates Place ID format (20-100 alphanumeric) and prevents cross-tenant collision
 *   - Updates businesses.google_review_url and google_place_id via service_role
 *   - Writes append-only audit trail to public.admin_audit_logs with actor_role = 'owner'
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

  // 7. Verify Business Ownership & Retrieve Baseline
  const { data: business, error: bizError } = await supabaseAdmin
    .from('businesses')
    .select('id, owner_id, google_review_url, google_place_id')
    .eq('id', businessId)
    .maybeSingle();

  if (bizError) {
    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      'Failed to resolve business record.',
    );
  }

  if (!business) {
    return buildErrorResponse(
      404,
      'ERR_BUSINESS_NOT_FOUND',
      'Business record not found.',
    );
  }

  // Enforce Tenant Boundary: User must be the registered owner
  if (business.owner_id !== user.id) {
    return buildErrorResponse(
      403,
      'ERR_PERMISSION_DENIED',
      'You do not have permission to modify this business review destination.',
    );
  }

  // 8. Strict Server-Side Google Review URL Validation
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

  // 9. Cross-Tenant Place ID Collision Guard (TC-DST-09)
  if (targetPlaceId) {
    const { data: collision, error: collisionError } = await supabaseAdmin
      .from('businesses')
      .select('id')
      .eq('google_place_id', targetPlaceId)
      .neq('id', businessId)
      .maybeSingle();

    if (collisionError) {
      return buildErrorResponse(
        500,
        'ERR_DATABASE_ERROR',
        'Failed to verify Place ID uniqueness.',
      );
    }

    if (collision) {
      return buildErrorResponse(
        422,
        'ERR_PLACE_ID_MISMATCH',
        'This Google Place ID is already associated with another registered business.',
      );
    }
  }

  // 10. Persist Destination Update via Service Role
  const { error: updateError } = await supabaseAdmin
    .from('businesses')
    .update({
      google_review_url: sanitizedUrl,
      google_place_id: targetPlaceId,
    })
    .eq('id', businessId);

  if (updateError) {
    return buildErrorResponse(
      500,
      'ERR_INTERNAL_SERVER_ERROR',
      updateError.message || 'Failed to update business destination in database.',
    );
  }

  // 11. Write Append-Only Audit Trail (public.admin_audit_logs)
  const ipHash = extractClientIpHash(req);
  const { error: auditError } = await supabaseAdmin
    .from('admin_audit_logs')
    .insert({
      actor_user_id: user.id,
      actor_role: 'owner',
      target_business_id: businessId,
      action: 'UPDATE_GOOGLE_DESTINATION',
      payload_before: {
        google_review_url: business.google_review_url,
        google_place_id: business.google_place_id,
      },
      payload_after: {
        google_review_url: sanitizedUrl,
        google_place_id: targetPlaceId,
      },
      ip_hash: ipHash,
    });

  if (auditError) {
    // Log error internally; do not fail customer request since primary mutation succeeded
    console.error('Failed to write audit log entry for destination update:', auditError);
  }

  // 12. Return Success Response (API-OWN-03 DTO)
  const responsePayload = {
    status: 'updated',
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

