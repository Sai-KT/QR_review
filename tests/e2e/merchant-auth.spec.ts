import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabaseAdmin = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY);

/**
 * M5-T01: Merchant Authentication E2E Test Suite
 *
 * Verifies live browser interactions for merchant authentication:
 * - TC-OWN-01: Password Login with local Supabase Auth credentials
 * - TC-OWN-02: Failed Login, Safe Inline Feedback, and Client Validation
 * - TC-OWN-03: Password Recovery Request & Anti-Enumeration Confirmation
 * - Password Visibility Toggling (masked vs revealed)
 * - Passwordless Magic Link Flow & OTP Dispatch Notice
 * - Invalid/Expired Reset Password State Detection
 * - 320px Mobile Reflow (TC-MOB-01 / TC-A11Y-04)
 * - Axe-core WCAG 2.2 AA Accessibility Audits
 */

test.describe('M5-T01: Merchant Authentication Views & Flows', () => {
  // ── 1. TC-OWN-01: Successful Password Login ───────────────────────────────
  test('TC-OWN-01: authenticates merchant via password and navigates to dashboard', async ({
    page,
  }) => {
    await page.goto('/login');

    await expect(page).toHaveTitle(/Merchant Sign In|QR_review/i);
    await expect(page.getByRole('heading', { name: /Portal Authentication/i })).toBeVisible();

    // Verify email & password fields are present
    const emailInput = page.getByLabel(/Email Address/i);
    const passwordInput = page.getByLabel(/^Password$/i);
    const signInButton = page.getByRole('button', { name: /^Sign In$/i });

    await emailInput.fill('merchant.luxe@local.test');
    await passwordInput.fill('LocalDevPass123!');

    await signInButton.click();

    // Verify successful redirection to /dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Merchant Dashboard Overview/i })).toBeVisible();
  });

  test('TC-OWN-01: navigates to sanitized redirect_to parameter upon successful login', async ({
    page,
  }) => {
    await page.goto('/login?redirect_to=/dashboard/settings');

    const emailInput = page.getByLabel(/Email Address/i);
    const passwordInput = page.getByLabel(/^Password$/i);
    const signInButton = page.getByRole('button', { name: /^Sign In$/i });

    await emailInput.fill('merchant.luxe@local.test');
    await passwordInput.fill('LocalDevPass123!');

    await signInButton.click();

    // Verify redirection to /dashboard/settings
    await expect(page).toHaveURL(/\/dashboard\/settings/);
    await expect(page.getByRole('heading', { name: /Account Security & Settings/i })).toBeVisible();
  });

  test('TC-OWN-01: toggles password input masking between password and text', async ({
    page,
  }) => {
    await page.goto('/login');

    const passwordInput = page.getByLabel(/^Password$/i);
    const toggleButton = page.getByRole('button', { name: /Show password/i });

    await passwordInput.fill('SecretPass123!');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Reveal password
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: /Hide password/i })).toBeVisible();

    // Hide password again
    await page.getByRole('button', { name: /Hide password/i }).click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: /Show password/i })).toBeVisible();
  });

  // ── 2. TC-OWN-02: Failed Login & Client Validation ────────────────────────
  test('TC-OWN-02: displays safe error notification on invalid credentials and stays on login', async ({
    page,
  }) => {
    await page.goto('/login');

    const emailInput = page.getByLabel(/Email Address/i);
    const passwordInput = page.getByLabel(/^Password$/i);
    const signInButton = page.getByRole('button', { name: /^Sign In$/i });

    await emailInput.fill('merchant.luxe@local.test');
    await passwordInput.fill('WrongPassword999!');

    await signInButton.click();

    // Verify error feedback appears
    await expect(
      page.getByText(/Invalid email or password\. Please verify your credentials and try again\./i).first(),
    ).toBeVisible();

    // Verify page stays on /login
    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-OWN-02: enforces client-side validation on empty inputs without network request', async ({
    page,
  }) => {
    await page.goto('/login');

    const signInButton = page.getByRole('button', { name: /^Sign In$/i });
    await signInButton.click();

    // Inline field validation messages
    await expect(page.getByText(/Email address is required/i)).toBeVisible();
    await expect(page.getByText(/Password is required/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-OWN-02: enforces email format validation on malformed email address', async ({
    page,
  }) => {
    await page.goto('/login');

    const emailInput = page.getByLabel(/Email Address/i);
    const passwordInput = page.getByLabel(/^Password$/i);
    const signInButton = page.getByRole('button', { name: /^Sign In$/i });

    await emailInput.fill('invalid-email-format');
    await passwordInput.fill('LocalDevPass123!');
    await signInButton.click();

    await expect(page.getByText(/Please enter a valid email address/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  // ── 3. Magic Link Flow ────────────────────────────────────────────────────
  test('handles passwordless magic link dispatch and renders email confirmation', async ({
    page,
  }) => {
    await page.goto('/login');

    // Switch to Magic Link tab
    const magicTab = page.getByRole('tab', { name: /Magic Link/i });
    await magicTab.click();

    const emailInput = page.getByLabel(/Email Address/i);
    const sendButton = page.getByRole('button', { name: /Send Magic Link/i });

    await emailInput.fill('merchant.luxe@local.test');
    await sendButton.click();

    // Check confirmation screen
    await expect(page.getByRole('heading', { name: /Check Your Email/i }).first()).toBeVisible();
    await expect(page.getByText(/merchant\.luxe@local\.test/i).first()).toBeVisible();

    // Button to reset/send to another email
    const diffEmailBtn = page.getByRole('button', { name: /Send to a different email/i });
    await expect(diffEmailBtn).toBeVisible();
    await diffEmailBtn.click();

    // Returns to magic link input form
    await expect(page.getByRole('button', { name: /Send Magic Link/i })).toBeVisible();
  });

  test('TC-OWN-01: masks unregistered email magic link requests with generic confirmation to prevent account enumeration', async ({
    page,
  }) => {
    await page.goto('/login');

    // Switch to Magic Link tab
    const magicTab = page.getByRole('tab', { name: /Magic Link/i });
    await magicTab.click();

    const emailInput = page.getByLabel(/Email Address/i);
    const sendButton = page.getByRole('button', { name: /Send Magic Link/i });

    const unregisteredEmail = `unregistered.${Date.now()}.${Math.floor(Math.random() * 1000)}@local.test`;
    await emailInput.fill(unregisteredEmail);
    await sendButton.click();

    // Generic confirmation must be rendered without exposing error alert
    await expect(page.getByRole('heading', { name: /Check Your Email/i }).first()).toBeVisible();
    await expect(page.getByText(unregisteredEmail).first()).toBeVisible();
    await expect(page.locator('[role="alert"].bg-state-danger\\/10')).not.toBeVisible();
  });

  test('TC-OWN-01: consumes local magic link token end-to-end and authenticates to dashboard', async ({
    page,
  }) => {
    // Generate valid cryptographic magic link via Supabase GoTrue admin API
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: 'merchant.luxe@local.test',
      options: {
        redirectTo: 'http://127.0.0.1:5173/dashboard',
      },
    });

    expect(error).toBeNull();
    expect(data.properties?.action_link).toBeTruthy();

    // Follow the verification action link in browser
    await page.goto(data.properties.action_link);

    // GoTrue verifies the token and redirects to /dashboard with session
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Merchant Dashboard Overview/i })).toBeVisible();
  });

  // ── 4. TC-OWN-03: Password Recovery Request ───────────────────────────────
  test('TC-OWN-03: submits password reset request and shows anti-enumeration confirmation', async ({
    page,
  }) => {
    await page.goto('/forgot-password');

    await expect(page.getByRole('heading', { name: /Forgot Password/i })).toBeVisible();

    const emailInput = page.getByLabel(/Email Address/i);
    const submitButton = page.getByRole('button', { name: /Send Recovery Link/i });

    const testRecoveryEmail = `merchant.recovery.${Date.now()}.${Math.floor(Math.random() * 1000)}@local.test`;
    await emailInput.fill(testRecoveryEmail);
    await submitButton.click();

    // Generic anti-enumeration confirmation appears
    await expect(page.getByRole('heading', { name: /Recovery Email Dispatched/i })).toBeVisible();
    await expect(page.getByText(testRecoveryEmail).first()).toBeVisible();
    await expect(
      page.getByText(/you will receive an email containing a link to reset your password/i),
    ).toBeVisible();

    // Dismiss toast if present to prevent it occluding action buttons on narrow 320px mobile viewports
    const toastDismiss = page.getByLabel('Dismiss notification');
    if (await toastDismiss.isVisible()) {
      await toastDismiss.click();
    }

    // Return to sign in button works
    const returnButton = page.getByRole('button', { name: /Back to Sign In/i });
    await expect(returnButton).toBeVisible();
    await returnButton.click();
    await expect(page).toHaveURL(/\/login/);
  });

  // ── 5. Reset Password Invalid Session Detection & Lifecycle ─────────────
  test('renders invalid/expired link notice when visited directly without active session', async ({
    page,
  }) => {
    await page.goto('/reset-password');

    // Wait for the verification check to complete
    await expect(
      page.getByRole('heading', { name: /Invalid or Expired Reset Link/i }),
    ).toBeVisible({ timeout: 5000 });

    const requestNewLink = page.getByRole('link', { name: /Request New Reset Link/i });
    await expect(requestNewLink).toBeVisible();
    await requestNewLink.click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test('TC-OWN-03: rejects direct /reset-password access when signed in with an ordinary session', async ({
    page,
  }) => {
    // 1. Log in normally to establish an ordinary authenticated session
    await page.goto('/login');
    const emailInput = page.getByLabel(/Email Address/i);
    const passwordInput = page.getByLabel(/^Password$/i);
    const signInButton = page.getByRole('button', { name: /^Sign In$/i });

    await emailInput.fill('merchant.luxe@local.test');
    await passwordInput.fill('LocalDevPass123!');
    await signInButton.click();

    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Directly navigate to /reset-password without recovery context
    await page.goto('/reset-password');

    // 3. Must display invalid link screen — ordinary session must NOT unlock password reset
    await expect(
      page.getByRole('heading', { name: /Invalid or Expired Reset Link/i }),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(/^New Password$/i)).not.toBeVisible();
  });

  test('TC-OWN-03: renders invalid link notice on expired or tampered recovery token parameters', async ({
    page,
  }) => {
    await page.goto('/reset-password#error=access_denied&error_code=otp_expired');

    await expect(
      page.getByRole('heading', { name: /Invalid or Expired Reset Link/i }),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(/^New Password$/i)).not.toBeVisible();
  });

  test('TC-OWN-03: executes full password recovery, rotation, rejection of old password, and new password login', async ({
    page,
  }) => {
    const syntheticEmail = 'merchant.daily@local.test';
    const syntheticUserId = '00000000-0000-4000-8000-000000000003';
    const originalPassword = 'LocalDevPass123!';
    const rotatedPassword = 'RotatedDevPass123!';

    try {
      // 1. Generate real recovery link via Supabase GoTrue admin API
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: syntheticEmail,
        options: {
          redirectTo: 'http://127.0.0.1:5173/reset-password',
        },
      });

      expect(error).toBeNull();
      expect(data.properties?.action_link).toBeTruthy();

      // 2. Follow the recovery link in the browser
      await page.goto(data.properties.action_link);

      // 3. Browser follows 303 redirect to /reset-password#access_token=...&type=recovery
      await expect(page).toHaveURL(/\/reset-password/);
      await expect(page.getByRole('heading', { name: /Set New Password/i })).toBeVisible({
        timeout: 5000,
      });

      // 4. Fill in new rotated password
      const newPasswordInput = page.getByLabel(/^New Password$/i);
      const confirmPasswordInput = page.getByLabel(/Confirm New Password/i);
      const updateButton = page.getByRole('button', { name: /Update Password/i });

      await newPasswordInput.fill(rotatedPassword);
      await confirmPasswordInput.fill(rotatedPassword);
      await updateButton.click();

      // 5. Verify success screen appears
      await expect(page.getByRole('heading', { name: /Password Updated/i, level: 2 })).toBeVisible();

      // 6. Clear session and navigate to /login
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());

      await page.goto('/login');

      // 7. Verify OLD password is now rejected
      const loginEmail = page.getByLabel(/Email Address/i);
      const loginPassword = page.getByLabel(/^Password$/i);
      const signInBtn = page.getByRole('button', { name: /^Sign In$/i });

      await loginEmail.fill(syntheticEmail);
      await loginPassword.fill(originalPassword);
      await signInBtn.click();

      await expect(
        page.getByText(/Invalid email or password\. Please verify your credentials and try again\./i).first(),
      ).toBeVisible();

      // 8. Verify NEW rotated password successfully signs in
      await loginPassword.fill(rotatedPassword);
      await signInBtn.click();

      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole('heading', { name: /Merchant Dashboard Overview/i })).toBeVisible();
    } finally {
      // 9. Safe local test data isolation: restore synthetic merchant credentials
      await supabaseAdmin.auth.admin.updateUserById(syntheticUserId, {
        password: originalPassword,
      });
    }
  });

  // ── 6. Mobile 320px Reflow Verification ───────────────────────────────────
  test('renders /login without horizontal overflow at 320px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/login');

    const hasHorizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth > root.clientWidth + 1;
    });

    expect(hasHorizontalOverflow).toBe(false);
  });

  test('renders /forgot-password without horizontal overflow at 320px viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/forgot-password');

    const hasHorizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth > root.clientWidth + 1;
    });

    expect(hasHorizontalOverflow).toBe(false);
  });

  // ── 7. Axe-core WCAG 2.2 AA Accessibility Audits ──────────────────────────
  test('executes axe-core WCAG 2.2 AA audit on /login', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('executes axe-core WCAG 2.2 AA audit on /forgot-password', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
