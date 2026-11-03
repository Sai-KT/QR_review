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
 * Architecture & Consistency Model:
 *   Supabase Storage and PostgreSQL operate as two independent distributed services
 *   without a shared two-phase commit (2PC) transaction coordinator.
 *   This gateway implements a Compensating Saga / Dual-Phase Reconciliation protocol:
 *   - Isolated per-request backup keys (`.backup_${requestId}_logo.${ext}`)
 *   - Zero-downtime same-extension copy-based backup (live file remains available during upload)
 *   - Best-effort compensation rollbacks on upload or DB persistence failure
 *   - In-place replacement with post-commit pruning of obsolete extensions
 *   - DB-first deletion with rollback compensation on storage removal failure
 *   - Database mutation predicates bound to caller tenant ownership (`owner_id = user.id`)
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

    const requestId = crypto.randomUUID().slice(0, 8);
    const targetPath = `${businessId}/logo.${validation.extension}`;
    const backupPath = `${businessId}/.backup_${requestId}_logo.${validation.extension}`;

    // Failure Safety: Check if current logo has same extension and create a non-destructive safety copy
    let hasBackup = false;
    try {
      const { error: copyError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .copy(targetPath, backupPath);

      if (!copyError) {
        hasBackup = true;
      }
    } catch {
      // Non-fatal if target file did not exist yet
    }

    // Upload new logo with validated extension (in-place upsert)
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(targetPath, bytes, {
        contentType: validation.mimeType,
        upsert: true,
      });

    if (uploadError) {
      // Restore backup if it existed
      if (hasBackup) {
        try {
          await supabaseAdmin.storage.from(BUCKET_NAME).remove([targetPath]);
          await supabaseAdmin.storage.from(BUCKET_NAME).move(backupPath, targetPath);
        } catch {
          // Best effort restore
        }
      }
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

    // Update public.businesses.logo_url with owner_id verification guard
    const { data: updatedBusiness, error: dbUpdateError } = await supabaseAdmin
      .from('businesses')
      .update({
        logo_url: logoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId)
      .eq('owner_id', user.id)
      .select('id, logo_url')
      .maybeSingle();

    if (dbUpdateError || !updatedBusiness) {
      // Rollback storage mutations
      try {
        await supabaseAdmin.storage.from(BUCKET_NAME).remove([targetPath]);
        if (hasBackup) {
          await supabaseAdmin.storage.from(BUCKET_NAME).move(backupPath, targetPath);
        }
      } catch {
        // Best effort rollback
      }

      if (dbUpdateError) {
        return errorResponse(
          'ERR_DATABASE_ERROR',
          `Failed to persist business logo URL: ${dbUpdateError.message}`,
          500,
        );
      }
      return errorResponse(
        'ERR_PERMISSION_DENIED',
        'Business ownership changed during update.',
        403,
      );
    }

    // Successful persistence: Clean up safety backup and any stale backups
    try {
      const { data: tenantFiles } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .list(businessId);
      const backupsToDelete = (tenantFiles || [])
        .filter((f) => f.name.startsWith('.backup_'))
        .map((f) => `${businessId}/${f.name}`);
      if (backupsToDelete.length > 0) {
        await supabaseAdmin.storage.from(BUCKET_NAME).remove(backupsToDelete);
      }
    } catch {
      // Non-fatal cleanup
    }

    // Clean up old extension files in tenant directory (TC-UPL-08)
    const possibleExts = ['png', 'jpeg', 'webp'];
    const oldExtsToDelete = possibleExts
      .filter((ext) => ext !== validation.extension)
      .map((ext) => `${businessId}/logo.${ext}`);

    try {
      await supabaseAdmin.storage.from(BUCKET_NAME).remove(oldExtsToDelete);
    } catch {
      // Non-fatal cleanup attempt
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

    // Clear public.businesses.logo_url FIRST with owner_id verification guard
    const previousLogoUrl = business.logo_url;
    const { data: updatedBusiness, error: dbClearError } = await supabaseAdmin
      .from('businesses')
      .update({
        logo_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId)
      .eq('owner_id', user.id)
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
      return errorResponse(
        'ERR_PERMISSION_DENIED',
        'Business ownership changed during deletion.',
        403,
      );
    }

    // Delete all potential logo files and backups for this tenant
    const filesToDelete = ['png', 'jpeg', 'webp'].map(
      (ext) => `${businessId}/logo.${ext}`,
    );

    try {
      const { data: tenantFiles } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .list(businessId);
      const extraFiles = (tenantFiles || [])
        .filter((f) => f.name.startsWith('.backup_'))
        .map((f) => `${businessId}/${f.name}`);
      filesToDelete.push(...extraFiles);
    } catch {
      // Non-fatal
    }

    const { error: storageRemoveError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .remove(filesToDelete);

    if (storageRemoveError) {
      // Attempt compensation: restore DB pointer if storage removal failed
      if (previousLogoUrl) {
        try {
          await supabaseAdmin
            .from('businesses')
            .update({
              logo_url: previousLogoUrl,
              updated_at: new Date().toISOString(),
            })
            .eq('id', businessId)
            .eq('owner_id', user.id);
        } catch {
          // Best effort rollback
        }
      }

      return errorResponse(
        'ERR_STORAGE_ERROR',
        `Failed to remove storage files: ${storageRemoveError.message}`,
        500,
      );
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
