/**
 * Merchant API Client (API-OWN-01)
 *
 * Source: docs/API_SPEC.md (v1.2) §11.1; docs/DATABASE_SCHEMA.md (v1.1) §5.2; docs/SECURITY.md (v1.1) §4
 *
 * Implements merchant-authenticated API interactions via direct PostgREST client.
 * Enforces security boundaries:
 * - Direct PostgREST via RLS: `owner_id = auth.uid()`
 * - Never accepts or relies on client-supplied business IDs for authorization proof.
 * - PostgREST raw snake_case rows transformed to camelCase Business DTOs via centralized adapter.
 */

import { supabase, getSupabaseUrl, getSupabaseAnonKey } from '../supabase';
import { toBusinessDto, toBusinessUpdateRow } from '../adapters/business';
import type { BusinessRow } from '../../types/database';
import type { Business, BusinessProfileUpdate } from '../../types/domain';

export interface FetchMerchantBusinessResult {
  data: Business | null;
  error: Error | null;
}

export interface UpdateMerchantBusinessResult {
  data: Business | null;
  error: Error | null;
}

export interface DestinationUpdateResponse {
  status: 'updated';
  businessId: string;
  googleReviewUrl: string;
  googlePlaceId: string | null;
}

export interface UpdateGoogleDestinationResult {
  data: DestinationUpdateResponse | null;
  error: Error | null;
}

/**
 * Fetches the active merchant business profile for the currently authenticated owner.
 *
 * Endpoint: GET /rest/v1/businesses (API-OWN-01)
 * Security: Enforced strictly by PostgreSQL RLS (`businesses_select_owner: owner_id = auth.uid()`).
 */
export async function fetchMerchantBusiness(): Promise<FetchMerchantBusinessResult> {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      return {
        data: null,
        error: new Error(error.message || 'Failed to fetch merchant business profile'),
      };
    }

    if (!data || data.length === 0) {
      return { data: null, error: null };
    }

    const business = toBusinessDto(data[0] as unknown as BusinessRow);
    return { data: business, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error('An unexpected error occurred while fetching business profile'),
    };
  }
}

/**
 * Updates safe profile fields for an authenticated merchant's business.
 *
 * Endpoint: PATCH /rest/v1/businesses?id=eq.:businessId (API-OWN-02)
 * Security: Enforced strictly by PostgreSQL RLS (`businesses_update_owner`) and column grants.
 *           Only name, vanity_slug, and whatsapp_number are permitted.
 *           Privileged or immutable fields (owner_id, public_qr_id, category_id,
 *           account_status, is_active) are dropped by adapter and guarded by trigger.
 */
export async function updateMerchantBusiness(
  businessId: string,
  update: BusinessProfileUpdate,
): Promise<UpdateMerchantBusinessResult> {
  if (!businessId || typeof businessId !== 'string' || businessId.trim() === '') {
    return {
      data: null,
      error: new Error('A valid business ID is required for profile update.'),
    };
  }

  const payload = toBusinessUpdateRow(update);

  if (Object.keys(payload).length === 0) {
    return {
      data: null,
      error: new Error('No valid fields provided for profile update.'),
    };
  }

  try {
    const { data, error } = await supabase
      .from('businesses')
      .update(payload)
      .eq('id', businessId.trim())
      .select('*')
      .single();

    if (error) {
      if (
        error.code === '23505' ||
        error.message?.includes('businesses_vanity_slug_uq') ||
        error.details?.includes('businesses_vanity_slug_uq')
      ) {
        return {
          data: null,
          error: new Error('This vanity slug is already taken. Please choose another.'),
        };
      }

      if (error.code === 'PGRST116') {
        return {
          data: null,
          error: new Error('Business record not found or you do not have permission to update it.'),
        };
      }

      if (
        error.message?.includes('ERR_IMMUTABLE_FIELD') ||
        error.message?.includes('ERR_PRIVILEGED_FIELD')
      ) {
        return {
          data: null,
          error: new Error('Privileged or immutable fields cannot be modified.'),
        };
      }

      if (error.message?.includes('chk_businesses_vanity_slug')) {
        return {
          data: null,
          error: new Error(
            'Vanity slug must contain only lowercase alphanumeric characters and single hyphens (2-63 chars).',
          ),
        };
      }

      if (error.message?.includes('chk_businesses_name')) {
        return {
          data: null,
          error: new Error('Business name must be between 1 and 100 characters.'),
        };
      }

      if (error.message?.includes('chk_businesses_whatsapp_number')) {
        return {
          data: null,
          error: new Error('WhatsApp number must be a valid 10-digit Indian mobile number.'),
        };
      }

      return {
        data: null,
        error: new Error(error.message || 'Failed to update business profile.'),
      };
    }

    if (!data) {
      return {
        data: null,
        error: new Error('No data returned from business update.'),
      };
    }

    const business = toBusinessDto(data as unknown as BusinessRow);
    return { data: business, error: null };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err
          : new Error('An unexpected error occurred while updating business profile.'),
    };
  }
}

/**
 * Updates Google Review Destination URL via the dedicated authenticated Edge Function gateway.
 *
 * Endpoint: POST /functions/v1/update-destination (API-OWN-03)
 * Trust Boundary: OWNER_AUTHENTICATED
 * Security: Validates session JWT, strict server-side Google domain whitelist, Place ID format,
 *           and records audit log in public.admin_audit_logs.
 */
export async function updateGoogleDestination(
  businessId: string,
  googleReviewUrl: string,
  googlePlaceId?: string | null,
): Promise<UpdateGoogleDestinationResult> {
  if (!businessId || typeof businessId !== 'string' || businessId.trim() === '') {
    return {
      data: null,
      error: new Error('A valid business ID is required.'),
    };
  }

  if (!googleReviewUrl || typeof googleReviewUrl !== 'string' || googleReviewUrl.trim() === '') {
    return {
      data: null,
      error: new Error('Google review URL is required.'),
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
        error: new Error('Authentication session required to update review destination.'),
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
    const endpoint = `${cleanBase}/functions/v1/update-destination`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };

    if (anonKey) {
      headers['apikey'] = anonKey;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        businessId: businessId.trim(),
        googleReviewUrl: googleReviewUrl.trim(),
        googlePlaceId: googlePlaceId ? googlePlaceId.trim() : null,
      }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const serverMessage = json?.error?.message;
      const serverCode = json?.error?.code;

      if (serverCode === 'ERR_INVALID_DESTINATION_URL') {
        return {
          data: null,
          error: new Error(serverMessage || 'URL must be an approved Google Maps review link.'),
        };
      }

      if (serverCode === 'ERR_PLACE_ID_MISMATCH') {
        return {
          data: null,
          error: new Error(serverMessage || 'Google Place ID does not match destination URL.'),
        };
      }

      if (serverCode === 'ERR_PERMISSION_DENIED') {
        return {
          data: null,
          error: new Error(
            serverMessage || 'You do not have permission to update this business destination.',
          ),
        };
      }

      return {
        data: null,
        error: new Error(serverMessage || `Destination update failed with status ${res.status}.`),
      };
    }

    return {
      data: json as DestinationUpdateResponse,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err
          : new Error('An unexpected network error occurred while updating review destination.'),
    };
  }
}



