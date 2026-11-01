import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidGoogleReviewUrl,
  sanitizeGoogleReviewUrl,
  formatWhatsAppUrl,
  getCategoryLabel,
  getInitials,
  getClientSessionUuid,
} from './customer';

describe('Customer Experience Utilities (M3-T05)', () => {
  describe('isValidGoogleReviewUrl & sanitizeGoogleReviewUrl', () => {
    it('accepts valid search.google.com review URLs', () => {
      const url = 'https://search.google.com/local/writereview?placeid=ChIJ12345';
      expect(isValidGoogleReviewUrl(url)).toBe(true);
      expect(sanitizeGoogleReviewUrl(url)).toBe(url);
    });

    it('accepts valid maps.google.com and g.page URLs', () => {
      expect(isValidGoogleReviewUrl('https://maps.google.com/?cid=12345')).toBe(true);
      expect(isValidGoogleReviewUrl('https://g.page/r/Cb12345/review')).toBe(true);
      expect(isValidGoogleReviewUrl('https://goo.gl/maps/abc12345')).toBe(true);
    });

    it('rejects non-Google third party domains', () => {
      expect(isValidGoogleReviewUrl('https://evil-phishing.com/google.com')).toBe(false);
      expect(isValidGoogleReviewUrl('https://facebook.com/reviews')).toBe(false);
      expect(sanitizeGoogleReviewUrl('https://untrusted.com')).toBeNull();
    });

    it('rejects unsafe protocols (javascript:, data:) and protocol-relative URLs', () => {
      expect(isValidGoogleReviewUrl('javascript:alert(1)')).toBe(false);
      expect(isValidGoogleReviewUrl('data:text/html,<script></script>')).toBe(false);
      expect(isValidGoogleReviewUrl('//maps.google.com/test')).toBe(false);
    });

    it('handles null, undefined, and empty string safely', () => {
      expect(isValidGoogleReviewUrl(null)).toBe(false);
      expect(isValidGoogleReviewUrl(undefined)).toBe(false);
      expect(isValidGoogleReviewUrl('')).toBe(false);
      expect(isValidGoogleReviewUrl('   ')).toBe(false);
    });
  });

  describe('formatWhatsAppUrl', () => {
    it('formats a standard 10-digit Indian phone number with 91 prefix', () => {
      const result = formatWhatsAppUrl('9876543210');
      expect(result).toBe(
        'https://wa.me/919876543210?text=Hello%2C%20I%20visited%20your%20business%20and%20would%20like%20to%20get%20in%20touch.',
      );
    });

    it('formats a number with country code +91 or 91 without duplication', () => {
      expect(formatWhatsAppUrl('+919876543210')).toBe(
        'https://wa.me/919876543210?text=Hello%2C%20I%20visited%20your%20business%20and%20would%20like%20to%20get%20in%20touch.',
      );
      expect(formatWhatsAppUrl('919876543210')).toBe(
        'https://wa.me/919876543210?text=Hello%2C%20I%20visited%20your%20business%20and%20would%20like%20to%20get%20in%20touch.',
      );
    });

    it('formats 11-digit number with leading zero (e.g. 09876543210)', () => {
      expect(formatWhatsAppUrl('09876543210')).toBe(
        'https://wa.me/919876543210?text=Hello%2C%20I%20visited%20your%20business%20and%20would%20like%20to%20get%20in%20touch.',
      );
    });

    it('encodes custom greeting properly without leaking internal secrets', () => {
      const result = formatWhatsAppUrl('9876543210', 'Hi! Inquiry about haircut pricing.');
      expect(result).toBe('https://wa.me/919876543210?text=Hi!%20Inquiry%20about%20haircut%20pricing.');
    });

    it('returns null for empty, null, or malformed numbers', () => {
      expect(formatWhatsAppUrl(null)).toBeNull();
      expect(formatWhatsAppUrl(undefined)).toBeNull();
      expect(formatWhatsAppUrl('')).toBeNull();
      expect(formatWhatsAppUrl('12345')).toBeNull(); // Too short
      expect(formatWhatsAppUrl('invalid_phone')).toBeNull();
    });
  });

  describe('getCategoryLabel', () => {
    it('returns formatted category labels', () => {
      expect(getCategoryLabel('salon')).toBe('Salon');
      expect(getCategoryLabel('cafe')).toBe('Café');
      expect(getCategoryLabel('restaurant')).toBe('Restaurant');
      expect(getCategoryLabel('')).toBe('');
      expect(getCategoryLabel(null)).toBe('');
    });
  });

  describe('getInitials', () => {
    it('returns first 2 letters for single-word names', () => {
      expect(getInitials('Luxe')).toBe('LU');
      expect(getInitials('Oasis')).toBe('OA');
    });

    it('returns first letters of first two words for multi-word names', () => {
      expect(getInitials('Green Salon & Spa')).toBe('GS');
      expect(getInitials('Daily Roast Cafe')).toBe('DR');
    });

    it('handles empty or null values gracefully', () => {
      expect(getInitials('')).toBe('QR');
      expect(getInitials(null)).toBe('QR');
      expect(getInitials(undefined)).toBe('QR');
    });
  });

  describe('getClientSessionUuid', () => {
    beforeEach(() => {
      window.sessionStorage.clear();
    });

    it('returns a valid UUID v4', () => {
      const uuid = getClientSessionUuid('luxe000001');
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('persists and returns identical UUID for repeated calls with same qrId', () => {
      const uuid1 = getClientSessionUuid('luxe000001');
      const uuid2 = getClientSessionUuid('luxe000001');
      expect(uuid1).toBe(uuid2);
    });

    it('returns different UUIDs for different qrIds', () => {
      const uuidSalon = getClientSessionUuid('luxe000001');
      const uuidCafe = getClientSessionUuid('daily00001');
      expect(uuidSalon).not.toBe(uuidCafe);
    });
  });
});
