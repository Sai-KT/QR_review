/**
 * Customer Experience Utility Functions (M3-T05 / SCR-CUST-01 & SCR-CUST-09)
 *
 * Specifications:
 *   - docs/UI_UX.md (v1.1) §7.1 (SCR-CUST-01, SCR-CUST-09)
 *   - docs/SECURITY.md (v1.1) §7 (TH-08), §13 (GC-01)
 *   - docs/PRD.md (v1.1) FR-CUST-001, FR-CUST-002, FR-CUST-008
 */

// Trusted domains for Google Maps / Google Reviews handoff
export const TRUSTED_GOOGLE_REVIEW_DOMAINS = [
  'search.google.com',
  'maps.google.com',
  'goo.gl',
  'google.com',
  'www.google.com',
  'g.page',
] as const;

/**
 * Validates whether a review URL is a secure, genuine Google Maps/Review destination.
 * Rejects javascript:, data:, protocol-relative, and arbitrary third-party domains.
 */
export function isValidGoogleReviewUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Reject protocol-relative URLs
  if (trimmed.startsWith('//')) return false;

  try {
    const parsed = new URL(trimmed);
    // Enforce safe HTTP(S) protocol
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    return TRUSTED_GOOGLE_REVIEW_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

/**
 * Sanitizes and returns the Google review destination URL.
 * Returns null if the URL is invalid or untrusted.
 */
export function sanitizeGoogleReviewUrl(url?: string | null): string | null {
  if (!isValidGoogleReviewUrl(url)) return null;
  return url!.trim();
}

/**
 * Formats a merchant phone number into an international WhatsApp click-to-chat URL (FR-CUST-08).
 * Format: https://wa.me/<internationalDigits>?text=<encodedMessage>
 *
 * Rules:
 * - India-first mobile normalization: 10 digits starting with 6-9 -> prefixed with 91.
 * - Handles country codes without duplicating them (e.g. 919876543210 or +919876543210 -> 919876543210).
 * - Strips leading 0 from 11-digit numbers (09876543210 -> 919876543210).
 * - Rejects non-digits, malformed numbers, and numbers shorter than 10 digits.
 * - Default neutral prefilled greeting without private data or customer telemetry.
 */
export function formatWhatsAppUrl(
  phoneNumber?: string | null,
  customMessage = 'Hello, I visited your business and would like to get in touch.',
): string | null {
  if (!phoneNumber || typeof phoneNumber !== 'string') return null;

  // Strip all non-digit characters
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  if (!digitsOnly) return null;

  let internationalDigits: string;

  if (digitsOnly.length === 10 && /^[6-9]/.test(digitsOnly)) {
    // 10-digit Indian mobile number
    internationalDigits = `91${digitsOnly}`;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('0') && /^[6-9]/.test(digitsOnly.slice(1))) {
    // 11-digit Indian number with leading 0
    internationalDigits = `91${digitsOnly.slice(1)}`;
  } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91') && /^[6-9]/.test(digitsOnly.slice(2))) {
    // 12-digit Indian number with country code 91
    internationalDigits = digitsOnly;
  } else if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
    // Standard international E.164 number (without +)
    internationalDigits = digitsOnly;
  } else {
    // Malformed number
    return null;
  }

  const encodedText = encodeURIComponent(customMessage.trim());
  return `https://wa.me/${internationalDigits}?text=${encodedText}`;
}

/**
 * Maps category ID to human-friendly display label.
 */
export function getCategoryLabel(categoryId?: string | null): string {
  if (!categoryId || typeof categoryId !== 'string') return '';
  const normalized = categoryId.trim().toLowerCase();

  switch (normalized) {
    case 'salon':
      return 'Salon';
    case 'cafe':
      return 'Café';
    default:
      // Capitalize first character
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
}

/**
 * Extracts 1-2 uppercase initial characters for fallback monogram avatar.
 */
export function getInitials(name?: string | null): string {
  if (!name || typeof name !== 'string') return 'QR';
  const trimmed = name.trim();
  if (!trimmed) return 'QR';

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  const first = parts[0]!.charAt(0);
  const second = parts[1]!.charAt(0);
  return `${first}${second}`.toUpperCase();
}

/**
 * Retrieves or generates an ephemeral customer scan session UUID.
 * Scoped to qrId in sessionStorage to persist across component re-renders
 * within the same tab/session, falling back to an in-memory UUID if sessionStorage
 * is restricted.
 */
const inMemorySessionMap = new Map<string, string>();

export function getClientSessionUuid(qrId: string): string {
  const normalizedQr = qrId.trim().toLowerCase();
  const storageKey = `qr_session_${normalizedQr}`;

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const existing = window.sessionStorage.getItem(storageKey);
      if (
        existing &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          existing,
        )
      ) {
        return existing;
      }
      const newUuid = crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, newUuid);
      return newUuid;
    }
  } catch {
    // Fall back to in-memory storage if sessionStorage throws (e.g. private browsing storage quota)
  }

  const existingMem = inMemorySessionMap.get(normalizedQr);
  if (existingMem) return existingMem;

  const newMem = crypto.randomUUID();
  inMemorySessionMap.set(normalizedQr, newMem);
  return newMem;
}
