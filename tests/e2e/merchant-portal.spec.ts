import { test, expect } from '@playwright/test';

/**
 * M5-T02: Merchant Portal Navigation Shell & Auth Guard (SCR-OWN-03)
 *
 * Verifies:
 * - TC-OWN-04: Authenticated merchant sees their authorized business profile in portal shell.
 * - TC-OWN-17: Merchant session sign-out clears credentials and redirects safely to /login.
 * - TC-OWN-18: Cross-tenant isolation (Owner A only sees Owner A's business, Owner B sees Owner B's).
 * - Unauthenticated route guard redirects /dashboard/* routes to /login.
 * - Responsive layout rendering without horizontal overflow at 320px.
 */

test.describe('M5-T02: Merchant Portal Navigation Shell & Auth Guard', () => {
  test.beforeEach(async ({ context }) => {
    // Start with a clean storage state
    await context.clearCookies();
  });

  test('Scenario 1: Unauthenticated visit to /dashboard redirects safely to /login', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /Portal Authentication/i })).toBeVisible();

    // Verify protected dashboard content is NOT rendered
    await expect(page.getByTestId('merchant-business-name')).not.toBeVisible();
  });

  test('Scenario 2: Unauthenticated visit to sub-routes (/dashboard/profile, /dashboard/qr) redirects to /login with redirect_to', async ({
    page,
  }) => {
    await page.goto('/dashboard/profile');
    await expect(page).toHaveURL(/\/login\?redirect_to=%2Fdashboard%2Fprofile/);

    await page.goto('/dashboard/qr');
    await expect(page).toHaveURL(/\/login\?redirect_to=%2Fdashboard%2Fqr/);

    await page.goto('/dashboard/feedback');
    await expect(page).toHaveURL(/\/login\?redirect_to=%2Fdashboard%2Ffeedback/);
  });

  test('Scenario 2b: Unauthenticated visit to /dashboard/analytics redirects to login with return path and returns post-auth', async ({
    page,
  }) => {
    // 1. Visit /dashboard/analytics while unauthenticated
    await page.goto('/dashboard/analytics');

    // 2. Verify redirect to login with encoded redirect_to parameter
    await expect(page).toHaveURL(/\/login\?redirect_to=%2Fdashboard%2Fanalytics/);
    await expect(page.getByRole('heading', { name: /Portal Authentication/i })).toBeVisible();

    // 3. Sign in with synthetic local merchant account
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();

    // 4. Verify return to the originally requested authorized route (/dashboard/analytics)
    await expect(page).toHaveURL(/\/dashboard\/analytics$/);
    await expect(
      page.getByRole('heading', {
        name: /Funnel Analytics|Conversion Funnel & Analytics Trends/i,
      }),
    ).toBeVisible();
  });

  test('Scenario 2c: Open-redirect attempt to external URL falls back safely to /dashboard', async ({
    page,
  }) => {
    await page.goto('/login?redirect_to=https://evil.com/phishing');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();

    // Must safely fallback to /dashboard, NOT external URL
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Merchant Dashboard Overview/i })).toBeVisible();
  });

  test('Scenario 2d: Check A - Token fragment in protected URL is never copied into /login query parameters', async ({
    page,
  }) => {
    // 1. Visit /dashboard with mock token fragment while unauthenticated
    await page.goto(
      '/dashboard#access_token=sensitive_jwt_token_12345&refresh_token=secret_refresh_67890&type=recovery',
    );

    // 2. Must redirect to /login WITHOUT tokens in the query string
    await expect(page).toHaveURL(/\/login$/);
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('access_token');
    expect(currentUrl).not.toContain('refresh_token');

    // 3. Visit /dashboard/analytics with token fragment while unauthenticated
    await page.goto(
      '/dashboard/analytics#access_token=sensitive_jwt_token_12345&refresh_token=secret_refresh_67890',
    );

    // 4. Must redirect to /login with clean redirect_to parameter preserving route but omitting token
    await expect(page).toHaveURL(/\/login\?redirect_to=%2Fdashboard%2Fanalytics$/);
    const subpathUrl = page.url();
    expect(subpathUrl).not.toContain('access_token');
    expect(subpathUrl).not.toContain('refresh_token');
  });

  test('Scenario 2e: Check B - Path traversal and /admin targets are strictly excluded from post-login redirect', async ({
    page,
  }) => {
    // 1. Attempt login with path traversal targeting administrative console
    await page.goto('/login?redirect_to=/dashboard/../admin');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();

    // Must safely fallback to /dashboard, NOT /admin
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Merchant Dashboard Overview/i })).toBeVisible();

    // 2. Attempt login with direct /admin target
    await page.goto('/login?redirect_to=/admin');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('Scenario 3: TC-OWN-04 - Authenticated merchant sees authorized business name and status in sidebar', async ({
    page,
  }) => {
    // Sign in as merchant.luxe@local.test
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();

    // Reaches /dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // Business identity is loaded from API-OWN-01 via RLS (check visible name in desktop sidebar or mobile header)
    const businessName = page.locator(
      '[data-testid="merchant-business-name"]:visible, [data-testid="merchant-mobile-business-name"]:visible',
    );
    await expect(businessName).toBeVisible({ timeout: 10000 });
    await expect(businessName).toHaveText(/Luxe Studio Unisex Salon/i);

    // Verify status badge (visible in desktop sidebar or mobile header)
    await expect(page.getByText(/active/i).filter({ visible: true }).first()).toBeVisible();

    // Verify navigation links are rendered
    await expect(page.getByRole('link', { name: /Overview/i }).filter({ visible: true }).first()).toBeVisible();
  });

  test('Scenario 4: TC-OWN-17 - Sign-out terminates session, clears merchant state, and redirects to /login', async ({
    page,
  }) => {
    // 1. Sign in
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Click sign-out button (either desktop sidebar or mobile drawer)
    const desktopSignOut = page.locator('[data-testid="merchant-sign-out-btn"]:visible');
    if (await desktopSignOut.isVisible()) {
      await desktopSignOut.click();
    } else {
      // Open mobile drawer then click sign out
      await page.getByTestId('merchant-mobile-menu-toggle').click();
      await page.getByTestId('merchant-mobile-sign-out-btn').click();
    }

    // 3. Verifies redirect to /login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /Portal Authentication/i })).toBeVisible();

    // 4. Visiting /dashboard again immediately redirects back to /login
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('Scenario 5: TC-OWN-18 - Tenant Isolation: Merchant A and Merchant B see strictly their own businesses', async ({
    browser,
  }) => {
    // Context A: Merchant Luxe
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto('/login');
    await pageA.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await pageA.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await pageA.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(pageA).toHaveURL(/\/dashboard/);

    const businessNameA = pageA.locator(
      '[data-testid="merchant-business-name"]:visible, [data-testid="merchant-mobile-business-name"]:visible',
    );
    await expect(businessNameA).toHaveText(/Luxe Studio Unisex Salon/i);
    // Merchant A must NOT see Merchant B's business name
    await expect(pageA.getByText(/The Daily Roast Cafe/i)).not.toBeVisible();

    // Context B: Merchant Daily
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto('/login');
    await pageB.getByLabel(/Email Address/i).fill('merchant.daily@local.test');
    await pageB.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await pageB.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(pageB).toHaveURL(/\/dashboard/);

    const businessNameB = pageB.locator(
      '[data-testid="merchant-business-name"]:visible, [data-testid="merchant-mobile-business-name"]:visible',
    );
    await expect(businessNameB).toHaveText(/The Daily Roast Cafe/i);
    // Merchant B must NOT see Merchant A's business name
    await expect(pageB.getByText(/Luxe Studio Unisex Salon/i)).not.toBeVisible();

    await contextA.close();
    await contextB.close();
  });

  test('Scenario 6: Mobile 320px reflow and touch navigation accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });

    // Sign in
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Check no horizontal scrollbar on body
    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(isOverflowing).toBe(false);

    // Verify mobile header and toggle button exist
    const toggleBtn = page.getByTestId('merchant-mobile-menu-toggle');
    await expect(toggleBtn).toBeVisible();

    // Toggle drawer open
    await toggleBtn.click();
    await expect(page.getByTestId('merchant-mobile-sign-out-btn')).toBeVisible();

    // Press Escape to dismiss
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('merchant-mobile-sign-out-btn')).not.toBeVisible();
  });
});
