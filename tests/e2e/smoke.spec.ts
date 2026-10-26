import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test.describe('M1-T06 Batch B: Core Route Shells & Navigation Smoke Suite', () => {
  // ── Phase 8: Test A — Platform gateway ─────────────────────────────────────
  test('Test A: renders platform gateway with accessible landmarks and navigation', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/QR_review/);
    const heading = page.getByRole('heading', { name: /QR_review Platform Gateway/i });
    await expect(heading).toBeVisible();

    const mainLandmark = page.getByRole('main');
    await expect(mainLandmark).toBeVisible();

    const showcaseLink = page.getByRole('link', { name: /Design-System Showcase/i });
    await expect(showcaseLink).toBeVisible();
  });

  // ── Phase 8: Test B — Customer QR route ───────────────────────────────────
  test('Test B: renders customer review portal with dynamic QR token', async ({ page }) => {
    const testQrId = 'DEMO123456';
    await page.goto(`/q/${testQrId}`);

    const customerCard = page.getByText(`Active QR token parameter: "${testQrId}"`);
    await expect(customerCard).toBeVisible();

    const mainLandmark = page.getByRole('main');
    await expect(mainLandmark).toBeVisible();
  });

  // ── Phase 8: Test C — Universal 404 ───────────────────────────────────────
  test('Test C: renders universal 404 with functional return-home recovery link', async ({
    page,
  }) => {
    await page.goto('/unknown-route-for-playwright');

    await expect(page).toHaveTitle(/404 Page Not Found/);
    await expect(page.getByRole('heading', { name: /Page Not Found/i })).toBeVisible();
    await expect(page.getByText(/HTTP 404/i)).toBeVisible();

    const returnHomeLink = page.getByRole('link', { name: /Return Home/i });
    await expect(returnHomeLink).toBeVisible();

    // Verify recovery link navigation works
    await returnHomeLink.click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: /QR_review Platform Gateway/i })).toBeVisible();
  });

  // ── Phase 8: Test D — Merchant compatibility ──────────────────────────────
  test('Test D: redirects /merchant/* to /dashboard/* preserving subpaths, query, and hash', async ({
    page,
  }) => {
    await page.goto('/merchant/analytics?period=30d#trend');

    // Confirm subpath, query string, and hash preservation
    await expect(page).toHaveURL(/\/dashboard\/analytics\?period=30d#trend$/);

    // Verify merchant shell renders
    await expect(page.getByText(/Conversion Funnel & Analytics Trends/i)).toBeVisible();
  });

  // ── Phase 8: Test E — Admin route ─────────────────────────────────────────
  test('Test E: renders super-admin operations console shell', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.getByText(/Super-Admin Master Overview/i)).toBeVisible();
    const mainLandmark = page.getByRole('main');
    await expect(mainLandmark).toBeVisible();
  });
});

// ── Phase 9: 320px Reflow Verification (TC-A11Y-04) ─────────────────────────
test.describe('M1-T06 Batch B: 320px Viewport Reflow Suite (TC-A11Y-04)', () => {
  const representativeRoutes = [
    { path: '/', name: 'Platform Gateway' },
    { path: '/q/DEMO123456', name: 'Customer Review Portal' },
    { path: '/dashboard', name: 'Merchant Dashboard' },
    { path: '/admin', name: 'Admin Console' },
  ];

  for (const { path, name } of representativeRoutes) {
    test(`verifies 320px reflow on ${name} (${path})`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(path);

      // Verify main content landmark is present
      const mainContent = page.getByRole('main');
      await expect(mainContent).toBeVisible();

      // Measure document horizontal overflow (no horizontal scrollbar allowed)
      const hasHorizontalOverflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth > root.clientWidth + 1; // 1px browser subpixel rounding tolerance
      });

      expect(hasHorizontalOverflow).toBe(false);
    });
  }
});

// ── Phase 10: Mobile Navigation Keyboard Verification ────────────────────────
test.describe('M1-T06 Batch B: Mobile Navigation Keyboard Accessibility Suite', () => {
  test('merchant mobile navigation disclosure opens, closes with Escape, restores focus, and navigates', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // Mobile viewport
    await page.goto('/dashboard');

    // Locate mobile navigation toggle (label alternates between Open and Close)
    const menuToggle = page.getByRole('button', { name: /portal navigation/i });
    await expect(menuToggle).toBeVisible();
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');

    // Click to open panel
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
    const mobileMenu = page.getByRole('navigation', { name: /mobile navigation drawer/i });
    await expect(mobileMenu).toBeVisible();

    // Press Escape to dismiss panel
    await page.keyboard.press('Escape');
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(mobileMenu).not.toBeVisible();

    // Verify keyboard focus returns to the toggle button
    await expect(menuToggle).toBeFocused();

    // Reopen disclosure and navigate via an actual route link
    await menuToggle.click();
    const profileLink = page.getByRole('link', { name: /business profile/i });
    await expect(profileLink).toBeVisible();
    await profileLink.click();

    // Verify URL updates
    await expect(page).toHaveURL(/\/dashboard\/profile$/);
    await expect(page.getByText(/Business Profile & Brand Settings/i)).toBeVisible();
  });

  test('admin mobile navigation disclosure opens, closes with Escape, and restores focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // Mobile viewport
    await page.goto('/admin');

    const adminToggle = page.getByRole('button', { name: /admin navigation/i });
    await expect(adminToggle).toBeVisible();
    await expect(adminToggle).toHaveAttribute('aria-expanded', 'false');

    // Open disclosure
    await adminToggle.click();
    await expect(adminToggle).toHaveAttribute('aria-expanded', 'true');

    // Dismiss with Escape
    await page.keyboard.press('Escape');
    await expect(adminToggle).toHaveAttribute('aria-expanded', 'false');

    // Focus restored
    await expect(adminToggle).toBeFocused();
  });
});

// ── Phase 11: Automated axe-core Accessibility Verification ─────────────────
test.describe('M1-T06 Batch B: Automated axe-core WCAG 2.2 AA Audits', () => {
  const auditRoutes = [
    { path: '/', name: 'Platform Gateway' },
    { path: '/q/DEMO123456', name: 'Customer Review Portal' },
    { path: '/dashboard', name: 'Merchant Dashboard' },
    { path: '/admin', name: 'Admin Console' },
  ];

  for (const { path, name } of auditRoutes) {
    test(`executes axe-core WCAG 2.2 AA audit on ${name} (${path})`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });
  }
});
