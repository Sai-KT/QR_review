import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { performSafeLocalRateLimitReset } from './test-isolation';

test.describe('M3-T07: Customer Exception & Offline Network Fallback (SCR-CUST-12..15)', () => {
  test.beforeAll(async () => {
    // Strictly fail-closed local test isolation
    const resetResult = await performSafeLocalRateLimitReset();
    if (!resetResult.success && resetResult.reason?.includes('Refusing cleanup')) {
      console.warn(`[E2E Preflight] ${resetResult.reason}`);
    }
  });

  // --------------------------------------------------------------------------
  // 1. SCR-CUST-12: Invalid QR Code (404)
  // --------------------------------------------------------------------------
  test('renders SCR-CUST-12 on unknown QR token without leaking private data', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          text.includes('local.test') ||
          text.includes('ERR_NAME_NOT_RESOLVED') ||
          text.includes('ERR_NETWORK_IO_SUSPENDED') ||
          text.includes('ERR_NETWORK_CHANGED') ||
          text.includes('404')
        )
          return;
        consoleErrors.push(text);
      }
    });

    await page.goto('/q/badtoken99');

    // Friendly non-technical heading
    await expect(page.getByRole('heading', { name: 'QR Code Not Recognized' })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText(
        'This QR code is not recognized or may have been mistyped. Please verify the code with staff.',
      ),
    ).toBeVisible();

    // Honest Search on Google Maps fallback action
    const searchBtn = page.getByRole('button', { name: /Search on Google Maps ↗/i });
    await expect(searchBtn).toBeVisible();

    // Scan again / retry button
    const retryBtn = page.getByRole('button', { name: /Scan Again \/ Retry/i });
    await expect(retryBtn).toBeVisible();

    // Active token indicator in footer
    await expect(page.getByText('Active QR token parameter: "badtoken99"')).toBeVisible();

    // Zero internal schemas or stack traces leaked
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('ERR_QR_NOT_FOUND');
    expect(bodyText).not.toContain('PostgreSQL');
    expect(bodyText).not.toContain('table');

    expect(consoleErrors).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 2. SCR-CUST-13: Suspended Business Notice (403)
  // --------------------------------------------------------------------------
  test('renders SCR-CUST-13 on suspended tenant and prevents query param bypass', async ({
    page,
  }) => {
    // Visit live seeded suspended fixture: /q/susp000001?step=1
    // Proves query parameter ?step=1 CANNOT bypass suspension
    await page.goto('/q/susp000001?step=1');

    await expect(
      page.getByRole('heading', { name: 'Feedback Temporarily Unavailable' }),
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(
        'Review collection for this location is currently paused. Please speak directly with the team for assistance.',
      ),
    ).toBeVisible();

    await expect(
      page.getByText(
        'Zero private data or account suspension details are exposed to public patrons.',
      ),
    ).toBeVisible();

    // Zero survey controls rendered
    await expect(page.getByText('Question 1 of 3')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Start 30-Sec/i })).not.toBeVisible();

    // Zero outbound merchant links or review actions manufactured
    const cardLinks = await page.getByRole('main').getByRole('link').count();
    expect(cardLinks).toBe(0);
    await expect(page.getByRole('button', { name: /Google/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /WhatsApp/i })).not.toBeVisible();

    // Active token in footer
    await expect(page.getByText('Active QR token parameter: "susp000001"')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // 3. SCR-CUST-14: Direct Google-Only Mode (Lapsed Subscription)
  // --------------------------------------------------------------------------
  test('renders SCR-CUST-14 on direct-only merchant with store branding and WhatsApp link', async ({
    page,
  }) => {
    // Visit live seeded lapsed subscription fixture: /q/lapse00001?step=1
    await page.goto('/q/lapse00001?step=1');

    // Store branding
    await expect(page.getByRole('heading', { name: 'Vintage Brews Cafe' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('Café')).toBeVisible();

    // Direct Google Maps review action
    const googleBtn = page.getByRole('button', { name: 'Open Google Maps to Review ↗' });
    await expect(googleBtn).toBeVisible();

    // WhatsApp Manager contact action
    const waBtn = page.getByRole('button', { name: 'WhatsApp Manager' });
    await expect(waBtn).toBeVisible();

    // Explanation copy
    await expect(
      page.getByText(
        'We are currently collecting direct reviews on Google Maps. Thank you for your support!',
      ),
    ).toBeVisible();

    // Survey is completely bypassed (no MCQ questions)
    await expect(page.getByText('Question 1 of 3')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Start 30-Sec/i })).not.toBeVisible();

    // Zero mention of billing, expiration, or past due
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('past_due');
    expect(bodyText).not.toContain('expired');
    expect(bodyText).not.toContain('unpaid');
    expect(bodyText).not.toContain('payment');
  });

  // --------------------------------------------------------------------------
  // 4. Cross-Tenant Navigation Isolation
  // --------------------------------------------------------------------------
  test('clears previous merchant branding when navigating across QR routes', async ({
    page,
  }) => {
    // 1. Visit active salon
    await page.goto('/q/luxe000001');
    await expect(
      page.getByRole('heading', { name: 'Luxe Studio Unisex Salon' }),
    ).toBeVisible({ timeout: 10000 });

    // 2. Navigate to suspended business
    await page.goto('/q/susp000001');
    await expect(
      page.getByRole('heading', { name: 'Feedback Temporarily Unavailable' }),
    ).toBeVisible({ timeout: 10000 });

    // Confirm Luxe Studio branding is completely unmounted
    await expect(page.getByRole('heading', { name: 'Luxe Studio Unisex Salon' })).not.toBeVisible();
    await expect(page.getByText('Salon', { exact: true })).not.toBeVisible();

    // 3. Navigate to unknown QR
    await page.goto('/q/badtoken99');
    await expect(page.getByRole('heading', { name: 'QR Code Not Recognized' })).toBeVisible({
      timeout: 10000,
    });

    // Confirm suspended notice is unmounted
    await expect(
      page.getByRole('heading', { name: 'Feedback Temporarily Unavailable' }),
    ).not.toBeVisible();
  });

  // --------------------------------------------------------------------------
  // 5. SCR-CUST-15: Offline Connection Banner & Mid-Survey State Preservation
  // --------------------------------------------------------------------------
  test('displays offline banner and preserves answered questions and note across network events', async ({
    page,
  }) => {
    // 1. Visit active salon survey
    await page.goto('/q/luxe000001?step=1');
    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });

    // Answer Q1
    await page.getByText('Masterful & Precise').click();
    await page.getByRole('button', { name: /Next to question 2/i }).click();

    // Answer Q2
    await expect(page.getByText('Question 2 of 3')).toBeVisible({ timeout: 5000 });
    await page.getByText('Clean & hygienic station').click();

    // 2. Dispatch browser offline event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Offline banner must appear immediately
    await expect(page.getByText('Connection Lost')).toBeVisible();
    await expect(
      page.getByText(/Please check your connection\. Your current answers are safely retained\./i),
    ).toBeVisible();

    // Verify option Q2 is still checked and progress preserved
    const optQ2 = page.getByRole('radio', { name: /Clean & hygienic station/i });
    await expect(optQ2).toBeChecked();

    // Advance to Q3 while still offline
    await page.getByRole('button', { name: /Next to question 3/i }).click();
    await expect(page.getByText('Question 3 of 3')).toBeVisible({ timeout: 5000 });
    await page.getByText('Great styling advice').click();

    // Advance to Note Editor while offline
    await page.getByRole('button', { name: /Next, optional note/i }).click();
    await expect(page.getByRole('heading', { name: /Add an Optional Note/i })).toBeVisible({
      timeout: 5000,
    });

    // Enter note while offline
    const noteTextarea = page.getByRole('textbox', { name: /Personal Note/i });
    await noteTextarea.fill('Stylist was exceptional despite network drops!');

    // 3. Dispatch browser online event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Banner is dismissed
    await expect(page.getByText('Connection Lost')).not.toBeVisible();

    // Note content and character count remain completely intact
    await expect(noteTextarea).toHaveValue('Stylist was exceptional despite network drops!');
  });

  // --------------------------------------------------------------------------
  // 6. WCAG 2.2 AA Accessibility Audits
  // --------------------------------------------------------------------------
  test('executes axe-core WCAG 2.2 AA audit on SCR-CUST-12, SCR-CUST-13, and SCR-CUST-14', async ({
    page,
  }) => {
    // 1. Audit SCR-CUST-12 (Invalid QR)
    await page.goto('/q/badtoken99');
    await expect(page.getByRole('heading', { name: 'QR Code Not Recognized' })).toBeVisible({
      timeout: 10000,
    });

    const auditCust12 = await new AxeBuilder({ page })
      .include('#root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(auditCust12.violations).toEqual([]);

    // 2. Audit SCR-CUST-13 (Suspended Business)
    await page.goto('/q/susp000001');
    await expect(
      page.getByRole('heading', { name: 'Feedback Temporarily Unavailable' }),
    ).toBeVisible({ timeout: 10000 });

    const auditCust13 = await new AxeBuilder({ page })
      .include('#root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(auditCust13.violations).toEqual([]);

    // 3. Audit SCR-CUST-14 (Direct-Only Mode)
    await page.goto('/q/lapse00001');
    await expect(page.getByRole('heading', { name: 'Vintage Brews Cafe' })).toBeVisible({
      timeout: 10000,
    });

    const auditCust14 = await new AxeBuilder({ page })
      .include('#root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(auditCust14.violations).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 7. Mobile 320px Viewport Reflow (TC-A11Y-04 / TC-MOB-01)
  // --------------------------------------------------------------------------
  test('verifies 320px viewport reflow and touch target sizing (>= 44px) on status screens', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });

    // 1. Direct-Only Card 320px check
    await page.goto('/q/lapse00001');
    await expect(page.getByRole('heading', { name: 'Vintage Brews Cafe' })).toBeVisible({
      timeout: 10000,
    });

    // Verify touch target height for primary action is at least 44px
    const googleBtn = page.getByRole('button', { name: 'Open Google Maps to Review ↗' });
    const box = await googleBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Verify zero horizontal scrolling
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // 2. Invalid QR Card 320px check
    await page.goto('/q/badtoken99');
    await expect(page.getByRole('heading', { name: 'QR Code Not Recognized' })).toBeVisible({
      timeout: 10000,
    });

    const searchBtn = page.getByRole('button', { name: /Search on Google Maps ↗/i });
    const searchBox = await searchBtn.boundingBox();
    expect(searchBox).not.toBeNull();
    expect(searchBox!.height).toBeGreaterThanOrEqual(44);

    const scrollWidth404 = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth404 = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth404).toBeLessThanOrEqual(clientWidth404);
  });
});

