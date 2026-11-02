import { describe, it, expect } from 'vitest';
import {
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  getSafeRedirectUrl,
  getAuthErrorMessage,
  MIN_PASSWORD_LENGTH,
} from './authUtils.ts';

describe('M5-T01: Authentication Utilities & Validation (authUtils)', () => {
  describe('validateEmail', () => {
    it('accepts valid email addresses', () => {
      expect(validateEmail('merchant@example.com').isValid).toBe(true);
      expect(validateEmail('owner.salon@local.test').isValid).toBe(true);
      expect(validateEmail('user+tag@domain.co.in').isValid).toBe(true);
    });

    it('rejects empty or whitespace-only emails', () => {
      const res = validateEmail('   ');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/email address is required/i);
    });

    it('rejects malformed emails missing @ or domain', () => {
      expect(validateEmail('notanemail').isValid).toBe(false);
      expect(validateEmail('user@').isValid).toBe(false);
      expect(validateEmail('@domain.com').isValid).toBe(false);
      expect(validateEmail('user@domain').isValid).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('accepts passwords meeting minimum length (>= 8 chars)', () => {
      expect(validatePassword('12345678').isValid).toBe(true);
      expect(validatePassword('SuperSecurePass123!').isValid).toBe(true);
    });

    it('rejects empty password', () => {
      const res = validatePassword('');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/password is required/i);
    });

    it(`rejects passwords shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
      const res = validatePassword('short');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain(`at least ${MIN_PASSWORD_LENGTH} characters`);
    });
  });

  describe('validatePasswordConfirmation', () => {
    it('accepts matching passwords meeting length requirements', () => {
      expect(validatePasswordConfirmation('Secret123!', 'Secret123!').isValid).toBe(true);
    });

    it('rejects mismatched passwords', () => {
      const res = validatePasswordConfirmation('Secret123!', 'DifferentPass123!');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/passwords do not match/i);
    });

    it('fails if new password is too short even if matching', () => {
      const res = validatePasswordConfirmation('short', 'short');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain(`at least ${MIN_PASSWORD_LENGTH} characters`);
    });
  });

  describe('getSafeRedirectUrl — Open Redirect Defense', () => {
    it('allows valid relative dashboard paths', () => {
      expect(getSafeRedirectUrl('/dashboard')).toBe('/dashboard');
      expect(getSafeRedirectUrl('/dashboard/profile')).toBe('/dashboard/profile');
      expect(getSafeRedirectUrl('/dashboard/destination?tab=test')).toBe(
        '/dashboard/destination?tab=test',
      );
      expect(getSafeRedirectUrl('/')).toBe('/');
    });

    it('falls back to /dashboard on null, undefined, or empty input', () => {
      expect(getSafeRedirectUrl(null)).toBe('/dashboard');
      expect(getSafeRedirectUrl(undefined)).toBe('/dashboard');
      expect(getSafeRedirectUrl('')).toBe('/dashboard');
      expect(getSafeRedirectUrl('   ')).toBe('/dashboard');
    });

    it('rejects absolute external URLs and falls back to safe destination', () => {
      expect(getSafeRedirectUrl('https://evil-attacker.com')).toBe('/dashboard');
      expect(getSafeRedirectUrl('http://evil.com/dashboard')).toBe('/dashboard');
      expect(getSafeRedirectUrl('ftp://server/path')).toBe('/dashboard');
    });

    it('rejects protocol-relative URLs (//attacker.com)', () => {
      expect(getSafeRedirectUrl('//evil-attacker.com')).toBe('/dashboard');
      expect(getSafeRedirectUrl('/\\evil-attacker.com')).toBe('/dashboard');
    });

    it('rejects javascript: and data: pseudo-protocols', () => {
      expect(getSafeRedirectUrl('javascript:alert(1)')).toBe('/dashboard');
      expect(getSafeRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe('/dashboard');
      expect(getSafeRedirectUrl('/dashboard:attack')).toBe('/dashboard');
    });
  });

  describe('getAuthErrorMessage', () => {
    it('formats invalid_credentials error safely', () => {
      const msg = getAuthErrorMessage({ message: 'Invalid login credentials', code: 'invalid_credentials' });
      expect(msg).toMatch(/invalid email or password/i);
    });

    it('formats rate limit error safely', () => {
      const msg = getAuthErrorMessage({ message: 'over_email_send_rate_limit', status: 429 });
      expect(msg).toMatch(/too many.*attempts/i);
    });

    it('formats unconfirmed email safely', () => {
      const msg = getAuthErrorMessage({ message: 'Email not confirmed' });
      expect(msg).toMatch(/email address has not been confirmed/i);
    });

    it('handles unexpected non-object inputs gracefully', () => {
      expect(getAuthErrorMessage(null)).toMatch(/unexpected authentication error/i);
      expect(getAuthErrorMessage('some string')).toMatch(/unexpected authentication error/i);
    });
  });
});
