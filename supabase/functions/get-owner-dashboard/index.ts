/**
 * Edge Function: get-owner-dashboard (API-OWN-04)
 *
 * Task: M5-T08 — Funnel Analytics Dashboard & Conversion Attribution
 * Milestone: M5 — Merchant Owner Portal & Digital QR Sharing
 *
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M5-T08
 *   - docs/API_SPEC.md (v1.2) §11.4 (API-OWN-04), §15.2
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.6, §5.7
 *   - docs/SECURITY.md (v1.1) §4, §8
 *   - docs/TEST_PLAN.md (v1.1) TC-ANA-07, TC-ANA-08, TC-OWN-14, TC-API-18
 *   - FR-OWNER-005 & FR-ANALYTICS-002
 *
 * Capabilities:
 *   - Authenticated merchant gateway (Authorization: Bearer <owner_jwt>)
 *   - Enforces strict tenant ownership (businesses.owner_id = auth.uid())
 *   - Supports period filtering: 7d, 30d (default), 90d, all
 *   - Computes canonical conversion rates with zero-division safety
 *   - Attaches mandatory Google Review Attribution Disclaimer
 *   - Sanitized canonical error envelopes
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

// ============================================================================
// CORS & Security Headers
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export const NO_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// ============================================================================
// Canonical Attribution Disclaimer
// ============================================================================

export const CANONICAL_ATTRIBUTION_DISCLAIMER =
  'Google Maps does not notify third-party platforms when reviews are published. Outbound clicks represent high-intent customer handoffs, not confirmed reviews.';

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
// Request Query Schema
// ============================================================================

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const QuerySchema = z.object({
  businessId: z.string().regex(UUID_REGEX, 'Invalid business UUID format'),
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

export type QueryParams = z.infer<typeof QuerySchema>;

// ============================================================================
// Calculation Helpers
// ============================================================================

function roundToFourDecimals(num: number): number {
  return Math.round(num * 10000) / 10000;
}

// ============================================================================
// Main Request Handler
// ============================================================================

export async function handler(
  req: Request,
  injectedSupabase?: SupabaseClient,
): Promise<Response> {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. Enforce GET Method
  if (req.method !== 'GET') {
    return buildErrorResponse(405, 'ERR_METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  // 3. Resolve Client and Authenticate Caller
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return buildErrorResponse(
      401,
      'ERR_UNAUTHORIZED',
      'Authorization header with Bearer token is required',
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return buildErrorResponse(401, 'ERR_UNAUTHORIZED', 'Bearer token is missing');
  }

  try {
    const url = new URL(req.url);
    const rawBusinessId = url.searchParams.get('businessId') ?? '';
    const rawPeriod = url.searchParams.get('period') ?? '30d';

    // 4. Validate Query Parameters
    const parseResult = QuerySchema.safeParse({
      businessId: rawBusinessId,
      period: rawPeriod,
    });

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0]?.message || 'Invalid query parameters';
      return buildErrorResponse(400, 'ERR_INVALID_INPUT', issue);
    }

    const { businessId, period } = parseResult.data;

    const supabaseUrl =
      typeof Deno !== 'undefined'
        ? Deno.env.get('SUPABASE_URL')
        : process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
    const supabaseServiceKey =
      typeof Deno !== 'undefined'
        ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        : process.env.SUPABASE_SERVICE_ROLE_KEY ||
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

    const supabaseAdmin =
      injectedSupabase && typeof (injectedSupabase as SupabaseClient).from === 'function'
        ? injectedSupabase
        : createClient(supabaseUrl!, supabaseServiceKey!, {
            auth: { persistSession: false },
          });

    // Verify token validity
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      return buildErrorResponse(
        401,
        'ERR_UNAUTHORIZED',
        authError?.message || 'Invalid or expired authentication session',
      );
    }

    const userId = authData.user.id;

    // 5. Verify Tenant Ownership (RLS boundary)
    const { data: business, error: bizError } = await supabaseAdmin
      .from('businesses')
      .select('id, owner_id')
      .eq('id', businessId)
      .maybeSingle();

    if (bizError) {
      return buildErrorResponse(
        500,
        'ERR_INTERNAL_DATABASE',
        'Failed to verify business ownership',
      );
    }

    if (!business || business.owner_id !== userId) {
      // Cross-tenant attempt or business not found -> 403 Forbidden
      return buildErrorResponse(
        403,
        'ERR_FORBIDDEN',
        'Access denied to target business analytics',
      );
    }

    // 6. Compute Period Date Boundaries
    const now = new Date();
    let periodStart: Date | null = null;
    if (period === '7d') {
      periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === '30d') {
      periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === '90d') {
      periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (period === 'all') {
      periodStart = null;
    }

    // 7. Query analytics_events for business and period
    let eventsQuery = supabaseAdmin
      .from('analytics_events')
      .select('event_name')
      .eq('business_id', businessId);

    if (periodStart) {
      eventsQuery = eventsQuery.gte('created_at', periodStart.toISOString());
    }
    eventsQuery = eventsQuery.lte('created_at', now.toISOString());

    const { data: events, error: eventsErr } = await eventsQuery;

    if (eventsErr) {
      return buildErrorResponse(
        500,
        'ERR_INTERNAL_DATABASE',
        'Failed to query analytics telemetry events',
      );
    }

    // 8. Query tenant_quotas for latest quota ledger
    const { data: quotaRow, error: quotaErr } = await supabaseAdmin
      .from('tenant_quotas')
      .select('billing_cycle, max_limit, used_count, reserved_count, reset_at')
      .eq('business_id', businessId)
      .order('billing_cycle', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (quotaErr) {
      return buildErrorResponse(
        500,
        'ERR_INTERNAL_DATABASE',
        'Failed to query tenant quota ledger',
      );
    }

    // 9. Aggregate event counts
    let qrVisits = 0;
    let surveysCompleted = 0;
    let generationsRequested = 0;
    let reviewsDrafted = 0;
    let clipboardCopies = 0;
    let googleHandoffClicks = 0;
    let directBypassClicks = 0;

    if (events) {
      for (const ev of events as Array<{ event_name: string }>) {
        switch (ev.event_name) {
          case 'EVENT_QR_PAGE_VIEW':
            qrVisits++;
            break;
          case 'EVENT_SURVEY_COMPLETED':
            surveysCompleted++;
            break;
          case 'EVENT_GENERATION_REQUESTED':
            generationsRequested++;
            break;
          case 'EVENT_GENERATION_SUCCESS':
            reviewsDrafted++;
            break;
          case 'EVENT_COPY_SUCCESS':
            clipboardCopies++;
            break;
          case 'EVENT_GOOGLE_REDIRECT_CLICK':
            googleHandoffClicks++;
            break;
          case 'EVENT_GOOGLE_BYPASS_CLICK':
            directBypassClicks++;
            break;
          default:
            break;
        }
      }
    }

    // 10. Canonical Funnel Mathematical Calculations (API_SPEC §15.2 / TC-ANA-07)
    const surveyCompletionRate = qrVisits > 0 ? surveysCompleted / qrVisits : 0;
    const draftSuccessRate = surveysCompleted > 0 ? reviewsDrafted / surveysCompleted : 0;
    const copyRate = reviewsDrafted > 0 ? clipboardCopies / reviewsDrafted : 0;
    const handoffRate = clipboardCopies > 0 ? googleHandoffClicks / clipboardCopies : 0;
    const directBypassRate = qrVisits > 0 ? directBypassClicks / qrVisits : 0;
    const totalHandoffRate =
      qrVisits > 0 ? (googleHandoffClicks + directBypassClicks) / qrVisits : 0;

    // 11. Format Quota
    const quota = quotaRow
      ? {
          billingCycle: quotaRow.billing_cycle,
          monthlyQuotaLimit: quotaRow.max_limit,
          generationsUsed: quotaRow.used_count,
          generationsRemaining: Math.max(
            0,
            quotaRow.max_limit - quotaRow.used_count - quotaRow.reserved_count,
          ),
          resetDate: quotaRow.reset_at,
        }
      : {
          billingCycle: new Date().toISOString().slice(0, 7),
          monthlyQuotaLimit: 150,
          generationsUsed: 0,
          generationsRemaining: 150,
          resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
        };

    // 12. Assemble Canonical Response Payload
    const responsePayload = {
      businessId,
      period,
      metrics: {
        qrVisits,
        qrPageViews: qrVisits,
        surveysCompleted,
        surveyCompletionRate: roundToFourDecimals(surveyCompletionRate),
        completionRate: roundToFourDecimals(surveyCompletionRate),
        reviewsDrafted,
        generationsSuccess: reviewsDrafted,
        generationsRequested,
        draftSuccessRate: roundToFourDecimals(draftSuccessRate),
        clipboardCopies,
        copySuccess: clipboardCopies,
        copyRate: roundToFourDecimals(copyRate),
        googleHandoffClicks,
        googleRedirectClicks: googleHandoffClicks,
        handoffRate: roundToFourDecimals(handoffRate),
        assistedHandoffRate: roundToFourDecimals(handoffRate),
        directBypassClicks,
        directBypassRate: roundToFourDecimals(directBypassRate),
        totalHandoffRate: roundToFourDecimals(totalHandoffRate),
      },
      quota,
      disclaimer: CANONICAL_ATTRIBUTION_DISCLAIMER,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        ...NO_CACHE_HEADERS,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return buildErrorResponse(500, 'ERR_INTERNAL_SERVER', message);
  }
}

// Start Deno runtime server if executed as standalone script
if (typeof Deno !== 'undefined' && 'serve' in Deno) {
  (Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => void }).serve(
    (req: Request) => handler(req),
  );
}
