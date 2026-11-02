/**
 * Merchant Authentication Utilities & Validation
 *
 * Task: M5-T01 — Merchant Supabase Auth Views & Magic Link Flow
 * Specifications:
 *   - docs/SECURITY.md (v1.1) §3 (Authentication Architecture)
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-01, SCR-OWN-02)
 *   - docs/TEST_PLAN.md (v1.1) TC-OWN-01, TC-OWN-02, TC-OWN-03
 */

/**
 * Validates an email address format.
 */
export function validateEmail(email: string): { isValid: boolean; error?: string } {
  const trimmed = email.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Email address is required.' };
  }
  // Standard RFC 5322 compatible email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }
  return { isValid: true };
}

/**
 * Minimum password length required by project specifications.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Validates a password input according to project constraints.
 */
export function validatePassword(password: string): { isValid: boolean; error?: string } {
  if (!password) {
    return { isValid: false, error: 'Password is required.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      isValid: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }
  return { isValid: true };
}

/**
 * Validates that two password inputs match.
 */
export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): { isValid: boolean; error?: string } {
  const passwordResult = validatePassword(password);
  if (!passwordResult.isValid) {
    return passwordResult;
  }
  if (password !== confirmation) {
    return { isValid: false, error: 'Passwords do not match.' };
  }
  return { isValid: true };
}

/**
 * Sanitizes and validates a redirect destination to prevent Open Redirect vulnerabilities.
 * Strictly permits only relative, first-party application paths.
 * Rejects protocol-relative URLs (//attacker.com), javascript: URLs, and external domains.
 */
export function getSafeRedirectUrl(
  candidateUrl: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!candidateUrl || typeof candidateUrl !== 'string') {
    return fallback;
  }

  const trimmed = candidateUrl.trim();

  // Must begin with a single forward slash
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }

  // Must not contain URL schemes or colons (prevents javascript:, data:, https:)
  if (trimmed.includes(':')) {
    return fallback;
  }

  // Permitted prefixes for merchant redirection
  if (trimmed.startsWith('/dashboard') || trimmed === '/') {
    return trimmed;
  }

  return fallback;
}

/**
 * Translates Supabase Auth errors into safe, user-friendly customer messages
 * without leaking internal configuration or account existence metadata.
 */
export function getAuthErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'An unexpected authentication error occurred. Please try again.';
  }

  const err = error as { message?: string; status?: number; code?: string };
  const message = (err.message ?? '').toLowerCase();
  const code = (err.code ?? '').toLowerCase();

  if (
    message.includes('invalid login credentials') ||
    code === 'invalid_credentials' ||
    err.status === 400
  ) {
    return 'Invalid email or password. Please verify your credentials and try again.';
  }

  if (message.includes('rate limit') || code === 'over_email_send_rate_limit' || err.status === 429) {
    return 'Too many sign-in attempts. Please wait a few moments before trying again.';
  }

  if (message.includes('email not confirmed')) {
    return 'Your email address has not been confirmed. Please check your inbox.';
  }

  if (message.includes('network') || message.includes('failed to fetch')) {
    return 'Network connection error. Please check your internet connection and try again.';
  }

  if (message.includes('user not found')) {
    // Anti-enumeration: do not distinguish from invalid credentials on login
    return 'Invalid email or password. Please verify your credentials and try again.';
  }

  if (message.includes('password should be at least')) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }

  return err.message && err.message.length < 120
    ? err.message
    : 'Unable to complete sign in. Please try again later.';
}
