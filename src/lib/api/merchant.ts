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

import { supabase } from '../supabase';
import { toBusinessDto } from '../adapters/business';
import type { BusinessRow } from '../../types/database';
import type { Business } from '../../types/domain';

export interface FetchMerchantBusinessResult {
  data: Business | null;
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

