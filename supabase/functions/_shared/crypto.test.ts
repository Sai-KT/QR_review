import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeSurveyVersion,
  signSubmissionToken,
  verifySubmissionToken,
  constantTimeHexEqual,
  getSigningSecret,
  SUBMISSION_TOKEN_TTL_SECONDS,
} from './crypto';

describe('Shared Cryptographic Utility (M3-T03 / TC-SEC-03)', () => {
  // 32 bytes (256 bits) encoded as 64 hexadecimal characters
  const mockSecret =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const originalEnv = process.env['SUBMISSION_SIGNING_SECRET'];

  const mockResponseId = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a';
  const mockBusinessId = '4a6b8c0d-1234-4000-8000-000000000001';
  const mockSessionUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const mockSurveyVersion = 'sv_e9f2a4b8c1d3e5f7';

  beforeEach(() => {
    process.env['SUBMISSION_SIGNING_SECRET'] = mockSecret;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['SUBMISSION_SIGNING_SECRET'] = originalEnv;
    } else {
      delete process.env['SUBMISSION_SIGNING_SECRET'];
    }
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Signing Secret Configuration & Validation                             */
  /* ------------------------------------------------------------------------ */

  describe('getSigningSecret', () => {
    it('returns custom 64-character hex secret when validly provided', () => {
      const custom =
        'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      expect(getSigningSecret(custom)).toBe(custom);
    });

    it('returns environment secret when no custom secret is provided', () => {
      expect(getSigningSecret()).toBe(mockSecret);
    });

    it('throws sanitized configuration error when secret is missing', () => {
      delete process.env['SUBMISSION_SIGNING_SECRET'];
      expect(() => getSigningSecret()).toThrow(/ERR_CRYPTO_CONFIG/);
    });

    it('throws sanitized configuration error when secret is not 64 hex characters (256-bit)', () => {
      expect(() => getSigningSecret('too-short')).toThrow(/ERR_CRYPTO_CONFIG/);
      expect(() =>
        getSigningSecret(
          'not-hex-characters-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        ),
      ).toThrow(/ERR_CRYPTO_CONFIG/);
      // 63 characters (1 character short)
      expect(() =>
        getSigningSecret(
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde',
        ),
      ).toThrow(/ERR_CRYPTO_CONFIG/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Survey Version Derivation                                             */
  /* ------------------------------------------------------------------------ */

  describe('computeSurveyVersion', () => {
    const q1 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c';
    const q2 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d';
    const q3 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e';

    it('derives a deterministic version string starting with sv_', () => {
      const v = computeSurveyVersion([q1, q2, q3]);
      expect(v).toMatch(/^sv_[a-f0-9]{16}$/);
    });

    it('is order-independent (shuffled question arrays yield identical version)', () => {
      const v1 = computeSurveyVersion([q1, q2, q3]);
      const v2 = computeSurveyVersion([q3, q1, q2]);
      const v3 = computeSurveyVersion([q2, q3, q1]);
      expect(v1).toBe(v2);
      expect(v2).toBe(v3);
    });

    it('yields different version strings for different question sets', () => {
      const qAlt = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b99';
      const v1 = computeSurveyVersion([q1, q2, q3]);
      const v2 = computeSurveyVersion([q1, q2, qAlt]);
      expect(v1).not.toBe(v2);
    });

    it('throws error when question list is empty', () => {
      expect(() => computeSurveyVersion([])).toThrow(/ERR_INVALID_ARGUMENT/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Constant-Time Hex Equality                                            */
  /* ------------------------------------------------------------------------ */

  describe('constantTimeHexEqual', () => {
    it('returns true for identical valid hex strings', () => {
      const hex = 'a1b2c3d4e5f6';
      expect(constantTimeHexEqual(hex, hex)).toBe(true);
    });

    it('returns false for mismatched hex strings of equal length', () => {
      expect(constantTimeHexEqual('a1b2c3d4e5f6', 'a1b2c3d4e5f0')).toBe(false);
    });

    it('returns false for hex strings of differing length', () => {
      expect(constantTimeHexEqual('a1b2c3', 'a1b2c3d4')).toBe(false);
    });

    it('returns false safely on invalid input or empty strings', () => {
      expect(constantTimeHexEqual('', '')).toBe(false);
      // @ts-expect-error Defensive runtime handling
      expect(constantTimeHexEqual(null, 'abc')).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Token Minting and Successful Verification                             */
  /* ------------------------------------------------------------------------ */

  describe('signSubmissionToken & verifySubmissionToken', () => {
    it('mints a three-segment dot-delimited token that verifies successfully', () => {
      const token = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
      });

      expect(typeof token).toBe('string');
      const parts = token.split('.');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe(mockResponseId);

      const verification = verifySubmissionToken(
        token,
        mockBusinessId,
        mockSessionUuid,
        mockSurveyVersion,
      );

      expect(verification.valid).toBe(true);
      expect(verification.responseId).toBe(mockResponseId);
      expect(verification.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(verification.error).toBeUndefined();
    });

    it('preserves an explicit custom expiration epoch', () => {
      const customExp = Math.floor(Date.now() / 1000) + 300;
      const token = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
        exp: customExp,
      });

      const verification = verifySubmissionToken(
        token,
        mockBusinessId,
        mockSessionUuid,
        mockSurveyVersion,
      );

      expect(verification.valid).toBe(true);
      expect(verification.exp).toBe(customExp);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Expiration and Replay Attacks                                         */
  /* ------------------------------------------------------------------------ */

  describe('Token Expiration & Anti-Replay Protections', () => {
    it('rejects an expired token (exp <= now)', () => {
      const pastExp = Math.floor(Date.now() / 1000) - 10; // Expired 10s ago
      const token = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
        exp: pastExp,
      });

      const result = verifySubmissionToken(
        token,
        mockBusinessId,
        mockSessionUuid,
        mockSurveyVersion,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/ERR_TOKEN_EXPIRED/);
    });

    it('rejects tokens claiming far-future expiration beyond permitted ceiling', () => {
      const futureExp =
        Math.floor(Date.now() / 1000) + SUBMISSION_TOKEN_TTL_SECONDS + 100;
      const token = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
        exp: futureExp,
      });

      const result = verifySubmissionToken(
        token,
        mockBusinessId,
        mockSessionUuid,
        mockSurveyVersion,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/ERR_TOKEN_FUTURE_EXPIRY/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Tampering & Cross-Tenant Binding Protections                          */
  /* ------------------------------------------------------------------------ */

  describe('Cryptographic Binding and Tamper Rejection', () => {
    it('rejects token when cryptographic signature is altered', () => {
      const token = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
      });

      const parts = token.split('.');
      // Tamper with signature
      const tamperedSignature =
        parts[2]!.slice(0, -2) + (parts[2]!.endsWith('aa') ? 'bb' : 'aa');
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSignature}`;

      const result = verifySubmissionToken(
        tamperedToken,
        mockBusinessId,
        mockSessionUuid,
        mockSurveyVersion,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/ERR_INVALID_SIGNATURE/);
    });

    it('rejects token when attempting cross-tenant substitution (wrong businessId)', () => {
      const token = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
      });

      const maliciousBusinessId = '99999999-9999-4000-8000-999999999999';
      const result = verifySubmissionToken(
        token,
        maliciousBusinessId,
        mockSessionUuid,
        mockSurveyVersion,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/ERR_INVALID_SIGNATURE/);
    });

    it('rejects token when attempting cross-session reuse (wrong sessionUuid)', () => {
      const token = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
      });

      const differentSessionUuid = '11111111-2222-4333-8444-555555555555';
      const result = verifySubmissionToken(
        token,
        mockBusinessId,
        differentSessionUuid,
        mockSurveyVersion,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/ERR_INVALID_SIGNATURE/);
    });

    it('rejects token when attempting survey-version substitution (wrong surveyVersion)', () => {
      const token = signSubmissionToken({
        responseId: mockResponseId,
        businessId: mockBusinessId,
        sessionUuid: mockSessionUuid,
        surveyVersion: mockSurveyVersion,
      });

      const swappedVersion = 'sv_0000000000000000';
      const result = verifySubmissionToken(
        token,
        mockBusinessId,
        mockSessionUuid,
        swappedVersion,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/ERR_INVALID_SIGNATURE/);
    });

    it('rejects malformed token strings safely', () => {
      expect(
        verifySubmissionToken(
          'not-a-token',
          mockBusinessId,
          mockSessionUuid,
          mockSurveyVersion,
        ).valid,
      ).toBe(false);
      expect(
        verifySubmissionToken(
          'a.b',
          mockBusinessId,
          mockSessionUuid,
          mockSurveyVersion,
        ).valid,
      ).toBe(false);
      expect(
        verifySubmissionToken(
          'a.b.c.d',
          mockBusinessId,
          mockSessionUuid,
          mockSurveyVersion,
        ).valid,
      ).toBe(false);
      expect(
        verifySubmissionToken(
          'respId.notanumber.sig',
          mockBusinessId,
          mockSessionUuid,
          mockSurveyVersion,
        ).valid,
      ).toBe(false);
    });
  });
});
