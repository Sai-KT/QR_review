/**
 * Google Destination Validator (M5-T04 / SCR-OWN-05 / API-OWN-03)
 *
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) §10.6 Task M5-T04
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-05)
 *   - docs/API_SPEC.md (v1.2) §11.3 (API-OWN-03)
 *   - docs/SECURITY.md (v1.1) §7.2 (TH-08, GC-01)
 *   - docs/TEST_PLAN.md (v1.1) TC-DST-01..10, TC-OWN-08..10, TC-API-16..17
 *   - Founder Decision M0-02 (Destination Verification Protocol)
 *
 * Rules:
 *   1. Protocol must be strictly HTTPS.
 *   2. Rejects embedded userinfo credentials (user:pass@).
 *   3. Rejects non-standard ports.
 *   4. Approved Google review hostnames:
 *      - search.google.com (path must start with /local/writereview)
 *      - maps.google.com
 *      - www.google.com (path must start with /maps)
 *      - g.page (path must start with /r/)
 *      - maps.app.goo.gl
 *   5. Disallows lookalike domains (e.g. search.google.com.attacker.com).
 *   6. Extracts and validates Google Place ID where present (regex: ^[A-Za-z0-9_-]{20,100}$).
 *      Does not require universal ChIJ prefix (Founder Decision M0-02 / TC-DST-07).
 *   7. Rejects Place ID format violations and cross-parameter mismatches (TC-DST-09).
 */

export const APPROVED_GOOGLE_HOSTNAMES = [
  'search.google.com',
  'maps.google.com',
  'www.google.com',
  'g.page',
  'maps.app.goo.gl',
] as const;

export type ApprovedGoogleHostname = (typeof APPROVED_GOOGLE_HOSTNAMES)[number];

export const PLACE_ID_REGEX = /^[A-Za-z0-9_-]{15,100}$/;

export interface DestinationValidationSuccess {
  isValid: true;
  sanitizedUrl: string;
  extractedPlaceId: string | null;
  targetPlaceId: string | null;
  hostname: ApprovedGoogleHostname;
}

export interface DestinationValidationFailure {
  isValid: false;
  errorCode: 'ERR_INVALID_DESTINATION_URL' | 'ERR_PLACE_ID_MISMATCH';
  errorMessage: string;
}

export type DestinationValidationResult =
  | DestinationValidationSuccess
  | DestinationValidationFailure;

/**
 * Checks if a hostname matches the exact approved Google review hostnames allowlist.
 * Explicitly rejects subdomain lookalikes, attacker domains, and arbitrary Google subdomains.
 */
export function isApprovedGoogleHostname(hostname: string): hostname is ApprovedGoogleHostname {
  const normalized = hostname.trim().toLowerCase();
  return (APPROVED_GOOGLE_HOSTNAMES as readonly string[]).includes(normalized);
}

/**
 * Extracts Google Place ID from a validated Google review URL if present.
 * Looks for query parameters: `placeid` or `place_id`.
 */
export function extractPlaceIdFromUrl(parsedUrl: URL): string | null {
  const queryPlaceId =
    parsedUrl.searchParams.get('placeid') ||
    parsedUrl.searchParams.get('place_id');

  if (queryPlaceId && queryPlaceId.trim()) {
    return queryPlaceId.trim();
  }

  return null;
}

/**
 * Validates a merchant-supplied Google review destination URL according to the approved
 * security and API specification.
 *
 * @param url The raw candidate Google review URL string.
 * @param explicitPlaceId Optional manually provided Place ID to verify against the URL.
 */
