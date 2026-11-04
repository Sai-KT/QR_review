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
import { toFeedbackDto } from '../adapters/feedback';
import { toOwnerDashboardResponse } from '../adapters/analytics';
import type { BusinessRow, SurveyResponseRow } from '../../types/database';
import type {
  Business,
  BusinessProfileUpdate,
  CustomerFeedback,
  DashboardAnalyticsPeriod,
  OwnerDashboardResponse,
} from '../../types/domain';

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

/* -------------------------------------------------------------------------- */
/* Customer Feedback Retrieval & Option Metadata (API-OWN-05)                  */
/* -------------------------------------------------------------------------- */

export interface FetchMerchantFeedbackOptions {
  businessId: string;
  startDate?: string; // ISO 8601 or YYYY-MM-DD
  endDate?: string;   // ISO 8601 or YYYY-MM-DD
  page?: number;      // 1-based index (default 1)
  pageSize?: number;  // items per page (default 50 per API-OWN-05)
}

export interface FetchMerchantFeedbackResult {
  data: CustomerFeedback[] | null;
  totalCount: number;
  error: Error | null;
}

/**
 * Fetches chronological customer feedback records for the authenticated merchant's business.
 *
 * Endpoint: GET /rest/v1/survey_responses (API-OWN-05)
 * Security: Enforced strictly by PostgreSQL RLS (`survey_responses_select_owner`).
 *           Requires authenticated owner session. Returns 0 rows for other businesses.
 */
export async function fetchMerchantFeedback(
  options: FetchMerchantFeedbackOptions,
): Promise<FetchMerchantFeedbackResult> {
  const { businessId, startDate, endDate, page = 1, pageSize = 50 } = options;

  if (!businessId || typeof businessId !== 'string' || businessId.trim() === '') {
    return {
      data: null,
      totalCount: 0,
      error: new Error('A valid business ID is required to fetch feedback.'),
    };
  }

  try {
    let query = supabase
      .from('survey_responses')
      .select(
        'id, business_id, category_id, selected_options, affirmed_facts_snapshot, optional_note, session_uuid, purged_at, created_at, authenticity_confirmed',
        { count: 'exact' },
      )
      .eq('business_id', businessId.trim())
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    // Apply date range filters if provided
    if (startDate && startDate.trim() !== '') {
      const startIso = startDate.includes('T') ? startDate.trim() : `${startDate.trim()}T00:00:00.000Z`;
      query = query.gte('created_at', startIso);
    }

    if (endDate && endDate.trim() !== '') {
      const endIso = endDate.includes('T') ? endDate.trim() : `${endDate.trim()}T23:59:59.999Z`;
      query = query.lte('created_at', endIso);
    }

    // Apply pagination range (0-indexed)
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(100, pageSize));
    const from = (validPage - 1) * validPageSize;
    const to = from + validPageSize - 1;

    query = query.range(from, to);

    const { data, count, error } = await query;

    if (error) {
      return {
        data: null,
        totalCount: 0,
        error: new Error(error.message || 'Failed to fetch customer feedback records.'),
      };
    }

    if (!data) {
      return { data: [], totalCount: 0, error: null };
    }

    const feedbacks = (data as unknown as SurveyResponseRow[]).map(toFeedbackDto);

    return {
      data: feedbacks,
      totalCount: count ?? feedbacks.length,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      totalCount: 0,
      error:
        err instanceof Error
          ? err
          : new Error('An unexpected error occurred while fetching customer feedback.'),
    };
  }
}

export interface SurveyQuestionOptionMeta {
  id: string;
  questionId: string;
  optionText: string;
  emojiAnchor: string;
  sentimentLabel: 'positive' | 'neutral' | 'negative';
  isNeutralNa: boolean;
}

export interface FetchSurveyOptionsResult {
  data: Map<string, SurveyQuestionOptionMeta> | null;
  error: Error | null;
}

/**
 * Loads questionnaire option metadata to enrich selected option IDs with
 * display text, emoji anchors, and authoritative sentiment labels.
 */
export async function fetchSurveyOptionsMap(): Promise<FetchSurveyOptionsResult> {
  try {
    const { data, error } = await supabase
      .from('survey_options')
      .select('id, question_id, option_text, emoji_anchor, sentiment_label, is_neutral_na')
      .eq('is_active', true);

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    const map = new Map<string, SurveyQuestionOptionMeta>();
    if (data) {
      for (const row of data as Array<Record<string, unknown>>) {
        const id = String(row.id);
        map.set(id, {
          id,
          questionId: String(row.question_id),
          optionText: String(row.option_text),
          emojiAnchor: String(row.emoji_anchor || ''),
          sentimentLabel: (row.sentiment_label as 'positive' | 'neutral' | 'negative') || 'positive',
          isNeutralNa: Boolean(row.is_neutral_na),
        });
      }
    }

    return { data: map, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error('Failed to load survey options.'),
    };
  }
}

export interface QuestionMeta {
  id: string;
  questionText: string;
  displayOrder: number;
}

/**
 * Loads survey question headers for display context.
 */
