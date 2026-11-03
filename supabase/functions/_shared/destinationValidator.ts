/**
 * Google Destination Validator (_shared)
 *
 * Deno Edge Function shared utility matching src/lib/destinationValidator.ts.
 * Enforces server-side destination verification for API-OWN-03.
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

export function isApprovedGoogleHostname(hostname: string): hostname is ApprovedGoogleHostname {
  const normalized = hostname.trim().toLowerCase();
  return (APPROVED_GOOGLE_HOSTNAMES as readonly string[]).includes(normalized);
}

export function extractPlaceIdFromUrl(parsedUrl: URL): string | null {
  const queryPlaceId =
    parsedUrl.searchParams.get('placeid') ||
    parsedUrl.searchParams.get('place_id');

  if (queryPlaceId && queryPlaceId.trim()) {
    return queryPlaceId.trim();
  }

  return null;
}

export function validateDestinationUrl(
  url: unknown,
  explicitPlaceId?: string | null,
): DestinationValidationResult {
  if (typeof url !== 'string' || !url.trim()) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'Destination URL is required.',
    };
  }

  const trimmed = url.trim();

  if (trimmed.startsWith('//')) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'Protocol-relative URLs are not allowed. Please include https://.',
    };
  }

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

  if (parsed.protocol !== 'https:') {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'URL must use secure HTTPS protocol.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'URL must not contain embedded user credentials.',
    };
  }

  if (parsed.port && parsed.port !== '443') {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage: 'URL must not specify non-standard ports.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!isApprovedGoogleHostname(hostname)) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_DESTINATION_URL',
      errorMessage:
        'URL must be an approved Google Maps review link (e.g. search.google.com, maps.app.goo.gl, or g.page/r/).',
    };
  }

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
  } else if (hostname === 'maps.google.com') {
    if (pathname.length <= 1 && !parsed.search) {
      return {
        isValid: false,
        errorCode: 'ERR_INVALID_DESTINATION_URL',
        errorMessage: 'maps.google.com links must contain a specific place or map query.',
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
