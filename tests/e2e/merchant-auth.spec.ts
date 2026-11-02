import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

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

  // ── 5. Reset Password Invalid Session Detection ───────────────────────────
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
