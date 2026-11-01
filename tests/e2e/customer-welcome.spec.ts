import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { performSafeLocalRateLimitReset } from './test-isolation';

test.describe('M3-T05: Customer Welcome Screen & Direct Google Bypass (SCR-CUST-01 & SCR-CUST-09)', () => {
  test.beforeAll(async () => {
    // Strictly fail-closed local test isolation:
    // 1. Verifies exact local endpoint: http://127.0.0.1:54321 (rejecting all https, remote, and spoofed URLs)
    // 2. Verifies canonical local demo service role key (iss=supabase-demo)
    // 3. Targets ONLY the exact hashes for local loopback / Docker bridge runner IPs
    // 4. Executes strictly once in beforeAll per worker, never touching other tests or remote databases
    const resetResult = await performSafeLocalRateLimitReset();
    if (!resetResult.success && resetResult.reason?.includes('Refusing cleanup')) {
      // In non-local environments, cleanup is safely bypassed
      console.warn(`[E2E Preflight] ${resetResult.reason}`);
    }
  });

  // ── 1. Seeded Salon Verification ──────────────────────────────────────────
  test('renders SCR-CUST-01 with live salon branding, category badge, anti-gating bypass, and WhatsApp link', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Exclude simulated unresolvable test domain images (e.g. https://local.test/*)
        if (text.includes('local.test') || text.includes('ERR_NAME_NOT_RESOLVED')) {
          return;
        }
        consoleErrors.push(text);
      }
    });

    await page.goto('/q/luxe000001');

    // Store branding
    await expect(
      page.getByRole('heading', { name: 'Luxe Studio Unisex Salon' }),
    ).toBeVisible({ timeout: 10000 });

    // Category badge
    await expect(page.getByText('Salon', { exact: true })).toBeVisible();

    // Start 30-Second Review CTA
    const startCta = page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i });
    await expect(startCta).toBeVisible();

    // Anti-gating Direct Google Bypass
    const googleBypassBtn = page.getByRole('button', {
      name: /Review Directly on Google Maps ↗/i,
    });
    await expect(googleBypassBtn).toBeVisible();

    // Universal WhatsApp contact link
    const whatsappLink = page.getByRole('link', { name: /Message Manager on WhatsApp/i });
    await expect(whatsappLink).toBeVisible();
    await expect(whatsappLink).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/919876543210\?text=/,
    );

    // Tap Start 30-Second Review CTA -> navigates to ?step=1 (M3-T06 routing contract)
    await startCta.click();
    await expect(page).toHaveURL('/q/luxe000001?step=1');
    await expect(
      page.getByRole('button', { name: /Survey Started \(3 Quick MCQs\)/i }),
    ).toBeVisible();

    // Direct Google bypass remains accessible independently
    await expect(googleBypassBtn).toBeVisible();

    // Footer token
    await expect(
      page.getByText('Active QR token parameter: "luxe000001"'),
    ).toBeVisible();

    // Zero unhandled console errors
    expect(consoleErrors).toEqual([]);
  });

  // ── 2. Seeded Cafe Verification ───────────────────────────────────────────
  test('renders SCR-CUST-01 with live cafe branding and category badge', async ({ page }) => {
    await page.goto('/q/daily00001');

    await expect(
      page.getByRole('heading', { name: 'The Daily Roast Cafe' }),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('Café')).toBeVisible();

    const startCta = page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i });
    await expect(startCta).toBeVisible();
  });

  // ── 3. Direct Google Handoff (?handoff=direct) ────────────────────────────
  test('renders SCR-CUST-09 direct Google handoff launchpad with return agency', async ({
    page,
  }) => {
    await page.goto('/q/luxe000001?handoff=direct');

    // Verify SCR-CUST-09 card
    await expect(page.getByText('Direct Google Review Handoff')).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/You are heading directly to Google Maps to review Luxe Studio Unisex Salon/i),
    ).toBeVisible();

    // Primary action
    const openGoogleBtn = page.getByRole('button', {
      name: /Open Google Maps to Review →/i,
    });
    await expect(openGoogleBtn).toBeVisible();

    // Return to quick survey button
    const backBtn = page.getByRole('button', { name: /← Back to Quick Survey/i });
    await expect(backBtn).toBeVisible();

    // Tap Back button -> returns to SCR-CUST-01
    await backBtn.click();
    await expect(page).toHaveURL('/q/luxe000001');
    await expect(page.getByText('Direct Google Review Handoff')).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }),
    ).toBeVisible();
  });

  // ── 4. Mobile Viewport Reflow (320px) & Touch Targets (>=44px) ───────────
  test('verifies 320px viewport reflow and WCAG touch targets on customer welcome card', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/q/luxe000001');

    await expect(
      page.getByRole('heading', { name: 'Luxe Studio Unisex Salon' }),
    ).toBeVisible({ timeout: 10000 });

    // Assert zero horizontal scrolling on 320px viewport (WCAG 1.4.10 Reflow)
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    // Measure Start CTA touch target height (>= 44px)
    const startCta = page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i });
    const startBox = await startCta.boundingBox();
    expect(startBox).not.toBeNull();
    expect(startBox!.height).toBeGreaterThanOrEqual(44);

    // Measure Direct Google Bypass touch target height (>= 44px)
    const googleBypassBtn = page.getByRole('button', {
      name: /Review Directly on Google Maps ↗/i,
    });
    const bypassBox = await googleBypassBtn.boundingBox();
    expect(bypassBox).not.toBeNull();
    expect(bypassBox!.height).toBeGreaterThanOrEqual(44);

    // Measure WhatsApp contact link touch target height (>= 44px)
    const whatsappLink = page.getByRole('link', { name: /Message Manager on WhatsApp/i });
    const waBox = await whatsappLink.boundingBox();
    expect(waBox).not.toBeNull();
    expect(waBox!.height).toBeGreaterThanOrEqual(44);
  });

  // ── 5. WCAG 2.2 AA Axe Accessibility Audit ────────────────────────────────
  test('executes axe-core WCAG 2.2 AA audit on SCR-CUST-01 and SCR-CUST-09', async ({
    page,
  }) => {
    // Audit SCR-CUST-01
    await page.goto('/q/luxe000001');
    await expect(
      page.getByRole('heading', { name: 'Luxe Studio Unisex Salon' }),
    ).toBeVisible({ timeout: 10000 });

    const auditCust01 = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(auditCust01.violations).toEqual([]);

    // Audit SCR-CUST-09
    await page.goto('/q/luxe000001?handoff=direct');
    await expect(page.getByText('Direct Google Review Handoff')).toBeVisible({ timeout: 10000 });

    const auditCust09 = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(auditCust09.violations).toEqual([]);
  });

  // ── 6. Real HTTP 429 Rate Limit UI Verification ───────────────────────────
  test('renders HTTP 429 rate-limited state with retry and anti-gating search fallback', async ({
    page,
  }) => {
    // Intercept to simulate HTTP 429 ERR_RATE_LIMITED
    await page.route('**/functions/v1/get-public-business*', (route) => {
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Retry-After': '60' },
        body: JSON.stringify({
          error: {
            code: 'ERR_RATE_LIMITED',
            message: 'Too many requests. Please wait before scanning or refreshing again.',
            retryable: true,
          },
        }),
      });
    });

    await page.goto('/q/luxe000001');

    await expect(page.getByText('Unable to Load Review Portal')).toBeVisible();
    await expect(
      page.getByText(/Too many requests\. Please wait before scanning or refreshing again\./i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Try Again/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Search on Google Maps ↗/i })).toBeVisible();
  });
});
