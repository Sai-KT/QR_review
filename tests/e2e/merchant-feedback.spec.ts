/**
 * M5-T07 E2E Suite: Merchant Feedback Feed & Privacy-Purged Note Indicators (SCR-OWN-08 / CMP-13)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.3 (SCR-OWN-08); §13 (CMP-13)
 *   - docs/ROADMAP.md (v1.1) Task M5-T07
 *   - docs/SECURITY.md (v1.1) §4 Multi-Tenancy & Tenant Isolation; §12 DPDPA Customer Note Privacy
 *   - docs/API_SPEC.md (v1.2) API-OWN-05
 *
 * Verifies:
 * - TC-OWN-13: Unauthenticated redirect to /login from /dashboard/feedback.
 * - Authenticated merchant loads Customer Feedback Stream (SCR-OWN-08).
 * - Displays summary metric strip (Total, Positive, Neutral, Needs Attention).
 * - Customer note privacy states per Founder Decision M0-01 (DPDPA 30-day retention):
 *     * Case A: Retained active note renders customer text in quote block.
 *     * Case B: Purged note renders accessible badge [Personal note expired per privacy policy] + DPDPA explanation.
 *     * Case C: No note provided renders "No additional note provided." without purge indicator.
 * - Sentiment filtering: tab switching dynamically filters feed.
 * - Search filtering: client-side search across notes and affirmed facts.
 * - Cross-tenant isolation: Merchant 1 (Luxe) cannot view Merchant 2 (Daily Roast) feedback and vice versa.
 * - Mobile responsive 320px reflow without horizontal scroll.
 * - WCAG 2.2 AA accessibility scan with zero violations.
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test.describe('M5-T07: Merchant Feedback Feed & Privacy-Purged Note Indicators', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('TC-OWN-13: Unauthenticated merchant navigating to /dashboard/feedback is redirected to /login', async ({
    page,
  }) => {
    await page.goto('/dashboard/feedback');
    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-OWN-14: Authenticated merchant loads feedback stream, metrics, and affirms experiences', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Customer Feedback Stream
    await page.goto('/dashboard/feedback');
    await expect(
      page.getByRole('heading', { level: 1, name: /Customer Feedback Stream/i }),
    ).toBeVisible();
    await expect(page.getByText('SCR-OWN-08')).toBeVisible();

    // 3. Verify Metrics Strip
    const metricsStrip = page.getByTestId('feedback-metrics-strip');
    await expect(metricsStrip).toBeVisible();
    await expect(page.getByTestId('metric-total-feedback')).toBeVisible();
    await expect(page.getByTestId('metric-positive-feedback')).toBeVisible();
    await expect(page.getByTestId('metric-neutral-feedback')).toBeVisible();
    await expect(page.getByTestId('metric-critical-feedback')).toBeVisible();

    // 4. Verify Feedback Cards are rendered
    const cards = page.getByTestId('feedback-card-item');
    await expect(cards.first()).toBeVisible();

    // 5. Verify Affirmed Facts section and option texts
    await expect(page.getByText(/Affirmed Experience Facts/i).first()).toBeVisible();
  });

  test('TC-PRIV-01: Customer note privacy lifecycle cases (Retained, Purged, and No Note)', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Feedback feed
    await page.goto('/dashboard/feedback');
    await expect(
      page.getByRole('heading', { level: 1, name: /Customer Feedback Stream/i }),
    ).toBeVisible();

    // Case A: Retained active customer note
    const retainedNotes = page.getByTestId('feedback-note-retained');
    await expect(retainedNotes.first()).toBeVisible();
    await expect(
      page.getByText(/Loved the styling and warm hospitality/i).first(),
    ).toBeVisible();

    // Case B: Privacy-purged customer note indicator
    // If recent test submissions have pushed historical purged notes to subsequent pages, paginate to locate it
    let purgedNotes = page.getByTestId('feedback-note-purged');
    let paginatedInPriv = false;
    if (!(await purgedNotes.first().isVisible())) {
      const nextBtn = page.getByTestId('btn-pagination-next');
      if ((await nextBtn.isVisible()) && (await nextBtn.isEnabled())) {
        await nextBtn.click();
        await expect(page.getByTestId('feedback-cards-container')).toBeVisible();
        purgedNotes = page.getByTestId('feedback-note-purged');
        paginatedInPriv = true;
      }
    }
    await expect(purgedNotes.first()).toBeVisible();
    await expect(
      page.getByText('[Personal note expired per privacy policy]').first(),
    ).toBeVisible();
    await expect(
      page.getByText(/Customer notes are automatically expunged after 30 days/i).first(),
    ).toBeVisible();

    // Case C: No note provided
    const noNotes = page.getByTestId('feedback-note-none');
    await expect(noNotes.first()).toBeVisible();
    await expect(page.getByText('No additional note provided.').first()).toBeVisible();

    // Return to page 1 if paginated
    if (paginatedInPriv) {
      const prevBtn = page.getByTestId('btn-pagination-prev');
      if ((await prevBtn.isVisible()) && (await prevBtn.isEnabled())) {
        await prevBtn.click();
        await expect(page.getByTestId('feedback-cards-container')).toBeVisible();
      }
    }
  });

  test('TC-OWN-15: Multi-criteria filtering by sentiment and keyword search', async ({ page }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/feedback');

    // 2. Filter by "Needs Attention" sentiment tab
    const criticalTab = page.getByTestId('sentiment-tab-critical');
    await criticalTab.click();

    // If recent test submissions have pushed critical items to subsequent pages, paginate to locate it
    let criticalText = page.getByText(/Waited 45 mins past appointment/i);
    let paginatedInSearch = false;
    if (!(await criticalText.first().isVisible())) {
      const nextBtn = page.getByTestId('btn-pagination-next');
      if ((await nextBtn.isVisible()) && (await nextBtn.isEnabled())) {
        await nextBtn.click();
        await expect(page.getByTestId('feedback-cards-container')).toBeVisible();
        criticalText = page.getByText(/Waited 45 mins past appointment/i);
        paginatedInSearch = true;
      }
    }

    // Verify critical feedback is shown
    await expect(criticalText.first()).toBeVisible();
    await expect(page.getByTestId('badge-sentiment-critical').first()).toBeVisible();

    // Verify positive feedback is filtered out
    await expect(page.getByText(/Loved the styling and warm hospitality/i)).not.toBeVisible();

    // 3. Switch back to "All" sentiment
    await page.getByTestId('sentiment-tab-all').click();

    // Return to page 1 if paginated
    if (paginatedInSearch) {
      const prevBtn = page.getByTestId('btn-pagination-prev');
      if ((await prevBtn.isVisible()) && (await prevBtn.isEnabled())) {
        await prevBtn.click();
        await expect(page.getByTestId('feedback-cards-container')).toBeVisible();
      }
    }

    await expect(
      page.getByText(/Loved the styling and warm hospitality/i).first(),
    ).toBeVisible();

    // 4. Test Client Search by Keyword
    const searchInput = page.getByTestId('feedback-search-input');
    await searchInput.fill('styling and warm hospitality');

    await expect(
      page.getByText(/Loved the styling and warm hospitality/i).first(),
    ).toBeVisible();
    await expect(page.getByText(/Waited 45 mins past appointment/i)).not.toBeVisible();

    // 5. Test Non-matching Search Keyword -> Empty State
    await searchInput.fill('xyz-nonexistent-query-123');
    await expect(page.getByTestId('feedback-no-matches')).toBeVisible();
    await expect(page.getByText(/No Feedback Matches Your Criteria/i)).toBeVisible();

    // Reset Filters button
    await page.getByTestId('btn-reset-filters').click();
    await expect(
      page.getByText(/Loved the styling and warm hospitality/i).first(),
    ).toBeVisible();
  });

  test('TC-SEC-08: Cross-Tenant Isolation: Merchant cannot view another merchant feedback records', async ({
    page,
  }) => {
    // 1. Sign in as Luxe Studio
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/feedback');
    await expect(
      page.getByRole('heading', { level: 1, name: /Customer Feedback Stream/i }),
    ).toBeVisible();

    // Luxe Studio should see salon affirmed facts / notes
    await expect(
      page.getByText(/Loved the styling and warm hospitality/i).first(),
    ).toBeVisible();

    // Luxe Studio must NEVER see Daily Roast feedback
    await expect(
      page.getByText(/Great pour-over coffee and peaceful workspace/i),
    ).not.toBeVisible();
    await expect(page.getByText(/Specialty coffee & espresso/i)).not.toBeVisible();

    // 2. Sign out and sign in as Daily Roast
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.daily@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/feedback');
    await expect(
      page.getByRole('heading', { level: 1, name: /Customer Feedback Stream/i }),
    ).toBeVisible();

    // Daily Roast should see cafe feedback
    await expect(page.getByText(/Specialty coffee & espresso/i).first()).toBeVisible();
    await expect(
      page.getByText(/Beverage was cold and service took too long/i).first(),
    ).toBeVisible();

    // Daily Roast must NEVER see Luxe Studio feedback
    await expect(page.getByText(/Loved the styling and warm hospitality/i)).not.toBeVisible();
    await expect(page.getByText(/Waited 45 mins past appointment/i)).not.toBeVisible();
    await expect(page.getByText(/How was your haircut/i)).not.toBeVisible();
  });

  test('TC-MOB-04: Mobile 320px viewport reflow and WCAG 2.2 AA accessibility scan', async ({
    page,
  }) => {
    // 1. Set mobile viewport (iPhone SE minimum 320px width)
    await page.setViewportSize({ width: 320, height: 640 });

    // 2. Sign in as Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 3. Navigate to Feedback
    await page.goto('/dashboard/feedback');
    await expect(
      page.getByRole('heading', { level: 1, name: /Customer Feedback Stream/i }),
    ).toBeVisible();

    // 4. Assert no horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // 5. Run Axe accessibility audit
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(axeResults.violations).toEqual([]);
  });
});
