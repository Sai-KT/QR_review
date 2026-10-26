/**
 * Business DTO Adapters
 *
 * Source: docs/API_SPEC.md (v1.2) §11.1, §11.2, §16.1; docs/DATABASE_SCHEMA.md (v1.1) §5.2, §6.1
 *
 * Maps between PostgreSQL businesses table snake_case rows and frontend camelCase Business DTOs.
 * Enforces security boundaries:
 * - Narrow merchant update serialization (drops ownerId, publicQrId, categoryId, accountStatus, isActive)
 * - Anti-gating and authentic destination tracking
 */

import type { BusinessRow } from '../../types/database';
import type {
  Business,
  BusinessCategoryType,
  BusinessProfileUpdate,
  DestinationUpdate,
  PublicBusinessProjection,
  SubscriptionStatus,
} from '../../types/domain';

/**
 * Maps a raw PostgreSQL businesses row to the frontend Business domain model.
 */
export function toBusinessDto(row: BusinessRow): Business {
  return {
    id: row.id,
    ownerId: row.owner_id,
    categoryId: row.category_id as BusinessCategoryType,
    publicQrId: row.public_qr_id,
    vanitySlug: row.vanity_slug,
    name: row.name,
    logoUrl: row.logo_url,
    googlePlaceId: row.google_place_id,
    googleReviewUrl: row.google_review_url,
    whatsappNumber: row.whatsapp_number,
    accountStatus: row.account_status,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps public QR projection RPC or database query to PublicBusinessProjection.
 * Strips internal surrogate UUIDs and owner credentials.
 */
export function toPublicBusinessProjection(row: {
  public_qr_id: string;
  name: string;
  logo_url: string | null;
  category_id: string;
  google_review_url: string | null;
  whatsapp_number: string | null;
  account_status: string;
  is_active: boolean;
  subscription_status?: string | null;
}): PublicBusinessProjection {
  return {
    publicQrId: row.public_qr_id,
    name: row.name,
    logoUrl: row.logo_url,
    categoryId: row.category_id as BusinessCategoryType,
    googleReviewUrl: row.google_review_url,
    whatsappNumber: row.whatsapp_number,
    accountStatus: row.account_status as Business['accountStatus'],
    isActive: row.is_active,
    subscriptionStatus: (row.subscription_status ?? 'pilot') as SubscriptionStatus,
  };
}

/**
 * Converts a frontend BusinessProfileUpdate into a narrow PostgREST update row for API-OWN-02.
 *
 * SECURITY & SCHEMA BOUNDARY ENFORCEMENT (Phase 5.2 & API_SPEC §11.2):
 * Only permits merchant-editable safe fields on PATCH /rest/v1/businesses:
 * - name -> name
 * - vanitySlug -> vanity_slug
 * - whatsappNumber -> whatsapp_number
 *
 * Explicitly excluded from API-OWN-02 PATCH:
 * - logo_url (handled exclusively via upload gateway API-OWN-07 / API-OWN-08)
 * - google_review_url (handled exclusively via validated destination gateway API-OWN-03)
 * - Privileged/hardware-locked fields (id, owner_id, category_id, public_qr_id, account_status, is_active)
 *
 * Uses explicit allowlisting to ensure runtime filtering against unexpected enumerable keys.
 */
export function toBusinessUpdateRow(update: BusinessProfileUpdate): {
  name?: string;
  vanity_slug?: string;
  whatsapp_number?: string | null;
} {
  const row: {
    name?: string;
    vanity_slug?: string;
    whatsapp_number?: string | null;
  } = {};

  if (update.name !== undefined) {
    row.name = update.name;
  }
  if (update.vanitySlug !== undefined) {
    row.vanity_slug = update.vanitySlug;
  }
  if (update.whatsappNumber !== undefined) {
    row.whatsapp_number = update.whatsappNumber;
  }

  return row;
}

/**
 * Backward-compatible alias for toBusinessUpdateRow.
 */
export const toBusinessUpdatePayload = toBusinessUpdateRow;

/**
 * Maps DestinationUpdate to the dedicated gateway payload (API-OWN-03).
 */
export function toDestinationUpdatePayload(update: DestinationUpdate): {
  google_review_url: string;
} {
  return {
    google_review_url: update.googleReviewUrl,
  };
}