export async function fetchSurveyQuestionsMap(
  categoryId?: string,
): Promise<Map<string, QuestionMeta>> {
  try {
    let query = supabase
      .from('survey_questions')
      .select('id, question_text, display_order')
      .eq('is_active', true);

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data } = await query;
    const map = new Map<string, QuestionMeta>();
    if (data) {
      for (const row of data as Array<Record<string, unknown>>) {
        const id = String(row.id);
        map.set(id, {
          id,
          questionText: String(row.question_text),
          displayOrder: Number(row.display_order || 0),
        });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export type DerivedSentiment = 'positive' | 'neutral' | 'critical';

/**
 * Authoritatively derives the sentiment classification for a feedback submission
 * strictly based on the customer's affirmative option choices from survey_options.
 *
 * Rules:
 * - If at least one affirmative selection has sentiment_label === 'negative': 'critical'
 * - If any selection cannot be resolved (retired option, unknown ID) and no negative is found: 'neutral'
 *   (Strictly avoids fabricating positive praise when historical metadata is incomplete).
 * - If all non-N/A selections are resolvable and positive: 'positive'
 * - If all selections are neutral/N/A: 'neutral'
 * - Safe non-fabricated default: 'neutral'
 * - Preserves sentiment without fabricating numeric stars or running unapproved AI models.
 */
export function deriveResponseSentiment(
  feedback: CustomerFeedback,
  optionsMap?: Map<string, SurveyQuestionOptionMeta>,
): DerivedSentiment {
  if (optionsMap && feedback.selectedOptions && feedback.selectedOptions.length > 0) {
    let hasNegative = false;
    let hasPositive = false;
    let applicableCount = 0;
    let unresolvableCount = 0;

    for (const sel of feedback.selectedOptions) {
      const opt = optionsMap.get(sel.optionId);
      if (opt) {
        if (!opt.isNeutralNa) {
          applicableCount++;
          if (opt.sentimentLabel === 'negative') {
            hasNegative = true;
          } else if (opt.sentimentLabel === 'positive') {
            hasPositive = true;
          }
        }
      } else {
        // Option is retired, missing from optionsMap, or has an unknown historical ID
        unresolvableCount++;
      }
    }

    if (hasNegative) return 'critical';

    // If any selection is unresolvable (e.g. retired survey option), we cannot authoritatively
    // guarantee it wasn't negative; therefore strictly abstain from fabricating a positive score.
    if (unresolvableCount > 0) {
      return 'neutral';
    }

    if (hasPositive) return 'positive';
    if (applicableCount === 0) return 'neutral';
    return 'neutral';
  }

  // Fallback to affirmedFactsSnapshot if option metadata unavailable
  if (
    feedback.affirmedFactsSnapshot &&
    Array.isArray(feedback.affirmedFactsSnapshot) &&
    feedback.affirmedFactsSnapshot.length > 0
  ) {
    let hasNegative = false;
    let hasPositive = false;
    for (const fact of feedback.affirmedFactsSnapshot) {
      if (typeof fact === 'object' && fact !== null && 'sentimentLabel' in fact) {
        const label = (fact as { sentimentLabel?: string }).sentimentLabel;
        if (label === 'negative') hasNegative = true;
        if (label === 'positive') hasPositive = true;
      }
    }
    if (hasNegative) return 'critical';
    if (hasPositive) return 'positive';
  }

  // Safe non-fabricated default: 'neutral' (never fabricate positive praise)
  return 'neutral';
}

export interface FetchOwnerDashboardParams {
  businessId: string;
  period?: DashboardAnalyticsPeriod;
}

export interface FetchOwnerDashboardResult {
  data: OwnerDashboardResponse | null;
  error: Error | null;
}

/**
 * Fetches conversion funnel metrics and quota indicators for an authenticated merchant owner.
 *
 * Endpoint: GET /functions/v1/get-owner-dashboard?businessId=:id&period=:period (API-OWN-04)
 * Trust Boundary: OWNER_AUTHENTICATED
 * Security: Enforces valid session JWT and verifies businesses.owner_id = auth.uid() on backend.
 */
export async function fetchOwnerDashboard(
  params: FetchOwnerDashboardParams,
): Promise<FetchOwnerDashboardResult> {
  const { businessId, period = '30d' } = params;

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
        error: new Error('Authentication session required to view funnel analytics.'),
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
    const query = new URLSearchParams({
      businessId: businessId.trim(),
      period: period,
    });
    const endpoint = `${cleanBase}/functions/v1/get-owner-dashboard?${query.toString()}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
    };

    if (anonKey) {
      headers['apikey'] = anonKey;
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const serverMessage = json?.error?.message;
      const serverCode = json?.error?.code;

      if (serverCode === 'ERR_FORBIDDEN') {
        return {
          data: null,
          error: new Error(serverMessage || 'Access denied: You do not own this business.'),
        };
      }
      if (serverCode === 'ERR_NOT_FOUND') {
        return {
          data: null,
          error: new Error(serverMessage || 'Business not found.'),
        };
      }
      return {
        data: null,
        error: new Error(serverMessage || `Failed to fetch owner dashboard (${res.status})`),
      };
    }

    return {
      data: toOwnerDashboardResponse(json),
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err
          : new Error('An unexpected error occurred while fetching funnel analytics.'),
    };
  }
}

export {
  uploadBusinessLogo,
  deleteBusinessLogo,
  prevalidateLogoFile,
  type LogoUploadResponse,
  type LogoDeleteResponse,
  type LogoUploadResult,
  type LogoDeleteResult,
} from '../storage';




