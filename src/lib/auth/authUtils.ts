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
 * Scoped Recovery Session State
 *
 * Tracks whether the active client session originated from a validated Supabase
 * PASSWORD_RECOVERY auth event. Strictly prevents ordinary authenticated sessions
 * or direct visits from accessing or unlocking the password-recovery update form.
 */
let recoverySessionActive = false;

export function isRecoverySessionActive(): boolean {
  return recoverySessionActive;
}

export function markRecoverySessionActive(): void {
  recoverySessionActive = true;
}

export function clearRecoverySession(): void {
  recoverySessionActive = false;
}

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
 * Approved non-sensitive query parameter keys for merchant dashboard views.
 */
export const SAFE_MERCHANT_QUERY_PARAMS = new Set([
  'period',
  'tab',
  'filter',
  'page',
  'sort',
  'view',
  'range',
  'status',
]);

/**
 * Safe UI fragment identifier regex (alphanumeric anchor IDs, strictly no key-value pairs or tokens).
 */
export const SAFE_HASH_REGEX = /^#[a-zA-Z0-9_-]{1,32}$/;

/**
 * Sanitizes and validates a redirect destination to prevent Open Redirect,
 * token-leakage, path traversal, and administrative route bypass vulnerabilities.
 * Strictly permits only relative, first-party merchant application paths.
 * Rejects protocol-relative URLs (//attacker.com), javascript: URLs, external domains,
 * administrative routes (/admin), and strips sensitive tokens from query and hash.
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

  // Strict path traversal defense on the route path component
  const rawPath = trimmed.split(/[?#]/)[0] ?? '';
  if (
    rawPath.includes('..') ||
    rawPath.toLowerCase().includes('%2e%2e') ||
    rawPath.toLowerCase().includes('%2e')
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, 'https://local-auth-guard.test');
    const path = parsed.pathname;

    // Explicitly exclude administrative routes
    if (path === '/admin' || path.startsWith('/admin/')) {
      return fallback;
    }

    // Permitted paths for merchant redirection:
    // Strictly /dashboard, /dashboard/*, or root /
    const isPermittedPath =
      path === '/dashboard' || path.startsWith('/dashboard/') || path === '/';

    if (!isPermittedPath) {
      return fallback;
    }

    // Filter query parameters to strictly non-sensitive, approved keys
    const safeParams = new URLSearchParams();
    parsed.searchParams.forEach((val, key) => {
      const k = key.toLowerCase();
      if (
        SAFE_MERCHANT_QUERY_PARAMS.has(k) &&
        !/token|secret|key|code|auth|session|pass|credential/i.test(val)
      ) {
        safeParams.set(key, val);
      }
    });

    // Filter hash: only permit safe alphanumeric UI anchors, never token key-value pairs
    let safeHash = '';
    if (
      parsed.hash &&
      SAFE_HASH_REGEX.test(parsed.hash) &&
      !/token|secret|key|code|auth|session|pass/i.test(parsed.hash)
    ) {
      safeHash = parsed.hash;
    }

    const q = safeParams.toString();
    return `${path}${q ? `?${q}` : ''}${safeHash}`;
  } catch {
    return fallback;
  }
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

  if (
    message.includes('signups not allowed for otp') ||
    code === 'otp_disabled' ||
    err.status === 422
  ) {
    // Anti-enumeration: mask unregistered email attempt to prevent account enumeration
    return 'If an account exists for this email address, a sign-in link will be sent.';
  }

  if (message.includes('password should be at least')) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }

  return err.message && err.message.length < 120
    ? err.message
    : 'Unable to complete sign in. Please try again later.';
}
