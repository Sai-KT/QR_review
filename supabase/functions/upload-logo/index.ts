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
 * Architecture & Consistency Model (Immutable Full-UUID Paths + CAS + Safe Pruning):
 *   Supabase Storage and PostgreSQL operate as two independent distributed services
 *   without a shared two-phase commit (2PC) transaction coordinator.
 *   This gateway eliminates shared-path mutable overwrites entirely by giving each upload
 *   its own unique, unpredictable, immutable object key:
 *
 *     Path:  ${businessId}/logos/logo_${fullUuid}.${ext}
 *
 *   Where:
 *     - fullUuid is a cryptographically strong 128-bit RFC 4122 UUID v4 (crypto.randomUUID()).
 *     - ext is derived exclusively from binary magic-byte inspection (png, jpeg, webp).
 *     - upsert: false guarantees no existing asset is ever overwritten.
 *
 *   PostgreSQL Compare-and-Swap (CAS) & Ambiguous-Commit Recovery:
 *     - Slot update asserts .is('logo_url', null) or .eq('logo_url', initialLogoUrl).
 *     - Ambiguous update errors trigger an authoritative re-read of public.businesses:
 *       * If current logo_url equals the newly written URL, the commit succeeded.
 *       * If current logo_url differs, uncommitted targetPath is cleaned up and 409/500 returned.
 *       * If database cannot be queried reliably, targetPath is PRESERVED to prevent data loss.
 *       * Referenced objects are NEVER deleted.
 *
 *   Safe Retention & Bounded Cleanup:
 *     - Superseded logos are retained during a safe grace period (default: 15 minutes)
 *       to prevent HTTP 404 broken images on already-open patron viewports.
 *     - Cleanup is request-triggered and opportunistic, executing synchronously during
 *       authenticated logo operations. Zero paid schedulers or unvetted infrastructure.
 *     - Storage URLs are strictly validated against bucket and tenant-path boundaries.
 *     - Legacy fixed-path logos (${businessId}/logo.<ext>) remain compatible and protected
 *       while actively referenced.
 *
 *   Deletion Safety (Decision M5-T05-D02 — Fail-Safe Avatar Fallback):
 *     - Logical deletion (DB logo_url = NULL) is committed via CAS.
 *     - Storage asset unlinking failure does NOT restore the DB pointer. The UI safely
 *       renders the monogram avatar rather than an HTTP 404 broken image.
 *     - Mutation predicates strictly enforce caller tenant ownership (owner_id = user.id).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateImageBuffer } from '../_shared/imageValidator.ts';

export const BUCKET_NAME = 'business-logos';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

export const DEFAULT_GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes

