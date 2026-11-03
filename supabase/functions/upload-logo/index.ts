/**
 * Edge Function: upload-logo (API-OWN-07 & API-OWN-08)
 *
 * Task: M5-T05 — Supabase Storage Gateway: Logo Upload, Inspection & Deletion
 * Milestone: M5 — Merchant Owner Portal & Digital QR Sharing
 *
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M5-T05
 *   - docs/API_SPEC.md (v1.2) §11.7 (API-OWN-07), §11.8 (API-OWN-08)
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.2
 *   - docs/SECURITY.md (v1.1) §15.1 (Founder Decision M0-03)
 *   - docs/TEST_PLAN.md (v1.1) TC-UPL-01..08, TC-API-21..23
 *
 * Architecture & Consistency Model (Option A — Immutable Request-Unique Paths + CAS):
 *   Supabase Storage and PostgreSQL operate as two independent distributed services
 *   without a shared two-phase commit (2PC) transaction coordinator.
 *   This gateway eliminates shared-path mutable overwrites entirely by giving each upload
 *   its own unique immutable object key:
 *
 *     Path:  ${businessId}/logos/logo_${Date.now()}_${uuid8}.${ext}
 *
 *   Concurrency control is provided by a PostgreSQL Compare-and-Swap (CAS) predicate:
 *     - .is('logo_url', null)             when the DB slot is currently empty
 *     - .eq('logo_url', initialLogoUrl)   when the DB slot holds a prior URL
 *   A stale concurrent request that loses the CAS race receives 0 matched rows,
 *   removes only its own unique file, and returns HTTP 409 Conflict.
 *   No backup copy/move operations are needed; live logos are never touched.
 *
 *   Deletion (Decision M5-T05-D02 — Fail-Safe Avatar Fallback):
 *   On Storage removal failure after a successful DB NULL commit, the backend logs
 *   an alert for background pruning but does NOT restore the DB pointer. The client
 *   receives the monogram avatar rather than a broken image URL.
 *
 *   Database mutation predicates are bound to caller tenant ownership (owner_id = user.id).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateImageBuffer } from '../_shared/imageValidator.ts';

const BUCKET_NAME = 'business-logos';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  correlationId = `corr_${crypto.randomUUID().slice(0, 12)}`,
  retryable = false,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        correlationId,
        retryable,
      },
    },
    status,
  );
}

export async function handler(
  req: Request,
  injectedSupabaseAdmin?: SupabaseClient,
): Promise<Response> {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. HTTP Method Gate
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return errorResponse(
      'ERR_METHOD_NOT_ALLOWED',
      `Method ${req.method} is not supported. Use POST or DELETE.`,
      405,
    );
  }

  // 3. Environment & Client Setup
  const supabaseUrl =
    (typeof Deno !== 'undefined'
      ? Deno.env.get('SUPABASE_URL') || Deno.env.get('LOCAL_SUPABASE_URL')
      : process.env['SUPABASE_URL'] || process.env['LOCAL_SUPABASE_URL']) ||
    'http://127.0.0.1:54321';

  const serviceRoleKey =
    typeof Deno !== 'undefined'
      ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      : process.env['SUPABASE_SERVICE_ROLE_KEY'];

  const supabaseAdmin =
    injectedSupabaseAdmin ||
    (serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null);

  if (!supabaseAdmin) {
    return errorResponse(
      'ERR_INTERNAL_SERVER_ERROR',
      'Supabase admin configuration missing.',
      500,
    );
  }

  // 4. Authenticate Caller JWT
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return errorResponse(
      'ERR_UNAUTHORIZED',
      'Authorization bearer token is required.',
      401,
    );
  }

  const jwtToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwtToken) {
    return errorResponse(
      'ERR_UNAUTHORIZED',
      'Authorization token is missing or malformed.',
      401,
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(jwtToken);

  if (authError || !user) {
    return errorResponse(
      'ERR_UNAUTHORIZED',
      'Invalid or expired session token.',
      401,
    );
  }

  // --------------------------------------------------------------------------
  // HANDLE POST: Upload Logo (API-OWN-07)
  // --------------------------------------------------------------------------
  if (req.method === 'POST') {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return errorResponse(
        'ERR_BAD_REQUEST',
        'Request must be multipart/form-data with businessId and file.',
        400,
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (err) {
      return errorResponse(
        'ERR_BAD_REQUEST',
        `Failed to parse multipart form data: ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }

    const businessIdRaw = formData.get('businessId');
    const fileEntry = formData.get('file');

    if (!businessIdRaw || typeof businessIdRaw !== 'string') {
      return errorResponse(
        'ERR_BAD_REQUEST',
        'Parameter businessId is required as a string UUID.',
        400,
      );
    }

    const businessId = businessIdRaw.trim();
    if (!UUID_REGEX.test(businessId)) {
      return errorResponse(
        'ERR_BAD_REQUEST',
        'Parameter businessId must be a valid UUID.',
        400,
      );
    }

    if (!fileEntry || !(fileEntry instanceof Blob)) {
      return errorResponse(
        'ERR_BAD_REQUEST',
        'File payload is required.',
        400,
      );
    }

    // Tenant Ownership Check
    const { data: business, error: businessError } = await supabaseAdmin
      .from('businesses')
      .select('id, owner_id, logo_url')
      .eq('id', businessId)
      .maybeSingle();

    if (businessError) {
      return errorResponse(
        'ERR_DATABASE_ERROR',
        'Failed to inspect business tenant ownership.',
        500,
      );
    }

    if (!business) {
      return errorResponse(
        'ERR_BUSINESS_NOT_FOUND',
        `Business with ID ${businessId} was not found.`,
        404,
      );
    }

    if (business.owner_id !== user.id) {
      return errorResponse(
        'ERR_PERMISSION_DENIED',
        'You do not have permission to modify this business logo.',
        403,
      );
    }

    // Binary Image Validation
    const arrayBuffer = await fileEntry.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const validation = validateImageBuffer(bytes);
    if (!validation.isValid) {
      let statusCode = 400;
      if (validation.errorCode === 'ERR_FILE_TOO_LARGE') {
        statusCode = 413;
      } else if (
        validation.errorCode === 'ERR_INVALID_IMAGE_TYPE' ||
        validation.errorCode === 'ERR_CORRUPT_IMAGE'
      ) {
        statusCode = 415;
      } else if (
        validation.errorCode === 'ERR_IMAGE_DIMENSIONS_EXCEEDED' ||
        validation.errorCode === 'ERR_INVALID_ASPECT_RATIO'
      ) {
        statusCode = 422;
      }

      return errorResponse(
        validation.errorCode,
        validation.errorMessage,
        statusCode,
      );
    }

    // Option A — Immutable Request-Unique Object Path:
    // Every upload writes to its own unique key. No two in-flight requests ever
    // share a Storage object key, eliminating all shared-path overwrite races.
    const uuid8 = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const fileName = `logo_${Date.now()}_${uuid8}.${validation.extension}`;
    const targetPath = `${businessId}/logos/${fileName}`;

    // Capture the initial DB logo_url before upload for CAS predicate and post-commit pruning.
    // This is the value we will assert in the PostgreSQL update; if it has changed by commit
    // time (concurrent winner already committed), the CAS update matches 0 rows → 409 Conflict.
    const initialLogoUrl = business.logo_url as string | null;

    // Upload to the unique immutable path. No backup, no copy, no upsert overwrite of existing.
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(targetPath, bytes, {
        contentType: validation.mimeType,
        upsert: false,
      });

    if (uploadError) {
      return errorResponse(
        'ERR_STORAGE_ERROR',
        `Failed to store logo file: ${uploadError.message}`,
        500,
      );
    }

    // Construct cache-busted public URL
    let publicBaseUrl = supabaseUrl.replace(/\/+$/, '');
    if (
      publicBaseUrl.includes('kong:8000') ||
      publicBaseUrl.includes('localhost') ||
      publicBaseUrl.includes('127.0.0.1')
    ) {
      publicBaseUrl = 'http://127.0.0.1:54321';
    }

    const timestamp = Date.now();
    const logoUrl = `${publicBaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${targetPath}?v=${timestamp}`;

    // CAS (Compare-and-Swap) update:
    // Only commit if logo_url still matches the value we read before uploading.
    // This detects a concurrent winner that committed between our DB read and our DB write.
    // On mismatch the update matches 0 rows → we abort and clean up only our own unique file.
    let dbUpdateQuery = supabaseAdmin
      .from('businesses')
      .update({
        logo_url: logoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId)
      .eq('owner_id', user.id);

    if (initialLogoUrl === null) {
      dbUpdateQuery = dbUpdateQuery.is('logo_url', null);
    } else {
      dbUpdateQuery = dbUpdateQuery.eq('logo_url', initialLogoUrl);
    }

    const { data: updatedBusiness, error: dbUpdateError } = await dbUpdateQuery
      .select('id, logo_url')
      .maybeSingle();

    if (dbUpdateError) {
      // DB error — clean up only our own unique file and return 500.
      try {
        await supabaseAdmin.storage.from(BUCKET_NAME).remove([targetPath]);
      } catch {
        // Best effort Storage cleanup
      }
      return errorResponse(
        'ERR_DATABASE_ERROR',
        `Failed to persist business logo URL: ${dbUpdateError.message}`,
        500,
      );
    }

    if (!updatedBusiness) {
      // CAS mismatch: a concurrent upload already committed a newer logo_url, OR
      // ownership check failed. Remove only our own file and report the conflict.
      try {
        await supabaseAdmin.storage.from(BUCKET_NAME).remove([targetPath]);
      } catch {
        // Best effort Storage cleanup
      }
      return errorResponse(
        'ERR_CONFLICT',
        'Another upload committed a newer logo concurrently. Please retry.',
        409,
        undefined,
        true,
      );
    }

    // CAS succeeded — prune the specific superseded file extracted from initialLogoUrl.
    // We only delete the one file we displaced; we never touch files we did not create.
    if (initialLogoUrl) {
      try {
        // Extract the Storage path from the full URL (strip base URL and query string)
        const urlObj = new URL(initialLogoUrl);
        // Path looks like /storage/v1/object/public/business-logos/<tenant-path>
        const pathMatch = urlObj.pathname.match(
          /\/storage\/v1\/object\/public\/business-logos\/(.+)$/,
        );
        if (pathMatch?.[1]) {
          await supabaseAdmin.storage.from(BUCKET_NAME).remove([pathMatch[1]]);
        }
      } catch {
        // Non-fatal: orphaned file will be pruned by background maintenance
      }
    }

    return jsonResponse({
      status: 'uploaded',
      businessId,
      logoUrl,
    });
  }

  // --------------------------------------------------------------------------
  // HANDLE DELETE: Remove Logo (API-OWN-08)
  // --------------------------------------------------------------------------
  if (req.method === 'DELETE') {
    const url = new URL(req.url);
    const businessId = url.searchParams.get('businessId')?.trim() || '';

    if (!businessId || !UUID_REGEX.test(businessId)) {
      return errorResponse(
        'ERR_BAD_REQUEST',
        'Query parameter businessId must be a valid UUID.',
        400,
      );
    }

    // Tenant Ownership Check
    const { data: business, error: businessError } = await supabaseAdmin
      .from('businesses')
      .select('id, owner_id, logo_url')
      .eq('id', businessId)
      .maybeSingle();

    if (businessError) {
      return errorResponse(
        'ERR_DATABASE_ERROR',
        'Failed to inspect business tenant ownership.',
        500,
      );
    }

    if (!business) {
      return errorResponse(
        'ERR_BUSINESS_NOT_FOUND',
        `Business with ID ${businessId} was not found.`,
        404,
      );
    }

    if (business.owner_id !== user.id) {
      return errorResponse(
        'ERR_PERMISSION_DENIED',
        'You do not have permission to modify this business logo.',
        403,
      );
    }

    // CAS deletion: clear logo_url only if it still matches what we read.
    // This prevents accidentally clobbering a logo_url that a concurrent upload
    // committed between our DB read and our DB update.
    const initialLogoUrl = business.logo_url as string | null;

    let dbClearQuery = supabaseAdmin
      .from('businesses')
      .update({
        logo_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId)
      .eq('owner_id', user.id);

    if (initialLogoUrl === null) {
      dbClearQuery = dbClearQuery.is('logo_url', null);
    } else {
      dbClearQuery = dbClearQuery.eq('logo_url', initialLogoUrl);
    }

    const { data: updatedBusiness, error: dbClearError } = await dbClearQuery
      .select('id')
      .maybeSingle();

    if (dbClearError) {
      return errorResponse(
        'ERR_DATABASE_ERROR',
        `Failed to clear business logo URL: ${dbClearError.message}`,
        500,
      );
    }

    if (!updatedBusiness) {
      // CAS mismatch: a concurrent upload committed a new logo between our read and write.
      // The existing logo is now valid — report 409 so the client can reload and re-try.
      return errorResponse(
        'ERR_CONFLICT',
        'A new logo was uploaded concurrently. Reload the page before deleting.',
        409,
        undefined,
        true,
      );
    }

    // DB pointer is now NULL. Attempt to remove the specific Storage object named in
    // initialLogoUrl. Failure is non-fatal (Decision M5-T05-D02 — Fail-Safe Avatar Fallback):
    // we do NOT restore the DB pointer. The client renders the monogram avatar rather than
    // a broken image. Orphaned objects are pruned by scheduled background maintenance.
    if (initialLogoUrl) {
      try {
        const urlObj = new URL(initialLogoUrl);
        const pathMatch = urlObj.pathname.match(
          /\/storage\/v1\/object\/public\/business-logos\/(.+)$/,
        );
        if (pathMatch?.[1]) {
          const { error: storageRemoveError } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .remove([pathMatch[1]]);
          if (storageRemoveError) {
            // Log alert for background pruning; DO NOT restore DB pointer.
            console.error(
              `[upload-logo] Storage pruning failed for ${pathMatch[1]} ` +
                `(business ${businessId}): ${storageRemoveError.message}. ` +
                'DB logo_url is NULL. Orphan scheduled for background cleanup.',
            );
          }
        }
      } catch (err) {
        // Non-fatal: URL parse or removal error; orphan logged for background pruning.
        console.error(
          `[upload-logo] Non-fatal Storage removal error for business ${businessId}: ${String(err)}`,
        );
      }
    }

    return jsonResponse({
      status: 'deleted',
      businessId,
    });
  }

  return errorResponse('ERR_BAD_REQUEST', 'Unhandled request', 400);
}

// Serve HTTP requests in Deno Edge Runtime
if (typeof Deno !== 'undefined' && 'serve' in Deno) {
  Deno.serve((req) => handler(req));
}