export function validateDestinationUrl(
  url: unknown,
  explicitPlaceId?: string | null,
): DestinationValidationResult {
  // 1. Basic Type and Nullability Checks
  if (typeof url !== 'string' || !url.trim()) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'Destination URL is required.',
    };
  }

  const trimmed = url.trim();

  // Reject protocol-relative URLs (//search.google.com/...)
  if (trimmed.startsWith('//')) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'Protocol-relative URLs are not allowed. Please include https://.',
    };
  }

  // 2. Standard WHATWG URL Parsing
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'Invalid URL format. Please provide a complete URL starting with https://.',
    };
  }

  // 3. Strict HTTPS Protocol Enforcement
  if (parsed.protocol !== 'https:') {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'URL must use secure HTTPS protocol.',
    };
  }

  // 4. Reject Embedded Userinfo Credentials (user:pass@...)
  if (parsed.username || parsed.password) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'URL must not contain embedded user credentials.',
    };
  }

  // 5. Reject Non-Standard Custom Ports
  if (parsed.port && parsed.port !== '443') {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'URL must not specify non-standard ports.',
    };
  }

  // 6. Hostname Whitelist & Lookalike Defense
  const hostname = parsed.hostname.toLowerCase();
  if (!isApprovedGoogleHostname(hostname)) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage:
        'URL must be an approved Google Maps review link (e.g. search.google.com, maps.app.goo.gl, or g.page/r/).',
    };
  }

  // 7. Path and Routing Boundary Verification per Hostname
  const pathname = parsed.pathname;

  if (hostname === 'search.google.com') {
    if (!pathname.startsWith('/local/writereview')) {
      return {
        isValid: false,
        errorCode: 'ERR_INVALID_DESTINATION_URL',
        errorMessage: 'search.google.com links must target /local/writereview.',
      };
    }
  } else if (hostname === 'www.google.com') {
    if (!pathname.startsWith('/maps')) {
      return {
        isValid: false,
        errorCode: 'ERR_INVALID_DESTINATION_URL',
        errorMessage: 'www.google.com links must target /maps.',
      };
    }
  } else if (hostname === 'g.page') {
    if (!pathname.startsWith('/r/')) {
      return {
        isValid: false,
        errorCode: 'ERR_INVALID_DESTINATION_URL',
        errorMessage: 'g.page links must target /r/ review shortlinks (e.g. https://g.page/r/.../review).',
      };
    }
  } else if (hostname === 'maps.app.goo.gl') {
    if (pathname.length <= 1) {
      return {
        isValid: false,
        errorCode: 'ERR_INVALID_DESTINATION_URL',
        errorMessage: 'maps.app.goo.gl links must contain a valid shortlink path.',
      };
    }
  }

  // 8. Place ID Extraction and Format Checking
  const urlPlaceId = extractPlaceIdFromUrl(parsed);

  if (urlPlaceId) {
    if (!PLACE_ID_REGEX.test(urlPlaceId)) {
      return {
        isValid: false,
        errorCode: 'ERR_INVALID_DESTINATION_URL',
        errorMessage: 'Google Place ID in URL contains invalid characters or length (20-100 alphanumeric).',
      };
    }
  }

  // 9. Explicit Place ID Cross-Verification (TC-DST-09)
  let finalPlaceId: string | null = urlPlaceId;

  if (explicitPlaceId !== undefined && explicitPlaceId !== null) {
    const trimmedExplicit = explicitPlaceId.trim();
    if (trimmedExplicit) {
      if (!PLACE_ID_REGEX.test(trimmedExplicit)) {
        return {
          isValid: false,
          errorCode: 'ERR_INVALID_DESTINATION_URL',
          errorMessage: 'Provided Google Place ID must be a 20-100 character alphanumeric string.',
        };
      }

      if (urlPlaceId && urlPlaceId !== trimmedExplicit) {
        return {
          isValid: false,
          errorCode: 'ERR_PLACE_ID_MISMATCH',
          errorMessage: 'Provided Google Place ID does not match the Place ID in the destination URL.',
        };
      }

      finalPlaceId = trimmedExplicit;
    }
  }

  return {
    isValid: true,
    sanitizedUrl: parsed.toString(),
    extractedPlaceId: urlPlaceId,
    targetPlaceId: finalPlaceId,
    hostname,
  };
}
