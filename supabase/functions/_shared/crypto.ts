/**
 * Cryptographic Utility for Survey Submission & Generation Binding
 *
 * Task: M3-T03 — Survey Feedback Submission & HMAC Token Issuer
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M3-T03
 *   - docs/API_SPEC.md (v1.2) §7.3, §7.4, §8.1, §8.2
 *   - docs/SECURITY.md (v1.1) §7 (Cryptographic Submission Binding), Gate M0-11
 *
 * Runtime: Dual-compatible with Node.js 20+ and Deno 1.35+/2.x via node:crypto.
 *
 * Enforces:
 *   - Strict 256-bit (32-byte) server-only secret encoded as 64 hexadecimal characters
 *   - HMAC-SHA256 submission token minting and constant-time verification
 *   - Strict 10-minute (600 seconds) token expiration ceiling
 *   - Cryptographic binding to persisted responseId, businessId, sessionUuid, and surveyVersion
 *   - Anti-replay and expiration lock (retries cannot extend the original authorization deadline)
 *   - Timing side-channel immunity via timingSafeEqual over binary digest buffers
 */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const SUBMISSION_TOKEN_TTL_SECONDS = 600; // 10 minutes maximum lifetime
export const MAX_CLOCK_SKEW_TOLERANCE_SECONDS = 30; // 30s clock drift ceiling

export interface SignSubmissionTokenParams {
  responseId: string;
  businessId: string;
  sessionUuid: string;
  surveyVersion: string;
  /** Custom expiration epoch in seconds. Defaults to Date.now() + 600s */
  exp?: number;
  /** Server secret key (64-char hex string). Defaults to SUBMISSION_SIGNING_SECRET env var */
  secret?: string;
}

export interface VerifySubmissionTokenResult {
  valid: boolean;
  responseId?: string;
  exp?: number;
  error?: string;
}

/**
 * Validates and retrieves the server-only cryptographic signing secret.
 * Requires a 32-byte (256-bit) cryptographically strong key encoded as 64 hex characters.
 * Throws a sanitized Error if missing or malformed to fail closed.
 */
export function getSigningSecret(customSecret?: string): string {
  const secret =
    customSecret ??
    (typeof Deno !== 'undefined'
      ? Deno.env.get('SUBMISSION_SIGNING_SECRET')
      : process.env['SUBMISSION_SIGNING_SECRET']);

  if (!secret || typeof secret !== 'string') {
    throw new Error(
      'ERR_CRYPTO_CONFIG: SUBMISSION_SIGNING_SECRET is required and must be configured',
    );
  }

  const trimmed = secret.trim();

  // Enforce 32-byte (256-bit) cryptographically strong key encoded as 64 hexadecimal characters
  if (!/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    throw new Error(
      'ERR_CRYPTO_CONFIG: SUBMISSION_SIGNING_SECRET must be a 64-character hexadecimal string (32-byte 256-bit key)',
    );
  }

  return trimmed.toLowerCase();
}

/**
 * Derives a canonical, immutable survey version fingerprint from question UUIDs.
 * Order-independent: questions are sorted lexicographically before hashing.
 */
export function computeSurveyVersion(questionIds: string[]): string {
  if (!questionIds || questionIds.length === 0) {
    throw new Error('ERR_INVALID_ARGUMENT: questionIds array cannot be empty');
  }
  const sorted = [...questionIds].sort();
  const digest = createHash('sha256').update(sorted.join(':')).digest('hex');
  return `sv_${digest.slice(0, 16)}`;
}

/**
 * Compares two hex-encoded strings in constant time to prevent timing side-channel attacks.
 */
export function constantTimeHexEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length === 0 || bufB.length === 0 || bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Constructs the canonical signature payload string for submission tokens.
 */
export function buildTokenPayload(
  responseId: string,
  businessId: string,
  sessionUuid: string,
  surveyVersion: string,
  exp: number,
): string {
  return `${responseId}:${businessId}:${sessionUuid}:${surveyVersion}:${exp}`;
}

