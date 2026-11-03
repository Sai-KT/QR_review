import { describe, it, expect } from 'vitest';
import {
  validateDestinationUrl,
  isApprovedGoogleHostname,
  extractPlaceIdFromUrl,
} from './destinationValidator';

describe('destinationValidator (M5-T04 / SCR-OWN-05 / API-OWN-03)', () => {
  describe('isApprovedGoogleHostname', () => {
    it('accepts exact approved Google hostnames', () => {
      expect(isApprovedGoogleHostname('search.google.com')).toBe(true);
      expect(isApprovedGoogleHostname('maps.google.com')).toBe(true);
      expect(isApprovedGoogleHostname('www.google.com')).toBe(true);
      expect(isApprovedGoogleHostname('g.page')).toBe(true);
      expect(isApprovedGoogleHostname('maps.app.goo.gl')).toBe(true);
    });

    it('rejects unapproved hostnames, attacker lookalikes, and general Google subdomains', () => {
      expect(isApprovedGoogleHostname('search.google.com.attacker.com')).toBe(false);
      expect(isApprovedGoogleHostname('google.com.evil.example')).toBe(false);
      expect(isApprovedGoogleHostname('google.com')).toBe(false);
      expect(isApprovedGoogleHostname('drive.google.com')).toBe(false);
      expect(isApprovedGoogleHostname('mail.google.com')).toBe(false);
      expect(isApprovedGoogleHostname('evil-phishing.com')).toBe(false);
    });
  });

  describe('extractPlaceIdFromUrl', () => {
    it('extracts placeid parameter from URL search params', () => {
      const url = new URL(
        'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
      );
      expect(extractPlaceIdFromUrl(url)).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
    });

    it('extracts place_id parameter as alternative', () => {
      const url = new URL(
        'https://maps.google.com/?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4',
      );
      expect(extractPlaceIdFromUrl(url)).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
    });

    it('returns null when no placeid parameter exists', () => {
      const url = new URL('https://maps.app.goo.gl/AbCd123');
      expect(extractPlaceIdFromUrl(url)).toBeNull();
    });
  });

  describe('validateDestinationUrl (TC-DST-01..10)', () => {
    it('TC-DST-01: accepts valid search.google.com review link with ChIJ Place ID', () => {
      const url =
        'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.hostname).toBe('search.google.com');
        expect(result.extractedPlaceId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
        expect(result.sanitizedUrl).toBe(url);
      }
    });

    it('TC-DST-02: accepts valid maps.app.goo.gl shortlink', () => {
      const url = 'https://maps.app.goo.gl/AbCd1234XYZ';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.hostname).toBe('maps.app.goo.gl');
        expect(result.extractedPlaceId).toBeNull();
      }
    });

    it('accepts valid g.page/r/ review link', () => {
      const url = 'https://g.page/r/Cb_tDeuEmsR/review';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.hostname).toBe('g.page');
      }
    });

    it('accepts valid www.google.com/maps link', () => {
      const url = 'https://www.google.com/maps/place/Luxe+Salon/@12.9716,77.5946,17z';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.hostname).toBe('www.google.com');
      }
    });

    it('accepts valid maps.google.com link', () => {
      const url = 'https://maps.google.com/?cid=1029384756102938475';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.hostname).toBe('maps.google.com');
      }
    });

    it('TC-DST-03: rejects insecure HTTP links', () => {
      const url = 'http://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_INVALID_DESTINATION_URL');
        expect(result.errorMessage).toContain('HTTPS');
      }
    });

    it('TC-DST-04: rejects lookalike domains with subdomain spoofing', () => {
      const url = 'https://search.google.com.attacker.com/local/writereview?placeid=ChIJ123';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_INVALID_DESTINATION_URL');
      }
    });

    it('TC-DST-05: rejects arbitrary external phishing domains', () => {
      const url = 'https://evil-phishing.com/review';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_INVALID_DESTINATION_URL');
      }
    });

    it('TC-DST-06: rejects URLs with embedded user credentials (userinfo)', () => {
      const url =
        'https://user:secret@search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_INVALID_DESTINATION_URL');
        expect(result.errorMessage).toContain('credentials');
      }
    });

    it('TC-DST-07: accepts custom non-ChIJ Place IDs matching ^[A-Za-z0-9_-]{20,100}$ (Decision M0-02)', () => {
      const nonChIjPlaceId = 'Eh1234567890abcdef1234567890';
      const url = `https://search.google.com/local/writereview?placeid=${nonChIjPlaceId}`;
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.extractedPlaceId).toBe(nonChIjPlaceId);
      }
    });

    it('TC-DST-09: rejects cross-parameter Place ID mismatch between URL and explicit parameter', () => {
      const url =
        'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4';
      const mismatchedPlaceId = 'ChIJ999999999999999999999999';

      const result = validateDestinationUrl(url, mismatchedPlaceId);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_PLACE_ID_MISMATCH');
        expect(result.errorMessage).toContain('does not match');
      }
    });

    it('accepts matching explicit Place ID with URL Place ID', () => {
      const placeId = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
      const url = `https://search.google.com/local/writereview?placeid=${placeId}`;
      const result = validateDestinationUrl(url, placeId);

      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.extractedPlaceId).toBe(placeId);
      }
    });

    it('rejects search.google.com with unapproved path', () => {
      const url = 'https://search.google.com/search?q=my+business';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_INVALID_DESTINATION_URL');
        expect(result.errorMessage).toContain('/local/writereview');
      }
    });

    it('rejects g.page without /r/ review path', () => {
      const url = 'https://g.page/about-us';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_INVALID_DESTINATION_URL');
        expect(result.errorMessage).toContain('/r/');
      }
    });

    it('rejects www.google.com without /maps path', () => {
      const url = 'https://www.google.com/search?q=salon';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_INVALID_DESTINATION_URL');
        expect(result.errorMessage).toContain('/maps');
      }
    });

    it('rejects non-standard ports', () => {
      const url = 'https://search.google.com:8443/local/writereview?placeid=ChIJ12345678901234567890';
      const result = validateDestinationUrl(url);

      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorCode).toBe('ERR_INVALID_DESTINATION_URL');
        expect(result.errorMessage).toContain('non-standard ports');
      }
    });

    it('rejects javascript: and protocol-relative schemes', () => {
      expect(validateDestinationUrl('javascript:alert(1)').isValid).toBe(false);
      expect(validateDestinationUrl('//search.google.com/local/writereview').isValid).toBe(false);
    });

    it('rejects malformed URLs, empty strings, null, and non-strings', () => {
      expect(validateDestinationUrl('').isValid).toBe(false);
      expect(validateDestinationUrl('   ').isValid).toBe(false);
      expect(validateDestinationUrl(null).isValid).toBe(false);
      expect(validateDestinationUrl(undefined).isValid).toBe(false);
      expect(validateDestinationUrl(12345).isValid).toBe(false);
      expect(validateDestinationUrl('not a url').isValid).toBe(false);
    });
  });
});

