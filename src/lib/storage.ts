/**
 * Client Storage Gateway for Merchant Logo Upload & Management
 *
 * Task: M5-T05 — Supabase Storage Gateway: Logo Upload, Inspection & Deletion
 * Milestone: M5 — Merchant Owner Portal & Digital QR Sharing
 *
 * Authoritative Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M5-T05
 *   - docs/API_SPEC.md (v1.2) §11.7 (API-OWN-07), §11.8 (API-OWN-08)
 *   - docs/SECURITY.md (v1.1) §15.1 (Founder Decision M0-03)
 *   - docs/TEST_PLAN.md (v1.1) TC-UPL-01..08, TC-API-21..23
 */

import { supabase, getSupabaseUrl, getSupabaseAnonKey } from './supabase';
import {
  validateImageBuffer,
  MAX_LOGO_BYTES,
  type ImageValidationResult,
} from './imageValidator';

export interface LogoUploadResponse {
  status: 'uploaded';
  businessId: string;
  logoUrl: string;
}

export interface LogoDeleteResponse {
  status: 'deleted';
  businessId: string;
}

export interface LogoUploadResult {
  data: LogoUploadResponse | null;
  error: Error | null;
}

export interface LogoDeleteResult {
  data: LogoDeleteResponse | null;
  error: Error | null;
}

/**
 * Pre-validates a File on the client side before dispatching network upload.
 * Performs immediate file-size, format, magic-byte, and dimension inspection.
 */
export async function prevalidateLogoFile(file: File): Promise<ImageValidationResult> {
  if (!file) {
    return {
      isValid: false,
      errorCode: 'ERR_CORRUPT_IMAGE',
      errorMessage: 'No file selected.',
    };
  }

  // Quick MIME / name check for SVG rejection
  const fileName = (file.name || '').toLowerCase();
  const fileType = (file.type || '').toLowerCase();
  if (
    fileName.endsWith('.svg') ||
    fileType === 'image/svg+xml' ||
    fileType.includes('svg')
  ) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_IMAGE_TYPE',
      errorMessage:
        'SVG files are strictly prohibited for security reasons. Please upload PNG, JPEG, or WebP.',
    };
  }

  // Size limit check
  if (file.size > MAX_LOGO_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      isValid: false,
      errorCode: 'ERR_FILE_TOO_LARGE',
      errorMessage: `File size (${sizeMb} MB) exceeds the 2 MB limit.`,
    };
  }

  // Read binary bytes and perform deep inspection (magic bytes, structural headers)
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    return validateImageBuffer(bytes);
  } catch {
    return {
      isValid: false,
      errorCode: 'ERR_CORRUPT_IMAGE',
      errorMessage: 'Could not read image file contents.',
    };
  }
}

/**
 * Uploads a merchant logo to the server upload gateway (API-OWN-07).
 * Executes client pre-flight checks, sends multipart/form-data, and returns
 * the updated public URL with cache-busting timestamp.
 */
export async function uploadBusinessLogo(
  businessId: string,
  file: File,
): Promise<LogoUploadResult> {
  if (!businessId || typeof businessId !== 'string' || businessId.trim() === '') {
    return {
      data: null,
      error: new Error('A valid business ID is required.'),
    };
  }

  if (!file) {
    return {
      data: null,
      error: new Error('A logo file must be selected for upload.'),
    };
  }

  // 1. Client-Side Pre-Flight Check (Immediate local feedback)
  const validation = await prevalidateLogoFile(file);
  if (!validation.isValid) {
    return {
      data: null,
      error: new Error(validation.errorMessage),
    };
  }

  try {
    // 2. Obtain current merchant auth session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      return {
        data: null,
        error: new Error('Authentication session required to upload logo.'),
      };
    }

    const supabaseUrl = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();

    if (!supabaseUrl) {
      return {
        data: null,
        error: new Error('Supabase URL configuration is missing.'),
      };
    }

    const cleanBase = supabaseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanBase}/functions/v1/upload-logo`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
    };

    if (anonKey) {
      headers['apikey'] = anonKey;
    }

    // 3. Assemble multipart form data
    const formData = new FormData();
    formData.append('businessId', businessId.trim());
    formData.append('file', file);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const serverMessage = json?.error?.message;
      const serverCode = json?.error?.code;

      if (serverCode === 'ERR_FILE_TOO_LARGE') {
        return {
          data: null,
          error: new Error(serverMessage || 'File size exceeds the 2 MB limit.'),
        };
      }

      if (serverCode === 'ERR_INVALID_IMAGE_TYPE') {
        return {
          data: null,
          error: new Error(
            serverMessage ||
              'Invalid image type. SVG is prohibited. Only PNG, JPEG, and WebP are allowed.',
          ),
        };
      }

      if (serverCode === 'ERR_PERMISSION_DENIED') {
        return {
          data: null,
          error: new Error(
            serverMessage || 'You do not have permission to modify this business logo.',
          ),
        };
      }

      return {
        data: null,
        error: new Error(serverMessage || `Logo upload failed with status ${res.status}.`),
      };
    }

    return {
      data: json as LogoUploadResponse,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err
          : new Error('An unexpected network error occurred while uploading logo.'),
    };
  }
}

/**
 * Removes the merchant's custom logo via the deletion gateway (API-OWN-08).
 * Cleans up storage files and clears businesses.logo_url.
 */
export async function deleteBusinessLogo(businessId: string): Promise<LogoDeleteResult> {
  if (!businessId || typeof businessId !== 'string' || businessId.trim() === '') {
    return {
      data: null,
      error: new Error('A valid business ID is required.'),
    };
  }

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      return {
        data: null,
        error: new Error('Authentication session required to delete logo.'),
      };
    }

    const supabaseUrl = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();

    if (!supabaseUrl) {
      return {
        data: null,
        error: new Error('Supabase URL configuration is missing.'),
      };
    }

    const cleanBase = supabaseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanBase}/functions/v1/upload-logo?businessId=${encodeURIComponent(
      businessId.trim(),
    )}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
    };

    if (anonKey) {
      headers['apikey'] = anonKey;
    }

    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const serverMessage = json?.error?.message;
      return {
        data: null,
        error: new Error(serverMessage || `Failed to delete logo with status ${res.status}.`),
      };
    }

    return {
      data: json as LogoDeleteResponse,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err
          : new Error('An unexpected network error occurred while deleting logo.'),
    };
  }
}