/**
 * Signs and mints an authentic, cryptographically bound submission token.
 * Token format: `<responseId>.<exp>.<signatureHex>`
 */
export function signSubmissionToken(params: SignSubmissionTokenParams): string {
  const { responseId, businessId, sessionUuid, surveyVersion } = params;

  if (!responseId || !businessId || !sessionUuid || !surveyVersion) {
    throw new Error(
      'ERR_INVALID_ARGUMENT: responseId, businessId, sessionUuid, and surveyVersion are required',
    );
  }

  const secretHex = getSigningSecret(params.secret);
  const secretKeyBuffer = Buffer.from(secretHex, 'hex');

  const nowEpoch = Math.floor(Date.now() / 1000);
  const exp = params.exp ?? nowEpoch + SUBMISSION_TOKEN_TTL_SECONDS;

  const payload = buildTokenPayload(
    responseId,
    businessId,
    sessionUuid,
    surveyVersion,
    exp,
  );

  const signatureHex = createHmac('sha256', secretKeyBuffer)
    .update(payload)
    .digest('hex');

  return `${responseId}.${exp}.${signatureHex}`;
}

/**
 * Verifies a submission token against authoritative persisted identifiers.
 *
 * Checks:
 *   1. Token structure (must contain exactly 3 dot-delimited segments)
 *   2. Response UUID integrity
 *   3. Expiration claim (must not be expired and not set into far future)
 *   4. Constant-time signature verification matching bound businessId, sessionUuid, and surveyVersion
 */
export function verifySubmissionToken(
  token: string,
  businessId: string,
  sessionUuid: string,
  surveyVersion: string,
  customSecret?: string,
): VerifySubmissionTokenResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'ERR_MALFORMED_TOKEN: Token must be a non-empty string' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'ERR_MALFORMED_TOKEN: Expected 3 segments' };
  }

  const [responseId, expStr, signatureHex] = parts as [string, string, string];

  if (!responseId || !expStr || !signatureHex) {
    return { valid: false, error: 'ERR_MALFORMED_TOKEN: Token segments cannot be empty' };
  }

  const exp = parseInt(expStr, 10);
  if (Number.isNaN(exp) || !Number.isFinite(exp)) {
    return { valid: false, error: 'ERR_MALFORMED_TOKEN: Expiration must be an integer epoch' };
  }

  const nowEpoch = Math.floor(Date.now() / 1000);

  // Expiration check: strictly rejected if expired
  if (exp <= nowEpoch) {
    return { valid: false, responseId, exp, error: 'ERR_TOKEN_EXPIRED: Token TTL has elapsed' };
  }

  // Future timestamp sanity check (prevents forged far-future tokens)
  if (exp > nowEpoch + SUBMISSION_TOKEN_TTL_SECONDS + MAX_CLOCK_SKEW_TOLERANCE_SECONDS) {
    return {
      valid: false,
      responseId,
      exp,
      error: 'ERR_TOKEN_FUTURE_EXPIRY: Expiration exceeds permitted maximum lifetime',
    };
  }

  let secretHex: string;
  try {
    secretHex = getSigningSecret(customSecret);
  } catch (err) {
    return {
      valid: false,
      responseId,
      exp,
      error: err instanceof Error ? err.message : 'ERR_CRYPTO_CONFIG',
    };
  }

  const secretKeyBuffer = Buffer.from(secretHex, 'hex');

  const payload = buildTokenPayload(
    responseId,
    businessId,
    sessionUuid,
    surveyVersion,
    exp,
  );

  const expectedSignatureHex = createHmac('sha256', secretKeyBuffer)
    .update(payload)
    .digest('hex');

  const matches = constantTimeHexEqual(signatureHex, expectedSignatureHex);

  if (!matches) {
    return {
      valid: false,
      responseId,
      exp,
      error: 'ERR_INVALID_SIGNATURE: Cryptographic signature mismatch or forged binding',
    };
  }

  return { valid: true, responseId, exp };
}