export function getGracePeriodMs(): number {
  const envVal =
    typeof Deno !== 'undefined'
      ? Deno.env.get('LOGO_PRUNE_GRACE_PERIOD_MS')
      : process.env['LOGO_PRUNE_GRACE_PERIOD_MS'];
  if (envVal !== undefined && envVal !== '') {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_GRACE_PERIOD_MS;
}

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

/**
 * Safely extracts and validates a tenant-scoped storage path from a public logo URL.
 * Strictly verifies bucket name, tenant businessId, and prevents directory traversal.
 *
 * Supported formats:
 * - http(s)://.../storage/v1/object/public/business-logos/:businessId/logos/:fileName
 * - http(s)://.../storage/v1/object/public/business-logos/:businessId/logo.:ext (legacy)
 */
export function extractTenantStoragePath(
  logoUrl: string | null | undefined,
  expectedBusinessId: string,
  expectedBucket = BUCKET_NAME,
): string | null {
  if (!logoUrl || typeof logoUrl !== 'string') {
    return null;
  }
  try {
    const urlObj = new URL(logoUrl);
    const prefix = `/storage/v1/object/public/${expectedBucket}/${expectedBusinessId}/`;
    if (!urlObj.pathname.startsWith(prefix)) {
      return null;
    }
    const relativePath = decodeURIComponent(urlObj.pathname.slice(prefix.length));
    // Guard against directory traversal and malformed inputs
    if (
      !relativePath ||
      relativePath.includes('..') ||
      relativePath.startsWith('/') ||
      relativePath.includes('\\')
    ) {
      return null;
    }
    return `${expectedBusinessId}/${relativePath}`;
  } catch {
    return null;
  }
}

/**
 * Opportunistically prunes superseded logos for this tenant.
 * - Never deletes the currently referenced logo in PostgreSQL.
 * - Never deletes the newly uploaded target file.
 * - Only prunes files older than gracePeriodMs (default: 15 min).
 * - Synchronously awaited to avoid dropped unhandled background promises.
 */
export async function pruneSupersededLogos(
  supabaseAdmin: SupabaseClient,
  businessId: string,
  currentReferencedUrl: string | null,
  newUploadPath: string | null,
  gracePeriodMs = getGracePeriodMs(),
): Promise<{ pruned: string[]; retained: string[] }> {
  const currentReferencedPath = extractTenantStoragePath(currentReferencedUrl, businessId);
  const pruned: string[] = [];
  const retained: string[] = [];

  try {
    const now = Date.now();

    // 1. Inspect the /logos/ subdirectory
    const { data: logoFiles, error: listError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .list(`${businessId}/logos`, { limit: 50 });

    if (!listError && logoFiles) {
      const filesToDelete: string[] = [];

      for (const file of logoFiles) {
        if (!file.name || file.name === '.emptyFolderPlaceholder') continue;

        const candidatePath = `${businessId}/logos/${file.name}`;

        // Invariant 1: NEVER delete the currently referenced active logo in DB
        if (candidatePath === currentReferencedPath) {
          retained.push(candidatePath);
          continue;
        }

        // Invariant 2: NEVER delete the file just uploaded by this request
        if (candidatePath === newUploadPath) {
          retained.push(candidatePath);
          continue;
        }

        // Invariant 3: Respect grace period
        let fileAgeMs = Infinity;
        if (file.created_at) {
          const t = new Date(file.created_at).getTime();
          if (!Number.isNaN(t)) fileAgeMs = now - t;
        }
        if (fileAgeMs === Infinity) {
          const m = file.name.match(/^logo_(\d+)_/);
          if (m?.[1]) {
            const t = parseInt(m[1], 10);
            if (!Number.isNaN(t)) fileAgeMs = now - t;
          }
        }
        // When gracePeriodMs === 0 (e.g. test override), any unreferenced file is eligible
        if (gracePeriodMs === 0) {
          fileAgeMs = Infinity;
        }

        if (fileAgeMs >= gracePeriodMs) {
          filesToDelete.push(candidatePath);
        } else {
          retained.push(candidatePath);
        }
      }

      if (filesToDelete.length > 0) {
        const { error: removeError } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .remove(filesToDelete);
        if (!removeError) {
          pruned.push(...filesToDelete);
        } else {
          console.error(`[upload-logo] Failed to prune superseded files: ${removeError.message}`);
        }
      }
    }

    // 2. Also check for legacy fixed-path logos (${businessId}/logo.<ext>) in tenant root
    const { data: rootFiles } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .list(businessId, { limit: 20 });

    if (rootFiles) {
      const legacyToDelete: string[] = [];
      for (const file of rootFiles) {
        if (!file.name) continue;
        const rootPath = `${businessId}/${file.name}`;
        const isLegacyLogo = /^logo\.(png|jpeg|webp)$/i.test(file.name);
        const isStaleBackup = file.name.startsWith('.backup_');
        if (!isLegacyLogo && !isStaleBackup) continue;

        // Invariant 1: If DB still points to this legacy file, NEVER delete!
        if (rootPath === currentReferencedPath) {
          retained.push(rootPath);
          continue;
        }

        let ageMs = Infinity;
        if (file.created_at) {
          const t = new Date(file.created_at).getTime();
          if (!Number.isNaN(t)) ageMs = now - t;
        }
        if (gracePeriodMs === 0) {
          ageMs = Infinity;
        }

        if (ageMs >= gracePeriodMs) {
          legacyToDelete.push(rootPath);
        } else {
          retained.push(rootPath);
        }
      }

      if (legacyToDelete.length > 0) {
        const { error: legacyRemoveErr } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .remove(legacyToDelete);
        if (!legacyRemoveErr) {
          pruned.push(...legacyToDelete);
        }
      }
    }
  } catch (err) {
    console.error(`[upload-logo] Opportunistic pruning encountered error: ${String(err)}`);
  }

  return { pruned, retained };
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

    // Correction A — Full Cryptographic UUID Object Identifier:
    // Full RFC 4122 UUID v4 generates 128 bits of cryptographic entropy.
    // upsert: false guarantees no existing file is ever overwritten.
    const fileUuid = crypto.randomUUID();
    const fileName = `logo_${fileUuid}.${validation.extension}`;
    const targetPath = `${businessId}/logos/${fileName}`;

    // Capture initial DB logo_url for CAS assertion and pruning comparison
    const initialLogoUrl = business.logo_url as string | null;

    // Upload new logo with unique immutable path
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

    // CAS (Compare-and-Swap) update query
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

    // Correction B — Ambiguous Database Commit Outcome Handling:
    // Do NOT immediately assume an update error or missing row means the write didn't commit.
    if (!dbUpdateError && updatedBusiness) {
      // Direct CAS success: exactly 1 row matched and committed
      await pruneSupersededLogos(
        supabaseAdmin,
        businessId,
        logoUrl,
        targetPath,
      );

      return jsonResponse({
        status: 'uploaded',
        businessId,
        logoUrl,
      });
    }

    // Ambiguous outcome or CAS conflict:
    // Authoritatively re-read public.businesses to check actual database state
    const { data: currentBiz, error: recheckError } = await supabaseAdmin
      .from('businesses')
      .select('id, owner_id, logo_url')
      .eq('id', businessId)
      .maybeSingle();

    if (recheckError || !currentBiz) {
      // Re-read failed or timed out: database status is INDETERMINATE.
      // Invariant: PRESERVE targetPath to prevent deleting a potentially referenced logo.
      console.error(
        `[upload-logo] Indeterminate DB commit status for business ${businessId}. ` +
          `Update error: ${dbUpdateError?.message}. Re-read error: ${recheckError?.message}. ` +
          `Preserving object at ${targetPath}.`,
      );
      return errorResponse(
        'ERR_DATABASE_ERROR',
        'Database state is indeterminate after update attempt. The uploaded logo has been preserved.',
        500,
        undefined,
        true,
      );
    }

    // Re-read succeeded: Inspect authoritative state
    if (currentBiz.owner_id !== user.id) {
      // Tenant ownership changed during upload: clean up our object and reject with 403
      try {
        await supabaseAdmin.storage.from(BUCKET_NAME).remove([targetPath]);
      } catch {
        // Best effort
      }
      return errorResponse(
        'ERR_PERMISSION_DENIED',
        'You do not have permission to modify this business logo.',
        403,
      );
    }

    if (currentBiz.logo_url === logoUrl) {
      // The update DID commit! (e.g. dropped response or transient timeout after commit)
      await pruneSupersededLogos(
        supabaseAdmin,
        businessId,
        logoUrl,
        targetPath,
      );

      return jsonResponse({
        status: 'uploaded',
        businessId,
        logoUrl,
      });
    }

    // The update did NOT commit our new URL.
    // It is safe to clean up our own uncommitted object at targetPath.
    try {
      await supabaseAdmin.storage.from(BUCKET_NAME).remove([targetPath]);
    } catch {
      // Best effort
    }

    if (currentBiz.logo_url !== initialLogoUrl) {
      // A concurrent winner committed a newer logo (CAS conflict)
      return errorResponse(
        'ERR_CONFLICT',
        'Another upload committed a newer logo concurrently. Please retry.',
        409,
        undefined,
        true,
      );
    }

    // Genuine DB rejection (no concurrent update, but DB rejected write)
    return errorResponse(
      'ERR_DATABASE_ERROR',
      `Failed to persist business logo URL: ${dbUpdateError?.message || 'Database rejected update.'}`,
      500,
    );
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

    // CAS deletion: clear logo_url only if it still matches initialLogoUrl
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

    if (!dbClearError && updatedBusiness) {
      // Explicitly unlink the specific active logo file that was deleted
      const activeFilePath = extractTenantStoragePath(initialLogoUrl, businessId);
      if (activeFilePath) {
        const { error: removeErr } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .remove([activeFilePath]);
        if (removeErr) {
          console.error(
            `[upload-logo] Failed to unlink deleted logo ${activeFilePath}: ${removeErr.message}. ` +
              'DB logo_url is NULL. Monogram fallback preserved.',
          );
        }
      }

      await pruneSupersededLogos(
        supabaseAdmin,
        businessId,
        null,
        null,
      );

      return jsonResponse({
        status: 'deleted',
        businessId,
      });
    }

    // Ambiguous delete outcome or CAS conflict:
    // Authoritatively re-read public.businesses
    const { data: currentBiz, error: recheckError } = await supabaseAdmin
      .from('businesses')
      .select('id, owner_id, logo_url')
      .eq('id', businessId)
      .maybeSingle();

    if (recheckError || !currentBiz) {
      return errorResponse(
        'ERR_DATABASE_ERROR',
        'Database state is indeterminate after delete attempt.',
        500,
        undefined,
        true,
      );
    }

    if (currentBiz.owner_id !== user.id) {
      return errorResponse(
        'ERR_PERMISSION_DENIED',
        'You do not have permission to modify this business logo.',
        403,
      );
    }

    if (currentBiz.logo_url === null) {
      // The delete DID commit! Unlink active file if present
      const activeFilePath = extractTenantStoragePath(initialLogoUrl, businessId);
      if (activeFilePath) {
        const { error: removeErr } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .remove([activeFilePath]);
        if (removeErr) {
          console.error(
            `[upload-logo] Failed to unlink deleted logo ${activeFilePath}: ${removeErr.message}. ` +
              'DB logo_url is NULL. Monogram fallback preserved.',
          );
        }
      }

      await pruneSupersededLogos(
        supabaseAdmin,
        businessId,
        null,
        null,
      );

      return jsonResponse({
        status: 'deleted',
        businessId,
      });
    }

    if (currentBiz.logo_url !== initialLogoUrl) {
      // A concurrent upload committed a new logo!
      return errorResponse(
        'ERR_CONFLICT',
        'A new logo was uploaded concurrently. Reload the page before deleting.',
        409,
        undefined,
        true,
      );
    }

    return errorResponse(
      'ERR_DATABASE_ERROR',
      `Failed to clear business logo URL: ${dbClearError?.message || 'Database rejected clear.'}`,
      500,
    );
  }

  return errorResponse('ERR_BAD_REQUEST', 'Unhandled request', 400);
}

// Serve HTTP requests in Deno Edge Runtime
if (typeof Deno !== 'undefined' && 'serve' in Deno) {
  Deno.serve((req) => handler(req));
}
