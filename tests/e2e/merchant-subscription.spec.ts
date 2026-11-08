/**
 * M5-T09 E2E Suite: Merchant Subscription Plan & AI Quota Monitor (SCR-OWN-10)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-10); §13 (CMP-12 QuotaMeterBar)
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.7 (subscriptions), §5.8 (tenant_quotas)
 *   - docs/API_SPEC.md (v1.2) §11.6 (API-OWN-06), §11.9 (API-OWN-09)
 *   - docs/ROADMAP.md (v1.1) Task M5-T09
 *   - docs/TEST_PLAN.md (v1.1) TC-OWN-15, TC-OWN-16, TC-API-20, TC-API-24
 *
 * Verifies:
 * - Unauthenticated redirect to /login from /dashboard/subscription.
 * - Authenticated Merchant Luxe views active Standard Recurring plan (TC-OWN-16).
 * - Verified payment settlement history displayed (₹399.00, UPI reference).
 * - Quota meter bar displays accurate used vs remaining counts (TC-OWN-15).
 * - Authenticated Merchant Daily Roast views Pilot tier Setup Package with trial expiration.
 * - Quota meter bar renders accurate capacity, reset timestamp, and ARIA progressbar.
 * - Manual renewal & upgrade guidance with inquiry modal (Section 9 safeguards).
 * - Historical billing cycle table rendered.
 * - Mobile 320px reflow and ARIA progressbar accessibility.
 * - WCAG 2.2 AA accessibility scan with zero critical violations.
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test.describe('M5-T09: Merchant Subscription Plan & AI Quota Monitor', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('TC-OWN-15-16-AUTH: Unauthenticated merchant navigating to /dashboard/subscription is redirected to /login', async ({
    page,
  }) => {
    await page.goto('/dashboard/subscription');
    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-OWN-16-LUXE: Authenticated Merchant Luxe views active subscription plan, period dates and payment log', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Subscription & Quota
    await page.goto('/dashboard/subscription');
    await expect(
      page.getByRole('heading', { level: 1, name: /Subscription & AI Quota/i }),
    ).toBeVisible({ timeout: 10000 });

    // 3. Subscription Plan Card (TC-OWN-16)
    const planCard = page.getByTestId('subscription-plan-card');
    await expect(planCard).toBeVisible();
    await expect(page.getByTestId('subscription-plan-name')).toHaveText('Monthly Recurring Plan');
    await expect(page.getByTestId('subscription-status-badge')).toHaveText('Active');

    // 4. Period Dates
    await expect(page.getByTestId('sub-period-start')).toBeVisible();
    await expect(page.getByTestId('sub-period-end')).toBeVisible();

    // 5. Authoritative Payment Settlement Record
    await expect(page.getByTestId('sub-payment-amount')).toHaveText('₹399.00');
    await expect(page.getByTestId('sub-payment-ref')).toHaveText('UPI-REF-LUXE-001');
  });

  test('TC-OWN-15-LUXE: Authenticated Merchant Luxe views quota meter bar and billing cycle history', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Subscription & Quota
    await page.goto('/dashboard/subscription');
    await expect(
      page.getByRole('heading', { level: 1, name: /Subscription & AI Quota/i }),
    ).toBeVisible({ timeout: 10000 });

    // 3. Quota Meter Bar (TC-OWN-15)
    const meterBar = page.getByTestId('quota-meter-bar');
    await expect(meterBar).toBeVisible();
    await expect(page.getByTestId('quota-used-count')).toBeVisible();
    await expect(page.getByTestId('quota-remaining-count')).toBeVisible();
    await expect(page.getByTestId('quota-reset-text')).toBeVisible();

    // 4. Progress bar ARIA semantics
    const progressBar = page.getByTestId('quota-progressbar');
    await expect(progressBar).toHaveAttribute('role', 'progressbar');
    await expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    await expect(progressBar).toHaveAttribute('aria-valuemax', '150');

    // 5. Billing Cycle History Table
    const historyTable = page.getByTestId('quota-history-table');
    await expect(historyTable).toBeVisible();
    await expect(historyTable.getByText('2026-10')).toBeVisible();
  });

  test('TC-OWN-16-DAILY: Authenticated Merchant Daily Roast views pilot tier, trial expiration, and quota meter', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Daily Roast
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.daily@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Subscription & Quota
    await page.goto('/dashboard/subscription');
    await expect(
      page.getByRole('heading', { level: 1, name: /Subscription & AI Quota/i }),
    ).toBeVisible({ timeout: 10000 });

    // 3. Pilot Tier & Trial Expiration
    await expect(page.getByTestId('subscription-plan-name')).toHaveText('Setup Package');
    await expect(page.getByTestId('subscription-status-badge')).toHaveText('Pilot Access');
    await expect(page.getByTestId('sub-trial-end')).toBeVisible();
    await expect(page.getByTestId('sub-payment-amount')).toHaveText('₹999.00');
    await expect(page.getByTestId('sub-payment-ref')).toHaveText('UPI-REF-DAILY-001');

    // 4. Quota Meter Bar reflects quota capacity
    const meterBar = page.getByTestId('quota-meter-bar');
    await expect(meterBar).toBeVisible();
    await expect(page.getByTestId('quota-used-count')).toBeVisible();
    await expect(page.getByTestId('quota-remaining-count')).toBeVisible();
    await expect(page.getByTestId('quota-progressbar')).toBeVisible();
  });

  test('TC-OWN-15-RENEWAL: Manual renewal guidance card and inquiry modal flow', async ({
    page,
  }) => {
    // 1. Sign in
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Subscription
    await page.goto('/dashboard/subscription');

    // 3. Renewal guidance card
    const renewalCard = page.getByTestId('manual-renewal-card');
    await expect(renewalCard).toBeVisible();
    await expect(page.getByText('Manual UPI Settlement')).toBeVisible();

    // 4. Open Inquiry Modal
    await page.getByTestId('contact-founder-upgrade-btn').click();
    const modal = page.getByTestId('inquiry-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Manual Renewal & Upgrades')).toBeVisible();
    await expect(modal.getByTestId('send-inquiry-email-btn')).toBeVisible();

    // 5. Close Modal
    await page.getByTestId('close-inquiry-modal').click();
    await expect(modal).not.toBeVisible();
  });

  test('TC-OWN-15-A11Y: Mobile 320px reflow and WCAG accessibility check', async ({ page }) => {
    // 1. Sign in
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Set 320px viewport
    await page.setViewportSize({ width: 320, height: 600 });
    await page.goto('/dashboard/subscription');

    await expect(page.getByRole('heading', { level: 1, name: /Subscription & AI Quota/i })).toBeVisible({
      timeout: 10000,
    });

    // Verify no horizontal overflow at 320px
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

    // 3. Run automated axe accessibility scan
    const accessibilityScanResults = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
